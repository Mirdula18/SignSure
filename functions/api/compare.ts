import { changedPairs, pairClauses, unchangedCount, type ClausePair } from '../../shared/compare';
import { compareModelOutputSchema, compareRequestSchema } from '../../shared/schemas';
import type { ClauseChange, CompareResult, VerifiedQuote } from '../../shared/types';
import { buildVerifiedQuote } from '../../shared/verify';
import type { Env } from '../lib/env';
import { isMockMode } from '../lib/env';
import { createGeminiClient } from '../lib/gemini';
import { errorResponse, json, parseBody } from '../lib/http';
import { compareSystemPrompt, compareUserPrompt } from '../lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { COMPARE_SCHEMA } from '../lib/responseSchemas';
import { requireSession } from './session';

/**
 * Compares two versions of an offer.
 *
 * Pairing is deterministic (`shared/compare.ts`) and happens before the model is involved, so
 * the model is only asked the judgemental part: does this difference matter to the employee.
 * Both quotes are then verified against their *own* side, which is what stops a change being
 * illustrated with text from the wrong version.
 */

const TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 4096;

/** Cap on pairs sent in one call, so a heavily rewritten document cannot blow the budget. */
const MAX_PAIRS = 60;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireSession(request, env);
  if (!session.ok) return session.response;

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'compare', session.ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, compareRequestSchema);
  if (!body.ok) return body.response;

  const { clausesA, clausesB, language, readingLevel } = body.data;

  const allPairs = pairClauses(clausesA, clausesB);
  const toExplain = changedPairs(allPairs).slice(0, MAX_PAIRS);
  const unchanged = unchangedCount(allPairs);

  if (toExplain.length === 0) {
    return json(
      { changes: [], unchangedCount: unchanged } satisfies CompareResult,
      200,
      rateLimitHeaders(rate),
    );
  }

  const mockResponder = isMockMode(env) ? (await import('../lib/mock')).mockResponder : undefined;
  const gemini = createGeminiClient(env, mockResponder);

  const outcome = await gemini.generate({
    systemInstruction: compareSystemPrompt({ language, readingLevel }),
    userPrompt: compareUserPrompt(toExplain),
    responseSchema: COMPARE_SCHEMA,
    schema: compareModelOutputSchema,
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!outcome.ok) return errorResponse(outcome.code, rateLimitHeaders(rate));

  const result: CompareResult = {
    changes: toChanges(outcome.data.changes, toExplain),
    unchangedCount: unchanged,
  };
  return json(result, 200, rateLimitHeaders(rate));
};

export interface CompareModelChange {
  pairId: string;
  changeType: 'ADDED' | 'REMOVED' | 'CHANGED';
  impact: 'BETTER_FOR_EMPLOYEE' | 'WORSE_FOR_EMPLOYEE' | 'NEUTRAL' | 'UNCLEAR';
  summary: string;
  quoteA?: string | null | undefined;
  quoteB?: string | null | undefined;
}

/**
 * Verifies each side of every reported change.
 *
 * Exported for direct testing. A change whose pair id we never sent is dropped, and the change
 * type is corrected from our own pairing rather than trusted from the model: whether a clause
 * exists on one side is a fact we already know.
 */
export function toChanges(
  modelChanges: readonly CompareModelChange[],
  pairs: readonly ClausePair[],
): ClauseChange[] {
  const byPairId = new Map(pairs.map((pair) => [pair.pairId, pair]));
  const changes: ClauseChange[] = [];

  for (const change of modelChanges) {
    const pair = byPairId.get(change.pairId);
    if (!pair) continue;

    const quoteA = verifySide(pair.a, change.quoteA);
    const quoteB = verifySide(pair.b, change.quoteB);

    changes.push({
      pairId: pair.pairId,
      // Presence on each side is ours to determine, not the model's.
      changeType: pair.a === null ? 'ADDED' : pair.b === null ? 'REMOVED' : 'CHANGED',
      impact: change.impact,
      summary: change.summary,
      category: pair.category,
      quoteA,
      quoteB,
    });
  }

  return changes;
}

function verifySide(
  clause: ClausePair['a'],
  quote: string | null | undefined,
): VerifiedQuote | null {
  if (clause === null || quote === null || quote === undefined || quote.trim().length === 0) {
    return null;
  }
  return buildVerifiedQuote(clause.id, quote, clause.text);
}
