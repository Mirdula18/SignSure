import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalysisResult,
  AskResult,
  Clause,
  CompareResult,
  PrepareResult,
} from '@shared/types';
import {
  analyzeResponseSchema,
  askResponseSchema,
  compareResponseSchema,
  prepareResponseSchema,
  sessionResponseSchema,
} from '@shared/schemas';
import {
  ApiError,
  analyzeDocument,
  askQuestion,
  compareDocuments,
  createSession,
  preparePack,
  type RequestOptions,
} from './client';

const TOKEN = 'session-token-123';

const CLAUSES: Clause[] = [
  {
    id: 'c001',
    label: '6.1',
    heading: 'Notice period',
    text: 'The Employee shall give ninety (90) days written notice of resignation.',
    page: 2,
    pageEnd: 2,
    order: 0,
  },
];

const PREFS = { language: 'en', readingLevel: 'standard' } as const;

const SESSION = { token: TOKEN, expiresAt: 1_900_000_000_000 };

const ANALYSIS: AnalysisResult = {
  documentSummary: {
    documentType: 'Offer letter',
    employer: 'Example Technologies Private Limited',
    role: null,
    startDate: null,
    noticePeriod: 'ninety (90) days',
    probation: null,
    bondOrPenalty: null,
    overview: 'An offer of employment.',
    sourceClauseIds: ['c001'],
  },
  findings: [
    {
      clauseId: 'c001',
      category: 'NOTICE_PERIOD',
      risk: 'HIGH',
      title: 'Long notice period',
      explanation: 'You must give ninety days notice.',
      whyItMatters: 'It can delay a new job.',
      evidence: {
        clauseId: 'c001',
        quote: 'ninety (90) days written notice',
        status: 'verified',
        start: 24,
        end: 55,
      },
      questionsToAsk: ['Can I buy out my notice period?'],
      modelConfidence: 'high',
    },
  ],
  ruleHits: [
    {
      ruleId: 'IN-EMP-NOTICE-LONG',
      clauseId: 'c001',
      severity: 'MEDIUM',
      title: 'Long notice period',
      message: 'A long notice period can slow a move.',
      basis: 'Contract terms.',
      questions: ['Is buyout allowed?'],
      lastReviewed: '2026-09-01',
    },
  ],
  missingInfo: [{ ruleId: 'IN-EMP-MISSING-LEAVE', label: 'Leave', question: 'How much leave?' }],
  stats: { verified: 1, fuzzy: 0, unverified: 0 },
  partial: false,
};

const ASK: AskResult = {
  status: 'answered',
  answer: 'Ninety days.',
  citations: [
    { clauseId: 'c001', quote: 'ninety (90) days', status: 'verified', start: 24, end: 40 },
  ],
  missingInfo: [],
  suggestedQuestions: ['Can I buy it out?'],
};

const COMPARE: CompareResult = {
  changes: [
    {
      pairId: 'p1',
      changeType: 'ADDED',
      impact: 'WORSE_FOR_EMPLOYEE',
      summary: 'A training bond was added.',
      category: 'BOND_OR_EXIT_PENALTY',
      quoteA: null,
      quoteB: { clauseId: 'c002', quote: 'a bond of two lakh rupees', status: 'fuzzy' },
    },
  ],
  unchangedCount: 4,
};

const PREPARE: PrepareResult = {
  checklistBeforeSigning: ['Read the bond clause again.'],
  questionsForHR: ['Can the notice period be bought out?'],
  questionsForLawyer: [],
  missingInformation: ['Leave entitlement'],
  documentsToBring: [],
};

interface Endpoint {
  name: string;
  path: string;
  token: string | null;
  sent: unknown;
  valid: unknown;
  call: (options?: RequestOptions) => Promise<unknown>;
}

const ANALYZE_INPUT = { clauses: CLAUSES, lenses: ['QUIT_EARLY' as const], ...PREFS };
const ASK_INPUT = {
  clauses: CLAUSES,
  question: 'What is my notice period?',
  history: [{ question: 'Is there a bond?', answer: 'No.' }],
  ...PREFS,
};
const COMPARE_INPUT = { clausesA: CLAUSES, clausesB: CLAUSES, ...PREFS };
const PREPARE_INPUT = {
  clauses: CLAUSES,
  lenses: ['EVERYTHING' as const],
  findings: [{ clauseId: 'c001', category: 'NOTICE_PERIOD', risk: 'HIGH', title: 'Long notice' }],
  unansweredQuestions: ['Is there a joining bonus?'],
  ...PREFS,
};

const ENDPOINTS: readonly Endpoint[] = [
  {
    name: 'createSession',
    path: '/api/session',
    token: null,
    sent: { turnstileToken: 'turnstile-ok' },
    valid: SESSION,
    call: (options) => createSession('turnstile-ok', options),
  },
  {
    name: 'analyzeDocument',
    path: '/api/analyze',
    token: TOKEN,
    sent: ANALYZE_INPUT,
    valid: ANALYSIS,
    call: (options) => analyzeDocument(TOKEN, ANALYZE_INPUT, options),
  },
  {
    name: 'askQuestion',
    path: '/api/ask',
    token: TOKEN,
    sent: ASK_INPUT,
    valid: ASK,
    call: (options) => askQuestion(TOKEN, ASK_INPUT, options),
  },
  {
    name: 'compareDocuments',
    path: '/api/compare',
    token: TOKEN,
    sent: COMPARE_INPUT,
    valid: COMPARE,
    call: (options) => compareDocuments(TOKEN, COMPARE_INPUT, options),
  },
  {
    name: 'preparePack',
    path: '/api/prepare',
    token: TOKEN,
    sent: PREPARE_INPUT,
    valid: PREPARE,
    call: (options) => preparePack(TOKEN, PREPARE_INPUT, options),
  },
];

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorEnvelope(
  code: string,
  retryable: boolean,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return json({ error: { code, message: 'Something went wrong.', retryable } }, status, headers);
}

/** The single request the client made, as fetch received it. */
function sentRequest(): { path: unknown; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [path, init] = fetchMock.mock.calls[0]!;
  return { path, init: init ?? {} };
}

/** Awaits a call that must fail, and hands back the ApiError it failed with. */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the request to fail, but it succeeded');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the fixtures', () => {
  it('are genuinely valid responses, so the success tests prove what they claim', () => {
    expect(sessionResponseSchema.safeParse(SESSION).success).toBe(true);
    expect(analyzeResponseSchema.safeParse(ANALYSIS).success).toBe(true);
    expect(askResponseSchema.safeParse(ASK).success).toBe(true);
    expect(compareResponseSchema.safeParse(COMPARE).success).toBe(true);
    expect(prepareResponseSchema.safeParse(PREPARE).success).toBe(true);
  });
});

describe.each(ENDPOINTS)('$name', ({ path, token, sent, valid, call }) => {
  it(`POSTs its input as JSON to ${path}`, async () => {
    fetchMock.mockResolvedValue(json(valid));
    await call();

    const request = sentRequest();
    expect(request.path).toBe(path);
    expect(request.init.method).toBe('POST');
    expect(request.init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(request.init.body as string)).toEqual(sent);
  });

  if (token === null) {
    it('sends no authorization header, because there is no session yet to prove', async () => {
      fetchMock.mockResolvedValue(json(valid));
      await call();
      expect(sentRequest().init.headers).toEqual({ 'content-type': 'application/json' });
    });
  } else {
    it('sends the session token as a bearer credential', async () => {
      fetchMock.mockResolvedValue(json(valid));
      await call();
      expect(sentRequest().init.headers).toEqual({
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      });
    });
  }

  it('returns a valid response parsed', async () => {
    fetchMock.mockResolvedValue(json(valid));
    await expect(call()).resolves.toEqual(valid);
  });

  it('refuses a response that fails its schema, rather than handing the UI a shape it cannot render', async () => {
    fetchMock.mockResolvedValue(json({ unexpected: 'shape' }));
    const error = await failure(call());
    expect(error.code).toBe('MODEL_INVALID_OUTPUT');
    expect(error.retryable).toBe(true);
  });

  it('passes the abort signal through to fetch', async () => {
    fetchMock.mockResolvedValue(json(valid));
    const controller = new AbortController();
    await call({ signal: controller.signal });
    expect(sentRequest().init.signal).toBe(controller.signal);
  });

  it('sends no signal when none is given', async () => {
    fetchMock.mockResolvedValue(json(valid));
    await call();
    expect(sentRequest().init).not.toHaveProperty('signal');
  });
});

describe('successful responses', () => {
  it('strips fields the schema does not know, so nothing unexpected reaches the UI', async () => {
    fetchMock.mockResolvedValue(json({ ...PREPARE, debug: 'internal prompt text' }));
    const result = await preparePack(TOKEN, PREPARE_INPUT);
    expect(result).toEqual(PREPARE);
    expect(result).not.toHaveProperty('debug');
  });

  it('treats a 200 whose body is not JSON as invalid output, not as a crash', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Captive portal</html>', { status: 200 }));
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('MODEL_INVALID_OUTPUT');
  });
});

describe('error responses', () => {
  it('reads the code and retryable flag from the API error envelope', async () => {
    fetchMock.mockResolvedValue(errorEnvelope('UNAUTHORIZED', false, 401));
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.retryable).toBe(false);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('reads Retry-After into retryAfterSeconds, so the UI can say how long to wait', async () => {
    fetchMock.mockResolvedValue(errorEnvelope('RATE_LIMITED', true, 429, { 'retry-after': '30' }));
    const error = await failure(askQuestion(TOKEN, ASK_INPUT));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('ignores a Retry-After it cannot read as seconds instead of reporting NaN', async () => {
    fetchMock.mockResolvedValue(
      errorEnvelope('RATE_LIMITED', true, 429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
    );
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('reports INTERNAL and allows a retry when the error body is not the API envelope', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const error = await failure(compareDocuments(TOKEN, COMPARE_INPUT));
    expect(error.code).toBe('INTERNAL');
    expect(error.retryable).toBe(true);
  });

  it('reports INTERNAL when the error JSON has the wrong shape or an unknown code', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'SOMETHING_NEW', message: 'x', retryable: false } }, 500),
    );
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('INTERNAL');
    expect(error.retryable).toBe(true);
  });

  it('keeps Retry-After even when the envelope is missing', async () => {
    fetchMock.mockResolvedValue(
      new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '5' } }),
    );
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('INTERNAL');
    expect(error.retryAfterSeconds).toBe(5);
  });
});

describe('network failures', () => {
  it('turns a failed fetch into a retryable INTERNAL error the UI can explain', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('INTERNAL');
    expect(error.retryable).toBe(true);
  });

  it('re-throws an AbortError untouched, because a cancelled request is not a failure', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    await expect(analyzeDocument(TOKEN, ANALYZE_INPUT)).rejects.toBe(abort);
  });

  it('still wraps a DOMException that is not an abort', async () => {
    fetchMock.mockRejectedValue(new DOMException('Network down', 'NetworkError'));
    const error = await failure(analyzeDocument(TOKEN, ANALYZE_INPUT));
    expect(error.code).toBe('INTERNAL');
  });
});

describe('ApiError', () => {
  it('is a real Error named after its code, so it logs and compares sensibly', () => {
    const error = new ApiError('RATE_LIMITED', true, 10);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(10);
  });
});
