import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { linesFromText, segment, totalChars, type SourceLine } from './segmenter';

/** Builds paged lines the way the PDF parser does, so page tracking is exercised. */
function paged(pages: readonly (readonly string[])[]): SourceLine[] {
  return pages.flatMap((lines, index) => lines.map((text) => ({ text, page: index + 1 })));
}

const OFFER_LETTER = `OFFER OF EMPLOYMENT

Dear Ms. Sharma,

We are pleased to offer you the position of Associate Software Engineer at Nimbus Technologies
Private Limited, on the terms set out below. Please sign and return a copy of this letter.

1. Appointment
1.1 Your appointment shall be effective from 15 October 2026. You will be based at our Pune
office and may be required to work from any other location of the Company from time to time.

1.2 You will be on probation for a period of six (6) months, which may be extended at the sole
discretion of the Company. Your employment will be confirmed in writing after probation ends.

6. Notice Period
6.1 The Employee shall give ninety (90) days written notice of resignation. The Company may
terminate this Agreement by giving thirty (30) days notice or pay in lieu thereof.
`;

describe('segment', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(segment([])).toEqual([]);
    expect(segment(linesFromText(''))).toEqual([]);
    expect(segment(linesFromText('   \n\n \t \n'))).toEqual([]);
  });

  it('gives every clause a zero-padded id that sorts in document order', () => {
    const clauses = segment(linesFromText(OFFER_LETTER));
    expect(clauses.length).toBeGreaterThan(2);
    expect(clauses.map((clause) => clause.id)).toEqual(
      [...clauses.map((clause) => clause.id)].sort(),
    );
    expect(clauses[0]?.id).toBe('c001');
    expect(clauses.map((clause) => clause.order)).toEqual(clauses.map((_, index) => index));
  });

  it('detects decimal numbering as the clause label', () => {
    const clauses = segment(linesFromText(OFFER_LETTER));
    const labels = clauses.map((clause) => clause.label);
    expect(labels).toContain('1.1');
    expect(labels).toContain('1.2');
    expect(labels).toContain('6.1');
  });

  it.each([
    ['1. First clause with enough words to stand on its own as a real paragraph.', '1'],
    ['2.3 A sub clause with enough words to stand on its own as a real paragraph.', '2.3'],
    ['4.5.6 A deep sub clause with enough words to stand on its own as a paragraph.', '4.5.6'],
    ['7) A bracketed clause with enough words to stand on its own as a paragraph.', '7'],
    ['12.4.1 A deeply numbered clause with enough words to stand on its own here.', '12.4.1'],
    ['100. A clause numbered past ninety-nine, which long agreements really do reach.', '100'],
  ])('reads %j as label %j', (line, expected) => {
    const clauses = segment(linesFromText(line));
    expect(clauses[0]?.label).toBe(expected);
  });

  it.each([
    ['Clause 5 The Employee shall keep all information confidential at all times.', 'Clause 5'],
    ['Section 12.1 Disputes shall be referred to arbitration seated at Bengaluru.', 'Section 12.1'],
    ['Article IV The Company may assign this agreement to any group entity.', 'Article IV'],
  ])('reads a named heading in %j as %j', (line, expected) => {
    const clauses = segment(linesFromText(line));
    expect(clauses[0]?.label).toBe(expected);
  });

  it('treats a short all-capitals line as a heading for the text that follows', () => {
    const clauses = segment(
      linesFromText(
        'CONFIDENTIALITY\nThe Employee shall not disclose any confidential information of the Company at any time.',
      ),
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.heading).toBe('Confidentiality');
    expect(clauses[0]?.text).not.toContain('CONFIDENTIALITY');
    expect(clauses[0]?.text).toMatch(/^The Employee/);
  });

  it('picks up a short lead-in before the body as the heading', () => {
    const clauses = segment(
      linesFromText(
        '9.2 Non-competition. For a period of twenty-four (24) months after the termination of employment, the Employee shall not join a competing business.',
      ),
    );
    expect(clauses[0]?.heading).toBe('Non-competition');
    expect(clauses[0]?.label).toBe('9.2');
  });

  it('keeps sub-items with their parent clause rather than splitting them out', () => {
    const clauses = segment(
      linesFromText(
        [
          '9.2 The Employee shall not solicit the customers of the Company after leaving employment.',
          '(a) This applies across India.',
          '(b) It also applies to any renewal of this agreement.',
          '(i) For the avoidance of doubt, it covers affiliates.',
        ].join('\n'),
      ),
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.text).toContain('(a) This applies across India.');
    expect(clauses[0]?.text).toContain('(i) For the avoidance of doubt');
  });

  it('starts a new clause at a blank line when there is no numbering', () => {
    const paragraph = (which: string) =>
      `The ${which} paragraph is comfortably longer than the minimum clause size, because it keeps talking about the terms of employment, the obligations of both parties and the consequences of ending the agreement early, without ever stopping for a heading.`;
    const clauses = segment(
      linesFromText([paragraph('first'), '', paragraph('second')].join('\n')),
    );
    expect(clauses).toHaveLength(2);
    expect(clauses[0]?.text).toContain('first paragraph');
    expect(clauses[1]?.text).toContain('second paragraph');
  });

  it('keeps merging unnumbered paragraphs until the clause is big enough to cite', () => {
    // A quote must be at least 12 characters to verify, so a 30-character paragraph standing
    // alone would be a citation target that proves nothing.
    const clauses = segment(
      linesFromText(['Signed for and on behalf of', '', 'Nimbus Technologies.'].join('\n')),
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.text).toBe('Signed for and on behalf of Nimbus Technologies.');
  });

  it('merges a short unnumbered fragment into the clause above it', () => {
    const clauses = segment(
      linesFromText(
        [
          'The Employee shall serve the Company faithfully and to the best of their ability throughout the term of this agreement and any renewal of it.',
          '',
          'and any renewal thereof.',
        ].join('\n'),
      ),
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.text).toMatch(/and any renewal thereof\.$/);
  });

  it('keeps each short, complete paragraph of an unnumbered letter as its own clause', () => {
    // Letters state one term per paragraph. Merging them folded the salary into the greeting.
    const clauses = segment(
      linesFromText(
        [
          'We are happy to offer you employment with Quickstart Logistics Private Limited.',
          '',
          'Your annual CTC will be Rs. 3,60,000, paid monthly into your salary account.',
          '',
          'Please report on 1 December 2026 with a copy of your identity proof.',
        ].join('\n'),
      ),
    );
    expect(clauses.map((item) => item.text.slice(0, 12))).toEqual([
      'We are happy',
      'Your annual ',
      'Please repor',
    ]);
  });

  it.each([
    [
      'a sentence that carries on from the paragraph above',
      'which the Company may recover from any amount due to you at the time of exit.',
    ],
    [
      'a line with no closing punctuation',
      'For and on behalf of Quickstart Logistics Private Limited, Chennai',
    ],
    ['a sentence too short to be a term', 'We look forward to having you on the team.'],
  ])('still merges %s', (_kind, fragment) => {
    const clauses = segment(
      linesFromText(
        [
          'You will receive a joining bonus of Rs. 25,000 after completing three months of service.',
          '',
          fragment,
        ].join('\n'),
      ),
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.text.endsWith(fragment)).toBe(true);
  });

  it('does not read a sentence that opens with a figure as a clause number', () => {
    const clauses = segment(
      linesFromText(
        '30 days notice is required from either party before this agreement can be brought to an end.',
      ),
    );
    expect(clauses[0]?.label).toBeNull();
    expect(clauses[0]?.text).toMatch(/^30 days notice/);
  });

  it('never merges a numbered clause into the one above, however short it is', () => {
    const clauses = segment(
      linesFromText(
        [
          '1. The Employee shall serve the Company faithfully throughout the term of this agreement and any renewal of it.',
          '',
          '2. Time is of the essence.',
        ].join('\n'),
      ),
    );
    expect(clauses).toHaveLength(2);
    expect(clauses[1]?.label).toBe('2');
  });

  it.each(['Page 3 of 5', 'Page 12', '-------------------', '   ***   ', '4', 'CONFIDENTIAL'])(
    'drops page furniture such as %j',
    (noise) => {
      const clauses = segment(
        linesFromText(
          `1. The Employee shall keep all information confidential at all times during employment.\n${noise}\n`,
        ),
      );
      expect(clauses).toHaveLength(1);
      expect(clauses[0]?.text).not.toContain(noise.trim());
    },
  );

  describe('page tracking', () => {
    it('records the page a clause starts on', () => {
      const clauses = segment(
        paged([
          ['1. The first clause is on page one and says enough to stand on its own here.'],
          ['2. The second clause is on page two and says enough to stand on its own here.'],
        ]),
      );
      expect(clauses.map((clause) => clause.page)).toEqual([1, 2]);
    });

    it('keeps the start page and the end page for a clause that spans a page break', () => {
      const clauses = segment(
        paged([
          ['7.1 The Employee agrees to serve the Company for a minimum period of twenty-four'],
          ['(24) months from the date of joining, failing which liquidated damages apply.'],
        ]),
      );
      expect(clauses).toHaveLength(1);
      expect(clauses[0]?.page).toBe(1);
      expect(clauses[0]?.pageEnd).toBe(2);
    });

    it('leaves pages null for formats that have none, such as pasted text', () => {
      const clauses = segment(
        linesFromText('1. A clause pasted as plain text has no page number at all to report.'),
      );
      expect(clauses[0]?.page).toBeNull();
      expect(clauses[0]?.pageEnd).toBeNull();
    });
  });

  describe('oversized clauses', () => {
    it('splits at a sentence boundary rather than mid-word', () => {
      const sentence = 'The Company shall provide reasonable notice of any change. '.repeat(20);
      const clauses = segment(linesFromText(`1. ${sentence}`), { maxClauseChars: 400 });
      expect(clauses.length).toBeGreaterThan(1);
      for (const clause of clauses) {
        expect(clause.text.length).toBeLessThanOrEqual(400);
        expect(clause.text).toMatch(/\.$/);
      }
    });

    it('still splits text that contains no sentence boundary at all', () => {
      const clauses = segment(linesFromText(`1. ${'word '.repeat(300)}`), {
        maxClauseChars: 300,
      });
      expect(clauses.length).toBeGreaterThan(1);
      for (const clause of clauses) {
        expect(clause.text.length).toBeLessThanOrEqual(300);
      }
    });

    it('labels only the first part of a split clause, so citations stay unambiguous', () => {
      const sentence = 'The Company shall provide reasonable notice of any change. '.repeat(20);
      const clauses = segment(linesFromText(`9.2 Notices. ${sentence}`), {
        maxClauseChars: 400,
      });
      expect(clauses[0]?.label).toBe('9.2');
      expect(clauses.slice(1).every((clause) => clause.label === null)).toBe(true);
    });

    it('keeps every clause within the schema limit by default', () => {
      const clauses = segment(linesFromText(`1. ${'x'.repeat(LIMITS.maxClauseChars * 2)}`));
      for (const clause of clauses) {
        expect(clause.text.length).toBeLessThanOrEqual(LIMITS.maxClauseChars);
      }
    });
  });

  it('stops at the maximum clause count instead of producing an unusable document', () => {
    const many = Array.from(
      { length: LIMITS.maxClauses + 50 },
      (_, index) =>
        `${index + 1}. Clause number ${index + 1} states something about the terms of employment here.`,
    ).join('\n');
    const clauses = segment(linesFromText(many));
    expect(clauses).toHaveLength(LIMITS.maxClauses);
  });

  it('preserves the original wording, because quotes are verified against it', () => {
    const original =
      '7.1 The Employee shall pay Rs. 2,00,000 as liquidated damages if the minimum service period is not completed.';
    const clauses = segment(linesFromText(original));
    expect(clauses[0]?.text).toBe(original);
  });

  it('joins wrapped lines back into one paragraph with single spaces', () => {
    const clauses = segment(
      linesFromText(
        [
          '1. The Employee shall give ninety (90) days written   notice',
          '   of resignation to the Company before leaving employment.',
        ].join('\n'),
      ),
    );
    expect(clauses[0]?.text).toBe(
      '1. The Employee shall give ninety (90) days written notice of resignation to the Company before leaving employment.',
    );
  });
});

describe('linesFromText', () => {
  it('splits on both Unix and Windows line endings', () => {
    expect(linesFromText('a\nb\r\nc')).toEqual([
      { text: 'a', page: null },
      { text: 'b', page: null },
      { text: 'c', page: null },
    ]);
  });
});

describe('totalChars', () => {
  it('adds up the clause text lengths', () => {
    const clauses = segment(linesFromText(OFFER_LETTER));
    expect(totalChars(clauses)).toBe(clauses.reduce((sum, clause) => sum + clause.text.length, 0));
  });

  it('is zero for no clauses', () => {
    expect(totalChars([])).toBe(0);
  });
});
