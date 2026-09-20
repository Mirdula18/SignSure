import { describe, expect, it } from 'vitest';
import { MemoryKv, type KvPutOptions, type MinimalKv } from '../../tools/memoryKv';
import { checkRateLimit, rateLimitHeaders, RATE_LIMITS } from './ratelimit';
import { hashIp } from './session';

const IP_HASH = 'a1b2c3d4e5f60718';
const OTHER_IP_HASH = '0f1e2d3c4b5a6978';

/** A fixed instant on an exact hour, so window arithmetic in the assertions stays readable. */
const START = Date.UTC(2026, 0, 15, 9, 0, 0);

/** Wraps a store so a test can see exactly what was written, keys included. */
class RecordingKv implements MinimalKv {
  readonly writes: { key: string; value: string; ttl: number | undefined }[] = [];

  constructor(private readonly inner: MinimalKv) {}

  get(key: string): Promise<string | null> {
    return this.inner.get(key);
  }

  put(key: string, value: string, options?: KvPutOptions): Promise<void> {
    this.writes.push({ key, value, ttl: options?.expirationTtl });
    return this.inner.put(key, value, options);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
}

/** A store that is bound but unreachable, to prove the limiter fails open rather than closed. */
function brokenKv(failing: 'get' | 'put'): MinimalKv {
  return {
    get: () =>
      failing === 'get'
        ? Promise.reject(new Error('KV unreachable'))
        : Promise.resolve<string | null>(null),
    put: () =>
      failing === 'put' ? Promise.reject(new Error('KV write failed')) : Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

describe('RATE_LIMITS', () => {
  it('gives every route a positive limit and a positive window', () => {
    for (const [route, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, route).toBeGreaterThan(0);
      expect(rule.windowSeconds, route).toBeGreaterThan(0);
    }
  });

  it('matches the budgets published in docs/SECURITY.md 3.3', () => {
    expect(RATE_LIMITS).toEqual({
      session: { limit: 10, windowSeconds: 10 * 60 },
      analyze: { limit: 8, windowSeconds: 60 * 60 },
      ask: { limit: 40, windowSeconds: 60 * 60 },
      compare: { limit: 10, windowSeconds: 60 * 60 },
      prepare: { limit: 10, windowSeconds: 60 * 60 },
    });
  });
});

describe('checkRateLimit', () => {
  it('allows eight analyses in an hour and rejects the ninth, as the checklist requires', async () => {
    const kv = new MemoryKv(() => START);

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const result = await checkRateLimit(kv, 'analyze', IP_HASH, START);
      expect(result.allowed, `analysis ${attempt}`).toBe(true);
      expect(result.remaining, `analysis ${attempt}`).toBe(8 - attempt);
      expect(result.limit).toBe(8);
    }

    const ninth = await checkRateLimit(kv, 'analyze', IP_HASH, START);
    expect(ninth.allowed).toBe(false);
    expect(ninth.remaining).toBe(0);
  });

  it('allows ten session tokens in ten minutes and rejects the eleventh', async () => {
    const kv = new MemoryKv(() => START);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(
        (await checkRateLimit(kv, 'session', IP_HASH, START)).allowed,
        `token ${attempt}`,
      ).toBe(true);
    }

    expect((await checkRateLimit(kv, 'session', IP_HASH, START)).allowed).toBe(false);
  });

  it('never reports a negative remaining, however long a caller keeps hammering', async () => {
    const kv = new MemoryKv(() => START);
    for (let attempt = 0; attempt < RATE_LIMITS.analyze.limit + 5; attempt += 1) {
      const result = await checkRateLimit(kv, 'analyze', IP_HASH, START);
      expect(result.remaining, `attempt ${attempt}`).toBeGreaterThanOrEqual(0);
    }
    expect((await checkRateLimit(kv, 'analyze', IP_HASH, START)).remaining).toBe(0);
  });

  it('keeps separate budgets for separate networks, so one abuser cannot lock everyone out', async () => {
    const kv = new MemoryKv(() => START);

    for (let attempt = 0; attempt < RATE_LIMITS.analyze.limit; attempt += 1) {
      await checkRateLimit(kv, 'analyze', IP_HASH, START);
    }
    expect((await checkRateLimit(kv, 'analyze', IP_HASH, START)).allowed).toBe(false);

    const other = await checkRateLimit(kv, 'analyze', OTHER_IP_HASH, START);
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(RATE_LIMITS.analyze.limit - 1);
  });

  it('keeps separate budgets per route, because an analysis costs far more than a question', async () => {
    const kv = new MemoryKv(() => START);

    for (let attempt = 0; attempt < RATE_LIMITS.analyze.limit; attempt += 1) {
      await checkRateLimit(kv, 'analyze', IP_HASH, START);
    }
    expect((await checkRateLimit(kv, 'analyze', IP_HASH, START)).allowed).toBe(false);

    const ask = await checkRateLimit(kv, 'ask', IP_HASH, START);
    expect(ask.allowed).toBe(true);
    expect(ask.remaining).toBe(RATE_LIMITS.ask.limit - 1);
  });

  it('starts a fresh budget once the window has passed', async () => {
    let now = START;
    const kv = new MemoryKv(() => now);

    for (let attempt = 0; attempt < RATE_LIMITS.analyze.limit; attempt += 1) {
      await checkRateLimit(kv, 'analyze', IP_HASH, now);
    }
    expect((await checkRateLimit(kv, 'analyze', IP_HASH, now)).allowed).toBe(false);

    now += RATE_LIMITS.analyze.windowSeconds * 1000;
    const afterReset = await checkRateLimit(kv, 'analyze', IP_HASH, now);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(RATE_LIMITS.analyze.limit - 1);
  });

  it.each([0, 1, 1_000, 59_000, 60 * 60 * 1000 - 1])(
    'reports a reset that is positive and no longer than the window (%i ms into it)',
    async (offset) => {
      const now = START + offset;
      const result = await checkRateLimit(new MemoryKv(() => now), 'ask', IP_HASH, now);
      expect(result.resetSeconds).toBeGreaterThan(0);
      expect(result.resetSeconds).toBeLessThanOrEqual(RATE_LIMITS.ask.windowSeconds);
    },
  );

  it('allows the request when no KV namespace is bound, so a misconfiguration cannot take the API down', async () => {
    expect(await checkRateLimit(undefined, 'analyze', IP_HASH, START)).toEqual({
      allowed: true,
      remaining: RATE_LIMITS.analyze.limit,
      resetSeconds: 0,
      limit: RATE_LIMITS.analyze.limit,
    });
  });

  it.each(['get', 'put'] as const)(
    'fails open when the store cannot %s, rather than turning a KV hiccup into an outage',
    async (failing) => {
      const result = await checkRateLimit(brokenKv(failing), 'analyze', IP_HASH, START);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(RATE_LIMITS.analyze.limit);
      expect(result.resetSeconds).toBeGreaterThan(0);
    },
  );

  it.each(['not a number', '-5', ''])(
    'treats a corrupt counter (%j) as zero rather than crashing or blocking everyone',
    async (stored) => {
      const inner = new MemoryKv(() => START);
      const probe = new RecordingKv(inner);
      await checkRateLimit(probe, 'analyze', IP_HASH, START);
      await inner.put(probe.writes[0]!.key, stored);

      const result = await checkRateLimit(inner, 'analyze', IP_HASH, START);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(RATE_LIMITS.analyze.limit - 1);
    },
  );

  it('writes keys that hold the hashed IP and never the address itself', async () => {
    const kv = new RecordingKv(new MemoryKv(() => START));
    const ipHash = await hashIp('203.0.113.7', 'test-ip-hash-salt');

    await checkRateLimit(kv, 'analyze', ipHash, START);

    expect(kv.writes).toHaveLength(1);
    const { key } = kv.writes[0]!;
    expect(key).toContain(ipHash);
    expect(key).toContain('analyze');
    expect(key).not.toContain('203.0.113.7');
    expect(key).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/);
  });

  it('gives a counter a time to live that cannot outlive the window it counts', async () => {
    const kv = new RecordingKv(new MemoryKv(() => START));
    await checkRateLimit(kv, 'analyze', IP_HASH, START);

    const { value, ttl } = kv.writes[0]!;
    expect(value).toBe('1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(RATE_LIMITS.analyze.windowSeconds + 60);
  });

  it('uses the live clock when no time is injected', async () => {
    const result = await checkRateLimit(new MemoryKv(), 'analyze', IP_HASH);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMITS.analyze.limit - 1);
  });
});

describe('rateLimitHeaders', () => {
  it('always states the limit, what is left and when the window resets', () => {
    expect(rateLimitHeaders({ allowed: true, remaining: 5, resetSeconds: 120, limit: 8 })).toEqual({
      'RateLimit-Limit': '8',
      'RateLimit-Remaining': '5',
      'RateLimit-Reset': '120',
    });
  });

  it('adds Retry-After only once a request has been rejected, so a client can back off politely', () => {
    const rejected = rateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetSeconds: 120,
      limit: 8,
    });
    expect(rejected['Retry-After']).toBe('120');

    const allowed = rateLimitHeaders({ allowed: true, remaining: 7, resetSeconds: 120, limit: 8 });
    expect(allowed).not.toHaveProperty('Retry-After');
  });
});
