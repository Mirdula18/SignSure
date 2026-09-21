import { describe, expect, it } from 'vitest';
import { onRequestGet } from './health';
import type { Env } from '../lib/env';

interface HealthBody {
  ok: boolean;
  mode: string;
  configured: Record<string, boolean>;
}

async function call(env: Env): Promise<{ status: number; body: HealthBody; headers: Headers }> {
  const response = await (
    onRequestGet as unknown as (ctx: { env: Env }) => Response | Promise<Response>
  )({ env });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

describe('GET /api/health', () => {
  it('reports mock mode without needing a key', async () => {
    const { status, body } = await call({ MOCK_GEMINI: 'true' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('mock');
    expect(body.configured.gemini).toBe(true);
  });

  it('reports which live configuration is missing', async () => {
    const { body } = await call({ MOCK_GEMINI: 'false' });
    expect(body.mode).toBe('live');
    expect(body.configured).toEqual({
      gemini: false,
      turnstile: false,
      session: false,
      rateLimitStore: false,
    });
  });

  it('never returns a secret value, only whether it is present', async () => {
    const secret = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234';
    const sessionSecret = 'super-secret-session-key-that-is-long-enough';
    const { body } = await call({ GEMINI_API_KEY: secret, SESSION_SECRET: sessionSecret });
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain(sessionSecret);
    expect(body.configured.gemini).toBe(true);
    expect(body.configured.session).toBe(true);
  });

  it('reports a session secret too short to be safe as not configured', async () => {
    // The API refuses to issue or accept tokens with it, so health must not say all is well.
    const { body } = await call({ SESSION_SECRET: 'short' });
    expect(body.configured.session).toBe(false);
  });

  it('is never cached', async () => {
    const { headers } = await call({});
    expect(headers.get('cache-control')).toBe('no-store');
  });
});
