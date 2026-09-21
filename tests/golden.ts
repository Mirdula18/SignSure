import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CLAUSE_CATEGORIES, RISK_LEVELS, type Clause, type ClauseCategory } from '@shared/types';
import { linesFromText, segment } from '@/features/parsing/segmenter';

/**
 * The golden set: small synthetic offer letters with what a correct analysis should find.
 *
 * Used twice. `tests/golden.test.ts` checks the deterministic half - segmentation, the rule
 * library and the missing-information rules - on every run, with no API key. `scripts/eval.ts`
 * sends the same documents through the real pipeline and measures what the model adds.
 *
 * Expectations refer to clause *labels* ("5.1") rather than generated ids ("c007"), because a
 * label is what a person reading the document sees and it survives a change to segmentation.
 */

export const CONTRACTS_DIR = join(import.meta.dirname, 'fixtures', 'contracts');

const category = z.enum(CLAUSE_CATEGORIES);
const status = z.enum(['answered', 'not_in_document', 'needs_professional']);

const questionSchema = z.object({
  q: z.string().min(3),
  expect: z.union([status, z.array(status).min(1)]),
  clauseLabels: z.array(z.string()).optional(),
  forbidVerifiedQuote: z.string().optional(),
});

const expectedSchema = z.strictObject({
  description: z.string(),
  categories: z.record(z.string(), category),
  categoriesByText: z.record(z.string(), category).optional(),
  mustFindCategories: z.array(category),
  mustFlagRules: z.array(z.string()),
  mustNotFlagRules: z.array(z.string()),
  expectedDetails: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  expectedSeverity: z.record(z.string(), z.enum(RISK_LEVELS)).optional(),
  mustReportMissing: z.array(z.string()),
  mustNotReportMissing: z.array(z.string()),
  forbiddenClauseIds: z.array(z.string()).optional(),
  forbiddenVerifiedQuotes: z.array(z.string()).optional(),
  compareWith: z.string().optional(),
  expectChanged: z.array(z.string()).optional(),
  expectRemoved: z.array(z.string()).optional(),
  expectUnchangedAtLeast: z.number().int().nonnegative().optional(),
  questions: z.array(questionSchema),
});

export type GoldenExpectation = z.infer<typeof expectedSchema>;
export type GoldenQuestion = z.infer<typeof questionSchema>;

export interface GoldenContract {
  name: string;
  text: string;
  clauses: Clause[];
  expected: GoldenExpectation;
}

/** Every contract with an `.expected.json` beside it, parsed and segmented. */
export function loadGoldenSet(): GoldenContract[] {
  return readdirSync(CONTRACTS_DIR)
    .filter((file) => file.endsWith('.expected.json'))
    .sort()
    .map((file) => {
      const name = file.replace('.expected.json', '');
      const text = readFileSync(join(CONTRACTS_DIR, `${name}.txt`), 'utf8');
      const expected = expectedSchema.parse(
        JSON.parse(readFileSync(join(CONTRACTS_DIR, file), 'utf8')),
      );
      return { name, text, clauses: segment(linesFromText(text)), expected };
    });
}

/** Finds the clause carrying a label, or throws so a stale fixture fails loudly. */
export function clauseByLabel(clauses: readonly Clause[], label: string): Clause {
  const clause = clauses.find((candidate) => candidate.label === label);
  if (!clause) {
    throw new Error(
      `No clause labelled "${label}". Labels present: ${clauses.map((c) => c.label ?? '-').join(', ')}`,
    );
  }
  return clause;
}

/**
 * The categories a correct classifier would assign, keyed by clause id.
 *
 * `categories` maps labels; `categoriesByText` maps a phrase to the clause containing it, for
 * documents with no numbering at all.
 */
export function expectedCategories(contract: GoldenContract): Record<string, ClauseCategory> {
  const result: Record<string, ClauseCategory> = {};
  for (const [label, value] of Object.entries(contract.expected.categories)) {
    result[clauseByLabel(contract.clauses, label).id] = value;
  }
  for (const [phrase, value] of Object.entries(contract.expected.categoriesByText ?? {})) {
    const clause = contract.clauses.find((candidate) =>
      candidate.text.toLowerCase().includes(phrase.toLowerCase()),
    );
    if (!clause) throw new Error(`No clause contains "${phrase}" in ${contract.name}`);
    const existing = result[clause.id];
    if (existing !== undefined && existing !== value) {
      // Two phrases landed in one clause: segmentation merged terms the fixture expects apart.
      throw new Error(
        `"${phrase}" is in clause ${clause.id}, already expected to be ${existing}, in ${contract.name}`,
      );
    }
    result[clause.id] = value;
  }
  return result;
}

/** Normalises a question's `expect` to a list of acceptable statuses. */
export function acceptableStatuses(question: GoldenQuestion): readonly string[] {
  return typeof question.expect === 'string' ? [question.expect] : question.expect;
}
