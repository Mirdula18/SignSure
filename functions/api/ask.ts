import { askModelOutputSchema, askRequestSchema } from '../../shared/schemas';
import type { AskResult, Clause, VerifiedQuote } from '../../shared/types';
import { buildVerifiedQuote, isPresentable } from '../../shared/verify';
import type { Env } from '../lib/env';
import { isMockMode } from '../lib/env';
import { createGeminiClient } from '../lib/gemini';
import { errorResponse, json, parseBody } from '../lib/http';
import { askSystemPrompt, askUserPrompt } from '../lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { ASK_SCHEMA } from '../lib/responseSchemas';
import { requireSession } from './session';

/**
 * Grounded question answering.
 *
 * The rule that makes this trustworthy is at the bottom of the file: if the model says it
 * answered but not one of its citations survives verification, the answer is replaced with
 * "your document does not say this". A confident, fluent, unsupported answer is the exact
 * failure mode SignSure exists to prevent, so it is handled as a hard downgrade rather than a
 * warning badge.
 */

const TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 1536;

/** Shown when an answer loses all its support. Plain, and immediately useful. */
const DOWNGRADE_ANSWER =
  'Your document does not say this. SignSure could not find anything in your document that supports an answer, so rather than guessing, here is what you could ask instead.';

const DOWNGRADE_MISSING_INFO = 'Your document does not appear to cover this topic.';

const DOWNGRADE_QUESTIONS = [
  'Is this covered by a separate company policy, and can I see it?',
  'Can you confirm the position in writing before I sign?',
];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireSession(request, env);
  if (!session.ok) return session.response;

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'ask', session.ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, askRequestSchema);
  if (!body.ok) return body.response;

  const { clauses, question, history, language, readingLevel } = body.data;

  const mockResponder = isMockMode(env) ? (await import('../lib/mock')).mockResponder : undefined;
  const gemini = createGeminiClient(env, mockResponder);

  const outcome = await gemini.generate({
    systemInstruction: askSystemPrompt({ language, readingLevel }),
    userPrompt: askUserPrompt(history ? { clauses, question, history } : { clauses, question }),
    responseSchema: ASK_SCHEMA,
    schema: askModelOutputSchema,
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!outcome.ok) return errorResponse(outcome.code, rateLimitHeaders(rate));

  return json(toAskResult(outcome.data, clauses), 200, rateLimitHeaders(rate));
};

export interface AskModelShape {
  status: 'answered' | 'not_in_document' | 'needs_professional';
  answer: string;
  citations: { clauseId: string; quote: string }[];
  missingInfo: string[];
  suggestedQuestions: string[];
}

/**
 * Verifies citations and applies the downgrade rule.
 *
 * Exported so the rule can be tested directly rather than only through a network handler: it is
 * the single most important behaviour in the product.
 */
export function toAskResult(model: AskModelShape, clauses: readonly Clause[]): AskResult {
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));

  const citations: VerifiedQuote[] = model.citations.map((citation) =>
    buildVerifiedQuote(citation.clauseId, citation.quote, byId.get(citation.clauseId)?.text),
  );

  const supported = citations.filter(isPresentable);

  // "answered" with nothing that checks out is indistinguishable from a confident guess.
  if (model.status === 'answered' && supported.length === 0) {
    return {
      status: 'not_in_document',
      answer: DOWNGRADE_ANSWER,
      citations: [],
      missingInfo: model.missingInfo.length > 0 ? model.missingInfo : [DOWNGRADE_MISSING_INFO],
      suggestedQuestions:
        model.suggestedQuestions.length > 0 ? model.suggestedQuestions : DOWNGRADE_QUESTIONS,
    };
  }

  return {
    status: model.status,
    answer: model.answer,
    // Unverified citations are dropped rather than shown with a caveat: an answer stands on
    // the evidence that survived, and evidence that did not is not evidence.
    citations: supported,
    missingInfo: model.missingInfo,
    suggestedQuestions: model.suggestedQuestions,
  };
}

export { DOWNGRADE_ANSWER };
