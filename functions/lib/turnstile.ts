/**
 * Cloudflare Turnstile verification.
 *
 * Turnstile is the gate in front of the Gemini proxy: solving it is what earns a session token.
 * It is used in managed mode, which is usually invisible and never asks for a cognitive puzzle,
 * so it satisfies WCAG 2.2 3.3.8 (accessible authentication) - see docs/ACCESSIBILITY.md 5.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Turnstile's own timeout is generous; ours is not, because a user is waiting. */
const VERIFY_TIMEOUT_MS = 8_000;

export type TurnstileResult =
  { ok: true } | { ok: false; reason: 'REJECTED' | 'UNREACHABLE' | 'NOT_CONFIGURED' };

interface SiteverifyResponse {
  success: boolean;
}

function isSiteverifyResponse(value: unknown): value is SiteverifyResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SiteverifyResponse).success === 'boolean'
  );
}

/**
 * Checks a Turnstile token with Cloudflare.
 *
 * Fails **closed**: an unreachable siteverify means no token is issued. Unlike the rate limiter,
 * this is the control that stops unbounded spend, so an outage should block new sessions rather
 * than quietly wave everyone through.
 *
 * The error codes Cloudflare returns are deliberately not surfaced: the caller learns only that
 * verification failed, so a script cannot use our response to tune its attempts.
 */
/**
 * Cloudflare's documented always-passes test secret.
 *
 * Short-circuiting it is behaviour-preserving: siteverify returns success for this key whatever
 * token it is given, so the only thing skipped is a network round-trip. That is what makes the
 * end-to-end suite hermetic, and it is why a production deployment must use a real secret -
 * this key is "allow everyone" at Cloudflare too, not only here.
 */
const ALWAYS_PASS_TEST_SECRET = '1x0000000000000000000000000000000AA';

export async function verifyTurnstile(
  token: string,
  secretKey: string | undefined,
  remoteIp: string,
): Promise<TurnstileResult> {
  if (secretKey === undefined || secretKey.length === 0) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  if (secretKey === ALWAYS_PASS_TEST_SECRET) return { ok: true };

  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', token);
  if (remoteIp !== 'unknown') body.append('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'UNREACHABLE' };

    const parsed: unknown = await response.json();
    if (!isSiteverifyResponse(parsed)) return { ok: false, reason: 'UNREACHABLE' };

    return parsed.success ? { ok: true } : { ok: false, reason: 'REJECTED' };
  } catch {
    return { ok: false, reason: 'UNREACHABLE' };
  } finally {
    clearTimeout(timer);
  }
}
