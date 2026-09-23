import { ipHashSalt, isMockMode, sessionSecret, type Env } from '../lib/env';

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
        // Reported as configured only when it is long enough to be used, so a deployer who set
        // a short secret sees the problem here rather than as a stream of 500s.
        session: sessionSecret(env) !== null,
        ipSalt: ipHashSalt(env) !== null,
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
