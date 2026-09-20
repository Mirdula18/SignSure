import type { ClauseCategory, ClauseFinding, RiskLevel } from './types';
import { RISK_ORDER } from './types';

/**
 * Concern lenses: what the reader is actually worried about.
 *
 * A blanket summary buries the clause that matters to *this* person. Lenses re-rank the report
 * so that someone asking "what if I leave in a year?" sees the bond and the notice period first,
 * and they also steer which categories the model is asked to prioritise.
 *
 * Lenses change ordering and emphasis only. They never hide a HIGH-risk finding: risk always
 * outranks relevance in `rankFindings`, so a serious clause outside your chosen concerns still
 * surfaces above a low-risk clause inside them.
 */
export const LENSES = [
  'QUIT_EARLY',
  'FUTURE_JOBS',
  'SALARY',
  'GETTING_FIRED',
  'EVERYTHING',
] as const;

export type Lens = (typeof LENSES)[number];

export interface LensDefinition {
  id: Lens;
  /** Categories this concern is really about. */
  primary: readonly ClauseCategory[];
  /** Categories worth raising slightly, but not the point of the concern. */
  secondary: readonly ClauseCategory[];
  /**
   * i18n keys for the questions offered in the Ask panel. Keys rather than text, because
   * `shared/` is language-agnostic and the strings live in `src/i18n`.
   */
  questionKeys: readonly string[];
}

export const LENS_DEFINITIONS: Readonly<Record<Lens, LensDefinition>> = {
  QUIT_EARLY: {
    id: 'QUIT_EARLY',
    primary: ['NOTICE_PERIOD', 'BOND_OR_EXIT_PENALTY'],
    secondary: ['TERMINATION', 'DOCUMENT_RETENTION', 'COMPENSATION'],
    questionKeys: ['ask.q.noticePeriod', 'ask.q.bondCost', 'ask.q.noticeBuyout'],
  },
  FUTURE_JOBS: {
    id: 'FUTURE_JOBS',
    primary: ['NON_COMPETE', 'NON_SOLICIT', 'CONFIDENTIALITY'],
    secondary: ['IP_ASSIGNMENT', 'MOONLIGHTING'],
    questionKeys: ['ask.q.joinCompetitor', 'ask.q.sideProjects', 'ask.q.confidentialAfter'],
  },
  SALARY: {
    id: 'SALARY',
    primary: ['COMPENSATION', 'BENEFITS'],
    secondary: ['WORKING_HOURS_LEAVE', 'BOND_OR_EXIT_PENALTY'],
    questionKeys: ['ask.q.inHandSalary', 'ask.q.variablePay', 'ask.q.deductions'],
  },
  GETTING_FIRED: {
    id: 'GETTING_FIRED',
    primary: ['TERMINATION', 'PROBATION'],
    secondary: ['NOTICE_PERIOD', 'DISPUTE_RESOLUTION'],
    questionKeys: ['ask.q.terminationNotice', 'ask.q.probationRules', 'ask.q.disputeForum'],
  },
  EVERYTHING: {
    id: 'EVERYTHING',
    primary: [],
    secondary: [],
    questionKeys: ['ask.q.biggestRisk', 'ask.q.missingInfo', 'ask.q.negotiate'],
  },
};

const PRIMARY_WEIGHT = 2;
const SECONDARY_WEIGHT = 1;

/** Treats an empty selection the same as "show me everything" rather than ranking by nothing. */
function effectiveLenses(lenses: readonly Lens[]): readonly Lens[] {
  return lenses.length === 0 ? ['EVERYTHING'] : lenses;
}

/**
 * How relevant a category is to the chosen concerns. Higher is more relevant.
 *
 * "Show me everything" gives every category the same non-zero weight, so ordering falls back to
 * risk alone instead of silently preferring whatever happens to be listed first.
 */
export function categoryWeight(lenses: readonly Lens[], category: ClauseCategory): number {
  let weight = 0;
  for (const lens of effectiveLenses(lenses)) {
    const definition = LENS_DEFINITIONS[lens];
    if (lens === 'EVERYTHING') {
      weight = Math.max(weight, SECONDARY_WEIGHT);
      continue;
    }
    if (definition.primary.includes(category)) weight = Math.max(weight, PRIMARY_WEIGHT);
    else if (definition.secondary.includes(category)) weight = Math.max(weight, SECONDARY_WEIGHT);
  }
  return weight;
}

/** Sort key: risk dominates relevance, and relevance breaks ties within a risk level. */
export function findingScore(
  lenses: readonly Lens[],
  risk: RiskLevel,
  category: ClauseCategory,
): number {
  return RISK_ORDER[risk] * 10 + categoryWeight(lenses, category);
}

/**
 * Orders findings for display: highest risk first, then most relevant to the chosen concerns,
 * then document order so the result is stable between renders.
 */
export function rankFindings<T extends Pick<ClauseFinding, 'risk' | 'category' | 'clauseId'>>(
  findings: readonly T[],
  lenses: readonly Lens[],
): T[] {
  return [...findings].sort((a, b) => {
    const delta =
      findingScore(lenses, b.risk, b.category) - findingScore(lenses, a.risk, a.category);
    if (delta !== 0) return delta;
    return a.clauseId.localeCompare(b.clauseId);
  });
}

/** The categories to tell the model to prioritise, de-duplicated and in a stable order. */
export function prioritisedCategories(lenses: readonly Lens[]): ClauseCategory[] {
  const selected = effectiveLenses(lenses);
  if (selected.includes('EVERYTHING')) return [];
  const seen = new Set<ClauseCategory>();
  for (const lens of selected) {
    for (const category of LENS_DEFINITIONS[lens].primary) seen.add(category);
  }
  for (const lens of selected) {
    for (const category of LENS_DEFINITIONS[lens].secondary) seen.add(category);
  }
  return [...seen];
}

/** i18n keys for the questions to offer, de-duplicated across the chosen lenses. */
export function suggestedQuestionKeys(lenses: readonly Lens[]): string[] {
  const keys = new Set<string>();
  for (const lens of effectiveLenses(lenses)) {
    for (const key of LENS_DEFINITIONS[lens].questionKeys) keys.add(key);
  }
  return [...keys];
}
