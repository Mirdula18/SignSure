import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemoryKv, type MinimalKv } from '../../tools/memoryKv';
import { apiErrorSchema, askModelOutputSchema, askResponseSchema } from '../../shared/schemas';
import type { Clause } from '../../shared/types';
import type { Env } from '../lib/env';
import type * as Gemini from '../lib/gemini';
import {
  createGeminiClient,
  type GeminiClient,
  type GeminiFailure,
  type GeminiResult,
  type GenerateOptions,
} from '../lib/gemini';
import { askSystemPrompt, askUserPrompt } from '../lib/prompts';
import { ASK_SCHEMA } from '../lib/responseSchemas';
import { hashIp, issueSession } from '../lib/session';
import { DOWNGRADE_ANSWER, onRequestPost, toAskResult, type AskModelShape } from './ask';

/**
 * `createGeminiClient` is wrapped rather than replaced: by default it is the real thing, so mock
 * mode runs the real fixtures and real verification, and a test that needs the model to say
 * something specific swaps in a scripted client for one request.
 */
vi.mock('../lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof Gemini>();
  return { ...actual, createGeminiClient: vi.fn(actual.createGeminiClient) };
});

const SECRET = 'test only: a thirty-two byte key';
const SALT = 'test-ip-hash-salt';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.22';
const ASK_URL = 'https://signsure.pages.dev/api/ask';

/** A fixed instant, so a rate-limit window cannot roll over in the middle of a test. */
const NOW = Date.UTC(2026, 0, 15, 9, 30, 0);

/** The routes only read `request` and `env`, and only this much of KV. */
type TestEnv = Omit<Env, 'RATE_LIMIT_KV'> & { RATE_LIMIT_KV?: MinimalKv };

interface Ctx {
  request: Request;
  env: TestEnv;
}

const call = (ctx: Ctx): Promise<Response> =>
  (onRequestPost as unknown as (context: Ctx) => Promise<Response>)(ctx);

function clause(id: string, label: string, text: string, order: number): Clause {
  return { id, label, heading: null, text, page: 1, pageEnd: 1, order };
}

const SALARY = clause(
  'c001',
  '1.1',
  'Your annual cost to company (CTC) will be Rs. 6,00,000, comprising basic salary, house rent allowance and special allowance.',
  0,
);
const NOTICE = clause(
  'c002',
  '4.2',
  'After confirmation, either party may end this employment by giving ninety (90) days written notice to the other.',
  1,
);
const NON_COMPETE = clause(
  'c003',
  '7.1',
  'For twelve months after leaving, you shall not join any business that competes with the Company.',
  2,
);
const CLAUSES = [SALARY, NOTICE, NON_COMPETE];

/** A quote copied character for character from the notice clause. */
const NOTICE_QUOTE =
  'either party may end this employment by giving ninety (90) days written notice';

function model(overrides: Partial<AskModelShape> = {}): AskModelShape {
  return {
    status: 'answered',
    answer: 'Your notice period is ninety days.',
    citations: [{ clauseId: 'c002', quote: NOTICE_QUOTE }],
    missingInfo: [],
    suggestedQuestions: [],
    ...overrides,
  };
}

function testEnv(overrides: TestEnv = {}): TestEnv {
  return {
    SESSION_SECRET: SECRET,
    IP_HASH_SALT: SALT,
    MOCK_GEMINI: 'true',
    RATE_LIMIT_KV: new MemoryKv(),
    ...overrides,
  };
}

/** Same env with mock mode off, for tests that script the model themselves. */
function liveEnv(): TestEnv {
  return { SESSION_SECRET: SECRET, IP_HASH_SALT: SALT, RATE_LIMIT_KV: new MemoryKv() };
}

async function bearer(ip = IP): Promise<string> {
  const { token } = await issueSession(SECRET, await hashIp(ip, SALT));
  return `Bearer ${token}`;
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(ASK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function askBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clauses: CLAUSES,
    question: 'What is my notice period?',
    language: 'en',
    readingLevel: 'standard',
    ...overrides,
  };
}

async function ask(body: unknown, env: TestEnv = testEnv()): Promise<Response> {
  return call({ request: request(body, { authorization: await bearer() }), env });
}

/** What a route asked the model, so a test can check the prompt and the settings. */
interface ModelCall {
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  schema: z.ZodType;
  temperature: number;
  maxOutputTokens: number;
}

/** Raw model output, schema-checked as the real client would, or a failure code. */
type Reply = { raw: unknown } | GeminiFailure;

/**
 * Makes the next request use a model whose reply the test scripts.
 *
 * The reply still goes through the route's own Zod schema, exactly as it would from the real
 * client, so a test cannot hand the route a shape the real pipeline would never let through.
 */
function scriptModel(reply: (call: ModelCall) => Reply): ModelCall[] {
  const calls: ModelCall[] = [];
  const client: GeminiClient = {
    generate<S extends z.ZodType>(options: GenerateOptions<S>): Promise<GeminiResult<z.infer<S>>> {
      const recorded: ModelCall = {
        systemInstruction: options.systemInstruction,
        userPrompt: options.userPrompt,
        responseSchema: options.responseSchema,
        schema: options.schema,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      };
      calls.push(recorded);
      const outcome = reply(recorded);
      if (typeof outcome === 'string') return Promise.resolve({ ok: false, code: outcome });
      const parsed = options.schema.safeParse(outcome.raw);
      if (!parsed.success) return Promise.resolve({ ok: false, code: 'MODEL_INVALID_OUTPUT' });
      return Promise.resolve({ ok: true, data: parsed.data });
    },
  };
  vi.mocked(createGeminiClient).mockReturnValueOnce(client);
  return calls;
}

async function errorCode(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.code;
}

afterEach(() => {
  vi.mocked(createGeminiClient).mockReset();
  vi.useRealTimers();
});

describe('toAskResult', () => {
  it('keeps an answer whose citation is found in the clause it names, with offsets for highlighting', () => {
    const result = toAskResult(model(), CLAUSES);

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('Your notice period is ninety days.');
    expect(result.citations).toHaveLength(1);
    const citation = result.citations[0]!;
    expect(citation).toMatchObject({ clauseId: 'c002', status: 'verified' });
    expect(NOTICE.text.slice(citation.start, citation.end)).toBe(NOTICE_QUOTE);
  });

  it('keeps an answer supported only by a close-match citation, since that is still evidence', () => {
    const paraphrased =
      'after confirmation, either party may end this employment by giving ninety (90) days prior notice to the other.';
    const result = toAskResult(
      model({ citations: [{ clauseId: 'c002', quote: paraphrased }] }),
      CLAUSES,
    );
    expect(result.status).toBe('answered');
    expect(result.citations.map((citation) => citation.status)).toEqual(['fuzzy']);
  });

  // THE most important test in the repository. A fluent, confident answer with nothing in the
  // document behind it is exactly the failure SignSure exists to prevent (CLAUDE.md rule 4), so
  // it must be replaced with "your document does not say this", not shown with a warning badge.
  it('downgrades an answer to not_in_document when every citation fails verification', () => {
    const result = toAskResult(
      model({
        answer: 'Yes, your parents are covered by the company health insurance.',
        citations: [
          { clauseId: 'c001', quote: 'health insurance cover for your parents and spouse' },
          { clauseId: 'c002', quote: 'the company will pay for family medical insurance' },
        ],
      }),
      CLAUSES,
    );

    expect(result.status).toBe('not_in_document');
    expect(result.answer).toBe(DOWNGRADE_ANSWER);
    expect(result.answer).not.toContain('parents');
    expect(result.citations).toEqual([]);
  });

  it('downgrades an answered status that arrives with no citations at all', () => {
    const result = toAskResult(model({ citations: [] }), CLAUSES);
    expect(result.status).toBe('not_in_document');
    expect(result.answer).toBe(DOWNGRADE_ANSWER);
  });

  it('treats a real quote attributed to the wrong clause as unsupported', () => {
    // The quote exists in c002, but the model said it came from c001.
    const result = toAskResult(
      model({ citations: [{ clauseId: 'c001', quote: NOTICE_QUOTE }] }),
      CLAUSES,
    );
    expect(result.status).toBe('not_in_document');
    expect(result.citations).toEqual([]);
  });

  it('treats a quote too short to prove anything as unsupported', () => {
    const result = toAskResult(model({ citations: [{ clauseId: 'c001', quote: 'CTC' }] }), CLAUSES);
    expect(result.status).toBe('not_in_document');
  });

  it('drops a citation to a clause id that was never sent, even if its quote is real', () => {
    const result = toAskResult(
      model({
        citations: [
          { clauseId: 'c999', quote: NOTICE_QUOTE },
          { clauseId: 'c002', quote: NOTICE_QUOTE },
        ],
      }),
      CLAUSES,
    );
    expect(result.status).toBe('answered');
    expect(result.citations.map((citation) => citation.clauseId)).toEqual(['c002']);
  });

  it('downgrades when the only citation points at a clause id that was never sent', () => {
    const result = toAskResult(
      model({ citations: [{ clauseId: 'c999', quote: NOTICE_QUOTE }] }),
      CLAUSES,
    );
    expect(result.status).toBe('not_in_document');
    expect(result.answer).toBe(DOWNGRADE_ANSWER);
    expect(result.citations).toEqual([]);
  });

  it('drops the unverified citations of an answer that also has a verified one', () => {
    const result = toAskResult(
      model({
        citations: [
          { clauseId: 'c002', quote: NOTICE_QUOTE },
          { clauseId: 'c003', quote: 'you may join a competitor immediately after leaving' },
        ],
      }),
      CLAUSES,
    );
    expect(result.status).toBe('answered');
    expect(result.citations).toHaveLength(1);
    expect(result.citations.every((citation) => citation.status !== 'unverified')).toBe(true);
  });

  it('passes a not_in_document answer through with its own wording', () => {
    const result = toAskResult(
      model({
        status: 'not_in_document',
        answer: 'The document does not mention insurance.',
        citations: [],
        missingInfo: ['Insurance cover'],
        suggestedQuestions: ['Is there a health insurance policy?'],
      }),
      CLAUSES,
    );
    expect(result).toEqual({
      status: 'not_in_document',
      answer: 'The document does not mention insurance.',
      citations: [],
      missingInfo: ['Insurance cover'],
      suggestedQuestions: ['Is there a health insurance policy?'],
    });
  });

  it('passes needs_professional through, keeping verified citations and dropping unverified ones', () => {
    const quote = 'you shall not join any business that competes with the Company';
    const result = toAskResult(
      model({
        status: 'needs_professional',
        answer: 'There is a restriction; a lawyer should confirm how it applies.',
        citations: [
          { clauseId: 'c003', quote },
          { clauseId: 'c003', quote: 'this restriction is unenforceable in India' },
        ],
      }),
      CLAUSES,
    );
    expect(result.status).toBe('needs_professional');
    expect(result.answer).toBe('There is a restriction; a lawyer should confirm how it applies.');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ clauseId: 'c003', quote, status: 'verified' });
  });

  it('supplies default missing information and questions when a downgraded answer had none', () => {
    const result = toAskResult(
      model({ citations: [{ clauseId: 'c001', quote: 'free lunch every working day' }] }),
      CLAUSES,
    );
    expect(result.status).toBe('not_in_document');
    expect(result.missingInfo).toEqual(['Your document does not appear to cover this topic.']);
    expect(result.suggestedQuestions).toHaveLength(2);
    expect(result.suggestedQuestions.every((question) => question.endsWith('?'))).toBe(true);
  });

  it("keeps the model's own missing information and questions when a downgraded answer had some", () => {
    const result = toAskResult(
      model({
        citations: [{ clauseId: 'c001', quote: 'free lunch every working day' }],
        missingInfo: ['Meal policy'],
        suggestedQuestions: ['Is lunch provided?'],
      }),
      CLAUSES,
    );
    expect(result.missingInfo).toEqual(['Meal policy']);
    expect(result.suggestedQuestions).toEqual(['Is lunch provided?']);
  });
});

describe('POST /api/ask in mock mode', () => {
  it('answers an answerable question with a citation verified against the real clause', async () => {
    const response = await ask(askBody());

    expect(response.status).toBe(200);
    const result = askResponseSchema.parse(await response.json());
    expect(result.status).toBe('answered');
    expect(result.citations.length).toBeGreaterThan(0);
    for (const citation of result.citations) {
      expect(citation.clauseId).toBe('c002');
      expect(citation.status).toBe('verified');
      expect(NOTICE.text.slice(citation.start, citation.end)).toBe(citation.quote);
    }
  });

  it('says the document does not cover a question it genuinely does not cover', async () => {
    const response = await ask(askBody({ question: "Will they pay for my parents' insurance?" }));

    expect(response.status).toBe(200);
    const result = askResponseSchema.parse(await response.json());
    expect(result.status).toBe('not_in_document');
    expect(result.citations).toEqual([]);
    expect(result.suggestedQuestions.length).toBeGreaterThan(0);
  });

  it('reports the remaining budget in the rate-limit headers', async () => {
    const response = await ask(askBody());
    expect(response.headers.get('RateLimit-Limit')).toBe('40');
    expect(response.headers.get('RateLimit-Remaining')).toBe('39');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /api/ask with a scripted model', () => {
  it('downgrades an unsupported answer end to end, so the network response never carries it', async () => {
    scriptModel(() => ({
      raw: {
        status: 'answered',
        answer: 'Yes, you get twenty-four days of paid leave.',
        citations: [
          { clauseId: 'c002', quote: 'you are entitled to twenty-four days of paid leave' },
        ],
        missingInfo: [],
        suggestedQuestions: [],
      },
    }));

    const response = await ask(askBody({ question: 'How much leave do I get?' }), liveEnv());

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('twenty-four days');
    const result = askResponseSchema.parse(JSON.parse(text));
    expect(result.status).toBe('not_in_document');
    expect(result.answer).toBe(DOWNGRADE_ANSWER);
  });

  it('asks the model with the ask prompt, schema, temperature and token budget', async () => {
    const calls = scriptModel(() => ({ raw: model() }));
    await ask(askBody({ language: 'hi', readingLevel: 'simple' }), liveEnv());

    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.systemInstruction).toBe(
      askSystemPrompt({ language: 'hi', readingLevel: 'simple' }),
    );
    expect(sent.userPrompt).toBe(
      askUserPrompt({ clauses: CLAUSES, question: 'What is my notice period?' }),
    );
    expect(sent.responseSchema).toBe(ASK_SCHEMA);
    expect(sent.schema).toBe(askModelOutputSchema);
    expect(sent.temperature).toBe(0.2);
    expect(sent.maxOutputTokens).toBe(1536);
  });

  it('does not load the fixture responder outside mock mode', async () => {
    scriptModel(() => ({ raw: model() }));
    const env = liveEnv();
    await ask(askBody(), env);
    expect(createGeminiClient).toHaveBeenCalledWith(env, undefined);
  });

  it('accepts a request with no history and sends no previous turns', async () => {
    const calls = scriptModel(() => ({ raw: model() }));
    const response = await ask(askBody(), liveEnv());

    expect(response.status).toBe(200);
    expect(calls[0]!.userPrompt).not.toContain('<previous_turns>');
  });

  it('passes earlier turns through to the prompt when history is supplied', async () => {
    const calls = scriptModel(() => ({ raw: model() }));
    const history = [{ question: 'What is my salary?', answer: 'Rs. 6,00,000 a year.' }];
    const response = await ask(askBody({ question: 'And my notice period?', history }), liveEnv());

    expect(response.status).toBe(200);
    expect(calls[0]!.userPrompt).toBe(
      askUserPrompt({ clauses: CLAUSES, question: 'And my notice period?', history }),
    );
    expect(calls[0]!.userPrompt).toContain('Q: What is my salary?\nA: Rs. 6,00,000 a year.');
  });

  it('returns 502 MODEL_INVALID_OUTPUT when the model output fails validation', async () => {
    scriptModel(() => ({ raw: { status: 'probably', answer: 42 } }));
    const response = await ask(askBody(), liveEnv());

    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('MODEL_INVALID_OUTPUT');
  });

  it.each([
    ['MODEL_BLOCKED', 422],
    ['UPSTREAM_TIMEOUT', 504],
    ['INTERNAL', 500],
  ] as const)('maps a %s model failure to HTTP %i', async (code, status) => {
    scriptModel(() => code);
    const response = await ask(askBody(), liveEnv());

    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
    expect(response.headers.get('RateLimit-Limit')).toBe('40');
  });
});

describe('POST /api/ask refusals', () => {
  it('returns 401 without a session token and never reaches the model or the rate limiter', async () => {
    const kv = new MemoryKv();
    const response = await call({
      request: request(askBody()),
      env: testEnv({ RATE_LIMIT_KV: kv }),
    });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('UNAUTHORIZED');
    expect(createGeminiClient).not.toHaveBeenCalled();
    expect(kv.size).toBe(0);
  });

  it('returns 401 for a token issued to a different network', async () => {
    const response = await call({
      request: request(askBody(), { authorization: await bearer(OTHER_IP) }),
      env: testEnv(),
    });
    expect(response.status).toBe(401);
  });

  it('returns 400 for a body that is not JSON', async () => {
    const response = await ask('{"question": "What is my notice');
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_INPUT');
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it.each([
    ['a question under three characters', askBody({ question: 'Hi' })],
    ['no clauses', askBody({ clauses: [] })],
    ['an unsupported language', askBody({ language: 'fr' })],
    [
      'more history than the limit',
      askBody({ history: Array.from({ length: 5 }, () => ({ question: 'q', answer: 'a' })) }),
    ],
  ])('returns 400 for a body with %s', async (_label, body) => {
    const response = await ask(body);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_INPUT');
  });

  it('returns 429 with Retry-After on the 41st question in an hour, without calling the model', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 40; index += 1) {
      expect((await ask(askBody(), env)).status).toBe(200);
    }
    vi.mocked(createGeminiClient).mockClear();

    const limited = await ask(askBody(), env);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });
});
