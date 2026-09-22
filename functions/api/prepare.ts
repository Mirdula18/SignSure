import { prepareModelOutputSchema, prepareRequestSchema } from '../../shared/schemas';
import { findMissingInfo, notStatedLine, ruleQuestions, runRules } from '../../shared/rules';
import type { PrepareResult } from '../../shared/types';
import type { Env } from '../lib/env';
import { isMockMode } from '../lib/env';
import { createGeminiClient } from '../lib/gemini';
import { errorResponse, json, parseBody } from '../lib/http';
import { prepareSystemPrompt, prepareUserPrompt } from '../lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { PREPARE_SCHEMA } from '../lib/responseSchemas';
import { requireSession } from './session';

/**
 * Builds the sheet the user takes to HR or a lawyer.
 *
 * The model drafts; the rule library has the last word. Reviewed questions from the serious
 * rules that fired are appended verbatim, so the ones tied to a statute are present even if the
 * model forgot them, and they read exactly as a human wrote them.
 */

const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 2048;

/** A sheet longer than this stops being something a person actually uses in a meeting. */
const MAX_REVIEWED_QUESTIONS = 12;

/**
 * Case- and punctuation-insensitive de-duplication, so near-identical questions collapse.
 *
 * The key keeps every letter and digit in any script. An ASCII-only key reduced every Hindi
 * question to an empty string, so a Hindi prep sheet collapsed to one question per section.
 */
function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireSession(request, env);
  if (!session.ok) return session.response;

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'prepare', session.ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, prepareRequestSchema);
  if (!body.ok) return body.response;

  const { clauses, findings, lenses, unansweredQuestions, language, readingLevel } = body.data;

  const categories: Record<string, (typeof findings)[number]['category']> = {};
  for (const finding of findings) categories[finding.clauseId] = finding.category;

  const hits = runRules(clauses, categories);
  // Only the serious hits contribute reviewed questions. Every rule that fires has questions
  // attached, and a document that trips a dozen INFO rules would otherwise produce a sheet of
  // thirty questions that nobody takes to a meeting.
  const reviewedQuestions = ruleQuestions(
    hits.filter((hit) => hit.severity === 'HIGH' || hit.severity === 'MEDIUM'),
    language,
  ).slice(0, MAX_REVIEWED_QUESTIONS);
  const gaps = findMissingInfo(clauses);

  const mockResponder = isMockMode(env) ? (await import('../lib/mock')).mockResponder : undefined;
  const gemini = createGeminiClient(env, mockResponder);

  const outcome = await gemini.generate({
    systemInstruction: prepareSystemPrompt({ language, readingLevel }),
    userPrompt: prepareUserPrompt({
      clauses,
      findings,
      ruleQuestions: reviewedQuestions,
      unansweredQuestions,
      lenses: lenses,
    }),
    responseSchema: PREPARE_SCHEMA,
    schema: prepareModelOutputSchema,
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!outcome.ok) return errorResponse(outcome.code, rateLimitHeaders(rate));

  const result: PrepareResult = {
    checklistBeforeSigning: dedupe(outcome.data.checklistBeforeSigning),
    questionsForHR: dedupe(outcome.data.questionsForHR),
    // Reviewed rule questions go last so the model's context-specific ones read first, but
    // they are never dropped: they are the ones tied to a statute.
    questionsForLawyer: dedupe([...outcome.data.questionsForLawyer, ...reviewedQuestions]),
    missingInformation: dedupe([
      ...outcome.data.missingInformation,
      ...gaps.map((gap) => notStatedLine(gap, language)),
    ]),
    documentsToBring: dedupe(outcome.data.documentsToBring),
  };

  return json(result, 200, rateLimitHeaders(rate));
};

export { dedupe };
