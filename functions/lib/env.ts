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
  /** `minimal` (default) or `auto`; see `thinkingLevel`. */
  GEMINI_THINKING?: string;
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

const MIN_IP_HASH_SALT_LENGTH = 16;

/**
 * The salt for hashing client IPs, or null when it is missing or too short.
 *
 * An unsalted hash of an IPv4 address can be reversed by trying all four billion of them, so
 * rate-limit keys and session bindings would quietly be storing addresses. Like the session
 * secret, a salt that is not usable is treated as absent, and the routes refuse to run on it.
 */
export function ipHashSalt(env: Env): string | null {
  const salt = env.IP_HASH_SALT;
  return salt !== undefined && salt.length >= MIN_IP_HASH_SALT_LENGTH ? salt : null;
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

/**
 * How much the model should think before answering: minimal by default.
 *
 * Every call we make is structured extraction against a response schema - find the clauses,
 * quote them, fill the fields - which is not the kind of work extended reasoning improves. Left
 * on automatic, a Flash model spent so long thinking that a whole-document analysis passed the
 * request timeout every time (measured against gemini-3.6-flash on 2026-09-23). Set
 * `GEMINI_THINKING=auto` to hand the decision back to the model, for a model that rejects or
 * ignores the setting.
 */
export function thinkingLevel(env: Env): 'MINIMAL' | null {
  return env.GEMINI_THINKING?.trim().toLowerCase() === 'auto' ? null : 'MINIMAL';
}
