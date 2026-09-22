import type { ClauseCategory, RiskLevel } from '../../../shared/types';
import { clausesFromPrompt, type PromptClause } from './index';

/**
 * Fixture analysis.
 *
 * Classification here is keyword-driven, which is exactly what a real model is better than -
 * but the *shape* of the output matches a real response, and every quote is lifted verbatim out
 * of the clause, so verification, rule evaluation and the UI all behave as they would live.
 */

interface Pattern {
  category: ClauseCategory;
  risk: RiskLevel;
  match: RegExp;
  title: string;
  explanation: string;
  whyItMatters: string;
}

const PATTERNS: readonly Pattern[] = [
  {
    category: 'NON_COMPETE',
    risk: 'HIGH',
    match: /non[- ]?comp|competes with|competing business/i,
    title: 'Restriction on joining a competitor',
    explanation:
      'This clause says that after you leave, you may not join, own or advise a business that competes with the company, for a stated period.',
    whyItMatters:
      'It could limit where you can work next, which matters most early in a career when moves are frequent.',
  },
  // Checked before the bond pattern: a clause keeping your originals until a minimum period
  // is served mentions that period, but what it does is hold your documents.
  {
    category: 'DOCUMENT_RETENTION',
    risk: 'HIGH',
    match: /original (certificate|document|mark ?sheet)/i,
    title: 'Company holds your original documents',
    explanation:
      'This clause says the company will keep your original certificates and identity documents until a condition is met.',
    whyItMatters:
      'Without your originals it is harder to take up another job or apply for further study.',
  },
  {
    category: 'BOND_OR_EXIT_PENALTY',
    risk: 'HIGH',
    match: /liquidated damages|minimum period of|service bond|training cost/i,
    title: 'Money owed if you leave early',
    explanation:
      'This clause asks you to stay for a minimum period and to pay a stated amount to the company if you leave before that.',
    whyItMatters:
      'It puts a price on changing jobs, and the amount is often large compared with an early-career salary.',
  },
  {
    category: 'NOTICE_PERIOD',
    risk: 'MEDIUM',
    match: /notice of resignation|written notice|notice period/i,
    title: 'Notice you must give',
    explanation:
      'This clause sets how much notice each side must give before ending the employment.',
    whyItMatters:
      'A long notice period can delay a new job, because most employers want you to start sooner.',
  },
  {
    category: 'TERMINATION',
    risk: 'MEDIUM',
    match: /terminate your employment|with immediate effect|without notice/i,
    title: 'How the company can end your employment',
    explanation:
      'This clause describes when and how the company can end your employment, and on what notice.',
    whyItMatters: 'It decides how much warning and pay you would get if the company let you go.',
  },
  {
    category: 'IP_ASSIGNMENT',
    risk: 'MEDIUM',
    match: /intellectual property|work product|invention/i,
    title: 'Who owns what you create',
    explanation:
      'This clause gives the company ownership of work you create, and describes how widely that applies.',
    whyItMatters: 'If you have side projects, a wide clause could cover them too.',
  },
  {
    category: 'COMPENSATION',
    risk: 'INFO',
    match: /cost to company|\bctc\b|basic salary|joining bonus/i,
    title: 'How your pay is made up',
    explanation:
      'This clause sets out your total pay and how it is divided between basic salary, allowances and contributions.',
    whyItMatters:
      'The split decides your monthly in-hand amount and what goes into provident fund and gratuity.',
  },
  {
    category: 'PROBATION',
    risk: 'MEDIUM',
    match: /probation/i,
    title: 'Probation period',
    explanation: 'This clause sets how long you are on probation and how confirmation happens.',
    whyItMatters: 'Notice periods and benefits often differ until you are confirmed.',
  },
  {
    category: 'CONFIDENTIALITY',
    risk: 'INFO',
    match: /confidential|trade secret/i,
    title: 'Keeping company information private',
    explanation:
      'This clause requires you to keep the company information you see private, during and after employment.',
    whyItMatters: 'Obligations like this normally continue after you leave.',
  },
  {
    category: 'NON_SOLICIT',
    risk: 'MEDIUM',
    match: /solicit|entice away/i,
    title: 'Approaching clients or colleagues after leaving',
    explanation:
      'This clause limits approaching the company clients or employees for a period after you leave.',
    whyItMatters: 'It can affect who you may work with next.',
  },
  {
    category: 'DISPUTE_RESOLUTION',
    risk: 'INFO',
    match: /arbitration|jurisdiction/i,
    title: 'Where a dispute would be decided',
    explanation: 'This clause decides where and how any disagreement would be settled.',
    whyItMatters: 'Arbitration or a distant court can make a dispute expensive.',
  },
  {
    category: 'MOONLIGHTING',
    risk: 'INFO',
    match: /whole time and attention|any other employment/i,
    title: 'Other work while employed',
    explanation: 'This clause requires you to work only for the company while employed here.',
    whyItMatters: 'It may cover freelancing and paid side work.',
  },
];

/**
 * A sentence: starts at a capital letter or bracket and runs to a full stop followed by a space.
 *
 * Dots inside a sentence are kept when no space follows ("5.2", "2,00,000") or when they end a
 * common abbreviation ("Rs. 2,00,000"), so a clause number or an amount does not cut a quote in
 * half and a quote never starts on the stray digit after "5.".
 */
const SENTENCE = /[A-Z(](?:[^.]|\.(?=\S)|(?<=\b(?:Rs|No|Nos|viz))\.)*?\.(?=\s|$)/g;

/**
 * Takes a quote from the clause: its first whole sentence of a sensible length, otherwise a
 * prefix. Long enough to clear the twelve-character minimum in `shared/verify.ts` and short
 * enough to look like something a model would actually return.
 */
function quoteFrom(text: string): string {
  for (const [sentence] of text.matchAll(SENTENCE)) {
    if (sentence.length >= 25 && sentence.length <= 240) return sentence.trim();
  }
  // No sentence of a usable length: take the opening words after any clause number.
  const start = Math.max(0, text.search(/[A-Z(]/));
  const opening = text.slice(start, start + 160);
  // Only a cut prefix can end mid-word; a short clause is quoted whole.
  return (start + 160 < text.length ? opening.replace(/\s+\S*$/, '') : opening).trim();
}

function findingFor(clause: PromptClause): Record<string, unknown> | null {
  const pattern = PATTERNS.find((candidate) => candidate.match.test(clause.text));
  if (!pattern) return null;

  return {
    clauseId: clause.id,
    category: pattern.category,
    risk: pattern.risk,
    title: pattern.title,
    explanation: pattern.explanation,
    whyItMatters: pattern.whyItMatters,
    quote: quoteFrom(clause.text),
    questionsToAsk: [],
    confidence: 'high',
  };
}

/** The first match in any clause: its first capture group if it has one, else the whole match. */
function firstMatch(clauses: readonly PromptClause[], pattern: RegExp): string | null {
  for (const clause of clauses) {
    const match = pattern.exec(clause.text);
    if (match) return (match[1] ?? match[0]).trim();
  }
  return null;
}

/** A rupee amount from the clause that is about `topic`, not merely the first one in the letter. */
function amountAbout(clauses: readonly PromptClause[], topic: RegExp): string | null {
  const clause = clauses.find((candidate) => topic.test(candidate.text));
  return clause ? firstMatch([clause], /Rs\. ?[\d,]+/) : null;
}

/**
 * A plausible analysis built from the clauses in the prompt, for `MOCK_GEMINI=true`.
 *
 * Quotes are cut from the real clause text so they pass verification, plus one that cannot, so
 * the "couldn't verify" path is always on screen in demos (DECISIONS D19).
 */
export function mockAnalyze(userPrompt: string): Record<string, unknown> {
  const clauses = clausesFromPrompt(userPrompt);
  const findings = clauses
    .map(findingFor)
    .filter((finding): finding is Record<string, unknown> => finding !== null);

  // One deliberately unverifiable finding, so the "couldn't verify" path is exercised end to
  // end rather than only in unit tests. It cites a real clause with a quote that is not in it.
  const firstClause = clauses[0];
  if (firstClause && findings.length > 0) {
    findings.push({
      clauseId: firstClause.id,
      category: 'GENERAL',
      risk: 'LOW',
      title: 'Demo: a claim we could not check',
      explanation:
        'This finding exists to show what happens when a quote cannot be found in the document.',
      whyItMatters:
        'SignSure shows unverified claims separately instead of presenting them as fact.',
      quote: 'This sentence does not appear anywhere in the uploaded document.',
      questionsToAsk: [],
      confidence: 'low',
    });
  }

  return {
    documentSummary: {
      documentType: clauses.length > 0 ? 'Letter of appointment' : null,
      employer: firstMatch(clauses, /[A-Z][A-Za-z]+ Technologies Private Limited/),
      role: firstMatch(clauses, /position of ([A-Z][A-Za-z ]+?)(?= (?:with|at|in)\b|[,.])/),
      // The joining date, not the date the letter was written.
      startDate: firstMatch(
        clauses,
        /(?:effective from|joining on|join on|date of joining is) (\d{1,2} [A-Z][a-z]+ \d{4})/i,
      ),
      noticePeriod: firstMatch(clauses, /(?:ninety|sixty|thirty|\d{1,3}) \(?\d{0,3}\)? ?days/i),
      probation: firstMatch(
        clauses,
        /probation for a period of ([^.,]{3,40}?)(?= from| starting|[.,])/i,
      ),
      bondOrPenalty: amountAbout(
        clauses,
        /liquidated damages|training bond|service bond|minimum period/i,
      ),
      overview:
        'This is an offer of employment. It sets out pay, notice, probation, and several terms that would apply if you leave before a stated period.',
      sourceClauseIds: clauses.slice(0, 3).map((clause) => clause.id),
    },
    findings,
  };
}
