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
