/**
 * Short-lived session tokens.
 *
 * What this protects: the Gemini proxy. Without a token, anyone could point a script at
 * `/api/analyze` and spend the project's quota. A token is only issued after a Turnstile
 * challenge, so scripted abuse has to solve a challenge per session rather than per request.
 *
 * What it deliberately is not: authentication. SignSure has no accounts and stores nothing
 * about anyone. The token carries a hashed IP and an expiry, nothing else - no user id, no
 * document, nothing that would be worth stealing.
 *
 * Format: `base64url(payload).base64url(HMAC-SHA256(secret, payload))`.
 */

const encoder = new TextEncoder();

/** Thirty minutes: long enough for a careful read, short enough to limit a leaked token. */
const TOKEN_LIFETIME_SECONDS = 30 * 60;

export interface SessionPayload {
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
  /** First 16 hex characters of a salted SHA-256 of the client IP. */
  ih: string;
}

export type SessionFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_IP' | 'NO_SECRET';

export type SessionVerdict =
  { ok: true; payload: SessionPayload } | { ok: false; reason: SessionFailure };

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Salted hash of an IP address.
 *
 * The salt is a secret, so the stored value cannot be reversed by hashing every IPv4 address,
 * and truncating to 16 hex characters keeps it short while staying far too large to collide by
 * accident. Used for rate-limit keys too, so neither the token nor KV ever holds a real IP.
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export interface IssuedSession {
  token: string;
  /** Seconds since epoch, so the client can refresh before it lapses. */
  expiresAt: number;
}

/** Signs a thirty-minute session bound to the caller's hashed IP (see docs/SECURITY.md 3.2). */
export async function issueSession(
  secret: string,
  ipHash: string,
  now: number = Date.now(),
): Promise<IssuedSession> {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    ih: ipHash,
  };

  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(encodedPayload),
  );

  return {
    token: `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt: payload.exp,
  };
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.iat === 'number' &&
    typeof candidate.exp === 'number' &&
    typeof candidate.ih === 'string'
  );
}

/**
 * Verifies a token.
 *
 * `crypto.subtle.verify` is used rather than comparing strings, because it compares in constant
 * time; a plain `===` on the signature would leak how many leading bytes were right.
 *
 * The IP hash is checked too, so a token copied out of one browser and replayed from another
 * network is rejected.
 */
export async function verifySession(
  token: string,
  secret: string,
  expectedIpHash: string,
  now: number = Date.now(),
): Promise<SessionVerdict> {
  if (secret.length === 0) return { ok: false, reason: 'NO_SECRET' };

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'MALFORMED' };
  const [encodedPayload, encodedSignature] = parts as [string, string];

  const signature = fromBase64Url(encodedSignature);
  if (signature === null) return { ok: false, reason: 'MALFORMED' };

  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(encodedPayload),
  );
  if (!valid) return { ok: false, reason: 'BAD_SIGNATURE' };

  const payloadBytes = fromBase64Url(encodedPayload);
  if (payloadBytes === null) return { ok: false, reason: 'MALFORMED' };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!isSessionPayload(payload)) return { ok: false, reason: 'MALFORMED' };

  if (payload.exp * 1000 <= now) return { ok: false, reason: 'EXPIRED' };
  if (payload.ih !== expectedIpHash) return { ok: false, reason: 'WRONG_IP' };

  return { ok: true, payload };
}

export { TOKEN_LIFETIME_SECONDS };
