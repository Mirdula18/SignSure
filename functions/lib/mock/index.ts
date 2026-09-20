import type { MockResponder } from '../gemini';
import { mockAnalyze } from './analyze';
import { mockAsk } from './ask';
import { mockCompare } from './compare';
import { mockPrepare } from './prepare';

/**
 * Fixture responses for `MOCK_GEMINI=true`.
 *
 * These are not stubs that return `{}`. They are generated from the clause text in the prompt,
 * quoting the document verbatim, so that everything downstream does real work: quotes go
 * through `shared/verify.ts` and genuinely verify, an unknown clause id is genuinely dropped,
 * and the "answered with no verified citation" downgrade genuinely fires. That is what makes
 * the end-to-end suite meaningful without an API key.
 *
 * One fixture deliberately misquotes, so the unverified path is exercised too.
 */

/** Clause markers the prompt builder emits: `[[c001 | 1.1 | p2]] text`. */
const CLAUSE_MARKER =
  /\[\[(c\d{3,5})(?:\s*\|[^\]]*)?\]\]\s*([\s\S]*?)(?=\n\n\[\[c\d{3,5}|\n<\/document>|$)/g;

export interface PromptClause {
  id: string;
  text: string;
}

/** Recovers the clauses from the serialised prompt, so fixtures can quote the real document. */
export function clausesFromPrompt(userPrompt: string): PromptClause[] {
  const clauses: PromptClause[] = [];
  for (const match of userPrompt.matchAll(CLAUSE_MARKER)) {
    const id = match[1];
    const text = match[2];
    if (id === undefined || text === undefined) continue;
    clauses.push({ id, text: text.trim() });
  }
  return clauses;
}

/** Pulls the question out of its fence, for the ask fixture. */
export function questionFromPrompt(userPrompt: string): string {
  const match = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(userPrompt);
  return match?.[1]?.trim() ?? '';
}

/**
 * Routes to the right fixture by looking at the task line in the system prompt.
 *
 * Matching on the system prompt rather than taking a parameter keeps `createGeminiClient`'s
 * signature identical in both modes, so no route has a branch for mock versus live.
 */
export const mockResponder: MockResponder = ({ systemInstruction, userPrompt }) => {
  if (systemInstruction.includes('produce a finding')) return mockAnalyze(userPrompt);
  if (systemInstruction.includes("Answer the user's question")) return mockAsk(userPrompt);
  if (systemInstruction.includes('pairs of clauses')) return mockCompare(userPrompt);
  return mockPrepare(userPrompt);
};

export { mockAnalyze, mockAsk, mockCompare, mockPrepare };
