import { describe, expect, it } from 'vitest';
import { required } from './arrays';

describe('required', () => {
  it('returns the element at an in-range index', () => {
    expect(required([10, 20, 30], 1)).toBe(20);
  });

  it('works on any array-like, including typed arrays and strings', () => {
    expect(required(Int32Array.from([5, 6]), 0)).toBe(5);
    expect(required('abc', 2)).toBe('c');
  });

  it('throws rather than inventing a default when the index is past the end', () => {
    expect(() => required([1, 2], 5)).toThrow(RangeError);
    expect(() => required([1, 2], 5)).toThrow('Index 5 is out of range for a collection of 2');
  });

  it('throws for a negative index', () => {
    expect(() => required([1, 2], -1)).toThrow(RangeError);
  });

  it('throws on an empty collection', () => {
    expect(() => required([], 0)).toThrow(RangeError);
  });
});
