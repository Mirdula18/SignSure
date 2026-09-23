import type { MinimalKv } from './kv';

/**
 * Fixed-window rate limiting backed by Workers KV.
 *
 * What it is for: denial-of-wallet. A Gemini call costs money and quota, so a single IP must not
 * be able to run thousands of them. Limits are per route, because analysing a document is far
 * more expensive than asking a follow-up question.
 *
 * Known and accepted weakness: KV is eventually consistent, so a burst arriving at two edge
 * locations at once can briefly exceed the limit. A precise counter would need Durable Objects,
 * which is more machinery than the threat justifies here. Documented in docs/SECURITY.md 3.3.
 *
 * Keys hold a hashed IP and expire on their own via `expirationTtl`, so nothing identifying
 * accumulates.
 */

export type RateLimitedRoute = 'session' | 'analyze' | 'ask' | 'compare' | 'prepare';

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const RATE_LIMITS: Readonly<Record<RateLimitedRoute, RateLimitRule>> = {
  session: { limit: 10, windowSeconds: 10 * 60 },
  analyze: { limit: 8, windowSeconds: 60 * 60 },
  ask: { limit: 40, windowSeconds: 60 * 60 },
  compare: { limit: 10, windowSeconds: 60 * 60 },
  prepare: { limit: 10, windowSeconds: 60 * 60 },
};

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in this window after the current one. */
  remaining: number;
  /** Seconds until the window resets, for the Retry-After header. */
  resetSeconds: number;
  limit: number;
}

/**
 * Records one request and reports whether it is allowed.
 *
 * Fails **open**: if KV is missing or unreachable the request proceeds. A rate limiter that
 * takes the whole product down when its store hiccups is worse than one that occasionally lets
 * a request through, and every other control (session token, payload caps) still
 * applies. `/api/health` reports whether the store is bound so a misconfiguration is visible.
 */
export async function checkRateLimit(
  kv: MinimalKv | undefined,
  route: RateLimitedRoute,
  ipHash: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[route];

  if (!kv) {
    return { allowed: true, remaining: rule.limit, resetSeconds: 0, limit: rule.limit };
  }

  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetSeconds = Math.ceil((windowStart + windowMs - now) / 1000);
  const key = `rl:${route}:${ipHash}:${windowStart}`;

  try {
    const stored = await kv.get(key);
    const used = stored === null ? 0 : Number.parseInt(stored, 10);
    const count = Number.isFinite(used) && used > 0 ? used : 0;

    if (count >= rule.limit) {
      return { allowed: false, remaining: 0, resetSeconds, limit: rule.limit };
    }

    // The TTL is the remaining window plus a small margin, so a key can never outlive its
    // window and start counting against a later one.
    await kv.put(key, String(count + 1), { expirationTtl: resetSeconds + 60 });

    return {
      allowed: true,
      remaining: rule.limit - (count + 1),
      resetSeconds,
      limit: rule.limit,
    };
  } catch {
    return { allowed: true, remaining: rule.limit, resetSeconds, limit: rule.limit };
  }
}

/** Standard headers so a client can back off politely instead of hammering. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.resetSeconds),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.resetSeconds);
  return headers;
}
