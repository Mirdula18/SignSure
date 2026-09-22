import type { z } from 'zod';
import type { ApiErrorCode } from '../../shared/types';

/**
 * Request and response helpers shared by every route.
 *
 * Two rules hold everywhere in this file. Responses are never cached, because they are derived
 * from someone's employment contract. And errors carry a code plus a fixed, generic message -
 * never a stack trace, a Zod path, or anything the model returned - so a failure can be
 * explained to the user without telling an attacker what our validation looks like.
 */

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/** A JSON response that is never cached: every API answer is about one person's document. */
export function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    // `JSON_HEADERS` is spread last on purpose: a caller passing its own `cache-control` must
    // not be able to defeat `no-store` on a response derived from someone's contract.
    headers: { ...Object.fromEntries(new Headers(extraHeaders).entries()), ...JSON_HEADERS },
  });
}

/** HTTP status for each error code, kept in one place so routes cannot disagree. */
const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  MODEL_BLOCKED: 422,
  MODEL_INVALID_OUTPUT: 502,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
};

/**
 * User-facing message for each code.
 *
 * Deliberately vague about internals and specific about what the person can do next. The client
 * maps the code to a translated string; this text is the fallback when it cannot.
 */
const MESSAGE_BY_CODE: Readonly<Record<ApiErrorCode, string>> = {
  INVALID_INPUT: 'That request could not be processed. Please try again.',
  UNAUTHORIZED: 'Your session has expired. Please reload the page.',
  TOO_LARGE: 'That document is too large. Please try a shorter one.',
  RATE_LIMITED: 'Too many requests. Please wait a little and try again.',
  MODEL_BLOCKED: 'The assistant could not process this document safely.',
  MODEL_INVALID_OUTPUT: 'The assistant returned something unusable. Please try again.',
  UPSTREAM_TIMEOUT: 'That took too long. Please try again.',
  INTERNAL: 'Something went wrong. Please try again.',
};

/** Whether trying the exact same request again could plausibly succeed. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'RATE_LIMITED',
  'MODEL_INVALID_OUTPUT',
  'UPSTREAM_TIMEOUT',
  'INTERNAL',
]);

/**
 * The one error shape every route returns.
 *
 * The message is fixed per code, never built from the request or an upstream error, so nothing
 * the caller sent (or a stack trace about it) can be echoed back.
 */
export function errorResponse(code: ApiErrorCode, extraHeaders: HeadersInit = {}): Response {
  return json(
    { error: { code, message: MESSAGE_BY_CODE[code], retryable: RETRYABLE.has(code) } },
    STATUS_BY_CODE[code],
    extraHeaders,
  );
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Reads and validates a JSON body.
 *
 * Returns the error *response* rather than throwing, so a route reads as a straight line and
 * cannot accidentally let an invalid body through. Validation failures never echo the Zod
 * issues back: a caller probing our limits learns only that the request was rejected.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: errorResponse('INVALID_INPUT') };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: errorResponse('INVALID_INPUT') };
  return { ok: true, data: parsed.data };
}

/**
 * The client's IP as Cloudflare sees it.
 *
 * `CF-Connecting-IP` is set by the edge and cannot be spoofed by the client, unlike
 * `X-Forwarded-For`, which is why it is the only header trusted for rate limiting.
 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** Bearer token from the Authorization header, or null when absent or malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
