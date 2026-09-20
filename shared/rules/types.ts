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

/** What a rule produces when it fires. */
export interface RuleVerdict {
  /** Severity may depend on the clause: a bond with a stated amount is more serious. */
  severity: RiskLevel;
  /** Values worth showing beside the card, e.g. an extracted bond amount. */
  details?: Record<string, string>;
}

export interface Rule {
  id: string;
  /**
   * Categories this rule applies to. An empty list means "any category", used by rules that
   * key off wording alone and must still fire when the model mis-classifies a clause.
   */
  appliesTo: readonly ClauseCategory[];
  /**
   * Decides whether the rule fires and, if so, how serious it is and what to show.
   *
   * One function rather than separate `test` / `severity` / `details` callbacks: those three
   * had to re-derive the same facts from the clause and then re-assert invariants the first
   * one had already proved, which meant guards no input could ever reach. Returning `null`
   * for "does not apply" keeps every branch here reachable and the work done once.
   *
   * Pure and synchronous: no network, no clock, no randomness.
   */
  evaluate: (context: RuleContext) => RuleVerdict | null;
  title: string;
  message: string;
  basis: string;
  questions: readonly string[];
  /** ISO date the message and basis were last checked against a primary source. */
  lastReviewed: string;
}

/** Document-level gap: something a fair offer letter should state and this one does not. */
export interface MissingInfoRule {
  id: string;
  label: string;
  question: string;
  /** True when the document *does* cover this, so no gap is reported. */
  isPresent: (clauses: readonly Clause[], normalizedTexts: readonly string[]) => boolean;
}
