/**
 * Deterministic extraction of the facts the rule library reasons about: how long a notice
 * period is, how big a bond is, and which side of the contract each one binds.
 *
 * These numbers are shown to the user and drive severity, so they come from regular expressions
 * over the clause text rather than from the model. Everything here operates on *normalised*
 * text (see `shared/normalize.ts`): lower-cased, ASCII punctuation, single spaces.
 */

export type DurationUnit = 'day' | 'week' | 'month' | 'year';

export interface Duration {
  /** Approximate length in days, for comparisons only. Months are 30 days, years 365. */
  days: number;
  value: number;
  unit: DurationUnit;
  /** The matched text, so the UI can quote the document rather than our arithmetic. */
  text: string;
  /** Offset of the match in the normalised text, used to attribute it to a party. */
  index: number;
}

export interface Amount {
  /** Value in rupees. */
  rupees: number;
  text: string;
  index: number;
}

const DAYS_PER_UNIT: Readonly<Record<DurationUnit, number>> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** Numbers commonly spelled out in Indian employment contracts. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['fifteen', 15],
  ['eighteen', 18],
  ['twenty', 20],
  ['twenty-four', 24],
  ['twenty four', 24],
  ['thirty', 30],
  ['forty-five', 45],
  ['forty five', 45],
  ['sixty', 60],
  ['ninety', 90],
  ['one hundred eighty', 180],
]);

const NUMBER_WORD_PATTERN = [...NUMBER_WORDS.keys()].sort((a, b) => b.length - a.length).join('|');

/** Plurals first: regex alternation is ordered, and "day" would otherwise swallow "days". */
const UNIT_PATTERN = '(days|day|weeks|week|months|month|years|year)';

/**
 * Matches "90 days", "ninety (90) days", "twenty-four (24) months", "3 month".
 * A spelled-out number may be followed by the same number in brackets, which is how these
 * documents normally write it; the bracketed digits are ignored so the two never disagree.
 */
const DURATION_PATTERN = new RegExp(
  String.raw`(?:(${NUMBER_WORD_PATTERN})|(\d{1,4}))\s*(?:\(\s*\d{1,4}\s*\)\s*)?${UNIT_PATTERN}`,
  'g',
);

function toUnit(raw: string): DurationUnit {
  if (raw.startsWith('day')) return 'day';
  if (raw.startsWith('week')) return 'week';
  if (raw.startsWith('month')) return 'month';
  return 'year';
}

/** Every duration mentioned in the text, in the order it appears. */
export function extractDurations(normalizedText: string): Duration[] {
  const durations: Duration[] = [];
  for (const match of normalizedText.matchAll(DURATION_PATTERN)) {
    const [text, word, digits, rawUnit] = match;
    const value = word !== undefined ? (NUMBER_WORDS.get(word) ?? 0) : Number(digits);
    if (!Number.isFinite(value) || value <= 0 || rawUnit === undefined) continue;
    const unit = toUnit(rawUnit);
    durations.push({
      days: value * DAYS_PER_UNIT[unit],
      value,
      unit,
      text,
      index: match.index,
    });
  }
  return durations;
}

const MULTIPLIERS: ReadonlyMap<string, number> = new Map([
  ['thousand', 1_000],
  ['lakh', 100_000],
  ['lakhs', 100_000],
  ['lac', 100_000],
  ['lacs', 100_000],
  ['crore', 10_000_000],
  ['crores', 10_000_000],
]);

/**
 * Matches "rs. 2,00,000", "inr 150000", "2 lakh", "1.5 lakhs", "rs 50,000".
 * The rupee symbol survives normalisation, so it is matched directly.
 */
/*
 * The grouped alternative requires at least one comma, so a plain run of digits such as
 * "150000" falls through to the second alternative and is read whole. With `,\d{2,3}` optional,
 * "150000" would match as "150" and understate the amount by a factor of a thousand.
 */
const AMOUNT_PATTERN =
  /(?:(?:rs\.?|inr|₹)\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(thousand|lakhs?|lacs?|crores?)?/g;

const CURRENCY_PREFIX = /(rs\.?|inr|₹)\s*$/;

/**
 * Money amounts mentioned in the text.
 *
 * A bare number is only treated as money when it is preceded by a currency marker or followed
 * by an Indian multiplier, otherwise "24 months" and "clause 7.2" would be read as rupees.
 */
export function extractAmounts(normalizedText: string): Amount[] {
  const amounts: Amount[] = [];
  for (const match of normalizedText.matchAll(AMOUNT_PATTERN)) {
    const [text, rawDigits, multiplierWord] = match;
    if (rawDigits === undefined) continue;

    const before = normalizedText.slice(0, match.index);
    const hasCurrency = CURRENCY_PREFIX.test(before) || /^(?:rs|inr|₹)/.test(text);
    if (!hasCurrency && multiplierWord === undefined) continue;

    const base = Number(rawDigits.replaceAll(',', ''));
    if (!Number.isFinite(base) || base <= 0) continue;

    const multiplier = multiplierWord === undefined ? 1 : (MULTIPLIERS.get(multiplierWord) ?? 1);
    amounts.push({
      rupees: base * multiplier,
      text: text.trim(),
      index: match.index,
    });
  }
  return amounts;
}

/** Formats rupees the way an Indian reader expects: 2,00,000 rather than 200,000. */
export function formatRupees(rupees: number): string {
  const rounded = Math.round(rupees);
  const digits = String(rounded);
  if (digits.length <= 3) return `Rs. ${digits}`;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `Rs. ${rest},${lastThree}`;
}

const EMPLOYEE_WORDS = /\b(employee|you|your|he\/she|his\/her)\b/g;
const EMPLOYER_WORDS = /\b(company|employer|organisation|organization|management)\b/g;

export interface NoticePeriods {
  /** Longest notice the employee must give. */
  employee: Duration | null;
  /** Longest notice the company must give. */
  employer: Duration | null;
  /** Durations near the word "notice" that could not be attributed to either side. */
  unattributed: Duration[];
}

function firstIndexOf(pattern: RegExp, text: string): number {
  const matcher = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const match = matcher.exec(text);
  return match ? match.index : -1;
}

/**
 * Splits notice durations between the two sides of the contract.
 *
 * Attribution is per sentence: whichever party is named first in the sentence owns the notice
 * mentioned in it. That is how these clauses are actually written ("The Employee shall give
 * ninety days notice; the Company may terminate on thirty days notice"). A sentence that names
 * neither party, or both ambiguously, is left unattributed rather than guessed at, because an
 * incorrect asymmetry claim is worse than no claim.
 */
export function extractNoticePeriods(normalizedText: string): NoticePeriods {
  const result: NoticePeriods = { employee: null, employer: null, unattributed: [] };

  for (const sentence of normalizedText.split(/[.;\n]/)) {
    if (!sentence.includes('notice')) continue;
    const durations = extractDurations(sentence);
    if (durations.length === 0) continue;

    const employeeAt = firstIndexOf(EMPLOYEE_WORDS, sentence);
    const employerAt = firstIndexOf(EMPLOYER_WORDS, sentence);

    let owner: 'employee' | 'employer' | null = null;
    if (employeeAt !== -1 && employerAt === -1) owner = 'employee';
    else if (employerAt !== -1 && employeeAt === -1) owner = 'employer';
    else if (employeeAt !== -1 && employerAt !== -1) {
      owner = employeeAt < employerAt ? 'employee' : 'employer';
    }

    for (const duration of durations) {
      if (owner === null) {
        result.unattributed.push(duration);
        continue;
      }
      const current = result[owner];
      if (current === null || duration.days > current.days) result[owner] = duration;
    }
  }

  return result;
}
