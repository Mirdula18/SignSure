import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mockAnalyze } from './analyze';
import { analyzeUserPrompt } from '../prompts';
import { verifyQuote } from '../../../shared/verify';
// The sample and the segmenter are pure TypeScript, so the Workers build can check them too.
import { linesFromText, segment } from '../../../src/features/parsing/segmenter';
import { SAMPLE_OFFER_LETTER } from '../../../src/sample/offerLetter';

/**
 * Mock mode is what a judge sees if the live key is unavailable, and what the README
 * screenshots show, so its output has to be true to the sample letter: every quote must be in
 * the clause it cites, and every summary figure must be the one the letter actually states.
 */

const CLAUSES = segment(linesFromText(SAMPLE_OFFER_LETTER));
const TEXT_BY_ID = new Map(CLAUSES.map((clause) => [clause.id, clause.text]));

const output = z
  .object({
    documentSummary: z.object({
      role: z.string().nullable(),
      bondOrPenalty: z.string().nullable(),
    }),
    findings: z.array(z.object({ clauseId: z.string(), title: z.string(), quote: z.string() })),
  })
  .parse(mockAnalyze(analyzeUserPrompt(CLAUSES)));

/** The one finding mock mode plants on purpose (see DECISIONS D19). */
const isPlanted = (title: string): boolean => title.startsWith('Demo:');
const genuine = output.findings.filter((finding) => !isPlanted(finding.title));

describe('the mock model on the sample letter', () => {
  it('produces findings to show', () => {
    expect(genuine.length).toBeGreaterThan(5);
  });

  it('quotes only text that is in the clause each finding cites', () => {
    for (const finding of genuine) {
      const text = TEXT_BY_ID.get(finding.clauseId) ?? '';
      expect(verifyQuote(text, finding.quote).status, finding.quote).toBe('verified');
    }
  });

  it('starts each quote at the start of a sentence, not on the digit after "5."', () => {
    for (const finding of genuine) {
      expect(finding.quote, finding.quote).toMatch(/^[A-Z(]/);
    }
  });

  it('keeps one planted quote that cannot verify, so the unverified path stays visible', () => {
    const planted = output.findings.filter((finding) => isPlanted(finding.title));
    expect(planted).toHaveLength(1);
    const [demo] = planted;
    expect(verifyQuote(TEXT_BY_ID.get(demo?.clauseId ?? '') ?? '', demo?.quote ?? '').status).toBe(
      'unverified',
    );
  });

  it('reports the bond amount from the bond clause, not the first amount in the letter', () => {
    const bondClause = CLAUSES.find((clause) => /liquidated damages/i.test(clause.text));
    expect(bondClause?.text).toContain('Rs. 2,00,000');
    expect(output.documentSummary.bondOrPenalty).toBe('Rs. 2,00,000');
  });

  it('reports the role without the employer name run on after it', () => {
    expect(output.documentSummary.role).toBe('Associate Software Engineer');
  });
});
