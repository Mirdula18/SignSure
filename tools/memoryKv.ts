/**
 * Minimal in-memory stand-in for a Workers KV namespace.
 *
 * Why: `wrangler` needs Node 22+, so local dev, e2e and the rate-limiter unit tests all need
 * a KV that behaves like the real one (string values, `expirationTtl`) without the real runtime.
 * Only the surface `functions/lib/ratelimit.ts` actually uses is implemented.
 */
export interface KvPutOptions {
  expirationTtl?: number;
}

export interface MinimalKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KvPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number | null;
}

export class MemoryKv implements MinimalKv {
  readonly #store = new Map<string, Entry>();

  /** Injectable clock so tests can expire entries without waiting. */
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get(key: string): Promise<string | null> {
    const entry = this.#store.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt !== null && entry.expiresAt <= this.#now()) {
      this.#store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  put(key: string, value: string, options?: KvPutOptions): Promise<void> {
    const ttl = options?.expirationTtl;
    this.#store.set(key, {
      value,
      expiresAt: typeof ttl === 'number' ? this.#now() + ttl * 1000 : null,
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#store.delete(key);
    return Promise.resolve();
  }

  /** Test helper: number of live keys. */
  get size(): number {
    return this.#store.size;
  }

  clear(): void {
    this.#store.clear();
  }
}
