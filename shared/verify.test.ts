import { describe, expect, it } from 'vitest';
import { buildVerifiedQuote, isPresentable, summarizeVerification, verifyQuote } from './verify';
import type { VerifiedQuote } from './types';

const SOFT_HYPHEN = String.fromCodePoint(0x00ad);

const NON_COMPETE = `9.2 Non-competition. For a period of twenty-four (24) months after the
termination of employment, the Employee shall not, directly or indirectly, join, own or advise
any business that competes with the Company anywhere in India.`;

const BOND = `7.1 The Employee agrees to serve the Company for a minimum period of 24 months.
If the Employee resigns earlier, the Employee shall pay Rs. 2,00,000 as liquidated damages.`;

/** Convenience for the many assertions that only care about the matched substring. */
function matchedText(text: string, quote: string): string | null {
  const match = verifyQuote(text, quote);
  if (match.start === undefined || match.end === undefined) return null;
  return text.slice(match.start, match.end);
}

describe('verifyQuote', () => {
  describe('exact matches', () => {
    it('verifies a quote copied character for character and returns usable offsets', () => {
      const quote = 'the Employee shall not, directly or indirectly, join';
      const match = verifyQuote(NON_COMPETE, quote);
      expect(match.status).toBe('verified');
      expect(match.score).toBe(1);
      expect(NON_COMPETE.slice(match.start, match.end)).toBe(quote);
    });

    it('verifies across a line break in the source text', () => {
      const quote = 'months after the termination of employment';
      expect(verifyQuote(NON_COMPETE, quote).status).toBe('verified');
      expect(matchedText(NON_COMPETE, quote)).toContain('\n');
    });

    it('verifies despite different capitalisation', () => {
      expect(verifyQuote(BOND, 'MINIMUM PERIOD OF 24 MONTHS').status).toBe('verified');
    });

    it('verifies despite extra whitespace in the quote', () => {
      expect(verifyQuote(BOND, 'liquidated    damages').status).toBe('verified');
    });

    it('verifies when the document uses curly quotes and the model returns straight ones', () => {
      const clause = 'The Employee shall not disclose the Company’s “Confidential Information”.';
      const match = verifyQuote(clause, 'the Company\'s "Confidential Information"');
      expect(match.status).toBe('verified');
      expect(clause.slice(match.start, match.end)).toBe('the Company’s “Confidential Information”');
    });

    it('verifies across a soft hyphen left by PDF extraction', () => {
      const clause = `The Employee shall receive compen${SOFT_HYPHEN}sation of Rs. 6,00,000 per year.`;
      expect(verifyQuote(clause, 'receive compensation of Rs. 6,00,000').status).toBe('verified');
    });

    it('verifies Devanagari text and highlights the right span', () => {
      const clause = 'कर्मचारी को इस्तीफा देने से पहले नब्बे (90) दिन का नोटिस देना होगा।';
      const quote = 'नब्बे (90) दिन का नोटिस';
      const match = verifyQuote(clause, quote);
      expect(match.status).toBe('verified');
      expect(clause.slice(match.start, match.end)).toBe(quote);
    });

    it('keeps a trailing matra inside the highlight', () => {
      // The quote ends on a consonant that carries a vowel sign. Highlighting one UTF-16 unit
      // past the consonant would drop the sign and render a different word.
      const clause = 'कर्मचारी की नोटिस अवधि तीन महीने होगी।';
      const quote = 'कर्मचारी की नोटिस अवधि';
      const match = verifyQuote(clause, quote);
      expect(match.status).toBe('verified');
      expect(clause.slice(match.start, match.end)).toBe(quote);
    });

    it('trims surrounding whitespace from the quote before matching', () => {
      expect(verifyQuote(BOND, '   liquidated damages   ').status).toBe('verified');
    });
  });

  describe('fuzzy matches', () => {
    const PARAPHRASED =
      'the Employee shall not, directly or indirectly, join, own or ADVISE any organisation that competes with the Company anywhere in India';

    it('reports one changed word in a long quote as a close match', () => {
      const match = verifyQuote(NON_COMPETE, PARAPHRASED);
      expect(match.status).toBe('fuzzy');
      expect(match.score).toBeGreaterThanOrEqual(0.9);
      expect(match.score).toBeLessThan(1);
    });

    it('highlights the window it actually matched', () => {
      const text = matchedText(NON_COMPETE, PARAPHRASED);
      expect(text).toContain('directly or indirectly');
      expect(text).toContain('anywhere in India');
    });

    it('picks the closest occurrence when a clause repeats similar wording', () => {
      // Three near-identical sentences: the middle one is a worse match than the first, and the
      // third ties with it. The best-scoring, earliest window must win.
      const base =
        'the Employee shall provide written notice of at least ninety days to the Company before resigning from the position of Software Engineer';
      const better = base.replace('shall', 'must');
      const worse = better.replace('ninety', 'sixty');
      const clause = `${better}. ${worse}. ${better}.`;

      const match = verifyQuote(clause, base);
      expect(match.status).toBe('fuzzy');
      expect(match.start).toBe(0);
      expect(clause.slice(match.start, match.end)).toContain('ninety days');
      expect(clause.slice(match.start, match.end)).not.toContain('sixty');
    });

    it('tolerates a dropped word', () => {
      const match = verifyQuote(
        NON_COMPETE,
        'For a period of twenty-four (24) months after termination of employment, the Employee shall not, directly or indirectly, join',
      );
      expect(match.status).toBe('fuzzy');
    });
  });

  describe('rejections', () => {
    it('rejects a quote taken from a different clause', () => {
      expect(verifyQuote(NON_COMPETE, 'shall pay Rs. 2,00,000 as liquidated damages').status).toBe(
        'unverified',
      );
    });

    it('rejects an invented quote that sounds plausible', () => {
      expect(
        verifyQuote(NON_COMPETE, 'the Company shall reimburse all relocation expenses in full')
          .status,
      ).toBe('unverified');
    });

    it('rejects a quote shorter than the minimum, even when present verbatim', () => {
      expect(verifyQuote(NON_COMPETE, 'the Company').status).toBe('unverified');
      expect(verifyQuote(NON_COMPETE, 'India.').status).toBe('unverified');
    });

    it.each(['', '   ', '\n\t'])('rejects blank quotes (%j)', (quote) => {
      expect(verifyQuote(NON_COMPETE, quote).status).toBe('unverified');
    });

    it('rejects any quote against empty clause text', () => {
      expect(verifyQuote('', 'the Employee shall not compete').status).toBe('unverified');
      expect(verifyQuote('   \n  ', 'the Employee shall not compete').status).toBe('unverified');
    });

    it('does not verify a quote whose meaning has been inverted', () => {
      const match = verifyQuote(
        NON_COMPETE,
        'the Employee may, at any time, join, own or advise any business that competes with the Company across India and abroad',
      );
      expect(match.status).not.toBe('verified');
    });

    it('returns no offsets and a zero score when unverified', () => {
      const match = verifyQuote(NON_COMPETE, 'totally unrelated sentence about insurance cover');
      expect(match.status).toBe('unverified');
      expect(match.start).toBeUndefined();
      expect(match.end).toBeUndefined();
      expect(match.score).toBe(0);
    });

    it('rejects a quote much longer than the clause it claims to come from', () => {
      const match = verifyQuote(
        'Short clause about leave.',
        'Short clause about leave and a great deal of additional text that was never in the document at all.',
      );
      expect(match.status).toBe('unverified');
    });

    it('skips fuzzy matching on an unreasonably long clause rather than burning CPU', () => {
      const huge = 'word '.repeat(2_500);
      const match = verifyQuote(huge, 'a quote that is definitely not present here at all');
      expect(match.status).toBe('unverified');
    });
  });
});

describe('buildVerifiedQuote', () => {
  it('produces a presentable quote with offsets when the clause matches', () => {
    const quote = buildVerifiedQuote('c009', 'minimum period of 24 months', BOND);
    expect(quote).toEqual({
      clauseId: 'c009',
      quote: 'minimum period of 24 months',
      status: 'verified',
      start: expect.any(Number),
      end: expect.any(Number),
    });
  });

  it('marks a citation unverified when the clause id does not exist in the document', () => {
    const quote = buildVerifiedQuote('c999', 'minimum period of 24 months', undefined);
    expect(quote.status).toBe('unverified');
    expect(quote.start).toBeUndefined();
  });

  it('marks a citation unverified when the quote is not in the cited clause', () => {
    const quote = buildVerifiedQuote(
      'c009',
      'a two year non-compete after leaving the company',
      BOND,
    );
    expect(quote.status).toBe('unverified');
  });

  it('trims the quote it echoes back', () => {
    expect(buildVerifiedQuote('c009', '  liquidated damages  ', BOND).quote).toBe(
      'liquidated damages',
    );
  });

  it('keeps a fuzzy match presentable, with the matched window', () => {
    // "Rs" instead of "Rs." - typography, not a change of meaning.
    const quote = buildVerifiedQuote(
      'c009',
      'If the Employee resigns earlier, the Employee shall pay Rs 2,00,000 as liquidated damages.',
      BOND,
    );
    expect(quote.status).toBe('fuzzy');
    expect(quote.start).toBeTypeOf('number');
  });

  it('refuses to fuzzy-match a changed amount, which is the mistake that matters most', () => {
    const quote = buildVerifiedQuote(
      'c009',
      'the Employee agrees to serve the Company for a minimum period of 36 months',
      BOND,
    );
    expect(quote.status).toBe('unverified');
  });
});

describe('isPresentable', () => {
  it.each([
    ['verified', true],
    ['fuzzy', true],
    ['unverified', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isPresentable({ clauseId: 'c1', quote: 'q', status })).toBe(expected);
  });
});

describe('summarizeVerification', () => {
  it('counts each outcome', () => {
    const quotes: VerifiedQuote[] = [
      { clauseId: 'c1', quote: 'a', status: 'verified' },
      { clauseId: 'c2', quote: 'b', status: 'verified' },
      { clauseId: 'c3', quote: 'c', status: 'fuzzy' },
      { clauseId: 'c4', quote: 'd', status: 'unverified' },
    ];
    expect(summarizeVerification(quotes)).toEqual({ verified: 2, fuzzy: 1, unverified: 1 });
  });

  it('returns zeros for an empty list', () => {
    expect(summarizeVerification([])).toEqual({ verified: 0, fuzzy: 0, unverified: 0 });
  });
});
