import type { z } from 'zod';
import {
  analyzeResponseSchema,
  askResponseSchema,
  compareResponseSchema,
  prepareResponseSchema,
  sessionResponseSchema,
  apiErrorSchema,
} from '@shared/schemas';
import type {
  AnalysisResult,
  ApiErrorCode,
  AskResult,
  QaTurn,
  Clause,
  CompareResult,
  PrepareResult,
} from '@shared/types';
import type { Lens } from '@shared/lenses';
import type { Language } from '@/i18n';
import type { ReadingLevel } from '@/state/preferences';

/**
 * Typed client for `/api/*`.
 *
 * Responses are validated against the same Zod schemas the server used to build them. That
 * looks redundant - we wrote both ends - but it is what stops a stale cached deployment, a
 * proxy that rewrites JSON, or a future server change from feeding the UI a shape it cannot
 * render. A validation failure becomes a normal error the user can act on, not a blank screen.
 */

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly retryable: boolean,
    /** Seconds to wait, when the server sent Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

async function post<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  token: string | null,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // An aborted request is the caller changing its mind, not a failure to report.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('INTERNAL', true);
  }

  if (!response.ok) throw await toApiError(response);

  const raw: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError('MODEL_INVALID_OUTPUT', true);
  return parsed.data;
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  const raw: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(raw);

  const code: ApiErrorCode = parsed.success ? parsed.data.error.code : 'INTERNAL';
  const retryable = parsed.success ? parsed.data.error.retryable : true;

  // A negative or missing Retry-After carries no usable instruction, so it is dropped.
  return Number.isFinite(retryAfter) && retryAfter >= 0
    ? new ApiError(code, retryable, retryAfter)
    : new ApiError(code, retryable);
}

export interface Preferences {
  language: Language;
  readingLevel: ReadingLevel;
}

export async function createSession(
  turnstileToken: string,
  options?: RequestOptions,
): Promise<{ token: string; expiresAt: number }> {
  return post('/api/session', { turnstileToken }, sessionResponseSchema, null, options);
}

export async function analyzeDocument(
  token: string,
  input: { clauses: readonly Clause[]; lenses: readonly Lens[] } & Preferences,
  options?: RequestOptions,
): Promise<AnalysisResult> {
  return post('/api/analyze', input, analyzeResponseSchema, token, options);
}

export async function askQuestion(
  token: string,
  input: {
    clauses: readonly Clause[];
    question: string;
    history?: readonly QaTurn[];
  } & Preferences,
  options?: RequestOptions,
): Promise<AskResult> {
  return post('/api/ask', input, askResponseSchema, token, options);
}

export async function compareDocuments(
  token: string,
  input: { clausesA: readonly Clause[]; clausesB: readonly Clause[] } & Preferences,
  options?: RequestOptions,
): Promise<CompareResult> {
  return post('/api/compare', input, compareResponseSchema, token, options);
}

export async function preparePack(
  token: string,
  input: {
    clauses: readonly Clause[];
    lenses: readonly Lens[];
    findings: readonly { clauseId: string; category: string; risk: string; title: string }[];
    unansweredQuestions: readonly string[];
  } & Preferences,
  options?: RequestOptions,
): Promise<PrepareResult> {
  return post('/api/prepare', input, prepareResponseSchema, token, options);
}
