import { CLAUSE_CATEGORIES, RISK_LEVELS } from '../../shared/types';

/**
 * Response schemas sent to Gemini alongside `responseMimeType: 'application/json'`.
 *
 * These *steer* the model; `shared/schemas.ts` *checks* what comes back. Both exist on purpose:
 * constrained decoding makes valid output overwhelmingly likely, and Zod makes invalid output
 * impossible to act on. The enums are built from the same constants the Zod schemas use, so the
 * two can never describe different sets of categories.
 */

const STRING = { type: 'STRING' } as const;
const NULLABLE_STRING = { type: 'STRING', nullable: true } as const;

function stringArray(description: string): Record<string, unknown> {
  return { type: 'ARRAY', items: STRING, description };
}

export const ANALYZE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    documentSummary: {
      type: 'OBJECT',
      properties: {
        documentType: NULLABLE_STRING,
        employer: NULLABLE_STRING,
        role: NULLABLE_STRING,
        startDate: NULLABLE_STRING,
        noticePeriod: NULLABLE_STRING,
        probation: NULLABLE_STRING,
        bondOrPenalty: NULLABLE_STRING,
        overview: {
          type: 'STRING',
          description: 'Two or three plain sentences describing what this document is.',
        },
        sourceClauseIds: stringArray('Clause ids the summary was drawn from.'),
      },
      required: ['overview', 'sourceClauseIds'],
    },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          clauseId: { type: 'STRING', description: 'Exactly as given in the document marker.' },
          category: { type: 'STRING', enum: [...CLAUSE_CATEGORIES] },
          risk: { type: 'STRING', enum: [...RISK_LEVELS] },
          title: { type: 'STRING', description: 'At most eight plain words.' },
          explanation: STRING,
          whyItMatters: STRING,
          quote: {
            type: 'STRING',
            description: 'Copied character-for-character from this clause, 12 to 200 characters.',
          },
          questionsToAsk: stringArray('Zero to three specific questions for HR or a lawyer.'),
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        required: [
          'clauseId',
          'category',
          'risk',
          'title',
          'explanation',
          'whyItMatters',
          'quote',
          'questionsToAsk',
          'confidence',
        ],
      },
    },
  },
  required: ['documentSummary', 'findings'],
};

export const ASK_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['answered', 'not_in_document', 'needs_professional'] },
    answer: STRING,
    citations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          clauseId: STRING,
          quote: {
            type: 'STRING',
            description: 'Copied character-for-character from that clause.',
          },
        },
        required: ['clauseId', 'quote'],
      },
    },
    missingInfo: stringArray('What the document does not say that would be needed to answer.'),
    suggestedQuestions: stringArray('One to three questions to put to HR or a lawyer.'),
  },
  required: ['status', 'answer', 'citations', 'missingInfo', 'suggestedQuestions'],
};

export const COMPARE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    changes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pairId: STRING,
          changeType: { type: 'STRING', enum: ['ADDED', 'REMOVED', 'CHANGED'] },
          impact: {
            type: 'STRING',
            enum: ['BETTER_FOR_EMPLOYEE', 'WORSE_FOR_EMPLOYEE', 'NEUTRAL', 'UNCLEAR'],
          },
          summary: STRING,
          quoteA: NULLABLE_STRING,
          quoteB: NULLABLE_STRING,
        },
        required: ['pairId', 'changeType', 'impact', 'summary'],
      },
    },
  },
  required: ['changes'],
};

export const PREPARE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    checklistBeforeSigning: stringArray('Things to do or confirm before signing.'),
    questionsForHR: stringArray('Questions HR can answer.'),
    questionsForLawyer: stringArray('Questions that need a qualified lawyer.'),
    missingInformation: stringArray('Information the document does not provide.'),
    documentsToBring: stringArray('Documents to take to the conversation.'),
  },
  required: [
    'checklistBeforeSigning',
    'questionsForHR',
    'questionsForLawyer',
    'missingInformation',
    'documentsToBring',
  ],
};
