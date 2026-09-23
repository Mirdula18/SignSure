/**
 * A small in-memory cache for validated model responses.
 *
 * Why: the same request reaching Gemini twice spends quota twice for an identical answer. The
 * commonest case is the built-in sample letter, which every visitor who presses "Try with a
 * sample" sends word for word; a reader switching language and back is the next.
 *
 * What it holds, and for how long: only output that already passed Zod, in this isolate's
 * memory, for ten minutes at most, keyed by a SHA-256 of the whole request. Nothing is written
 * to KV or disk, and an entry can only be reached by sending the exact same text again - which
 * means the caller already has the document it came from.
 *
 * Concurrent identical requests share one call: the pending promise is cached, and dropped
 * again if it fails so a failure is never replayed.
 */

export interface ResponseCacheOptions {
  /** Entries kept before the least recently used is evicted. */
  maxEntries: number;
  /** Lifetime of a settled entry, in milliseconds. */
  ttlMs: number;
  /** Injected so tests can move time without waiting. */
  now?: () => number;
}

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

export class ResponseCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: ResponseCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns the cached result for `key`, or runs `load` once and caches what it produces.
   *
   * `keep` decides whether a resolved value is worth keeping: a typed failure is a resolved
   * value too, and caching one would turn a passing blip into ten minutes of refusals.
   */
  async getOrLoad(key: string, load: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
    const hit = this.entries.get(key);
    if (hit !== undefined && hit.expiresAt > this.now()) {
      // Re-inserting moves the key to the end of the Map's order, which makes it most recent.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    if (hit !== undefined) this.entries.delete(key);

    const value = load();
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    this.evict();

    try {
      const settled = await value;
      if (!keep(settled)) this.forget(key, value);
      return settled;
    } catch (error) {
      this.forget(key, value);
      throw error;
    }
  }

  /** Number of live entries, for tests and the size cap. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Removes `key` only if it still holds `value`, so a newer load is never thrown away. */
  private forget(key: string, value: Promise<T>): void {
    if (this.entries.get(key)?.value === value) this.entries.delete(key);
  }

  private evict(): void {
    // A Map iterates in insertion order, so the first keys are the least recently used.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.options.maxEntries) return;
      this.entries.delete(key);
    }
  }
}

const encoder = new TextEncoder();

/** SHA-256 of a request, so the cache never holds document text as a key. */
export async function cacheKey(parts: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(parts)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
