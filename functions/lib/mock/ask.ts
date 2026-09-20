import { clausesFromPrompt, questionFromPrompt, type PromptClause } from './index';

/**
 * Fixture answers.
 *
 * Matching is by keyword against the real clause text, so an answerable question cites a clause
 * that genuinely contains the quote, and an unanswerable one honestly returns
 * `not_in_document`. The demo's two scripted questions - "can they stop me joining a
 * competitor?" and "will they pay for my parents' insurance?" - therefore take the two
 * different paths for real reasons rather than because the fixture was told to.
 */

interface Topic {
  asks: RegExp;
  inClause: RegExp;
  status: 'answered' | 'needs_professional';
  answer: string;
  suggestedQuestions: string[];
}

const TOPICS: readonly Topic[] = [
  {
    asks: /competitor|competing|non[- ]?compete|another company|rival/i,
    inClause: /competes with|non[- ]?comp/i,
    status: 'needs_professional',
    answer:
      'Your document does contain a restriction on joining a competing business after you leave, for the period stated in that clause. Whether a restriction like this can actually be enforced in India depends on its exact wording and on the facts, and courts have treated post-employment restraints very differently from restrictions that apply while you are still employed. Please ask a lawyer to look at this clause before you rely on either reading.',
    suggestedQuestions: [
      'Is this restriction intended to apply after I leave, and for how long?',
      'Would the company narrow it to protecting confidential information?',
    ],
  },
  {
    asks: /notice period|how much notice|resign|quit|leave the (job|company)/i,
    inClause: /notice of resignation|written notice|notice period/i,
    status: 'answered',
    answer:
      'Your document sets out the notice each side must give. The clause quoted below states the period that applies to you and the period that applies to the company.',
    suggestedQuestions: [
      'Can I buy out part of the notice period, and how is that calculated?',
      'Is the notice period shorter during probation?',
    ],
  },
  {
    asks: /bond|penalty|pay back|liquidated|leave early|minimum service/i,
    inClause: /liquidated damages|minimum period of|training cost/i,
    status: 'needs_professional',
    answer:
      'Your document includes a minimum service period with an amount payable if you leave before it ends. What a court would actually award in such a case depends on what the company can show it lost, so the stated figure is not automatically the amount you would owe. This is worth discussing with a lawyer before signing.',
    suggestedQuestions: [
      'Is the amount reduced for each month I have served?',
      'Does the amount still apply if the company ends my employment?',
    ],
  },
  {
    // Deliberately narrow. A looser pattern containing bare "pay" matched "will they pay for my
    // parents' insurance?", which the document says nothing about - turning the demo's refusal
    // case into a confident answer about salary. Topic matching has to be about *what* is asked,
    // not about a word that happens to appear.
    asks: /\bsalary\b|\bctc\b|cost to company|in.?hand|take.?home|compensation|salary breakup|joining bonus/i,
    inClause: /cost to company|\bctc\b|basic salary/i,
    status: 'answered',
    answer:
      'Your document states your total cost to company and how it is divided. The clause quoted below gives the breakup. Note that cost to company is not the same as what reaches your bank account each month.',
    suggestedQuestions: ['What is my expected monthly in-hand salary after PF and tax?'],
  },
  {
    asks: /probation|confirm/i,
    inClause: /probation/i,
    status: 'answered',
    answer:
      'Your document sets a probation period and describes how confirmation works. The clause quoted below has the details.',
    suggestedQuestions: ['What is the maximum probation period?'],
  },
  {
    asks: /fired|terminate|dismiss|let me go|sack/i,
    inClause: /terminate your employment|without notice|immediate effect/i,
    status: 'needs_professional',
    answer:
      'Your document describes how the company can end your employment. What protection you have beyond the contract depends on your role and category under Indian labour law, so a lawyer should confirm how it applies to you.',
    suggestedQuestions: ['What notice or pay in lieu applies if I am let go without cause?'],
  },
  {
    asks: /document|certificate|mark ?sheet|original/i,
    inClause: /original (certificate|document|mark ?sheet)/i,
    status: 'answered',
    answer:
      'Your document says the company will hold your original certificates. The clause quoted below states when they would be returned.',
    suggestedQuestions: ['Will attested copies be accepted instead of originals?'],
  },
];

function quoteFrom(text: string): string {
  const sentence = /[^.]{25,180}\./.exec(text);
  if (sentence?.[0]) return sentence[0].trim();
  return text.slice(0, 160).trim();
}

function findClause(clauses: readonly PromptClause[], pattern: RegExp): PromptClause | undefined {
  return clauses.find((clause) => pattern.test(clause.text));
}

export function mockAsk(userPrompt: string): Record<string, unknown> {
  const clauses = clausesFromPrompt(userPrompt);
  const question = questionFromPrompt(userPrompt);

  for (const topic of TOPICS) {
    if (!topic.asks.test(question)) continue;
    const clause = findClause(clauses, topic.inClause);
    if (!clause) continue;

    return {
      status: topic.status,
      answer: topic.answer,
      citations: [{ clauseId: clause.id, quote: quoteFrom(clause.text) }],
      missingInfo: [],
      suggestedQuestions: topic.suggestedQuestions,
    };
  }

  return {
    status: 'not_in_document',
    answer:
      'Your document does not say this. SignSure only answers from the document you uploaded, so rather than guessing, here is what to ask instead.',
    citations: [],
    missingInfo: ['This document does not cover the topic you asked about.'],
    suggestedQuestions: [
      'Can you confirm in writing whether this is covered by company policy?',
      'Is there a separate policy document that covers this?',
    ],
  };
}
