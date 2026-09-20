import { clausesFromPrompt } from './index';

/**
 * Fixture preparation sheet.
 *
 * Only the model-written half is produced here. The reviewed questions from the rule library are
 * appended verbatim by the route afterwards, so what a judge sees in mock mode has the same
 * split between generated and reviewed content as the live product.
 */

interface Suggestion {
  when: RegExp;
  checklist?: string;
  forHR?: string;
  forLawyer?: string;
  document?: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    when: /liquidated damages|minimum period of|training cost/i,
    checklist: 'Work out what leaving in year one would actually cost you.',
    forHR: 'Is the bond amount reduced for each month I have already served?',
    forLawyer: 'Is the stated bond amount a reasonable pre-estimate of the training cost?',
    document: 'Any training or service agreement referred to in the offer.',
  },
  {
    when: /competes with|non[- ]?comp/i,
    checklist: 'Check whether the restriction would cover the companies you might move to.',
    forLawyer: 'How would this post-employment restriction be treated if it were tested?',
  },
  {
    when: /notice of resignation|notice period/i,
    checklist: 'Confirm the notice period in writing, including any buyout option.',
    forHR: 'Can I buy out part of my notice period, and how is the amount calculated?',
  },
  {
    when: /original (certificate|document|mark ?sheet)/i,
    checklist: 'Ask for a written receipt for any original document you hand over.',
    forHR: 'Will attested copies be accepted instead of my original certificates?',
    document: 'Copies of every certificate you are being asked to deposit.',
  },
  {
    when: /cost to company|\bctc\b/i,
    checklist: 'Get the monthly in-hand figure in writing, not just the annual CTC.',
    forHR: 'What is my expected monthly in-hand salary after PF and tax?',
    document: 'The detailed salary breakup, if it is not in the offer itself.',
  },
  {
    when: /probation/i,
    forHR: 'What is the maximum probation period, and what changes once I am confirmed?',
  },
];

export function mockPrepare(userPrompt: string): Record<string, unknown> {
  const text = clausesFromPrompt(userPrompt)
    .map((clause) => clause.text)
    .join('\n');

  const checklistBeforeSigning = ['Read every clause that mentions money or a time period.'];
  const questionsForHR: string[] = [];
  const questionsForLawyer: string[] = [];
  const documentsToBring = ['A copy of this offer letter.'];

  for (const suggestion of SUGGESTIONS) {
    if (!suggestion.when.test(text)) continue;
    if (suggestion.checklist) checklistBeforeSigning.push(suggestion.checklist);
    if (suggestion.forHR) questionsForHR.push(suggestion.forHR);
    if (suggestion.forLawyer) questionsForLawyer.push(suggestion.forLawyer);
    if (suggestion.document) documentsToBring.push(suggestion.document);
  }

  checklistBeforeSigning.push('Keep a signed copy of everything you hand back.');

  return {
    checklistBeforeSigning,
    questionsForHR,
    questionsForLawyer,
    missingInformation: [],
    documentsToBring,
  };
}
