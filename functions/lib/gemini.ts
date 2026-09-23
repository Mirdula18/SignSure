import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { z } from 'zod';
import { isMockMode, modelId, thinkingLadder, type Env } from './env';
import { cacheKey, ResponseCache } from './responseCache';
import type { ApiErrorCode } from '../../shared/types';

/**
 * The only place in SignSure that talks to Gemini.
 *
 * Everything the model returns is treated as untrusted input: it is requested as JSON against a
 * response schema, parsed, and validated with Zod before any caller sees it. A model that
 * returns prose, an extra key, or an invented enum value produces a typed failure rather than
 * flowing into the UI.
 *
 * Mock mode exists so the whole product - including the end-to-end suite - runs with no API key
 * and no network. It is not a stub that returns `{}`: the fixtures are shaped exactly like real
 * responses, so the verification pipeline does real work on them.
 */

export type GeminiFailure = Extract<
  ApiErrorCode,
  'MODEL_BLOCKED' | 'MODEL_INVALID_OUTPUT' | 'UPSTREAM_TIMEOUT' | 'RATE_LIMITED' | 'INTERNAL'
>;

export type GeminiResult<T> = { ok: true; data: T } | { ok: false; code: GeminiFailure };

export interface GenerateOptions<S extends z.ZodType> {
  systemInstruction: string;
  userPrompt: string;
  /** Gemini response schema, mirroring `schema` so the model is steered, not just checked. */
  responseSchema: Record<string, unknown>;
  /** Zod schema the response must satisfy before it is returned. */
  schema: S;
  temperature: number;
  maxOutputTokens: number;
  /** Overrides the default deadline for a call that legitimately takes longer. */
  timeoutMs?: number;
}

/** A user is waiting, so a slow model is a failure rather than something to wait out. */
const REQUEST_TIMEOUT_MS = 25_000;

/** One retry on a transient upstream failure, with jitter so retries do not synchronise. */
const MAX_TRANSIENT_RETRIES = 1;

function backoffMs(): number {
  return 400 + Math.floor(Math.random() * 400);
}

/**
 * The model refusing the thinking setting itself, rather than the request.
 *
 * Models differ: `gemini-3.7-flash` answers 400 "Thinking level MINIMAL is not supported for
 * this model" while others accept it. The caller steps down the ladder and tries again instead
 * of failing a request over a performance hint.
 */
function isThinkingUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thinking/i.test(message) && /\b400\b|INVALID_ARGUMENT/.test(message);
}

/**
 * A quota or rate limit at Google, rather than a blip.
 *
 * Kept apart from the transient failures below because retrying cannot help: the second call
 * spends quota that is already gone, and the reader waits through the backoff for the same
 * answer. Reported as RATE_LIMITED so they are told to wait and try again, which is true,
 * instead of "something went wrong", which is not.
 */
function isQuotaExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i.test(message);
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(500|502|503|504)\b|overloaded|unavailable|rate limit/i.test(message);
}

/** Strips a ```json fence, which models sometimes add despite being asked for raw JSON. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

export interface GeminiClient {
  generate<S extends z.ZodType>(options: GenerateOptions<S>): Promise<GeminiResult<z.infer<S>>>;
}

/** Signature of the mock provider, so tests and fixtures share one contract. */
export type MockResponder = (options: { systemInstruction: string; userPrompt: string }) => unknown;

/**
 * Builds the client for this request.
 *
 * `mockResponder` is injected rather than imported at module scope so that the fixture module
 * is only loaded when mock mode is on, keeping it out of the production bundle's hot path.
 */
export function createGeminiClient(env: Env, mockResponder?: MockResponder): GeminiClient {
  if (isMockMode(env)) return createMockClient(mockResponder);
  return createLiveClient(env);
}

function createMockClient(mockResponder: MockResponder | undefined): GeminiClient {
  return {
    generate<S extends z.ZodType>(options: GenerateOptions<S>): Promise<GeminiResult<z.infer<S>>> {
      if (!mockResponder) return Promise.resolve({ ok: false, code: 'INTERNAL' });
      const raw = mockResponder({
        systemInstruction: options.systemInstruction,
        userPrompt: options.userPrompt,
      });
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) return Promise.resolve({ ok: false, code: 'MODEL_INVALID_OUTPUT' });
      return Promise.resolve({ ok: true, data: parsed.data });
    },
  };
}

/**
 * Shared by every request this isolate serves, which is the point: a per-request cache would
 * never see a repeat. Sized for a handful of documents, because each entry is a whole analysis.
 */
const responseCache = new ResponseCache<GeminiResult<unknown>>({
  maxEntries: 64,
  ttlMs: 10 * 60 * 1000,
});

/** Empties the response cache, so tests never see an answer another test paid for. */
export function clearResponseCache(): void {
  responseCache.clear();
}

function createLiveClient(env: Env): GeminiClient {
  const apiKey = env.GEMINI_API_KEY;
  const model = modelId(env);
  // Where this model sits on the ladder. Remembered, so a model that refuses a level costs one
  // extra call once rather than on every request.
  const ladder = thinkingLadder(env);
  let rung = 0;

  return {
    async generate<S extends z.ZodType>(
      options: GenerateOptions<S>,
    ): Promise<GeminiResult<z.infer<S>>> {
      if (apiKey === undefined || apiKey.length === 0) {
        return { ok: false, code: 'INTERNAL' };
      }
      // The Zod schema is left out of the key: it is code, and the response schema beside it
      // already describes the same shape.
      const key = await cacheKey({
        model,
        systemInstruction: options.systemInstruction,
        userPrompt: options.userPrompt,
        responseSchema: options.responseSchema,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      const result = await responseCache.getOrLoad(
        key,
        () => generateUncached(new GoogleGenAI({ apiKey }), options),
        (outcome) => outcome.ok,
      );
      return result as GeminiResult<z.infer<S>>;
    },
  };

  async function generateUncached<S extends z.ZodType>(
    ai: GoogleGenAI,
    options: GenerateOptions<S>,
  ): Promise<GeminiResult<unknown>> {
    let lastFailure: GeminiFailure = 'INTERNAL';

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      const outcome = await callOnce(ai, model, options, ladder[rung] ?? null);
      if (outcome.kind === 'ok') return { ok: true, data: outcome.data };
      if (outcome.kind === 'fatal') return { ok: false, code: outcome.code };
      if (outcome.kind === 'thinking-unsupported') {
        // Not a failure of the request: step down and try the same call again, without
        // spending one of the retries meant for a flaky upstream.
        rung += 1;
        attempt -= 1;
        continue;
      }
      lastFailure = outcome.code;
      if (attempt < MAX_TRANSIENT_RETRIES) await sleep(backoffMs());
    }

    // The model produced something unparseable; ask once more for JSON only before failing.
    if (lastFailure === 'MODEL_INVALID_OUTPUT') {
      const repair = await callOnce(
        ai,
        model,
        {
          ...options,
          userPrompt: `${options.userPrompt}\n\nReturn valid JSON only, matching the schema exactly. No markdown, no commentary.`,
        },
        ladder[rung] ?? null,
      );
      if (repair.kind === 'ok') return { ok: true, data: repair.data };
    }

    return { ok: false, code: lastFailure };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CallOutcome =
  | { kind: 'ok'; data: unknown }
  /** Retrying could help. */
  | { kind: 'transient'; code: GeminiFailure }
  /** The model rejected the thinking hint; the same call with less of it should work. */
  | { kind: 'thinking-unsupported' }
  /** Retrying cannot help; return immediately. */
  | { kind: 'fatal'; code: GeminiFailure };

async function callOnce<S extends z.ZodType>(
  ai: GoogleGenAI,
  model: string,
  options: GenerateOptions<S>,
  thinking: 'MINIMAL' | 'LOW' | null,
): Promise<CallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: options.userPrompt }] }],
      config: {
        systemInstruction: options.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: options.responseSchema,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        // Structured extraction, not reasoning: see `thinkingLevel` in lib/env.ts.
        ...(thinking === null
          ? {}
          : { thinkingConfig: { thinkingLevel: ThinkingLevel[thinking] } }),
        abortSignal: controller.signal,
      },
    });

    const text = response.text;
    if (text === undefined || text.trim().length === 0) {
      // An empty response is what a safety block looks like from here.
      return { kind: 'fatal', code: 'MODEL_BLOCKED' };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stripCodeFence(text));
    } catch {
      return { kind: 'transient', code: 'MODEL_INVALID_OUTPUT' };
    }

    const parsed = options.schema.safeParse(raw);
    if (!parsed.success) return { kind: 'transient', code: 'MODEL_INVALID_OUTPUT' };

    return { kind: 'ok', data: parsed.data };
  } catch (error) {
    if (controller.signal.aborted) return { kind: 'fatal', code: 'UPSTREAM_TIMEOUT' };
    if (isThinkingUnsupported(error)) return { kind: 'thinking-unsupported' };
    if (isQuotaExhausted(error)) return { kind: 'fatal', code: 'RATE_LIMITED' };
    if (isTransient(error)) return { kind: 'transient', code: 'INTERNAL' };
    return { kind: 'fatal', code: 'INTERNAL' };
  } finally {
    clearTimeout(timer);
  }
}

export { REQUEST_TIMEOUT_MS, stripCodeFence };
