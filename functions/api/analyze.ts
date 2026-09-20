import { LIMITS } from '../../shared/limits';
import { analyzeModelOutputSchema, analyzeRequestSchema } from '../../shared/schemas';
import { findMissingInfo, runRules } from '../../shared/rules';
import type {
  AnalysisResult,
  Clause,
  ClauseFinding,
  DocumentSummary,
  VerificationStats,
} from '../../shared/types';
import { buildVerifiedQuote } from '../../shared/verify';
import { rankFindings, type Lens } from '../../shared/lenses';
import type { Env } from '../lib/env';
import { isMockMode } from '../lib/env';
import { createGeminiClient } from '../lib/gemini';
import { errorResponse, json } from '../lib/http';
import { parseBody } from '../lib/http';
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

/** Splits clauses into prompt-sized batches so a long contract does not blow the token budget. */
export function batchClauses(
  clauses: readonly Clause[],
  size = LIMITS.clauseBatchSize,
): Clause[][] {
  const batches: Clause[][] = [];
  for (let index = 0; index < clauses.length; index += size) {
    batches.push(clauses.slice(index, index + size));
  }
  return batches;
}

/** Runs batches with bounded concurrency, because Workers cap subrequests per invocation. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    const window = items.slice(index, index + limit);
    results.push(...(await Promise.all(window.map(run))));
  }
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
    }),
  );

  const succeeded = outcomes.filter((outcome) => outcome.ok);
  if (succeeded.length === 0) {
    const first = outcomes[0];
    return errorResponse(first && !first.ok ? first.code : 'INTERNAL', rateLimitHeaders(rate));
  }

  const findings: ClauseFinding[] = [];
  const categories: Record<string, ClauseFinding['category']> = {};
  let summary: DocumentSummary = EMPTY_SUMMARY;
  let summaryTaken = false;

  for (const outcome of succeeded) {
    if (!outcome.ok) continue;

    // The first batch that produced a summary wins: later batches only saw later clauses, so
    // their view of "who is the employer" is strictly less informed.
    if (!summaryTaken && outcome.data.documentSummary.overview.length > 0) {
      summary = toSummary(outcome.data.documentSummary, byId);
      summaryTaken = true;
    }

    for (const finding of outcome.data.findings) {
      const clause = byId.get(finding.clauseId);
      // A clause id we never sent is a hallucination; there is nothing to verify against.
      if (!clause) continue;

      findings.push({
        clauseId: clause.id,
        category: finding.category,
        risk: finding.risk,
        title: finding.title,
        explanation: finding.explanation,
        whyItMatters: finding.whyItMatters,
        evidence: buildVerifiedQuote(clause.id, finding.quote, clause.text),
        questionsToAsk: finding.questionsToAsk,
        modelConfidence: finding.confidence,
      });
      categories[clause.id] = finding.category;
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
    stats: countVerification(ranked),
  };

  return json(result, 200, rateLimitHeaders(rate));
};

function countVerification(findings: readonly ClauseFinding[]): VerificationStats {
  const stats: VerificationStats = { verified: 0, fuzzy: 0, unverified: 0 };
  for (const finding of findings) stats[finding.evidence.status] += 1;
  return stats;
}

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
