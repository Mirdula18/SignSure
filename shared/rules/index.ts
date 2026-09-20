import { normalize } from '../normalize';
import type { Clause, ClauseCategory, MissingInfoHit, RuleHit } from '../types';
import { RISK_ORDER } from '../types';
import { appliesToCategory, EMPLOYMENT_RULES, MISSING_INFO_RULES } from './employment';
import type { Rule, RuleContext } from './types';

export { EMPLOYMENT_RULES, MISSING_INFO_RULES } from './employment';
export type { MissingInfoRule, Rule, RuleContext } from './types';
export { extractAmounts, extractDurations, extractNoticePeriods, formatRupees } from './extract';
export type { Amount, Duration, NoticePeriods } from './extract';

/** Category the model assigned to each clause, keyed by clause id. */
export type CategoryByClauseId = Readonly<Record<string, ClauseCategory | undefined>>;

/**
 * Runs the whole rule library over a document.
 *
 * This is the deterministic half of SignSure: given the same document it produces the same
 * legal context every time, with text a human wrote and a date it was last checked. The model's
 * category is used as a hint, but rules whose `appliesTo` is empty run on wording alone so a
 * mis-classified clause still gets flagged.
 */
export function runRules(
  clauses: readonly Clause[],
  categories: CategoryByClauseId = {},
): RuleHit[] {
  const hits: RuleHit[] = [];

  for (const clause of clauses) {
    const context: RuleContext = {
      clause,
      category: categories[clause.id],
      normalizedText: normalize(clause.text),
      allClauses: clauses,
    };

    for (const rule of EMPLOYMENT_RULES) {
      if (!appliesToCategory(rule, context.category)) continue;
      if (!rule.test(context)) continue;
      hits.push(toHit(rule, context));
    }
  }

  return sortHits(hits);
}

function toHit(rule: Rule, context: RuleContext): RuleHit {
  const details = rule.details?.(context);
  return {
    ruleId: rule.id,
    clauseId: context.clause.id,
    severity: rule.severity(context),
    title: rule.title,
    message: rule.message,
    basis: rule.basis,
    questions: [...rule.questions],
    lastReviewed: rule.lastReviewed,
    ...(details ? { details } : {}),
  };
}

/** Most serious first, then document order, so the list is stable between runs. */
function sortHits(hits: readonly RuleHit[]): RuleHit[] {
  return [...hits].sort((a, b) => {
    const bySeverity = RISK_ORDER[b.severity] - RISK_ORDER[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byClause = a.clauseId.localeCompare(b.clauseId);
    if (byClause !== 0) return byClause;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

/**
 * Finds what the document never says.
 *
 * A silent offer letter is a real risk for a first-time employee, so these gaps are surfaced as
 * questions to ask rather than left for the reader to notice.
 */
export function findMissingInfo(clauses: readonly Clause[]): MissingInfoHit[] {
  const texts = clauses.map((clause) => normalize(clause.text));
  return MISSING_INFO_RULES.filter((rule) => !rule.isPresent(clauses, texts)).map((rule) => ({
    ruleId: rule.id,
    label: rule.label,
    question: rule.question,
  }));
}

/** Every reviewed question the rule library produced, de-duplicated, for the prep sheet. */
export function ruleQuestions(hits: readonly RuleHit[]): string[] {
  const questions = new Set<string>();
  for (const hit of hits) {
    for (const question of hit.questions) questions.add(question);
  }
  return [...questions];
}
