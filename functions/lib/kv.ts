/**
 * The slice of Workers KV the rate limiter uses.
 *
 * Declared here, beside the code that depends on it, rather than in `tools/`: production code
 * must not import from the development tooling. `tools/memoryKv.ts` implements this interface
 * for local runs and tests, and Cloudflare's own `KVNamespace` satisfies it in production.
 */
export interface KvPutOptions {
  expirationTtl?: number;
}

export interface MinimalKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KvPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}
