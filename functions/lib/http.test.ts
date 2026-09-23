import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema } from '../../shared/schemas';
import type { ApiErrorCode } from '../../shared/types';
import { bearerToken, clientIp, errorResponse, json, parseBody } from './http';

const URL_UNDER_TEST = 'https://signsure.pages.dev/api/ask';

/** Every code, with the status it must map to and whether repeating the request could help. */
const ERROR_CASES: [ApiErrorCode, number, boolean][] = [
  ['INVALID_INPUT', 400, false],
  ['UNAUTHORIZED', 401, false],
  ['TOO_LARGE', 413, false],
  ['MODEL_BLOCKED', 422, false],
  ['RATE_LIMITED', 429, true],
  ['INTERNAL', 500, true],
  ['MODEL_INVALID_OUTPUT', 502, true],
  ['UPSTREAM_TIMEOUT', 504, true],
];

/** Words that would tell a caller how our validation or our upstream is put together. */
const INTERNAL_DETAIL = ['zod', 'stack', 'gemini', 'undefined', 'null', 'clause'];

const askSchema = z.object({ question: z.string().max(20) });

function postJson(body: string): Request {
  return new Request(URL_UNDER_TEST, { method: 'POST', body });
}

/**
 * A POST whose body arrives in pieces with no declared length, as a chunked upload does. It
 * records how many pieces were pulled and whether the reader gave up, so a test can tell a
 * capped read from one that buffered everything.
 */
function chunked(pieces: readonly string[]) {
  const encoder = new TextEncoder();
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[pulled];
      pulled += 1;
      if (piece === undefined) controller.close();
      else controller.enqueue(encoder.encode(piece));
    },
    cancel() {
      cancelled = true;
    },
  });
  // `duplex` is required by the runtime for a streamed request body; the Workers types omit it.
  const init = { method: 'POST', body: stream, duplex: 'half' } as RequestInit;
  return {
    request: new Request(URL_UNDER_TEST, init),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

function withHeaders(headers: Record<string, string>): Request {
  return new Request(URL_UNDER_TEST, { headers });
}

/** Narrows to the rejection branch, so a test can read the response `parseBody` built. */
async function rejectionFrom(request: Request, schema: z.ZodType): Promise<Response> {
  const result = await parseBody(request, schema);
  if (result.ok) throw new Error('expected parseBody to reject this body');
  return result.response;
}

describe('json', () => {
  it('answers as JSON and forbids caching, because every response derives from a contract', async () => {
    const response = json({ ok: true });
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('defaults to 200 and otherwise uses the status it is given', () => {
    expect(json({}).status).toBe(200);
    expect(json({}, 201).status).toBe(201);
  });

  it('merges extra headers alongside the JSON ones instead of replacing them', () => {
    const response = json({}, 429, { 'Retry-After': '30', 'RateLimit-Remaining': '0' });
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serialises the body it is handed', async () => {
    expect(await json({ a: [1, 2], b: null }).text()).toBe('{"a":[1,2],"b":null}');
  });
});

describe('errorResponse', () => {
  it.each(ERROR_CASES)(
    'answers %s with HTTP %i and marks it retryable: %s',
    async (code, status, retryable) => {
      const response = errorResponse(code);
      expect(response.status).toBe(status);

      const body = apiErrorSchema.parse(await response.json());
      expect(body.error.code).toBe(code);
      expect(body.error.retryable).toBe(retryable);
      expect(body.error.message.length).toBeGreaterThan(0);
    },
  );

  it.each(ERROR_CASES.map(([code]) => code))(
    'keeps internal detail out of the %s message, so a prober learns nothing',
    async (code) => {
      const body = apiErrorSchema.parse(await errorResponse(code).json());
      const message = body.error.message.toLowerCase();
      for (const word of INTERNAL_DETAIL) {
        expect(message, `"${body.error.message}" mentions "${word}"`).not.toContain(word);
      }
    },
  );

  it('marks only the four codes worth retrying as retryable', async () => {
    const retryable: ApiErrorCode[] = [];
    for (const [code] of ERROR_CASES) {
      const body = apiErrorSchema.parse(await errorResponse(code).json());
      if (body.error.retryable) retryable.push(code);
    }
    expect(retryable.sort()).toEqual([
      'INTERNAL',
      'MODEL_INVALID_OUTPUT',
      'RATE_LIMITED',
      'UPSTREAM_TIMEOUT',
    ]);
  });

  it('carries the extra headers a route passes, such as the rate-limit ones', () => {
    const response = errorResponse('RATE_LIMITED', { 'Retry-After': '900' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('900');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('parseBody', () => {
  it('returns the validated data and strips keys the schema does not know about', async () => {
    const body = JSON.stringify({ question: 'Notice period?', isAdmin: true, clauses: ['c001'] });
    expect(await parseBody(postJson(body), askSchema)).toEqual({
      ok: true,
      data: { question: 'Notice period?' },
    });
  });

  it('rejects a body that is not JSON with a 400 instead of throwing at the route', async () => {
    const response = await rejectionFrom(postJson('{not json at all'), askSchema);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INVALID_INPUT');
  });

  it('rejects a request with no body at all', async () => {
    const response = await rejectionFrom(
      new Request(URL_UNDER_TEST, { method: 'POST' }),
      askSchema,
    );
    expect(response.status).toBe(400);
  });

  it('reads a body sent in chunks without a length', async () => {
    const { request } = chunked(['{"question":', '"Notice period?"}']);
    expect(await parseBody(request, askSchema)).toEqual({
      ok: true,
      data: { question: 'Notice period?' },
    });
  });

  it('stops reading a chunked body the moment it passes the cap, and answers 413', async () => {
    // A chunked upload declares no length, so the middleware cannot reject it up front.
    const piece = 'x'.repeat(64 * 1024);
    const { request, pulled, cancelled } = chunked(Array.from({ length: 50 }, () => piece));
    const response = await rejectionFrom(request, askSchema);

    expect(response.status).toBe(413);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('TOO_LARGE');
    expect(cancelled()).toBe(true);
    // 256 KB is four 64 KB pieces and a bit: nowhere near the fifty on offer.
    expect(pulled()).toBeLessThan(10);
  });

  it('rejects a body the schema refuses with a 400', async () => {
    const response = await rejectionFrom(postJson(JSON.stringify({ question: 42 })), askSchema);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INVALID_INPUT');
  });

  it('never echoes the rejected input or the validation issues back to the caller', async () => {
    const body = JSON.stringify({ question: 'SECRET_MARKER_12345 and then some more text' });
    const text = await (await rejectionFrom(postJson(body), askSchema)).text();

    expect(text).not.toContain('SECRET_MARKER_12345');
    expect(text.toLowerCase()).not.toContain('question');
    expect(text.toLowerCase()).not.toContain('too_big');
  });

  it('never echoes the input when the JSON itself is malformed', async () => {
    const text = await (
      await rejectionFrom(postJson('{"question": "SECRET_MARKER_12345"'), askSchema)
    ).text();
    expect(text).not.toContain('SECRET_MARKER_12345');
  });
});

describe('clientIp', () => {
  it('trusts the address the Cloudflare edge reports', () => {
    expect(clientIp(withHeaders({ 'CF-Connecting-IP': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('falls back to a literal unknown when the edge header is absent', () => {
    expect(clientIp(new Request(URL_UNDER_TEST))).toBe('unknown');
  });

  it('ignores X-Forwarded-For, which any caller can set to whatever it likes', () => {
    expect(clientIp(withHeaders({ 'X-Forwarded-For': '203.0.113.7' }))).toBe('unknown');
  });

  it('prefers the edge header when a spoofable one is present alongside it', () => {
    const request = withHeaders({
      'CF-Connecting-IP': '198.51.100.22',
      'X-Forwarded-For': '203.0.113.7',
    });
    expect(clientIp(request)).toBe('198.51.100.22');
  });
});

describe('bearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(bearerToken(withHeaders({ authorization: 'Bearer abc.def' }))).toBe('abc.def');
  });

  it.each(['bearer', 'BEARER', 'BeArEr'])(
    'accepts %s as the scheme, because HTTP auth schemes are case-insensitive',
    (scheme) => {
      expect(bearerToken(withHeaders({ authorization: `${scheme} abc.def` }))).toBe('abc.def');
    },
  );

  it('tolerates extra spacing between the scheme and the token', () => {
    expect(bearerToken(withHeaders({ authorization: 'Bearer    abc.def' }))).toBe('abc.def');
  });

  it('returns null when there is no Authorization header at all', () => {
    expect(bearerToken(new Request(URL_UNDER_TEST))).toBeNull();
  });

  it.each([
    ['an empty header', ''],
    ['a different scheme', 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'],
    ['a scheme with no token', 'Bearer'],
    ['a scheme followed by only spaces', 'Bearer   '],
    ['a token that is not a single word', 'Bearer abc def'],
  ])('returns null for %s', (_label, header) => {
    expect(bearerToken(withHeaders({ authorization: header }))).toBeNull();
  });
});
