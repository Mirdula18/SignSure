import type { Env } from '../lib/env';
import { isMockMode } from '../lib/env';

/**
 * Liveness probe. Reports only booleans about configuration presence - never the values -
 * so it is safe to expose publicly while still telling a deployer what is missing.
 */
export const onRequestGet: PagesFunction<Env> = ({ env }) => {
  return new Response(
    JSON.stringify({
      ok: true,
      mode: isMockMode(env) ? 'mock' : 'live',
      configured: {
        gemini: isMockMode(env) || Boolean(env.GEMINI_API_KEY),
        turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
        session: Boolean(env.SESSION_SECRET),
        rateLimitStore: Boolean(env.RATE_LIMIT_KV),
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
};
