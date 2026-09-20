/**
 * Array access helper for hot loops that have already bounds-checked their index.
 *
 * Why this exists: `noUncheckedIndexedAccess` is on, so every `items[i]` is typed
 * `T | undefined`. Inside an algorithm such as the edit-distance table in `verify.ts` the index
 * is provably in range, and sprinkling `?? 0` fallbacks there would bury real bugs behind a
 * plausible-looking default. Failing loudly instead keeps the invariant honest.
 */
export function required<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new RangeError(`Index ${index} is out of range for a collection of ${items.length}`);
  }
  return value;
}

/**
 * Map lookup for keys the caller knows are present.
 *
 * Used where a regular expression's alternation was generated from the map's own keys, so a
 * miss would mean the two had silently drifted apart - which should crash, not quietly return
 * a default that skews a bond amount or a notice period.
 */
export function requiredEntry<K, V>(entries: ReadonlyMap<K, V>, key: K): V {
  const value = entries.get(key);
  if (value === undefined) {
    throw new RangeError(`Key ${String(key)} is missing from a map of ${entries.size} entries`);
  }
  return value;
}
