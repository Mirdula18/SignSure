/**
 * Typed bindings for the Pages Functions runtime.
 *
 * Secrets live only here (as `env` values injected by Cloudflare) and must never be copied
 * into responses, logs, or anything the browser can read. See docs/SECURITY.md section 3.1.
 */
export interface Env {
  /** Secret. Absent when MOCK_GEMINI is on. */
  GEMINI_API_KEY?: string;
  /** Secret. Cloudflare Turnstile server-side key. */
  TURNSTILE_SECRET_KEY?: string;
  /** Secret. HMAC key for session tokens; must be >= 32 bytes in production. */
  SESSION_SECRET?: string;
  /** Secret. Salt so stored rate-limit keys cannot be reversed to an IP. */
  IP_HASH_SALT?: string;

  /** Plain var. Model id, e.g. "gemini-3.8-flash". */
  GEMINI_MODEL?: string;
  /** Plain var. "true" disables all network calls and serves fixtures. */
  MOCK_GEMINI?: string;
  /** Plain var. Exact origin allowed to call the API. */
  ALLOWED_ORIGIN?: string;

  /** KV namespace holding fixed-window rate-limit counters (hashed IPs only). */
  RATE_LIMIT_KV?: KVNamespace;
}

/** Fallback so a missing or blank var never takes the API down. */
const DEFAULT_MODEL = 'gemini-3.8-flash';

/** HMAC-SHA256 keys shorter than this are guessable enough to forge a token with. */
const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * The session secret, or null when it is missing or too short to be safe.
 *
 * One definition used by the route that issues tokens, the guard that checks them, and the
 * health check that reports on them. When the issuing route alone refused a short secret, the
 * refusal protected nothing: a forger never goes through the issuing route.
 */
export function sessionSecret(env: Env): string | null {
  const secret = env.SESSION_SECRET;
  return secret !== undefined && secret.length >= MIN_SESSION_SECRET_LENGTH ? secret : null;
}

/** True when the API should answer from fixtures instead of calling Gemini. */
export function isMockMode(env: Env): boolean {
  return env.MOCK_GEMINI === 'true';
}

/** Model id to call, falling back to the current stable Flash model. */
export function modelId(env: Env): string {
  const configured = env.GEMINI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}
