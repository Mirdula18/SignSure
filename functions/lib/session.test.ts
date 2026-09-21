import { describe, expect, it } from 'vitest';
import {
  hashIp,
  issueSession,
  TOKEN_LIFETIME_SECONDS,
  verifySession,
  type SessionPayload,
} from './session';

const SECRET = 'test only: a thirty-two byte key';
const OTHER_SECRET = 'test only: a different byte key.';
const SALT = 'test-ip-hash-salt';
const IP_HASH = 'a1b2c3d4e5f60718';

/** A fixed clock, so every expiry assertion below reads as plain arithmetic. */
const NOW = Date.UTC(2026, 0, 15, 9, 30, 0);

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encodes a payload segment the way the module does, so tests can build tokens by hand. */
function encodeSegment(value: string): string {
  return toBase64Url(encoder.encode(value));
}

function decodeSegment(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

/**
 * Signs an arbitrary payload segment with a real HMAC.
 *
 * Needed because `verifySession` checks the signature first: a test about a broken payload can
 * only reach the payload checks if the signature over it is genuine.
 */
async function signedToken(secret: string, encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

function splitToken(token: string): [string, string] {
  const parts = token.split('.');
  expect(parts).toHaveLength(2);
  return [parts[0]!, parts[1]!];
}

describe('hashIp', () => {
  it('returns the same hash for the same address, so a rate-limit key stays stable', async () => {
    expect(await hashIp('203.0.113.7', SALT)).toBe(await hashIp('203.0.113.7', SALT));
  });

  it('returns a different hash for a different address, so budgets do not blur together', async () => {
    expect(await hashIp('203.0.113.7', SALT)).not.toBe(await hashIp('203.0.113.8', SALT));
  });

  it('returns a different hash under a different salt, which is what makes it unreversible', async () => {
    // Without a secret salt an attacker could hash all four billion IPv4 addresses and read
    // the stored value straight back; the salt is the only thing standing in the way.
    expect(await hashIp('203.0.113.7', SALT)).not.toBe(await hashIp('203.0.113.7', 'other-salt'));
  });

  it('returns sixteen lowercase hexadecimal characters', async () => {
    expect(await hashIp('203.0.113.7', SALT)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashes the literal unknown address, so a request with no edge header still gets a key', async () => {
    const unknown = await hashIp('unknown', SALT);
    expect(unknown).toMatch(/^[0-9a-f]{16}$/);
    expect(unknown).toBe(await hashIp('unknown', SALT));
    expect(unknown).not.toBe(await hashIp('203.0.113.7', SALT));
  });

  it('hashes IPv6 addresses as readily as IPv4 ones', async () => {
    const hash = await hashIp('2001:db8:85a3::8a2e:370:7334', SALT);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toBe(await hashIp('2001:db8:85a3::8a2e:370:7335', SALT));
  });
});

describe('issueSession', () => {
  it('returns a token of exactly two dot-separated, non-empty segments', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [payload, signature] = splitToken(token);
    expect(payload.length).toBeGreaterThan(0);
    expect(signature.length).toBeGreaterThan(0);
  });

  it('expires TOKEN_LIFETIME_SECONDS after the moment it was issued', async () => {
    const { expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect(expiresAt).toBe(Math.floor(NOW / 1000) + TOKEN_LIFETIME_SECONDS);
  });

  it('keeps the lifetime at thirty minutes, short enough to limit a leaked token', () => {
    expect(TOKEN_LIFETIME_SECONDS).toBe(30 * 60);
  });

  it('uses the live clock when no time is injected', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { expiresAt } = await issueSession(SECRET, IP_HASH);
    expect(expiresAt).toBeGreaterThanOrEqual(before + TOKEN_LIFETIME_SECONDS);
  });

  it('encodes both segments as base64url, so the token survives a header or URL intact', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });

  it('carries only iat, exp and ih, so a stolen token is worth nothing on its own', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [encodedPayload] = splitToken(token);
    const payload: unknown = JSON.parse(decodeSegment(encodedPayload));
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual(['exp', 'iat', 'ih']);
  });

  it('never puts the raw IP or the signing secret anywhere in the token', async () => {
    const ipHash = await hashIp('203.0.113.7', SALT);
    const { token } = await issueSession(SECRET, ipHash, NOW);
    const decodedPayload = decodeSegment(splitToken(token)[0]);

    expect(decodedPayload).toContain(ipHash);
    expect(decodedPayload).not.toContain('203.0.113.7');
    expect(token).not.toContain('203.0.113.7');
    expect(token).not.toContain(SECRET);
    expect(decodedPayload).not.toContain(SECRET);
  });
});

describe('verifySession', () => {
  it('accepts a freshly issued token and hands back the payload it carried', async () => {
    const { token, expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: true,
      payload: { iat: Math.floor(NOW / 1000), exp: expiresAt, ih: IP_HASH },
    });
  });

  it('accepts a token against the live clock when no time is injected', async () => {
    const { token } = await issueSession(SECRET, IP_HASH);
    expect((await verifySession(token, SECRET, IP_HASH)).ok).toBe(true);
  });

  it('refuses to verify anything when the signing secret is unset, rather than trusting it', async () => {
    // A blank secret would otherwise sign and verify happily, so every token would be forgeable.
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    expect(await verifySession(token, '', IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'NO_SECRET',
    });
  });

  it.each([
    ['an empty string', ''],
    ['no dot at all', 'notatokenatall'],
    ['two dots', 'header.payload.signature'],
    ['three dots', 'a.b.c.d'],
    ['a trailing dot only', 'payload..'],
    ['a signature that is not base64url', `${encodeSegment('{}')}.!!!not base64!!!`],
  ])('rejects a token shaped like %s as malformed', async (_label, token) => {
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('rejects a correctly signed payload segment that is not valid base64url', async () => {
    const token = await signedToken(SECRET, '!!!!');
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('rejects a correctly signed payload that does not decode to JSON', async () => {
    const token = await signedToken(SECRET, encodeSegment('this is not json'));
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it.each([
    ['a JSON string', '"hello"'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['an array', '[1,2,3]'],
    ['an object with no ih', JSON.stringify({ iat: 1, exp: 2 })],
    ['an object with no iat', JSON.stringify({ exp: 2, ih: IP_HASH })],
    [
      'an object whose exp is a string',
      JSON.stringify({ iat: 1, exp: '99999999999', ih: IP_HASH }),
    ],
    ['an object whose ih is a number', JSON.stringify({ iat: 1, exp: 2, ih: 7 })],
  ])('rejects a correctly signed payload that is %s', async (_label, body) => {
    const token = await signedToken(SECRET, encodeSegment(body));
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('rejects a token signed with a different secret, which is the outright forgery case', async () => {
    const { token } = await issueSession(OTHER_SECRET, IP_HASH, NOW);
    expect(await verifySession(token, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token whose payload was edited after signing, before ever parsing it', async () => {
    // The reason must be BAD_SIGNATURE rather than MALFORMED: the signature is checked first,
    // so nothing an attacker controls is ever handed to JSON.parse.
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [encodedPayload, signature] = splitToken(token);
    const flipped = `${encodedPayload.startsWith('e') ? 'f' : 'e'}${encodedPayload.slice(1)}`;
    expect(await verifySession(`${flipped}.${signature}`, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects an empty signature instead of treating a missing one as agreement', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [encodedPayload] = splitToken(token);
    expect(await verifySession(`${encodedPayload}.`, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token whose expiry was extended by hand, reusing the original signature', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [encodedPayload, signature] = splitToken(token);
    const payload = JSON.parse(decodeSegment(encodedPayload)) as SessionPayload;
    const forged = encodeSegment(JSON.stringify({ ...payload, exp: payload.exp + 86_400 }));

    expect(await verifySession(`${forged}.${signature}`, SECRET, IP_HASH, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token whose IP hash was swapped by hand for another network', async () => {
    const { token } = await issueSession(SECRET, IP_HASH, NOW);
    const [encodedPayload, signature] = splitToken(token);
    const payload = JSON.parse(decodeSegment(encodedPayload)) as SessionPayload;
    const forged = encodeSegment(JSON.stringify({ ...payload, ih: '0f1e2d3c4b5a6978' }));

    expect(await verifySession(`${forged}.${signature}`, SECRET, '0f1e2d3c4b5a6978', NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token presented after it has expired', async () => {
    const { token, expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect(await verifySession(token, SECRET, IP_HASH, expiresAt * 1000 + 1)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('rejects a token at the exact instant it expires, leaving no last-millisecond window', async () => {
    const { token, expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect(await verifySession(token, SECRET, IP_HASH, expiresAt * 1000)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('still accepts a token one millisecond before it expires', async () => {
    const { token, expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect((await verifySession(token, SECRET, IP_HASH, expiresAt * 1000 - 1)).ok).toBe(true);
  });

  it('rejects a token replayed from a different network', async () => {
    const home = await hashIp('203.0.113.7', SALT);
    const cafe = await hashIp('198.51.100.22', SALT);
    const { token } = await issueSession(SECRET, home, NOW);

    expect((await verifySession(token, SECRET, home, NOW)).ok).toBe(true);
    expect(await verifySession(token, SECRET, cafe, NOW)).toEqual({
      ok: false,
      reason: 'WRONG_IP',
    });
  });

  it('reports an expired token as expired even when the IP is also wrong', async () => {
    // Expiry is the cheaper and more informative answer, so it is checked first.
    const { token, expiresAt } = await issueSession(SECRET, IP_HASH, NOW);
    expect(await verifySession(token, SECRET, 'ffffffffffffffff', expiresAt * 1000 + 1)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });
});
