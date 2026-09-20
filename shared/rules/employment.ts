import type { Clause, ClauseCategory, RiskLevel } from '../types';
import { extractAmounts, extractNoticePeriods, formatRupees } from './extract';
import type { MissingInfoRule, Rule, RuleContext } from './types';

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

/** Matches a restriction on competing, whatever verb the drafter used. */
const COMPETE_RESTRICTION =
  /(shall not|will not|must not|agrees not to|refrain from|prohibited from|restrained from)[^.]{0,120}(compet|similar business|rival|engage in any business)/;

/** Wording that places an obligation after employment ends. */
const POST_EMPLOYMENT =
  /(after|following|upon|post)[- ]?(the )?(termination|cessation|expiry|resignation|leaving|separation|end of (the )?employment)|post[- ]employment|(for a period of|for)[^.]{0,40}(from|after) (the )?(date of )?(termination|resignation|leaving|separation|last working day)/;

/** Wording that limits an obligation to the period of employment. */
const DURING_EMPLOYMENT =
  /(during|throughout|for the (term|period|duration) of)[^.]{0,40}(employment|engagement|service|this agreement)|while (employed|in the employment|working)/;

function has(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

/** Most rules key off the category the model assigned but must still work without one. */
function appliesToCategory(rule: Rule, category: ClauseCategory | undefined): boolean {
  if (rule.appliesTo.length === 0) return true;
  if (category === undefined) return false;
  return rule.appliesTo.includes(category);
}

const constant = (level: RiskLevel) => (): RiskLevel => level;

export const EMPLOYMENT_RULES: readonly Rule[] = [
  {
    id: 'IN-EMP-NONCOMPETE-POST',
    appliesTo: ['NON_COMPETE'],
    test: ({ normalizedText }) =>
      has(COMPETE_RESTRICTION, normalizedText) && has(POST_EMPLOYMENT, normalizedText),
    severity: constant('HIGH'),
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
    test: ({ normalizedText }) =>
      has(DURING_EMPLOYMENT, normalizedText) && !has(POST_EMPLOYMENT, normalizedText),
    severity: constant('INFO'),
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
    test: ({ normalizedText }) =>
      /bond|service agreement|liquidated damages|minimum (period of )?service|minimum service|training cost|pay the company|reimburse the company|recover|forfeit/.test(
        normalizedText,
      ),
    severity: ({ normalizedText }) =>
      extractAmounts(normalizedText).length > 0 ? 'HIGH' : 'MEDIUM',
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
    details: ({ normalizedText }) => {
      const amounts = extractAmounts(normalizedText);
      const largest = amounts.reduce<number>((max, a) => Math.max(max, a.rupees), 0);
      return largest > 0 ? { amount: formatRupees(largest) } : undefined;
    },
  },
  {
    id: 'IN-EMP-NOTICE-ASYMMETRIC',
    appliesTo: ['NOTICE_PERIOD', 'TERMINATION'],
    test: ({ normalizedText }) => {
      const { employee, employer } = extractNoticePeriods(normalizedText);
      return employee !== null && employer !== null && employee.days > employer.days;
    },
    severity: constant('MEDIUM'),
    title: 'Unequal notice periods',
    message:
      'The notice you must give appears to be longer than the notice the company must give you. This is a contract term, so it is something you can ask to negotiate before signing.',
    basis: 'Contract terms; general fairness.',
    questions: [
      'Can the notice period be the same for both sides?',
      'Can I buy out my notice period, and how is that calculated?',
    ],
    lastReviewed: REVIEWED,
    details: ({ normalizedText }) => {
      const { employee, employer } = extractNoticePeriods(normalizedText);
      if (!employee || !employer) return undefined;
      return { yours: employee.text, theirs: employer.text };
    },
  },
  {
    id: 'IN-EMP-NOTICE-LONG',
    appliesTo: ['NOTICE_PERIOD'],
    test: ({ normalizedText }) => longestEmployeeNoticeDays(normalizedText) >= 60,
    severity: ({ normalizedText }) =>
      longestEmployeeNoticeDays(normalizedText) >= 90 ? 'HIGH' : 'MEDIUM',
    title: 'Long notice period',
    message:
      'A long notice period can make it harder to join a new employer quickly, because most companies want you to start within a month or two. Check whether you can shorten it by paying in lieu of notice or by using your leave balance.',
    basis: 'Contract terms.',
    questions: [
      'Is notice buyout allowed, and how is the amount calculated?',
      'Is the notice period shorter during probation?',
    ],
    lastReviewed: REVIEWED,
    details: ({ normalizedText }) => {
      const { employee, unattributed } = extractNoticePeriods(normalizedText);
      const longest =
        employee ??
        unattributed.reduce<(typeof unattributed)[number] | null>(
          (best, current) => (best === null || current.days > best.days ? current : best),
          null,
        );
      return longest ? { period: longest.text } : undefined;
    },
  },
  {
    id: 'IN-EMP-DOC-RETENTION',
    appliesTo: [],
    test: ({ normalizedText }) =>
      /original (certificate|certificates|document|documents|mark ?sheet|mark ?sheets|degree|degrees|testimonial)/.test(
        normalizedText,
      ) && /retain|deposit|submit|surrender|keep|hold|custody|safe custody/.test(normalizedText),
    severity: constant('HIGH'),
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
    test: ({ normalizedText }) =>
      /solicit|entice|induce|poach|approach[^.]{0,40}(client|customer|employee|personnel)/.test(
        normalizedText,
      ),
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) =>
      /confidential|proprietary information|trade secret|non[- ]disclosure/.test(normalizedText),
    severity: constant('INFO'),
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
    test: ({ normalizedText }) =>
      /(intellectual property|copyright|invention|work product|deliverable)/.test(normalizedText) &&
      /(outside (of )?(working|office|business) hours|whether or not|at any time|during or after|any time during|unrelated to)/.test(
        normalizedText,
      ),
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) => {
      const trigger =
        /without (any )?(prior )?(notice|reason|cause)|at (its|the company's|their) sole discretion|with immediate effect/;
      if (!trigger.test(normalizedText)) return false;
      // Termination without notice *for misconduct* is ordinary and not worth flagging.
      return !/misconduct|fraud|dishonesty|breach of|criminal|insubordination|negligence/.test(
        normalizedText,
      );
    },
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) =>
      /joining bonus|sign[- ]?on bonus|signing bonus|relocation|retention bonus|joining incentive/.test(
        normalizedText,
      ) && /repay|refund|recover|claw ?back|return the|deduct/.test(normalizedText),
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) =>
      /(may|reserves the right to|shall be entitled to) (amend|modify|change|revise|alter|withdraw)/.test(
        normalizedText,
      ) &&
      /(terms|policies|policy|compensation|salary|benefits|this agreement|conditions)/.test(
        normalizedText,
      ) &&
      /(sole discretion|without notice|without prior notice|from time to time|at its discretion)/.test(
        normalizedText,
      ),
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) =>
      normalizedText.includes('probation') &&
      /(may be|can be|shall be|liable to be) extended|extend(ed)? at the (sole )?discretion/.test(
        normalizedText,
      ) &&
      !/maximum|not exceed|no longer than|up to a total/.test(normalizedText),
    severity: constant('MEDIUM'),
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
    test: ({ normalizedText }) => countSalaryComponents(normalizedText) >= 2,
    severity: constant('INFO'),
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
    test: ({ normalizedText }) =>
      /fixed[- ]term|contract (period|basis)|contractual employment|for a term of \d+ (month|year)/.test(
        normalizedText,
      ),
    severity: constant('INFO'),
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
    test: ({ normalizedText }) =>
      /arbitration|arbitrator|jurisdiction|courts? (at|of|in)|tribunal/.test(normalizedText),
    severity: constant('INFO'),
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

/** Notice the employee must give, falling back to an unattributed period when only one appears. */
function longestEmployeeNoticeDays(normalizedText: string): number {
  const { employee, unattributed } = extractNoticePeriods(normalizedText);
  if (employee !== null) return employee.days;
  return unattributed.reduce((max, duration) => Math.max(max, duration.days), 0);
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
    isPresent: (_clauses, texts) =>
      texts.some((text) => /notice period|notice of \d|days notice|months notice/.test(text)),
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
        /designation|job title|position of|role of|reporting to|duties/.test(text),
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
    isPresent: (_clauses, texts) =>
      texts.some((text) => /leave|holiday|vacation|time off/.test(text)),
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
