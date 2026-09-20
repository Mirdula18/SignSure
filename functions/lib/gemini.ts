import { GoogleGenAI } from '@google/genai';
import type { z } from 'zod';
import { isMockMode, modelId, type Env } from './env';
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
  'MODEL_BLOCKED' | 'MODEL_INVALID_OUTPUT' | 'UPSTREAM_TIMEOUT' | 'INTERNAL'
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
}

/** A user is waiting, so a slow model is a failure rather than something to wait out. */
const REQUEST_TIMEOUT_MS = 25_000;

/** One retry on a transient upstream failure, with jitter so retries do not synchronise. */
const MAX_TRANSIENT_RETRIES = 1;

function backoffMs(): number {
  return 400 + Math.floor(Math.random() * 400);
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|overloaded|unavailable|rate limit/i.test(message);
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

function createLiveClient(env: Env): GeminiClient {
  const apiKey = env.GEMINI_API_KEY;
  const model = modelId(env);

  return {
    async generate<S extends z.ZodType>(
      options: GenerateOptions<S>,
    ): Promise<GeminiResult<z.infer<S>>> {
      if (apiKey === undefined || apiKey.length === 0) {
        return { ok: false, code: 'INTERNAL' };
      }
      const ai = new GoogleGenAI({ apiKey });

      let lastFailure: GeminiFailure = 'INTERNAL';

      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
        const outcome = await callOnce(ai, model, options);
        if (outcome.kind === 'ok') return { ok: true, data: outcome.data as z.infer<S> };
        if (outcome.kind === 'fatal') return { ok: false, code: outcome.code };
        lastFailure = outcome.code;
        if (attempt < MAX_TRANSIENT_RETRIES) await sleep(backoffMs());
      }

      // The model produced something unparseable; ask once more for JSON only before failing.
      if (lastFailure === 'MODEL_INVALID_OUTPUT') {
        const repair = await callOnce(ai, model, {
          ...options,
          userPrompt: `${options.userPrompt}\n\nReturn valid JSON only, matching the schema exactly. No markdown, no commentary.`,
        });
        if (repair.kind === 'ok') return { ok: true, data: repair.data as z.infer<S> };
      }

      return { ok: false, code: lastFailure };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CallOutcome =
  | { kind: 'ok'; data: unknown }
  /** Retrying could help. */
  | { kind: 'transient'; code: GeminiFailure }
  /** Retrying cannot help; return immediately. */
  | { kind: 'fatal'; code: GeminiFailure };

async function callOnce<S extends z.ZodType>(
  ai: GoogleGenAI,
  model: string,
  options: GenerateOptions<S>,
): Promise<CallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

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
    if (isTransient(error)) return { kind: 'transient', code: 'INTERNAL' };
    return { kind: 'fatal', code: 'INTERNAL' };
  } finally {
    clearTimeout(timer);
  }
}

export { REQUEST_TIMEOUT_MS, stripCodeFence };
