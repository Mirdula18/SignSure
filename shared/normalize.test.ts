import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithMap, tokenize } from './normalize';

const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZERO_WIDTH_NON_JOINER = String.fromCodePoint(0x200c);
const BOM = String.fromCodePoint(0xfeff);
const NON_BREAKING_SPACE = String.fromCodePoint(0x00a0);

describe('normalize', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalize('  The   Employee\n\tSHALL  ')).toBe('the employee shall');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalize('   \n\t  ')).toBe('');
    expect(normalize('')).toBe('');
  });

  it('folds curly quotes and apostrophes to ASCII', () => {
    expect(normalize('the “company”’s')).toBe('the "company"\'s');
  });

  it('folds every dash variant to a hyphen', () => {
    const dashes = ['‐', '‑', '‒', '–', '—', '―', '−'];
    for (const dash of dashes) {
      expect(normalize(`ninety${dash}day`)).toBe('ninety-day');
    }
  });

  it('expands an ellipsis character to three dots', () => {
    expect(normalize('and so on…')).toBe('and so on...');
  });

  it('drops soft hyphens introduced at PDF line breaks', () => {
    expect(normalize(`compen${SOFT_HYPHEN}sation`)).toBe('compensation');
  });

  it('drops zero-width characters and the byte-order mark', () => {
    expect(normalize(`${BOM}non${ZERO_WIDTH_SPACE}compete`)).toBe('noncompete');
  });

  it('treats a non-breaking space as ordinary whitespace', () => {
    expect(normalize(`Rs.${NON_BREAKING_SPACE}2,00,000`)).toBe('rs. 2,00,000');
  });

  it('applies NFKC so ligatures and full-width forms match their plain form', () => {
    expect(normalize('ofﬁce')).toBe('office');
    expect(normalize('Ｅｍｐ')).toBe('emp');
  });

  describe('Devanagari', () => {
    it('keeps Hindi text intact and collapses whitespace around it', () => {
      expect(normalize('  नोटिस   अवधि  ')).toBe('नोटिस अवधि');
    });

    it('matches a precomposed nukta form against its decomposed form', () => {
      const precomposed = 'क़'; // KA with nukta, single code point
      const decomposed = 'क़'; // KA + combining nukta
      expect(normalize(precomposed)).toBe(normalize(decomposed));
    });

    it('drops a zero-width non-joiner inside a Hindi word', () => {
      const withZwnj = `कर${ZERO_WIDTH_NON_JOINER}ना`;
      expect(normalize(withZwnj)).toBe('करना');
    });
  });
});

describe('normalizeWithMap', () => {
  it('maps every normalised character back to its source index', () => {
    const input = '  The  Employee ';
    const { text, start: map } = normalizeWithMap(input);
    expect(text).toBe('the employee');
    expect(map).toHaveLength(text.length);
    expect(input[map[0]!]).toBe('T');
    // The collapsed space points at the first whitespace character of the run.
    expect(input[map[3]!]).toBe(' ');
    expect(input[map[4]!]).toBe('E');
  });

  it('points a multi-character expansion at the single source character', () => {
    const { text, start: map } = normalizeWithMap('a…');
    expect(text).toBe('a...');
    expect(map).toEqual([0, 1, 1, 1]);
  });

  it('keeps indices correct after dropped characters', () => {
    const input = `no${SOFT_HYPHEN}tice`;
    const { text, start: map } = normalizeWithMap(input);
    expect(text).toBe('notice');
    expect(input.slice(map[2])).toBe('tice');
  });

  it('never emits a leading or trailing space', () => {
    const { text } = normalizeWithMap('\n\n  hello  \n\n');
    expect(text).toBe('hello');
  });

  it.each([
    'plain ascii',
    'curly ‘quotes’ and — dashes',
    'pay \u{1F4B0} now',
    '  padded  \n text ',
    'क़ नोटिस अवधि',
    'office and …',
  ])('keeps the map index-for-index with the text for %j', (input) => {
    const { text, start: map } = normalizeWithMap(input);
    expect(map).toHaveLength(text.length);
  });

  it('does not desynchronise the map after a surrogate pair', () => {
    const input = 'pay \u{1F4B0} now';
    const { text, start: map } = normalizeWithMap(input);
    expect(text).toContain('\u{1F4B0}');
    const nowIndex = text.indexOf('now');
    expect(input.slice(map[nowIndex])).toBe('now');
  });
});

describe('tokenize', () => {
  it('splits normalised text into words with offsets', () => {
    expect(tokenize('the notice period')).toEqual([
      { value: 'the', start: 0, end: 3 },
      { value: 'notice', start: 4, end: 10 },
      { value: 'period', start: 11, end: 17 },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});
