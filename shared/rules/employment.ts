import type { Clause, ClauseCategory, RiskLevel } from '../types';
import { extractAmounts, extractNoticePeriods, formatRupees, type Duration } from './extract';
import type { MissingInfoRule, Rule, RuleContext, RuleVerdict } from './types';

/**
 * The India employment rule library.
 *
 * Every `message` and `basis` below is fixed, reviewed text taken from docs/LEGAL_RULES.md.
 * The model never writes any of it. Language is deliberately cautious - "generally", "courts
 * have held", "may" - because SignSure gives information, not advice, and must never tell
 * someone a clause is void or that they should or should not sign.
 *
 * Re-check every `basis` against a primary source and bump `lastReviewed` before a release.
 */

const REVIEWED = '2026-09-20';

/**
 * Matches a restriction on competing, whatever verb the drafter used.
 *
 * The gap allowance is generous because real clauses pile up qualifiers between the prohibition
 * and the thing prohibited ("shall not, directly or indirectly, whether as employee, consultant,
 * partner, director or shareholder, join, own, manage or advise any business that competes").
 * `[^.]` keeps the match inside one sentence, which is what actually bounds the false positives.
 */
const COMPETE_RESTRICTION =
  /(shall not|will not|must not|agrees not to|refrain from|prohibited from|restrained from)[^.]{0,250}(compet|similar business|rival|engage in any business)/;

/** Wording that places an obligation after employment ends. */
const POST_EMPLOYMENT =
  /(after|following|upon|post)[- ]?(the )?(termination|cessation|expiry|resignation|leaving|separation|end of (the )?employment)|post[- ]employment|(for a period of|for)[^.]{0,40}(from|after) (the )?(date of )?(termination|resignation|leaving|separation|last working day)/;

/** Wording that limits an obligation to the period of employment. */
const DURING_EMPLOYMENT =
  /(during|throughout|for the (term|period|duration) of)[^.]{0,40}(employment|engagement|service|this agreement)|while (employed|in the employment|working)/;

/** Most rules key off the category the model assigned but must still work without one. */
function appliesToCategory(rule: Rule, category: ClauseCategory | undefined): boolean {
  if (rule.appliesTo.length === 0) return true;
  if (category === undefined) return false;
  return rule.appliesTo.includes(category);
}

/** A rule whose severity never varies: fires at `level` when `matches` is true. */
const flag =
  (level: RiskLevel, matches: (normalizedText: string) => boolean) =>
  ({ normalizedText }: RuleContext): RuleVerdict | null =>
    matches(normalizedText) ? { severity: level } : null;

/** The longest notice the employee owes, falling back to an unattributed period. */
function employeeNotice(normalizedText: string): Duration | null {
  const { employee, unattributed } = extractNoticePeriods(normalizedText);
  if (employee !== null) return employee;
  return unattributed.reduce<Duration | null>(
    (longest, current) => (longest === null || current.days > longest.days ? current : longest),
    null,
  );
}

const SALARY_COMPONENTS = [
  /\bbasic\b/,
  /house rent allowance|\bhra\b/,
  /special allowance/,
  /\bctc\b|cost to company/,
  /gross (salary|pay)/,
  /provident fund|\bpf\b/,
  /gratuity/,
  /conveyance|transport allowance/,
  /medical allowance/,
  /variable pay|performance (pay|bonus)/,
];

function countSalaryComponents(normalizedText: string): number {
  return SALARY_COMPONENTS.filter((pattern) => pattern.test(normalizedText)).length;
}

export const EMPLOYMENT_RULES: readonly Rule[] = [
  {
    id: 'IN-EMP-NONCOMPETE-POST',
    appliesTo: ['NON_COMPETE'],
    evaluate: flag('HIGH', (text) => COMPETE_RESTRICTION.test(text) && POST_EMPLOYMENT.test(text)),
    title: 'Non-compete after you leave',
    message:
      'Section 27 of the Indian Contract Act, 1872 makes agreements that restrain a person from carrying on a lawful profession or trade void, with a narrow exception for the sale of goodwill. Indian courts have generally refused to enforce non-compete restrictions that apply after employment ends. Your confidentiality obligations may still apply after you leave. Whether any part of this clause could be enforced depends on its exact wording and the facts, so please confirm with a lawyer.',
    basis:
      "Indian Contract Act, 1872, s.27; Percept D'Mark (India) Pvt Ltd v. Zaheer Khan (2006) 4 SCC 227; Varun Tyagi v. Daffodil Software Pvt Ltd (Delhi HC, 2025).",
    questions: [
      'Is this restriction meant to apply after I leave, and for how long?',
      'Would the company agree to limit it to not using confidential information?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-NONCOMPETE-DURING',
    appliesTo: ['NON_COMPETE', 'MOONLIGHTING'],
    evaluate: flag('INFO', (text) => DURING_EMPLOYMENT.test(text) && !POST_EMPLOYMENT.test(text)),
    title: 'Exclusivity while you are employed',
    message:
      'Restrictions that apply only while you are employed, for example not working for a competitor at the same time, are generally treated differently from restraints that bite after you leave, and are more likely to be upheld.',
    basis: 'Niranjan Shankar Golikari v. Century Spinning & Mfg. Co. (1967) SC.',
    questions: [
      "Does this stop me from freelancing or doing side projects unrelated to the company's business?",
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-BOND',
    appliesTo: ['BOND_OR_EXIT_PENALTY'],
    evaluate: ({ normalizedText }) => {
      const isBond =
        /bond|service agreement|liquidated damages|minimum (period of )?service|minimum service|training cost|pay the company|reimburse the company|recover|forfeit/.test(
          normalizedText,
        );
      if (!isBond) return null;
      // A stated amount is what makes a bond concretely dangerous, so it raises the severity.
      const largest = extractAmounts(normalizedText).reduce(
        (max, amount) => Math.max(max, amount.rupees),
        0,
      );
      if (largest === 0) return { severity: 'MEDIUM' };
      return { severity: 'HIGH', details: { amount: formatRupees(largest) } };
    },
    title: 'Training bond or exit penalty',
    message:
      'Under Section 74 of the Indian Contract Act a court generally awards only reasonable compensation up to the stated amount, not an arbitrary penalty. The Supreme Court has upheld a minimum-service bond where the amount was a reasonable pre-estimate of the employer’s loss. Whether this bond is reasonable depends on the amount, the period, and what the company actually spends on you.',
    basis: 'Indian Contract Act, 1872, s.73-74; Vijaya Bank v. Prashant B. Narnaware (SC, 2025).',
    questions: [
      'Is the amount reduced (pro-rated) for each month I serve?',
      'What specific training costs does this amount cover?',
      'Does it apply if the company terminates me?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-NOTICE-ASYMMETRIC',
    appliesTo: ['NOTICE_PERIOD', 'TERMINATION'],
    evaluate: ({ normalizedText }) => {
      const { employee, employer } = extractNoticePeriods(normalizedText);
      if (employee === null || employer === null) return null;
      if (employee.days <= employer.days) return null;
      return { severity: 'MEDIUM', details: { yours: employee.text, theirs: employer.text } };
    },
    title: 'Unequal notice periods',
    message:
      'The notice you must give appears to be longer than the notice the company must give you. This is a contract term, so it is something you can ask to negotiate before signing.',
    basis: 'Contract terms; general fairness.',
    questions: [
      'Can the notice period be the same for both sides?',
      'Can I buy out my notice period, and how is that calculated?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-NOTICE-LONG',
    appliesTo: ['NOTICE_PERIOD'],
    evaluate: ({ normalizedText }) => {
      const notice = employeeNotice(normalizedText);
      if (notice === null || notice.days < 60) return null;
      return {
        severity: notice.days >= 90 ? 'HIGH' : 'MEDIUM',
        details: { period: notice.text },
      };
    },
    title: 'Long notice period',
    message:
      'A long notice period can make it harder to join a new employer quickly, because most companies want you to start within a month or two. Check whether you can shorten it by paying in lieu of notice or by using your leave balance.',
    basis: 'Contract terms.',
    questions: [
      'Is notice buyout allowed, and how is the amount calculated?',
      'Is the notice period shorter during probation?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-DOC-RETENTION',
    appliesTo: [],
    evaluate: flag(
      'HIGH',
      (text) =>
        /original (certificate|certificates|document|documents|mark ?sheet|mark ?sheets|degree|degrees|testimonial)/.test(
          text,
        ) &&
        /retain|deposit|submit|surrender|keep|hold|custody|safe custody/.test(text) &&
        // A clause that protects the reader is not a red flag: "shall not retain any original
        // documents", or originals that are only checked and handed back. "Shall not retain ...
        // beyond the service period" is still retention, so a time limit keeps the flag.
        !/(shall|will|may|does) not (retain|keep|hold|take)(?![^.]*\b(beyond|after|longer than|more than|until)\b)|not be (retained|kept|held)|verified and returned|returned (to you |to the employee )?(immediately|forthwith|on the same day|after verification)/.test(
          text,
        ),
    ),
    title: 'Keeping your original documents',
    message:
      'This clause appears to allow the company to hold your original educational or identity documents. Holding originals can be used to pressure an employee not to leave, and is widely regarded as an unfair practice. Ask whether attested copies are enough, and get any handover in writing.',
    basis: 'General contract fairness; please confirm your position with a lawyer.',
    questions: [
      'Will attested copies be accepted instead of originals?',
      'When exactly will my original documents be returned?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-NONSOLICIT',
    appliesTo: ['NON_SOLICIT'],
    evaluate: flag('MEDIUM', (text) =>
      /solicit|entice|induce|poach|approach[^.]{0,40}(client|customer|employee|personnel)/.test(
        text,
      ),
    ),
    title: 'Non-solicitation after you leave',
    message:
      "Restrictions on approaching the company's clients or employees after you leave are treated case by case in India. Courts have generally been more willing to protect confidential information and trade secrets than to stop someone from working. Check exactly who and what the clause covers.",
    basis: 'Indian Contract Act, 1872, s.27 and related case law.',
    questions: [
      'Does this stop former colleagues from approaching me, or only me approaching them?',
      'Does it cover clients I never worked with?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-CONFIDENTIALITY',
    appliesTo: ['CONFIDENTIALITY'],
    evaluate: flag('INFO', (text) =>
      /confidential|proprietary information|trade secret|non[- ]disclosure/.test(text),
    ),
    title: 'Confidentiality lasting after you leave',
    message:
      "Obligations to keep the company's confidential information secret generally continue after employment ends and are commonly enforced. Make sure you understand what the agreement counts as confidential, and that ordinary skill and knowledge you build up is not included.",
    basis: 'Contract law; trade-secret protection through case law.',
    questions: [
      "Is the general skill and knowledge I gain excluded from 'confidential information'?",
      'How long does the confidentiality obligation last?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-IP-BROAD',
    appliesTo: ['IP_ASSIGNMENT'],
    evaluate: flag(
      'MEDIUM',
      (text) =>
        /(intellectual property|copyright|invention|work product|deliverable)/.test(text) &&
        /(outside (of )?(working|office|business) hours|whether or not|at any time|during or after|any time during|unrelated to)/.test(
          text,
        ),
    ),
    title: 'Wide ownership of what you create',
    message:
      'This clause may give the company ownership of things you create outside work or unrelated to your job. If you have side projects or open-source work, ask for them to be listed as excluded in writing before you sign.',
    basis:
      'Copyright Act, 1957, s.17 (employer ownership of work made in the course of employment); contract terms.',
    questions: [
      'Can my existing and personal projects be listed as excluded?',
      'Does this cover work I do on my own equipment and time?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-TERMINATION-NO-NOTICE',
    appliesTo: ['TERMINATION'],
    evaluate: flag(
      'MEDIUM',
      (text) =>
        /without (any )?(prior )?(notice|reason|cause)|at (its|the company's|their) sole discretion|with immediate effect/.test(
          text,
        ) &&
        // Dismissal without notice *for misconduct* is ordinary and not worth flagging.
        !/misconduct|fraud|dishonesty|breach of|criminal|insubordination|negligence/.test(text),
    ),
    title: 'Termination without notice or reason',
    message:
      'The company appears to be able to end your employment without notice or without giving a reason. Protections under labour law depend on your role and category, so ask what notice or pay in lieu you would actually receive, and get the answer in writing.',
    basis: 'Contract terms; Industrial Relations Code, 2020 (applicability depends on the role).',
    questions: [
      'What notice or pay in lieu applies if the company terminates me without cause?',
      'Does anything change after I complete probation?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-CLAWBACK',
    appliesTo: ['COMPENSATION', 'BOND_OR_EXIT_PENALTY', 'BENEFITS'],
    evaluate: flag(
      'MEDIUM',
      (text) =>
        /joining bonus|sign[- ]?on bonus|signing bonus|relocation|retention bonus|joining incentive/.test(
          text,
        ) &&
        // "repaid" and "refunded" are at least as common as the base forms in real letters.
        /repay|repaid|refund|recover|claw ?back|return the|deduct/.test(text),
    ),
    title: 'Paying back a bonus or relocation',
    message:
      'This clause asks you to repay a joining bonus, retention bonus or relocation cost if you leave within a certain time. Check whether the amount reduces month by month, and whether it still applies if the company ends your employment rather than you resigning.',
    basis: 'Contract terms; Indian Contract Act, 1872, s.74 on reasonable compensation.',
    questions: [
      'Is the repayment pro-rated for the time I have served?',
      'Does it still apply if the company lets me go?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-UNILATERAL-CHANGE',
    appliesTo: ['GENERAL', 'COMPENSATION', 'BENEFITS', 'OTHER'],
    evaluate: flag(
      'MEDIUM',
      (text) =>
        /(may|reserves the right to|shall be entitled to) (amend|modify|change|revise|alter|withdraw)/.test(
          text,
        ) &&
        /(terms|policies|policy|compensation|salary|benefits|this agreement|conditions)/.test(
          text,
        ) &&
        /(sole discretion|without notice|without prior notice|from time to time|at its discretion)/.test(
          text,
        ),
    ),
    title: 'Company can change terms on its own',
    message:
      'This clause lets the company change terms, policies or pay without needing your agreement. Ask which parts of your offer are fixed, and whether changes to pay or role would need your written consent.',
    basis: 'Contract terms.',
    questions: [
      'Will changes to my pay or role require my written consent?',
      'Which parts of this offer are fixed for the first year?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-PROBATION-EXTEND',
    appliesTo: ['PROBATION'],
    evaluate: flag(
      'MEDIUM',
      (text) =>
        text.includes('probation') &&
        /(may be|can be|shall be|liable to be) extended|extend(ed)? at the (sole )?discretion/.test(
          text,
        ) &&
        // Any stated cap means the reader can plan around it: "no more than three further
        // months" and "extended once" are limits, just not ones that use the word "maximum".
        !/maximum|not exceed|no longer than|no more than|not more than|at most|up to a total|extended (only )?once|one further period/.test(
          text,
        ),
    ),
    title: 'Probation with no stated maximum',
    message:
      'Probation can be extended here and the clause does not state a limit, so confirmation could be delayed indefinitely. Benefits, notice period and job security often change once probation ends, so it is worth pinning down a maximum in writing.',
    basis: 'Contract terms.',
    questions: [
      'What is the maximum probation period?',
      'What is the notice period during probation?',
      'What changes once I am confirmed?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-WAGES-50',
    appliesTo: ['COMPENSATION'],
    evaluate: flag('INFO', (text) => countSalaryComponents(text) >= 2),
    title: 'How your salary is structured',
    message:
      'Under the Code on Wages, 2019, excluded allowances above 50% of total remuneration are added back into "wages". Because provident fund and gratuity are calculated on wages, the way your salary is split between basic pay and allowances affects both your in-hand pay and your long-term benefits. Ask HR for your expected monthly in-hand amount in writing.',
    basis:
      'Code on Wages, 2019, definition of "wages"; labour codes notified with effect from 21 November 2025 (PIB).',
    questions: [
      'What is my expected monthly in-hand salary after PF and tax?',
      'Which parts of the CTC are variable or conditional?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-GRATUITY-FTE',
    appliesTo: ['BENEFITS', 'GENERAL', 'OTHER'],
    evaluate: flag('INFO', (text) =>
      /fixed[- ]term|contract (period|basis)|contractual employment|for a term of \d+ (month|year)/.test(
        text,
      ),
    ),
    title: 'Gratuity for fixed-term roles',
    message:
      'Under the Code on Social Security, 2020, a fixed-term employee can become eligible for gratuity after one year of continuous service instead of the usual five. Check how this contract describes your employment type, because it changes what you are owed if the term is not renewed.',
    basis: 'Code on Social Security, 2020; confirm the current provision before relying on it.',
    questions: [
      'Am I a fixed-term or a permanent employee?',
      'What happens at the end of the term if it is not renewed?',
    ],
    lastReviewed: REVIEWED,
  },
  {
    id: 'IN-EMP-JURISDICTION',
    appliesTo: ['DISPUTE_RESOLUTION'],
    evaluate: flag('INFO', (text) =>
      /arbitration|arbitrator|jurisdiction|courts? (at|of|in)|tribunal/.test(text),
    ),
    title: 'Where disputes would be decided',
    message:
      'This clause decides where and how a dispute would be handled. Arbitration or a court in a distant city can make a dispute slow and expensive, which matters more to an employee than to a company. Note it now, and raise it with a lawyer only if a dispute ever arises.',
    basis: 'Contract terms; Arbitration and Conciliation Act, 1996.',
    questions: [
      'Who pays the arbitration costs?',
      'Which city would I have to travel to for a dispute?',
    ],
    lastReviewed: REVIEWED,
  },
];

/**
 * Document-level gaps. These fire when an offer letter is *silent* about something a reader
 * needs, which is just as important as a bad clause: "not stated" is an answer, and a question
 * to take to HR.
 */
export const MISSING_INFO_RULES: readonly MissingInfoRule[] = [
  {
    id: 'IN-EMP-MISSING-NOTICE',
    label: 'Notice period',
    question: 'What is the notice period for me and for the company?',
    // Uses the same extractor as the notice rules, so "thirty (30) days written notice" and
    // "one month's notice" count; a fixed phrase list missed every wording it did not foresee.
    isPresent: (_clauses, texts) =>
      texts.some((text) => {
        if (text.includes('notice period')) return true;
        const { employee, employer, unattributed } = extractNoticePeriods(text);
        return employee !== null || employer !== null || unattributed.length > 0;
      }),
  },
  {
    id: 'IN-EMP-MISSING-SALARY',
    label: 'Salary or CTC details',
    question: 'Can I get the full salary breakup in writing?',
    isPresent: (_clauses, texts) =>
      texts.some((text) =>
        /\bctc\b|cost to company|salary|remuneration|compensation of|per annum/.test(text),
      ),
  },
  {
    id: 'IN-EMP-MISSING-ROLE',
    label: 'Job title or duties',
    question: 'What is my exact designation and who will I report to?',
    isPresent: (_clauses, texts) =>
      texts.some((text) =>
        /designation|job title|position of|role of|reporting to|report to|duties|(appointed|employed|engaged|join|joins|joining) as (an? )?\w/.test(
          text,
        ),
      ),
  },
  {
    id: 'IN-EMP-MISSING-LOCATION',
    label: 'Work location or transfer terms',
    question: 'Where will I be based, and can I be transferred to another city?',
    isPresent: (_clauses, texts) =>
      texts.some((text) =>
        /place of (work|posting)|work location|based (at|in)|transfer|relocat/.test(text),
      ),
  },
  {
    id: 'IN-EMP-MISSING-LEAVE',
    label: 'Leave entitlement',
    question: 'How many paid leaves do I get in a year?',
    // An entitlement, not any mention of the word: "you may be required to work on holidays"
    // sits in a working-hours clause and tells the reader nothing about the leave they get.
    isPresent: (_clauses, texts) =>
      texts.some((text) =>
        // "As per the leave policy" is deliberately not enough: it points at a document the
        // reader has not been given and tells them nothing about how much leave they get.
        /(annual|casual|sick|earned|privilege|paid|maternity|paternity) leave|leave (entitlement|balance|of \d)|\d+ (days?|weeks?) of (paid )?leave|leave per (year|annum)|vacation (days|entitlement)/.test(
          text,
        ),
      ),
  },
  {
    id: 'IN-EMP-MISSING-PROBATION',
    label: 'Probation terms',
    question: 'Is there a probation period, and what changes after it?',
    isPresent: (_clauses, texts) =>
      texts.some((text) => /probation|confirmation of employment/.test(text)),
  },
];

export { appliesToCategory };
export type { Clause, RuleContext };
