import { describe, expect, it } from 'vitest';
import { normalize } from '../normalize';
import { extractAmounts, extractDurations, extractNoticePeriods, formatRupees } from './extract';

/**
 * Every extractor here reads *normalised* text, so each fixture is wrapped in `normalize` the
 * way the rule engine does it. Writing the fixtures the way an offer letter writes them, and
 * normalising in the test, keeps the wording realistic and the expectations honest.
 */

describe('extractDurations', () => {
  it('reads a plain number of days', () => {
    expect(extractDurations(normalize('90 days'))).toEqual([
      { days: 90, value: 90, unit: 'day', text: '90 days', index: 0 },
    ]);
  });

  it('reads a number spelled out with the digits repeated in brackets', () => {
    const [duration] = extractDurations(normalize('ninety (90) days'));
    expect(duration!.value).toBe(90);
    expect(duration!.unit).toBe('day');
    // The plural must survive: the UI quotes this text back to the reader.
    expect(duration!.text).toBe('ninety (90) days');
  });

  it('reads a hyphenated number word rather than only its second half', () => {
    expect(extractDurations(normalize('twenty-four (24) months'))).toEqual([
      { days: 720, value: 24, unit: 'month', text: 'twenty-four (24) months', index: 0 },
    ]);
  });

  it('recognises the same number written with a space instead of a hyphen', () => {
    const [duration] = extractDurations(normalize('twenty four (24) months'));
    expect(duration!.value).toBe(24);
    expect(duration!.text).toBe('twenty four (24) months');
  });

  it('counts a year as 365 days', () => {
    const [duration] = extractDurations(normalize('2 years'));
    expect(duration!.days).toBe(730);
    expect(duration!.unit).toBe('year');
  });

  it('counts a month as 30 days', () => {
    const [duration] = extractDurations(normalize('6 months'));
    expect(duration!.days).toBe(180);
    expect(duration!.unit).toBe('month');
  });

  it('counts a week as 7 days', () => {
    const [duration] = extractDurations(normalize('1 week'));
    expect(duration!.days).toBe(7);
    expect(duration!.unit).toBe('week');
  });

  it('keeps a singular unit exactly as the document wrote it', () => {
    const [duration] = extractDurations(normalize('three (3) month'));
    expect(duration!.days).toBe(90);
    expect(duration!.text).toBe('three (3) month');
  });

  it('returns every duration in the order it appears in the clause', () => {
    const text = normalize(
      'The Employee shall give 90 days notice and shall serve the Company for twenty-four (24) months.',
    );
    expect(extractDurations(text).map((duration) => duration.text)).toEqual([
      '90 days',
      'twenty-four (24) months',
    ]);
  });

  it('reports the offset of each match so a party can be attributed to it', () => {
    const text = normalize('Notice of 30 days applies.');
    const [duration] = extractDurations(text);
    expect(text.slice(duration!.index, duration!.index + duration!.text.length)).toBe('30 days');
  });

  it('returns an empty list when the text mentions no duration at all', () => {
    expect(extractDurations(normalize('Salaries are credited on the last working day.'))).toEqual(
      [],
    );
  });

  it('ignores a bare number that is not followed by a unit of time', () => {
    expect(extractDurations(normalize('Clause 7 applies to all employees.'))).toEqual([]);
  });

  it('ignores a zero-length duration rather than reporting it as a period', () => {
    expect(extractDurations(normalize('0 days'))).toEqual([]);
  });
});

describe('extractAmounts', () => {
  it('reads a rupee amount written with Indian digit grouping', () => {
    expect(extractAmounts(normalize('Rs. 2,00,000'))).toEqual([
      { rupees: 200_000, text: 'rs. 2,00,000', index: 0 },
    ]);
  });

  it('reads an unpunctuated INR amount whole instead of only its first three digits', () => {
    // Regression: an earlier pattern made the comma group optional, so "INR 150000" was read
    // as 150 and understated the bond by a factor of a thousand.
    const [amount] = extractAmounts(normalize('INR 150000'));
    expect(amount!.rupees).toBe(150_000);
  });

  it('multiplies a lakh written without a currency marker', () => {
    expect(extractAmounts(normalize('2 lakh'))[0]!.rupees).toBe(200_000);
  });

  it('handles a fractional lakh written with the rupee symbol', () => {
    const [amount] = extractAmounts(normalize('₹1.5 lakhs'));
    expect(amount!.rupees).toBe(150_000);
    expect(amount!.text).toBe('₹1.5 lakhs');
  });

  it('reads a rupee amount written without a full stop after "Rs"', () => {
    expect(extractAmounts(normalize('Rs 50,000'))[0]!.rupees).toBe(50_000);
  });

  it('reads an amount followed by the "/-" suffix used in Indian documents', () => {
    const [amount] = extractAmounts(normalize('Rs.75000/-'));
    expect(amount!.rupees).toBe(75_000);
    expect(amount!.text).toBe('rs.75000');
  });

  it('multiplies a crore', () => {
    expect(extractAmounts(normalize('1 crore'))[0]!.rupees).toBe(10_000_000);
  });

  it('recognises the "lac" spelling as well as "lakh"', () => {
    expect(extractAmounts(normalize('2 lacs'))[0]!.rupees).toBe(200_000);
  });

  it('multiplies thousands', () => {
    expect(extractAmounts(normalize('50 thousand'))[0]!.rupees).toBe(50_000);
  });

  it('does not treat a bare number with no currency marker or multiplier as money', () => {
    expect(extractAmounts(normalize('clause 7.2 applies for 24 months'))).toEqual([]);
  });

  it('ignores a zero amount', () => {
    expect(extractAmounts(normalize('Rs. 0'))).toEqual([]);
  });

  it('returns every amount in the order it appears', () => {
    const amounts = extractAmounts(
      normalize('a penalty of Rs. 2,00,000 or INR 150000, whichever is higher'),
    );
    expect(amounts.map((amount) => amount.rupees)).toEqual([200_000, 150_000]);
  });
});

describe('formatRupees', () => {
  it('groups two hundred thousand the way an Indian reader expects', () => {
    expect(formatRupees(200_000)).toBe('Rs. 2,00,000');
  });

  it('groups one hundred and fifty thousand as one lakh fifty thousand', () => {
    expect(formatRupees(150_000)).toBe('Rs. 1,50,000');
  });

  it('leaves a three-digit amount ungrouped', () => {
    expect(formatRupees(500)).toBe('Rs. 500');
  });

  it('groups a crore with two lakh-sized groups', () => {
    expect(formatRupees(10_000_000)).toBe('Rs. 1,00,00,000');
  });

  it('adds the first comma after the thousands for a four-digit amount', () => {
    expect(formatRupees(1_000)).toBe('Rs. 1,000');
  });

  it('rounds a fractional amount to whole rupees', () => {
    expect(formatRupees(1234.6)).toBe('Rs. 1,235');
  });
});

describe('extractNoticePeriods', () => {
  it('attributes a sentence that names only the employee to the employee', () => {
    const periods = extractNoticePeriods(
      normalize('The Employee shall give ninety (90) days written notice of resignation.'),
    );
    expect(periods.employee?.text).toBe('ninety (90) days');
    expect(periods.employee?.days).toBe(90);
    expect(periods.employer).toBeNull();
    expect(periods.unattributed).toEqual([]);
  });

  it('attributes a sentence that names only the company to the employer', () => {
    const periods = extractNoticePeriods(
      normalize('The Company may terminate this agreement by giving thirty (30) days notice.'),
    );
    expect(periods.employer?.text).toBe('thirty (30) days');
    expect(periods.employee).toBeNull();
  });

  it('splits a clause that states both sides, giving each period to the right party', () => {
    const periods = extractNoticePeriods(
      normalize(
        'The Employee shall give ninety (90) days notice. The Company may terminate on thirty (30) days notice.',
      ),
    );
    expect(periods.employee?.text).toBe('ninety (90) days');
    expect(periods.employer?.text).toBe('thirty (30) days');
  });

  it('gives the notice to whichever party the sentence names first', () => {
    // Both parties appear, but the company is named first, so the notice is the company's.
    const periods = extractNoticePeriods(
      normalize('The Company shall give the Employee 30 days notice before termination.'),
    );
    expect(periods.employer?.text).toBe('30 days');
    expect(periods.employee).toBeNull();
  });

  it('keeps the longest period when the same party is named in two sentences', () => {
    const periods = extractNoticePeriods(
      normalize(
        'The Employee shall serve 30 days notice during probation; the Employee shall serve ninety (90) days notice after confirmation.',
      ),
    );
    expect(periods.employee?.days).toBe(90);
  });

  it('keeps the first period when a later sentence for the same party is shorter', () => {
    const periods = extractNoticePeriods(
      normalize(
        'The Employee shall give ninety (90) days notice; the Employee shall give 30 days notice during probation.',
      ),
    );
    expect(periods.employee?.text).toBe('ninety (90) days');
  });

  it('leaves a period unattributed when the sentence names neither party', () => {
    const periods = extractNoticePeriods(
      normalize('A notice of thirty (30) days is required before the last working day.'),
    );
    expect(periods.employee).toBeNull();
    expect(periods.employer).toBeNull();
    expect(periods.unattributed.map((duration) => duration.text)).toEqual(['thirty (30) days']);
  });

  it('collects every unattributed period rather than guessing at an owner', () => {
    const periods = extractNoticePeriods(
      normalize(
        'A notice period of 90 days applies; a notice period of 30 days applies on probation.',
      ),
    );
    expect(periods.unattributed.map((duration) => duration.days)).toEqual([90, 30]);
  });

  it('ignores a sentence that states a duration but never mentions notice', () => {
    const periods = extractNoticePeriods(
      normalize('The Employee shall serve the Company for twenty-four (24) months.'),
    );
    expect(periods).toEqual({ employee: null, employer: null, unattributed: [] });
  });

  it('returns nulls for text that mentions no notice at all', () => {
    const periods = extractNoticePeriods(
      normalize('Salaries are credited on the last working day of each month.'),
    );
    expect(periods).toEqual({ employee: null, employer: null, unattributed: [] });
  });
});
