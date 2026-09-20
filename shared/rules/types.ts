import type { Clause, ClauseCategory, RiskLevel } from '../types';

/**
 * Shape of a rule in the India employment library.
 *
 * Rule text is *written and reviewed by a human*, never generated. That is the whole point of
 * the library: an explanation of Section 27 of the Indian Contract Act has to say the same
 * cautious thing every time, and has to be checkable against a primary source. The model
 * chooses a category and writes a plain-language summary; the legal context comes from here.
 *
 * See docs/LEGAL_RULES.md, which is the source of truth for every message below.
 */
export interface RuleContext {
  clause: Clause;
  /** Category the model assigned to this clause, if it produced a finding for it. */
  category: ClauseCategory | undefined;
  /** Normalised, lower-cased clause text. Precomputed once because every rule tests it. */
  normalizedText: string;
  /** Every clause in the document, for rules that need to compare two clauses. */
  allClauses: readonly Clause[];
}

export interface Rule {
  id: string;
  /**
   * Categories this rule applies to. An empty list means "any category", used by rules that
   * key off wording alone and must still fire when the model mis-classifies a clause.
   */
  appliesTo: readonly ClauseCategory[];
  /** Whether the rule fires for this clause. Pure and synchronous: no network, no clock. */
  test: (context: RuleContext) => boolean;
  /** Severity may depend on the clause, e.g. a bond with a stated amount is more serious. */
  severity: (context: RuleContext) => RiskLevel;
  title: string;
  message: string;
  basis: string;
  questions: readonly string[];
  /** ISO date the message and basis were last checked against a primary source. */
  lastReviewed: string;
  /** Optional extraction of values worth showing, e.g. a bond amount. */
  details?: (context: RuleContext) => Record<string, string> | undefined;
}

/** Document-level gap: something a fair offer letter should state and this one does not. */
export interface MissingInfoRule {
  id: string;
  label: string;
  question: string;
  /** True when the document *does* cover this, so no gap is reported. */
  isPresent: (clauses: readonly Clause[], normalizedTexts: readonly string[]) => boolean;
}
