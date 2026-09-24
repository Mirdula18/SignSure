/**
 * Single source of truth for every size limit.
 *
 * The browser enforces these to fail fast and explain the problem to the user; the server
 * enforces the same numbers again because the browser is not trusted (docs/SECURITY.md 3.4).
 */
export const LIMITS = {
  /** Upload guard. Larger files are rejected before any parsing starts. */
  maxFileBytes: 10 * 1024 * 1024,
  /** PDF page guard, so a 900-page contract cannot hang the browser. */
  maxPages: 40,
  /** Per-clause guard. Anything longer is split by the segmenter. */
  maxClauseChars: 4_000,
  /** Total clause text sent in one request. */
  maxTotalChars: 120_000,
  /** Clause count guard; also caps prompt size. */
  maxClauses: 400,
  /** A question longer than this is almost certainly an injection attempt, not a question. */
  maxQuestionChars: 500,
  /** How many previous turns are replayed to the model for context. */
  maxHistoryTurns: 4,
  /** Request body cap enforced in `functions/_middleware.ts`. */
  maxRequestBytes: 256 * 1024,
  /** Below this a quote is too generic to prove anything, so it is never "verified". */
  minQuoteChars: 12,
  /** Quotes longer than this are truncated by the model instruction, not by us. */
  maxQuoteChars: 400,
  /** Clauses per Gemini call; larger documents are split into parallel batches. */
  clauseBatchSize: 80,
  /** Workers' subrequest budget means we never fan out wider than this. */
  maxParallelBatches: 4,
  /**
   * Model calls one visit may make, counted in the browser. A careful read of one letter is an
   * analysis, a dozen questions, a comparison and a checklist - about fifteen - and cached
   * answers are free. The cap is for the other case: a loop or a stuck button that would
   * otherwise keep spending quota until the server's hourly limit stopped it.
   */
  aiCallsPerVisit: 30,
  /** A PDF with fewer characters per page than this is treated as scanned images. */
  minCharsPerPageForText: 100,
} as const;

export type Limits = typeof LIMITS;
