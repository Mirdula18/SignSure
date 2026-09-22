import { askModelOutputSchema, askRequestSchema, type Language } from '../../shared/schemas';
import type { AskResult, Clause, VerifiedQuote } from '../../shared/types';
import { buildVerifiedQuote, isPresentable } from '../../shared/verify';
import { isMockMode, type Env } from '../lib/env';
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
/**
 * Fixed replies used when the model's own answer cannot be shown, in the reader's language.
 *
 * Written and reviewed here rather than generated, because they replace an answer precisely when
 * the model's words could not be backed by the document.
 */
const FIXED_REPLIES = {
  en: {
    downgrade:
      'Your document does not say this. SignSure could not find anything in your document that supports an answer, so rather than guessing, here is what you could ask instead.',
    unsupportedProfessional:
      'This is a question for a qualified lawyer. SignSure could not point to a clause in your document that settles it, so it will not guess; the questions below may help you prepare.',
    missingInfo: 'Your document does not appear to cover this topic.',
    questions: [
      'Is this covered by a separate company policy, and can I see it?',
      'Can you confirm the position in writing before I sign?',
    ],
  },
  hi: {
    downgrade:
      'आपके डॉक्यूमेंट में यह नहीं लिखा है। SignSure को आपके डॉक्यूमेंट में ऐसा कुछ नहीं मिला जिससे इसका जवाब दिया जा सके, इसलिए अंदाज़ा लगाने के बजाय, आप ये सवाल पूछ सकते हैं।',
    unsupportedProfessional:
      'यह सवाल किसी योग्य वकील से पूछने लायक है। SignSure आपके डॉक्यूमेंट में ऐसी कोई शर्त नहीं दिखा सका जिससे इसका जवाब तय हो, इसलिए वह अंदाज़ा नहीं लगाएगा; नीचे दिए सवाल आपकी तैयारी में मदद कर सकते हैं।',
    missingInfo: 'ऐसा लगता है कि आपका डॉक्यूमेंट इस विषय के बारे में कुछ नहीं कहता।',
    questions: [
      'क्या यह किसी अलग कंपनी नीति में लिखा है, और क्या वह नीति मुझे दिखाई जा सकती है?',
      'क्या साइन करने से पहले आप यह बात लिखित में पक्की कर सकते हैं?',
    ],
  },
} as const satisfies Record<Language, unknown>;

/** The English downgrade reply, kept as a named export for the tests that pin it. */
const DOWNGRADE_ANSWER = FIXED_REPLIES.en.downgrade;

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

  return json(toAskResult(outcome.data, clauses, language), 200, rateLimitHeaders(rate));
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
export function toAskResult(
  model: AskModelShape,
  clauses: readonly Clause[],
  language: Language = 'en',
): AskResult {
  const fixed = FIXED_REPLIES[language];
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));

  const citations: VerifiedQuote[] = model.citations.map((citation) =>
    buildVerifiedQuote(citation.clauseId, citation.quote, byId.get(citation.clauseId)?.text),
  );

  const supported = citations.filter(isPresentable);

  // "answered" with nothing that checks out is indistinguishable from a confident guess.
  if (model.status === 'answered' && supported.length === 0) {
    return {
      status: 'not_in_document',
      answer: fixed.downgrade,
      citations: [],
      missingInfo: model.missingInfo.length > 0 ? model.missingInfo : [fixed.missingInfo],
      suggestedQuestions:
        model.suggestedQuestions.length > 0 ? model.suggestedQuestions : [...fixed.questions],
    };
  }

  // "Ask a lawyer" is the right status here, but prose about the reader's contract that cites
  // nothing verifiable is still an unchecked claim, so it is replaced with a fixed reply.
  if (model.status === 'needs_professional' && supported.length === 0) {
    return {
      status: 'needs_professional',
      answer: fixed.unsupportedProfessional,
      citations: [],
      missingInfo: model.missingInfo,
      suggestedQuestions:
        model.suggestedQuestions.length > 0 ? model.suggestedQuestions : [...fixed.questions],
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
