import { sessionRequestSchema } from '../../shared/schemas';
import { ipHashSalt, sessionSecret, type Env } from '../lib/env';
import { bearerToken, clientIp, errorResponse, json, parseBody } from '../lib/http';
import { checkRateLimit, rateLimitHeaders } from '../lib/ratelimit';
import { hashIp, issueSession, verifySession } from '../lib/session';

/**
 * Issues the short-lived token every other `/api/*` route requires.
 *
 * The browser asks for one and gets back an HMAC-signed session bound to a hashed IP and a
 * thirty-minute expiry. Nothing is proved to get it, so this endpoint is open by design: what
 * limits abuse of the Gemini proxy is the per-address rate limit here and on every route behind
 * it, plus the payload caps. A session is a budget, not a credential.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request);
  const salt = ipHashSalt(env);
  // Without a usable salt the hash would give the address away. It is a deployment fault, not
  // the caller's, and `/api/health` reports it.
  if (salt === null) return errorResponse('INTERNAL');
  const ipHash = await hashIp(ip, salt);

  const rate = await checkRateLimit(env.RATE_LIMIT_KV, 'session', ipHash);
  if (!rate.allowed) return errorResponse('RATE_LIMITED', rateLimitHeaders(rate));

  const body = await parseBody(request, sessionRequestSchema);
  if (!body.ok) return body.response;

  const secret = sessionSecret(env);
  if (secret === null) {
    // Refuse to issue a token a short secret could let someone forge. `/api/health` reports
    // this so a deployer can see it without the endpoint explaining the problem to a caller.
    return errorResponse('INTERNAL');
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
  const secret = sessionSecret(env);
  if (secret === null) return { ok: false, response: errorResponse('INTERNAL') };

  const salt = ipHashSalt(env);
  if (salt === null) return { ok: false, response: errorResponse('INTERNAL') };

  const token = bearerToken(request);
  if (token === null) return { ok: false, response: errorResponse('UNAUTHORIZED') };

  const ipHash = await hashIp(clientIp(request), salt);
  const verdict = await verifySession(token, secret, ipHash);
  if (!verdict.ok) return { ok: false, response: errorResponse('UNAUTHORIZED') };

  return { ok: true, ipHash };
}
