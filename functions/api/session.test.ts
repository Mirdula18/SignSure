import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryKv, type MinimalKv } from '../../tools/memoryKv';
import { apiErrorSchema, sessionResponseSchema } from '../../shared/schemas';
import type { Env } from '../lib/env';
import { hashIp, issueSession, TOKEN_LIFETIME_SECONDS, verifySession } from '../lib/session';
import { onRequestPost, requireSession } from './session';

const SECRET = 'test only: a thirty-two byte key';
const SALT = 'test-ip-hash-salt';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.22';
const SESSION_URL = 'https://signsure.pages.dev/api/session';
const ANALYZE_URL = 'https://signsure.pages.dev/api/analyze';

/** Cloudflare's documented always-pass test secret, which skips the network entirely. */
const ALWAYS_PASS_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Any other secret, so verification really goes to (our stand-in for) siteverify. */
const REAL_TURNSTILE_SECRET = 'unit-test-turnstile-secret';

/** A fixed instant, so expiry and rate-limit windows read as plain arithmetic. */
const NOW = Date.UTC(2026, 0, 15, 9, 30, 0);

/** The route only reads `request` and `env`, and only this much of KV. */
type TestEnv = Omit<Env, 'RATE_LIMIT_KV'> & { RATE_LIMIT_KV?: MinimalKv };

interface Ctx {
  request: Request;
  env: TestEnv;
}

const call = (ctx: Ctx): Promise<Response> =>
  (onRequestPost as unknown as (context: Ctx) => Promise<Response>)(ctx);

function testEnv(overrides: TestEnv = {}): TestEnv {
  return {
    SESSION_SECRET: SECRET,
    IP_HASH_SALT: SALT,
    TURNSTILE_SECRET_KEY: ALWAYS_PASS_TEST_SECRET,
    RATE_LIMIT_KV: new MemoryKv(),
    ...overrides,
  };
}

function sessionRequest(body: unknown = { turnstileToken: 'solved-challenge' }, ip = IP): Request {
  return new Request(SESSION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Replaces the global fetch for one test, so siteverify is never really called. */
function stubFetch(respond: typeof fetch) {
  const fetchMock = vi.fn<typeof fetch>(respond);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function errorBody(response: Response) {
  return apiErrorSchema.parse(await response.json()).error;
}

/** A request to a protected route, carrying the given Authorization header, if any. */
function protectedRequest(authorization: string | null, ip = IP): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  if (authorization !== null) headers.authorization = authorization;
  return new Request(ANALYZE_URL, { method: 'POST', headers });
}

async function bearer(ip = IP, secret = SECRET, now = Date.now()): Promise<string> {
  const { token } = await issueSession(secret, await hashIp(ip, SALT), now);
  return `Bearer ${token}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('POST /api/session', () => {
  it('issues a token that verifies for the same IP, and that later requests will accept', async () => {
    const response = await call({ request: sessionRequest(), env: testEnv() });

    expect(response.status).toBe(200);
    const { token, expiresAt } = sessionResponseSchema.parse(await response.json());
    const verdict = await verifySession(token, SECRET, await hashIp(IP, SALT));
    expect(verdict.ok).toBe(true);

    const guard = await requireSession(protectedRequest(`Bearer ${token}`), {
      SESSION_SECRET: SECRET,
      IP_HASH_SALT: SALT,
    });
    expect(guard.ok).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('issues a token that expires thirty minutes after it was issued', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const response = await call({ request: sessionRequest(), env: testEnv() });

    const { expiresAt } = sessionResponseSchema.parse(await response.json());
    expect(expiresAt).toBe(Math.floor(NOW / 1000) + TOKEN_LIFETIME_SECONDS);
  });

  it('binds the token to the IP it was issued to, so it fails from another network', async () => {
    const response = await call({ request: sessionRequest(), env: testEnv() });
    const { token } = sessionResponseSchema.parse(await response.json());

    expect(await verifySession(token, SECRET, await hashIp(OTHER_IP, SALT))).toEqual({
      ok: false,
      reason: 'WRONG_IP',
    });
  });

  it('still issues a verifiable token when no IP hash salt is configured', async () => {
    const env = testEnv();
    delete env.IP_HASH_SALT;
    const response = await call({ request: sessionRequest(), env });

    expect(response.status).toBe(200);
    const { token } = sessionResponseSchema.parse(await response.json());
    expect((await verifySession(token, SECRET, await hashIp(IP, ''))).ok).toBe(true);
  });

  it('reports the remaining budget in the rate-limit headers', async () => {
    const response = await call({ request: sessionRequest(), env: testEnv() });
    expect(response.headers.get('RateLimit-Limit')).toBe('10');
    expect(response.headers.get('RateLimit-Remaining')).toBe('9');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['unset', undefined],
    ['blank', ''],
    ['31 characters, one short of the minimum', 'x'.repeat(31)],
  ])('refuses with 500 INTERNAL and no token when SESSION_SECRET is %s', async (_label, secret) => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }))),
    );
    const env = testEnv({ TURNSTILE_SECRET_KEY: REAL_TURNSTILE_SECRET });
    if (secret === undefined) delete env.SESSION_SECRET;
    else env.SESSION_SECRET = secret;

    const response = await call({ request: sessionRequest(), env });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('token');
    expect(apiErrorSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
    // Refused before spending a Turnstile verification on a token it could never issue.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a secret of exactly 32 characters', async () => {
    const response = await call({
      request: sessionRequest(),
      env: testEnv({ SESSION_SECRET: 'y'.repeat(32) }),
    });
    expect(response.status).toBe(200);
  });

  it('never echoes the session secret in any response', async () => {
    const ok = await call({ request: sessionRequest(), env: testEnv() });
    const refused = await call({
      request: sessionRequest(),
      env: testEnv({ SESSION_SECRET: 'short-secret' }),
    });
    expect(await ok.text()).not.toContain(SECRET);
    expect(await refused.text()).not.toContain('short-secret');
  });

  it('returns 401 when Turnstile rejects the challenge token', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] })),
      ),
    );
    const response = await call({
      request: sessionRequest(),
      env: testEnv({ TURNSTILE_SECRET_KEY: REAL_TURNSTILE_SECRET }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    const error = await errorBody(response);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(error)).not.toContain('invalid-input-response');
    expect(response.headers.get('RateLimit-Limit')).toBe('10');
  });

  it('returns 504 UPSTREAM_TIMEOUT when siteverify cannot be reached, and issues nothing', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const response = await call({
      request: sessionRequest(),
      env: testEnv({ TURNSTILE_SECRET_KEY: REAL_TURNSTILE_SECRET }),
    });

    expect(response.status).toBe(504);
    const error = await errorBody(response);
    expect(error.code).toBe('UPSTREAM_TIMEOUT');
    expect(error.retryable).toBe(true);
  });

  it('fails closed with a server error when no Turnstile secret is configured at all', async () => {
    // Still no token. But it is our misconfiguration, not the visitor's expired session, so it
    // is a 500: a 401 would tell them to reload, and reloading would never fix it.
    const env = testEnv();
    delete env.TURNSTILE_SECRET_KEY;
    const response = await call({ request: sessionRequest(), env });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL' } });
  });

  it('forwards the client IP to siteverify so Cloudflare can score the solve', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }))),
    );
    await call({
      request: sessionRequest(),
      env: testEnv({ TURNSTILE_SECRET_KEY: REAL_TURNSTILE_SECRET }),
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('remoteip')).toBe(IP);
    expect((body as FormData).get('response')).toBe('solved-challenge');
  });

  it.each([
    ['a body that is not JSON', '{"turnstileToken":'],
    ['no Turnstile token', {}],
    ['an empty Turnstile token', { turnstileToken: '' }],
    ['an oversized Turnstile token', { turnstileToken: 'x'.repeat(2_049) }],
  ])('returns 400 for %s', async (_label, body) => {
    const response = await call({ request: sessionRequest(body), env: testEnv() });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).code).toBe('INVALID_INPUT');
  });

  it('returns 429 with Retry-After on the eleventh attempt in ten minutes, before checking Turnstile', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 10; index += 1) {
      expect((await call({ request: sessionRequest(), env })).status).toBe(200);
    }

    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }))),
    );
    env.TURNSTILE_SECRET_KEY = REAL_TURNSTILE_SECRET;
    const limited = await call({ request: sessionRequest(), env });

    expect(limited.status).toBe(429);
    expect((await errorBody(limited)).code).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(Number(limited.headers.get('Retry-After'))).toBeLessThanOrEqual(10 * 60);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts failed attempts too, so the challenge cannot simply be retried in a loop', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 10; index += 1) {
      expect((await call({ request: sessionRequest({}), env })).status).toBe(400);
    }
    expect((await call({ request: sessionRequest(), env })).status).toBe(429);
  });

  it('keeps separate budgets for separate networks', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 10; index += 1) {
      await call({ request: sessionRequest(), env });
    }
    expect((await call({ request: sessionRequest(undefined, OTHER_IP), env })).status).toBe(200);
  });
});

describe('requireSession', () => {
  const ENV: Env = { SESSION_SECRET: SECRET, IP_HASH_SALT: SALT };

  it('lets a valid token through and hands back the hashed IP for rate limiting', async () => {
    const verdict = await requireSession(protectedRequest(await bearer()), ENV);
    expect(verdict).toEqual({ ok: true, ipHash: await hashIp(IP, SALT) });
  });

  it('never hands back the raw IP', async () => {
    const verdict = await requireSession(protectedRequest(await bearer()), ENV);
    expect(JSON.stringify(verdict)).not.toContain(IP);
  });

  it('returns 401 when there is no Authorization header', async () => {
    const verdict = await requireSession(protectedRequest(null), ENV);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(401);
    expect((await errorBody(verdict.response)).code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a Basic credential', 'Basic dXNlcjpwYXNz'],
    ['a bare token with no scheme', 'abc.def'],
    ['an empty bearer', 'Bearer '],
  ])('returns 401 for %s', async (_label, header) => {
    const verdict = await requireSession(protectedRequest(header), ENV);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(401);
  });

  it('returns 401 for a token presented from a different IP', async () => {
    const verdict = await requireSession(protectedRequest(await bearer(IP), OTHER_IP), ENV);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(401);
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const forged = await bearer(IP, 'a-different-thirty-two-byte-key0');
    const verdict = await requireSession(protectedRequest(forged), ENV);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(401);
  });

  it('returns 401 for a token that has expired', async () => {
    const stale = await bearer(IP, SECRET, Date.now() - (TOKEN_LIFETIME_SECONDS + 1) * 1000);
    const verdict = await requireSession(protectedRequest(stale), ENV);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(401);
  });

  it.each([
    ['unset', {}],
    ['blank', { SESSION_SECRET: '' }],
  ])(
    'returns 500 rather than trusting any token when the secret is %s',
    async (_label, secret: Env) => {
      const verdict = await requireSession(protectedRequest(await bearer()), {
        IP_HASH_SALT: SALT,
        ...secret,
      });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.response.status).toBe(500);
      expect((await errorBody(verdict.response)).code).toBe('INTERNAL');
    },
  );

  // SUSPECTED BUG: the issuing route refuses a SESSION_SECRET under 32 characters because "a
  // short secret could let someone forge" a token, but the guard accepts any non-empty secret.
  // Forging never goes through the issuing route, so the refusal protects nothing unless the
  // guard applies the same rule. requireSession's own comment promises "the same failure
  // handling" as the issuing code.
  it('refuses every token with 500 when the secret is shorter than 32 characters', async () => {
    const shortSecret = 'short-but-not-empty';
    const verdict = await requireSession(protectedRequest(await bearer(IP, shortSecret)), {
      SESSION_SECRET: shortSecret,
      IP_HASH_SALT: SALT,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.response.status).toBe(500);
  });

  it('hashes the IP with the same salt the issuing route uses, including no salt at all', async () => {
    const { token } = await issueSession(SECRET, await hashIp(IP, ''));
    const verdict = await requireSession(protectedRequest(`Bearer ${token}`), {
      SESSION_SECRET: SECRET,
    });
    expect(verdict).toEqual({ ok: true, ipHash: await hashIp(IP, '') });
  });
});
