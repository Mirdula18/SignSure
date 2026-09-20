import { sessionRequestSchema } from '../../shared/schemas';
import type { Env } from '../lib/env';
import { bearerToken, clientIp, errorResponse, json, parseBody } from '../lib/http';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { hashIp, issueSession, verifySession } from '../lib/session';
import { verifyTurnstile } from '../lib/turnstile';

/**
 * Issues the short-lived token every other `/api/*` route requires.
 *
 * Flow: the browser solves a Turnstile challenge, posts the token here, and gets back an
 * HMAC-signed session bound to a hashed IP and a thirty-minute expiry. That is what makes
 * scripted abuse of the Gemini proxy cost a challenge per session instead of nothing at all.
 *
 * Rate limited in its own right, so the challenge cannot simply be solved in a loop.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request);
  const salt = env.IP_HASH_SALT ?? '';
  const ipHash = await hashIp(ip, salt);

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'session', ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, sessionRequestSchema);
  if (!body.ok) return body.response;

  const secret = env.SESSION_SECRET;
  if (secret === undefined || secret.length < 32) {
    // Refuse to issue a token a short secret could let someone forge. `/api/health` reports
    // this so a deployer can see it without the endpoint explaining the problem to a caller.
    return errorResponse('INTERNAL');
  }

  const turnstile = await verifyTurnstile(body.data.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstile.ok) {
    return turnstile.reason === 'UNREACHABLE'
      ? errorResponse('UPSTREAM_TIMEOUT', rateLimitHeaders(rate))
      : errorResponse('UNAUTHORIZED', rateLimitHeaders(rate));
  }

  const session = await issueSession(secret, ipHash);
  return json({ token: session.token, expiresAt: session.expiresAt }, 200, rateLimitHeaders(rate));
};

/**
 * Guard used by every other route.
 *
 * Kept here beside the issuing code so the two can never drift: the same secret, the same IP
 * hashing, and the same failure handling.
 */
export async function requireSession(
  request: Request,
  env: Env,
): Promise<{ ok: true; ipHash: string } | { ok: false; response: Response }> {
  const secret = env.SESSION_SECRET;
  if (secret === undefined || secret.length === 0) {
    return { ok: false, response: errorResponse('INTERNAL') };
  }

  const token = bearerToken(request);
  if (token === null) return { ok: false, response: errorResponse('UNAUTHORIZED') };

  const ipHash = await hashIp(clientIp(request), env.IP_HASH_SALT ?? '');
  const verdict = await verifySession(token, secret, ipHash);
  if (!verdict.ok) return { ok: false, response: errorResponse('UNAUTHORIZED') };

  return { ok: true, ipHash };
}
