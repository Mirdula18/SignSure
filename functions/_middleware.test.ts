import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../shared/limits';
import { apiErrorSchema } from '../shared/schemas';
import { onRequest } from './_middleware';
import type { Env } from './lib/env';

/**
 * The middleware only ever touches these three fields of the Pages context, so a test can build
 * one without standing up the whole Workers runtime.
 */
interface Ctx {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const call = (ctx: Ctx): Promise<Response> =>
  (onRequest as unknown as (context: Ctx) => Promise<Response>)(ctx);

const SITE = 'https://signsure.pages.dev';
const ATTACKER = 'https://evil.example';
const API_URL = `${SITE}/api/analyze`;

const ENV: Env = { ALLOWED_ORIGIN: SITE };

/** The two ways ALLOWED_ORIGIN can be missing in practice. */
const UNCONFIGURED: [string, Env][] = [
  ['unset', {}],
  ['blank', { ALLOWED_ORIGIN: '   ' }],
];

/** Every header the API must carry, whatever the outcome. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store',
};

function req(url: string, method: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method, headers });
}

/** A stand-in route, so a test can assert whether the request ever reached one. */
function route(body = 'route body') {
  return vi.fn(() => Promise.resolve(new Response(body)));
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
}

describe('onRequest outside /api/', () => {
  it('passes a static asset straight through to the next handler, untouched', async () => {
    const next = vi.fn(() => Promise.resolve(new Response('<!doctype html>')));
    const response = await call({ request: req(`${SITE}/privacy`, 'GET'), env: ENV, next });

    expect(next).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('<!doctype html>');
    // Static responses get their headers from public/_headers, so this middleware adds none.
    expect(response.headers.get('X-Content-Type-Options')).toBeNull();
  });

  it('does not apply the origin check to a page request, only to the API', async () => {
    const next = route('page');
    const response = await call({
      request: req(`${SITE}/`, 'POST', { origin: ATTACKER }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

describe('onRequest payload cap', () => {
  it('rejects a 300 KB body with 413 without ever letting a route read it', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE, 'content-length': String(300 * 1024) }),
      env: ENV,
      next,
    });

    expect(300 * 1024).toBeGreaterThan(LIMITS.maxRequestBytes);
    expect(response.status).toBe(413);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('TOO_LARGE');
    expect(next).not.toHaveBeenCalled();
    expectSecurityHeaders(response);
  });

  it('rejects a body one byte over the cap', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', {
        origin: SITE,
        'content-length': String(LIMITS.maxRequestBytes + 1),
      }),
      env: ENV,
      next,
    });

    expect(response.status).toBe(413);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a body of exactly the cap, so the documented limit is inclusive', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', {
        origin: SITE,
        'content-length': String(LIMITS.maxRequestBytes),
      }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('allows a request that declares no length, leaving chunked bodies to the route', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('allows a request whose declared length is not a number', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE, 'content-length': 'chunked' }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

describe('onRequest origin check', () => {
  it('allows a write from the origin we serve the app on', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('rejects a write driven from another site with 401 and never runs the route', async () => {
    const next = route();
    const response = await call({
      request: req(API_URL, 'POST', { origin: ATTACKER }),
      env: ENV,
      next,
    });

    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
    expectSecurityHeaders(response);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])(
    'rejects a cross-origin %s as well as a POST',
    async (method) => {
      const next = route();
      const response = await call({
        request: req(API_URL, method, { origin: ATTACKER }),
        env: ENV,
        next,
      });

      expect(response.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('allows a write with no Origin at all, because it carries no ambient authority', async () => {
    // curl and health probes send no Origin; the API is bearer-token authorised, not cookie
    // authorised, so there is nothing for such a request to borrow.
    const next = route();
    const response = await call({ request: req(API_URL, 'POST'), env: ENV, next });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('allows a read from a foreign origin, because reading is not the threat here', async () => {
    const next = route();
    const response = await call({
      request: req(`${SITE}/api/health`, 'GET', { origin: ATTACKER }),
      env: ENV,
      next,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it.each(UNCONFIGURED)(
    'falls back to same-origin when ALLOWED_ORIGIN is %s, so a missing var cannot open the API up',
    async (_label, env) => {
      const sameOrigin = route();
      const allowed = await call({
        request: req(API_URL, 'POST', { origin: SITE }),
        env,
        next: sameOrigin,
      });
      expect(sameOrigin).toHaveBeenCalledTimes(1);
      expect(allowed.status).toBe(200);

      const foreign = route();
      const rejected = await call({
        request: req(API_URL, 'POST', { origin: ATTACKER }),
        env,
        next: foreign,
      });
      expect(rejected.status).toBe(401);
      expect(foreign).not.toHaveBeenCalled();
    },
  );
});

describe('onRequest response handling', () => {
  it('stamps the security headers on a successful API response', async () => {
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next: route(),
    });

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it('preserves the status, body and headers a route produced', async () => {
    const next = vi.fn(() =>
      Promise.resolve(
        new Response('{"token":"t"}', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json', 'RateLimit-Remaining': '7' },
        }),
      ),
    );
    const response = await call({
      request: req(`${SITE}/api/session`, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('RateLimit-Remaining')).toBe('7');
    expect(await response.text()).toBe('{"token":"t"}');
    expectSecurityHeaders(response);
  });

  it('overrides a route that tried to allow caching, because responses derive from a contract', async () => {
    const next = vi.fn(() =>
      Promise.resolve(new Response('ok', { headers: { 'Cache-Control': 'public, max-age=600' } })),
    );
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('turns a rejected route into a 500 envelope and never leaks the message it carried', async () => {
    const next = vi.fn(() =>
      Promise.reject<Response>(new Error('clause text: Rs 2,00,000 liquidated damages')),
    );
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('liquidated');
    expect(text).not.toContain('Rs 2,00,000');
    expect(text).not.toContain('Error');
    expect(apiErrorSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
    expectSecurityHeaders(response);
  });

  it('turns a route that throws synchronously into the same 500 envelope', async () => {
    const next = vi.fn((): Promise<Response> => {
      throw new Error('clause text: Rs 2,00,000 liquidated damages');
    });
    const response = await call({
      request: req(API_URL, 'POST', { origin: SITE }),
      env: ENV,
      next,
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('liquidated');
  });
});
