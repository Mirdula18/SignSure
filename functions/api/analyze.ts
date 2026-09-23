import { LIMITS } from '../../shared/limits';
import { analyzeModelOutputSchema, analyzeRequestSchema } from '../../shared/schemas';
import { findMissingInfo, runRules } from '../../shared/rules';
import type { AnalysisResult, Clause, ClauseFinding, DocumentSummary } from '../../shared/types';
import { buildVerifiedQuote, isPresentable, summarizeVerification } from '../../shared/verify';
import { required } from '../../shared/arrays';
import { rankFindings, type Lens } from '../../shared/lenses';
import { isMockMode, type Env } from '../lib/env';
import { createGeminiClient } from '../lib/gemini';
import { errorResponse, json, parseBody } from '../lib/http';
import { analyzeSystemPrompt, analyzeUserPrompt } from '../lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { ANALYZE_SCHEMA } from '../lib/responseSchemas';
import { requireSession } from './session';

/**
 * Classifies and explains a document.
 *
 * The order of operations is the product: validate, ask the model, then *disbelieve it* until
 * each claim is checked against the clause it names. Anything the model says about a clause id
 * we did not send is dropped, and every quote goes through `shared/verify.ts`. Only then does
 * the deterministic rule library run, and its text is the only legal content in the response.
 */

const TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Longer than the default deadline, because this is the one call that reads a whole document
 * and writes a finding for every clause worth one. Measured on 2026-09-23 against
 * gemini-3.6-flash, the 26-clause sample letter did not finish inside 25 seconds; asking a
 * question about the same document took about 7. The reader waits on a progress message, and a
 * late report beats a failed one.
 */
const ANALYZE_TIMEOUT_MS = 45_000;

/** Splits clauses into prompt-sized batches so a long contract does not blow the token budget. */
export function batchClauses(
  clauses: readonly Clause[],
  size: number = LIMITS.clauseBatchSize,
): Clause[][] {
  const batches: Clause[][] = [];
  for (let index = 0; index < clauses.length; index += size) {
    batches.push(clauses.slice(index, index + size));
  }
  return batches;
}

/**
 * Runs `run` over `items` with at most `limit` in flight, because Workers cap subrequests per
 * invocation.
 *
 * A pool rather than fixed windows: the next batch starts the moment any batch finishes, so one
 * slow batch holds up only its own slot instead of every batch queued behind its window.
 * Results come back in input order whatever order they finish in.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(required(items, index));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const EMPTY_SUMMARY: DocumentSummary = {
  documentType: null,
  employer: null,
  role: null,
  startDate: null,
  noticePeriod: null,
  probation: null,
  bondOrPenalty: null,
  overview: '',
  sourceClauseIds: [],
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireSession(request, env);
  if (!session.ok) return session.response;

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'analyze', session.ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, analyzeRequestSchema);
  if (!body.ok) return body.response;

  const { clauses, lenses, language, readingLevel } = body.data;
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));

  const mockResponder = isMockMode(env) ? (await import('../lib/mock')).mockResponder : undefined;
  const gemini = createGeminiClient(env, mockResponder);
  const systemInstruction = analyzeSystemPrompt({ language, readingLevel }, lenses);

  const outcomes = await mapWithLimit(batchClauses(clauses), LIMITS.maxParallelBatches, (batch) =>
    gemini.generate({
      systemInstruction,
      userPrompt: analyzeUserPrompt(batch),
      responseSchema: ANALYZE_SCHEMA,
      schema: analyzeModelOutputSchema,
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: ANALYZE_TIMEOUT_MS,
    }),
  );

  const successes = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.data] : []));
  const failures = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.code]));
  // A request always holds at least one clause, so with no successes there is a first failure.
  if (successes.length === 0) {
    return errorResponse(required(failures, 0), rateLimitHeaders(rate));
  }

  const findings: ClauseFinding[] = [];
  const categories: Record<string, ClauseFinding['category']> = {};
  let summary: DocumentSummary = EMPTY_SUMMARY;
  let summaryTaken = false;

  for (const data of successes) {
    // The first batch that produced a summary wins: later batches only saw later clauses, so
    // their view of "who is the employer" is strictly less informed.
    if (!summaryTaken && data.documentSummary.overview.length > 0) {
      summary = toSummary(data.documentSummary, byId);
      summaryTaken = true;
    }

    for (const finding of data.findings) {
      const clause = byId.get(finding.clauseId);
      // A clause id we never sent is a hallucination; there is nothing to verify against.
      if (!clause) continue;

      const evidence = buildVerifiedQuote(clause.id, finding.quote, clause.text);
      findings.push({
        clauseId: clause.id,
        category: finding.category,
        risk: finding.risk,
        title: finding.title,
        explanation: finding.explanation,
        whyItMatters: finding.whyItMatters,
        evidence,
        questionsToAsk: finding.questionsToAsk,
        modelConfidence: finding.confidence,
      });

      // The category steers which reviewed rules run, so it is taken only from a finding whose
      // quote checked out, and the first such finding keeps it. Otherwise an unverified claim
      // about a clause could change the legal context shown for that clause.
      if (isPresentable(evidence) && categories[clause.id] === undefined) {
        categories[clause.id] = finding.category;
      }
    }
  }

  const ruleHits = runRules(clauses, categories);
  const missingInfo = findMissingInfo(clauses);
  const ranked = rankFindings(findings, lenses as readonly Lens[]);

  const result: AnalysisResult = {
    documentSummary: summary,
    findings: ranked,
    ruleHits,
    missingInfo,
    stats: summarizeVerification(ranked.map((finding) => finding.evidence)),
    // Some batches failed: say so, rather than presenting part of a document as all of it.
    partial: failures.length > 0,
  };

  return json(result, 200, rateLimitHeaders(rate));
};

/**
 * Normalises the model's summary.
 *
 * `nullish` fields become `null` so the UI has exactly one "not stated" case to render, and
 * source clause ids the model invented are dropped rather than shown as provenance.
 */
function toSummary(
  raw: {
    documentType?: string | null | undefined;
    employer?: string | null | undefined;
    role?: string | null | undefined;
    startDate?: string | null | undefined;
    noticePeriod?: string | null | undefined;
    probation?: string | null | undefined;
    bondOrPenalty?: string | null | undefined;
    overview: string;
    sourceClauseIds: string[];
  },
  byId: ReadonlyMap<string, Clause>,
): DocumentSummary {
  return {
    documentType: raw.documentType ?? null,
    employer: raw.employer ?? null,
    role: raw.role ?? null,
    startDate: raw.startDate ?? null,
    noticePeriod: raw.noticePeriod ?? null,
    probation: raw.probation ?? null,
    bondOrPenalty: raw.bondOrPenalty ?? null,
    overview: raw.overview,
    sourceClauseIds: raw.sourceClauseIds.filter((id) => byId.has(id)),
  };
}
