import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemoryKv, type MinimalKv } from '../../tools/memoryKv';
import { ruleQuestions, runRules } from '../../shared/rules';
import {
  apiErrorSchema,
  prepareModelOutputSchema,
  prepareResponseSchema,
} from '../../shared/schemas';
import type { Clause, ClauseCategory } from '../../shared/types';
import type { Env } from '../lib/env';
import type * as Gemini from '../lib/gemini';
import {
  createGeminiClient,
  type GeminiClient,
  type GeminiFailure,
  type GeminiResult,
  type GenerateOptions,
} from '../lib/gemini';
import { prepareSystemPrompt } from '../lib/prompts';
import { PREPARE_SCHEMA } from '../lib/responseSchemas';
import { hashIp, issueSession } from '../lib/session';
import { dedupe, onRequestPost } from './prepare';

/**
 * `createGeminiClient` is wrapped rather than replaced: by default it is the real thing, so mock
 * mode runs the real fixtures, and a test that needs the model to say something specific swaps
 * in a scripted client for one request.
 */
vi.mock('../lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof Gemini>();
  return { ...actual, createGeminiClient: vi.fn(actual.createGeminiClient) };
});

const SECRET = 'test only: a thirty-two byte key';
const SALT = 'test-ip-hash-salt';
const IP = '203.0.113.7';
const PREPARE_URL = 'https://signsure.pages.dev/api/prepare';

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

interface Fixture {
  clause: Clause;
  category: ClauseCategory;
}

function fixture(id: string, category: ClauseCategory, text: string, order: number): Fixture {
  return {
    clause: { id, label: String(order + 1), heading: null, text, page: 1, pageEnd: 1, order },
    category,
  };
}

/**
 * A deliberately harsh letter: seven clauses that trip HIGH or MEDIUM rules, between them
 * carrying more reviewed questions than the sheet's cap, plus two that trip only INFO rules.
 */
const HARSH: Fixture[] = [
  fixture(
    'c001',
    'BOND_OR_EXIT_PENALTY',
    'You agree to serve the Company for a minimum period of twenty-four months. If you resign before then, you shall pay Rs. 2,00,000 as liquidated damages towards the training cost.',
    0,
  ),
  fixture(
    'c002',
    'NON_COMPETE',
    'For a period of twelve months after the termination of your employment, you shall not join or advise any business that competes with the Company.',
    1,
  ),
  fixture(
    'c003',
    'DOCUMENT_RETENTION',
    'The Company will retain your original certificates until you complete one year of service.',
    2,
  ),
  fixture(
    'c004',
    'PROBATION',
    'You will be on probation for six months, which may be extended at the sole discretion of the Company.',
    3,
  ),
  fixture(
    'c005',
    'TERMINATION',
    'The Company may terminate your employment without notice at its sole discretion.',
    4,
  ),
  fixture(
    'c006',
    'NON_SOLICIT',
    'You shall not solicit any client or employee of the Company for one year after leaving.',
    5,
  ),
  fixture(
    'c007',
    'IP_ASSIGNMENT',
    'All intellectual property you create, whether or not during working hours, belongs to the Company.',
    6,
  ),
  fixture(
    'c008',
    'CONFIDENTIALITY',
    'You shall keep all confidential information of the Company secret during and after your employment.',
    7,
  ),
  fixture(
    'c009',
    'DISPUTE_RESOLUTION',
    'Any dispute arising from this letter shall be referred to arbitration in Pune.',
    8,
  ),
];

/** Only the two clauses whose rules are informational. */
const MILD = HARSH.slice(7);

function clausesOf(fixtures: readonly Fixture[]): Clause[] {
  return fixtures.map((item) => item.clause);
}

function findingsOf(fixtures: readonly Fixture[]) {
  return fixtures.map((item) => ({
    clauseId: item.clause.id,
    category: item.category,
    risk: 'MEDIUM',
    title: 'A finding',
  }));
}

function categoriesOf(fixtures: readonly Fixture[]): Record<string, ClauseCategory> {
  return Object.fromEntries(fixtures.map((item) => [item.clause.id, item.category]));
}

/** Reviewed questions from the serious rules, in the order the route receives them. */
function seriousQuestions(fixtures: readonly Fixture[]): string[] {
  return ruleQuestions(
    runRules(clausesOf(fixtures), categoriesOf(fixtures)).filter(
      (hit) => hit.severity === 'HIGH' || hit.severity === 'MEDIUM',
    ),
  );
}

/** Reviewed questions from the informational rules only. */
function infoQuestions(fixtures: readonly Fixture[]): string[] {
  return ruleQuestions(
    runRules(clausesOf(fixtures), categoriesOf(fixtures)).filter((hit) => hit.severity === 'INFO'),
  );
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
  return new Request(PREPARE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function prepareBody(
  fixtures: readonly Fixture[] = HARSH,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clauses: clausesOf(fixtures),
    findings: findingsOf(fixtures),
    lenses: [],
    unansweredQuestions: [],
    language: 'en',
    readingLevel: 'standard',
    ...overrides,
  };
}

async function prepare(body: unknown, env: TestEnv = testEnv()): Promise<Response> {
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

/** A model sheet with nothing in it, for tests about what the route adds on its own. */
const EMPTY_SHEET = {
  checklistBeforeSigning: [],
  questionsForHR: [],
  questionsForLawyer: [],
  missingInformation: [],
  documentsToBring: [],
};

async function errorCode(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.code;
}

afterEach(() => {
  vi.mocked(createGeminiClient).mockReset();
  vi.useRealTimers();
});

describe('dedupe', () => {
  it('collapses questions that differ only in case and punctuation', () => {
    expect(
      dedupe(['Can I buy out my notice?', 'can i buy out my notice', 'CAN I BUY OUT MY NOTICE!!']),
    ).toEqual(['Can I buy out my notice?']);
  });

  it('keeps the first occurrence and the original order of distinct items', () => {
    expect(dedupe(['B question?', 'A question?', 'b question', 'C question?'])).toEqual([
      'B question?',
      'A question?',
      'C question?',
    ]);
  });

  it('drops blank and whitespace-only entries', () => {
    expect(dedupe(['', '   ', '\n', 'Real question?'])).toEqual(['Real question?']);
  });

  it('trims what it keeps', () => {
    expect(dedupe(['  Padded question?  '])).toEqual(['Padded question?']);
  });

  it('keeps questions that differ in a word, even when they look alike', () => {
    expect(dedupe(['Is the bond pro-rated?', 'Is the bonus pro-rated?'])).toHaveLength(2);
  });

  it('returns an empty list for an empty list', () => {
    expect(dedupe([])).toEqual([]);
  });

  // SUSPECTED BUG: the key strips everything outside [a-z0-9], and Devanagari is outside it, so
  // every Hindi question reduces to the same empty key and all but the first are thrown away.
  // With language "hi" the model writes its questions in Hindi, so each section of the sheet
  // would collapse to a single item.
  it('keeps distinct Hindi questions distinct, since the sheet is offered in Hindi', () => {
    const questions = [
      'क्या बॉन्ड की राशि हर महीने कम होगी?',
      'क्या मुझे मूल प्रमाणपत्र जमा करने होंगे?',
    ];
    expect(dedupe(questions)).toEqual(questions);
  });
});

describe('POST /api/prepare in mock mode', () => {
  it("appends the reviewed questions from serious rules after the model's own lawyer questions", async () => {
    const response = await prepare(prepareBody(HARSH));

    expect(response.status).toBe(200);
    const sheet = prepareResponseSchema.parse(await response.json());
    const reviewed = seriousQuestions(HARSH);
    expect(sheet.questionsForLawyer).toContain(reviewed[0]);
    // The fixture's own lawyer question for the bond clause comes first.
    expect(sheet.questionsForLawyer[0]).toBe(
      'Is the stated bond amount a reasonable pre-estimate of the training cost?',
    );
    expect(sheet.questionsForLawyer.indexOf(reviewed[0]!)).toBeGreaterThan(0);
  });

  it('includes reviewed questions only from HIGH and MEDIUM rules, never from INFO ones', async () => {
    const sheet = prepareResponseSchema.parse(await (await prepare(prepareBody(HARSH))).json());

    const info = infoQuestions(HARSH);
    expect(info.length).toBeGreaterThan(0);
    for (const question of info) expect(sheet.questionsForLawyer).not.toContain(question);
  });

  it('adds no reviewed questions at all when only informational rules fire', async () => {
    const sheet = prepareResponseSchema.parse(await (await prepare(prepareBody(MILD))).json());

    expect(seriousQuestions(MILD)).toEqual([]);
    for (const question of infoQuestions(MILD)) {
      expect(sheet.questionsForLawyer).not.toContain(question);
    }
  });

  it('caps the reviewed questions at twelve, so the sheet stays usable in a meeting', async () => {
    const sheet = prepareResponseSchema.parse(await (await prepare(prepareBody(HARSH))).json());

    const reviewed = seriousQuestions(HARSH);
    expect(reviewed.length).toBeGreaterThan(12);
    for (const question of reviewed.slice(0, 12)) {
      expect(sheet.questionsForLawyer).toContain(question);
    }
    for (const question of reviewed.slice(12)) {
      expect(sheet.questionsForLawyer).not.toContain(question);
    }
  });

  it('appends each missing-information gap as "<label>: not stated in this document."', async () => {
    const sheet = prepareResponseSchema.parse(await (await prepare(prepareBody(HARSH))).json());

    expect(sheet.missingInformation).toContain('Notice period: not stated in this document.');
    expect(sheet.missingInformation).toContain('Leave entitlement: not stated in this document.');
    // The letter does talk about probation, so that gap must not be claimed.
    expect(sheet.missingInformation).not.toContain('Probation terms: not stated in this document.');
  });

  it('reports the remaining budget in the rate-limit headers', async () => {
    const response = await prepare(prepareBody(HARSH));
    expect(response.headers.get('RateLimit-Limit')).toBe('10');
    expect(response.headers.get('RateLimit-Remaining')).toBe('9');
  });
});

describe('POST /api/prepare with a scripted model', () => {
  it('asks the model with the prepare prompt, schema, temperature and token budget', async () => {
    const calls = scriptModel(() => ({ raw: EMPTY_SHEET }));
    await prepare(
      prepareBody(HARSH, { unansweredQuestions: ['Is there a joining bonus?'], language: 'hi' }),
      liveEnv(),
    );

    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.systemInstruction).toBe(
      prepareSystemPrompt({ language: 'hi', readingLevel: 'standard' }),
    );
    expect(sent.responseSchema).toBe(PREPARE_SCHEMA);
    expect(sent.schema).toBe(prepareModelOutputSchema);
    expect(sent.temperature).toBe(0.3);
    expect(sent.maxOutputTokens).toBe(2048);
    expect(sent.userPrompt).toContain('- Is there a joining bonus?');
  });

  it('tells the model which reviewed questions are already covered, so it does not repeat them', async () => {
    const calls = scriptModel(() => ({ raw: EMPTY_SHEET }));
    await prepare(prepareBody(HARSH), liveEnv());

    const covered = /<already_covered_questions>\n([\s\S]*?)\n<\/already_covered_questions>/.exec(
      calls[0]!.userPrompt,
    )?.[1];
    expect(covered?.split('\n')).toEqual(
      seriousQuestions(HARSH)
        .slice(0, 12)
        .map((question) => `- ${question}`),
    );
  });

  it('de-duplicates every section of what the model wrote', async () => {
    scriptModel(() => ({
      raw: {
        checklistBeforeSigning: ['Check the bond.', 'check the bond', '   ', 'CHECK THE BOND!'],
        questionsForHR: ['What is my in-hand pay?', 'what is my in hand pay'],
        questionsForLawyer: [],
        missingInformation: ['Leave policy', 'leave policy.'],
        documentsToBring: ['This offer letter.', 'this offer letter'],
      },
    }));
    const sheet = prepareResponseSchema.parse(
      await (await prepare(prepareBody(MILD), liveEnv())).json(),
    );

    expect(sheet.checklistBeforeSigning).toEqual(['Check the bond.']);
    expect(sheet.questionsForHR).toEqual(['What is my in-hand pay?']);
    expect(sheet.documentsToBring).toEqual(['This offer letter.']);
    expect(sheet.missingInformation[0]).toBe('Leave policy');
    expect(sheet.missingInformation).not.toContain('leave policy.');
  });

  it("does not repeat a reviewed question the model already asked, keeping the model's wording", async () => {
    const reviewed = seriousQuestions(HARSH)[0]!;
    const paraphrase = reviewed.toLowerCase().replace(/[?]/g, '');
    scriptModel(() => ({ raw: { ...EMPTY_SHEET, questionsForLawyer: [paraphrase] } }));
    const sheet = prepareResponseSchema.parse(
      await (await prepare(prepareBody(HARSH), liveEnv())).json(),
    );

    expect(sheet.questionsForLawyer[0]).toBe(paraphrase);
    expect(sheet.questionsForLawyer).not.toContain(reviewed);
  });

  it('still lists every reviewed question when the model wrote no lawyer questions at all', async () => {
    scriptModel(() => ({ raw: EMPTY_SHEET }));
    const sheet = prepareResponseSchema.parse(
      await (await prepare(prepareBody(HARSH), liveEnv())).json(),
    );

    expect(sheet.questionsForLawyer).toEqual(seriousQuestions(HARSH).slice(0, 12));
  });

  it.each([
    ['MODEL_INVALID_OUTPUT', 502],
    ['MODEL_BLOCKED', 422],
    ['UPSTREAM_TIMEOUT', 504],
    ['INTERNAL', 500],
  ] as const)('returns a %s model failure as HTTP %i', async (code, status) => {
    scriptModel(() => code);
    const response = await prepare(prepareBody(HARSH), liveEnv());

    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
  });

  it('returns 502 when the model output does not match the schema', async () => {
    scriptModel(() => ({ raw: { questionsForHR: 'ask about pay' } }));
    const response = await prepare(prepareBody(HARSH), liveEnv());
    expect(response.status).toBe(502);
  });
});

describe('POST /api/prepare refusals', () => {
  it('returns 401 without a session token and never reaches the model', async () => {
    const response = await call({ request: request(prepareBody()), env: testEnv() });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('UNAUTHORIZED');
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not JSON', async () => {
    const response = await prepare('<xml/>');
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_INPUT');
  });

  it.each([
    [
      'a finding with an unknown category',
      { findings: [{ clauseId: 'c001', category: 'VIBES', risk: 'LOW', title: 't' }] },
    ],
    [
      'more than twenty unanswered questions',
      { unansweredQuestions: Array.from({ length: 21 }, () => 'q?') },
    ],
    ['no findings field', { findings: undefined }],
  ])('returns 400 for a body with %s, before any model call', async (_label, overrides) => {
    const response = await prepare(prepareBody(HARSH, overrides));
    expect(response.status).toBe(400);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After on the eleventh sheet in an hour', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 10; index += 1) {
      expect((await prepare(prepareBody(MILD), env)).status).toBe(200);
    }
    vi.mocked(createGeminiClient).mockClear();

    const limited = await prepare(prepareBody(MILD), env);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });
});
