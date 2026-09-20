/**
 * Core data model shared by the browser and the Pages Functions.
 *
 * The rule that shapes these types: deterministic code decides, the model explains. Anything
 * the user is shown as fact - page numbers, clause labels, rule text, verification status -
 * originates here or in `shared/rules`, never in model output.
 */

export type ClauseCategory =
  | 'NOTICE_PERIOD'
  | 'BOND_OR_EXIT_PENALTY'
  | 'NON_COMPETE'
  | 'NON_SOLICIT'
  | 'CONFIDENTIALITY'
  | 'IP_ASSIGNMENT'
  | 'COMPENSATION'
  | 'PROBATION'
  | 'TERMINATION'
  | 'WORKING_HOURS_LEAVE'
  | 'BENEFITS'
  | 'MOONLIGHTING'
  | 'DISPUTE_RESOLUTION'
  | 'DOCUMENT_RETENTION'
  | 'GENERAL'
  | 'OTHER';

export const CLAUSE_CATEGORIES: readonly ClauseCategory[] = [
  'NOTICE_PERIOD',
  'BOND_OR_EXIT_PENALTY',
  'NON_COMPETE',
  'NON_SOLICIT',
  'CONFIDENTIALITY',
  'IP_ASSIGNMENT',
  'COMPENSATION',
  'PROBATION',
  'TERMINATION',
  'WORKING_HOURS_LEAVE',
  'BENEFITS',
  'MOONLIGHTING',
  'DISPUTE_RESOLUTION',
  'DOCUMENT_RETENTION',
  'GENERAL',
  'OTHER',
] as const;

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const RISK_LEVELS: readonly RiskLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

/** Sort weight: higher is shown first. */
export const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export type ModelConfidence = 'high' | 'medium' | 'low';

export type VerificationStatus = 'verified' | 'fuzzy' | 'unverified';

export type SourceKind = 'pdf' | 'docx' | 'txt' | 'paste' | 'sample';

/** A segment of the document with a stable id. Page numbers only ever come from here. */
export interface Clause {
  /** Stable id derived from position, e.g. "c012". */
  id: string;
  /** Numbering detected in the document, e.g. "7.2" or "(b)". Null when unnumbered. */
  label: string | null;
  heading: string | null;
  /** Original text, never modified. */
  text: string;
  /** 1-based page the clause starts on. Null for DOCX and pasted text. */
  page: number | null;
  /** Last page the clause touches; equals `page` unless it spans a break. */
  pageEnd: number | null;
  /** 0-based position in the document. */
  order: number;
}

export interface ParsedDocument {
  clauses: Clause[];
  pageCount: number | null;
  /** Total characters across all clauses, used for the limit checks. */
  charCount: number;
  source: SourceKind;
  fileName: string | null;
}

/** A quote after `shared/verify.ts` has checked it against the clause it claims to come from. */
export interface VerifiedQuote {
  clauseId: string;
  quote: string;
  status: VerificationStatus;
  /** Offsets into the original `Clause.text`, for highlighting. Absent when unverified. */
  start?: number;
  end?: number;
}

export interface ClauseFinding {
  clauseId: string;
  category: ClauseCategory;
  risk: RiskLevel;
  title: string;
  explanation: string;
  whyItMatters: string;
  evidence: VerifiedQuote;
  questionsToAsk: string[];
  modelConfidence: ModelConfidence;
}

/** A hit from the deterministic India rule library. Text is reviewed and fixed, never generated. */
export interface RuleHit {
  ruleId: string;
  clauseId: string;
  severity: RiskLevel;
  title: string;
  message: string;
  basis: string;
  questions: string[];
  /** ISO date the rule text was last checked against a primary source. */
  lastReviewed: string;
  /** Values pulled out of the clause for display, e.g. a bond amount. */
  details?: Readonly<Record<string, string>>;
}

/** Document-level gap: something an offer letter should say and this one does not. */
export interface MissingInfoHit {
  ruleId: string;
  label: string;
  question: string;
}

export interface DocumentSummary {
  documentType: string | null;
  employer: string | null;
  role: string | null;
  startDate: string | null;
  noticePeriod: string | null;
  probation: string | null;
  bondOrPenalty: string | null;
  overview: string;
  sourceClauseIds: string[];
}

export interface VerificationStats {
  verified: number;
  fuzzy: number;
  unverified: number;
}

export interface AnalysisResult {
  documentSummary: DocumentSummary;
  findings: ClauseFinding[];
  ruleHits: RuleHit[];
  missingInfo: MissingInfoHit[];
  stats: VerificationStats;
}

export type AskStatus = 'answered' | 'not_in_document' | 'needs_professional';

export interface AskResult {
  status: AskStatus;
  answer: string;
  citations: VerifiedQuote[];
  missingInfo: string[];
  suggestedQuestions: string[];
}

export interface QaTurn {
  question: string;
  answer: string;
}

export type ChangeType = 'ADDED' | 'REMOVED' | 'CHANGED';

export type ChangeImpact = 'BETTER_FOR_EMPLOYEE' | 'WORSE_FOR_EMPLOYEE' | 'NEUTRAL' | 'UNCLEAR';

export interface ClauseChange {
  pairId: string;
  changeType: ChangeType;
  impact: ChangeImpact;
  summary: string;
  category: ClauseCategory;
  quoteA: VerifiedQuote | null;
  quoteB: VerifiedQuote | null;
}

export interface CompareResult {
  changes: ClauseChange[];
  unchangedCount: number;
}

export interface PrepareResult {
  checklistBeforeSigning: string[];
  questionsForHR: string[];
  questionsForLawyer: string[];
  missingInformation: string[];
  documentsToBring: string[];
}

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'MODEL_BLOCKED'
  | 'MODEL_INVALID_OUTPUT'
  | 'UPSTREAM_TIMEOUT'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
  };
}
