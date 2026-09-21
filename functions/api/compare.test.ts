import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemoryKv, type MinimalKv } from '../../tools/memoryKv';
import type { ClausePair } from '../../shared/compare';
import {
  apiErrorSchema,
  compareModelOutputSchema,
  compareResponseSchema,
} from '../../shared/schemas';
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
import { compareSystemPrompt } from '../lib/prompts';
import { COMPARE_SCHEMA } from '../lib/responseSchemas';
import { hashIp, issueSession } from '../lib/session';
import { onRequestPost, toChanges, type CompareModelChange } from './compare';

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
const COMPARE_URL = 'https://signsure.pages.dev/api/compare';

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

const SALARY =
  'Your annual cost to company will be Rs. 6,00,000, paid in twelve equal monthly instalments.';

/** Version A: the original offer. */
const A_SALARY = clause('c001', '1', SALARY, 0);
const A_NOTICE = clause(
  'c002',
  '2',
  'Either party may end this employment by giving thirty (30) days written notice to the other.',
  1,
);
const A_LEAVE = clause(
  'c003',
  '3',
  'You will be entitled to eighteen days of paid leave in each calendar year of service.',
  2,
);

/** Version B: the revision, with a longer notice period, no leave clause and a new non-compete. */
const B_SALARY = clause('c001', '1', SALARY, 0);
const B_NOTICE = clause(
  'c002',
  '2',
  'Either party may end this employment by giving ninety (90) days written notice to the other.',
  1,
);
const B_NON_COMPETE = clause(
  'c003',
  '4',
  'For twelve months after leaving, you shall not join any business that competes with the Company.',
  2,
);

const VERSION_A = [A_SALARY, A_NOTICE, A_LEAVE];
const VERSION_B = [B_SALARY, B_NOTICE, B_NON_COMPETE];

function pair(pairId: string, a: Clause | null, b: Clause | null): ClausePair {
  return { pairId, a, b, category: 'NOTICE_PERIOD', similarity: 0.5, identical: false };
}

const CHANGED = pair('c002-c002', A_NOTICE, B_NOTICE);
const REMOVED = pair('c003-none', A_LEAVE, null);
const ADDED = pair('none-c003', null, B_NON_COMPETE);

const QUOTE_A = 'giving thirty (30) days written notice to the other';
const QUOTE_B = 'giving ninety (90) days written notice to the other';

function change(overrides: Partial<CompareModelChange> = {}): CompareModelChange {
  return {
    pairId: 'c002-c002',
    changeType: 'CHANGED',
    impact: 'WORSE_FOR_EMPLOYEE',
    summary: 'The notice period has tripled.',
    quoteA: QUOTE_A,
    quoteB: QUOTE_B,
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
  return new Request(COMPARE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function compareBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clausesA: VERSION_A,
    clausesB: VERSION_B,
    language: 'en',
    readingLevel: 'standard',
    ...overrides,
  };
}

async function compare(body: unknown, env: TestEnv = testEnv()): Promise<Response> {
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

describe('toChanges', () => {
  it('verifies quoteA against version A and quoteB against version B', () => {
    const [result] = toChanges([change()], [CHANGED]);

    expect(result!.quoteA).toMatchObject({ clauseId: 'c002', status: 'verified' });
    expect(result!.quoteB).toMatchObject({ clauseId: 'c002', status: 'verified' });
    expect(A_NOTICE.text.slice(result!.quoteA!.start, result!.quoteA!.end)).toBe(QUOTE_A);
    expect(B_NOTICE.text.slice(result!.quoteB!.start, result!.quoteB!.end)).toBe(QUOTE_B);
  });

  it("marks a quote taken from the other version unverified, so a change is never shown in the wrong side's words", () => {
    const [result] = toChanges([change({ quoteA: QUOTE_B, quoteB: QUOTE_A })], [CHANGED]);

    expect(result!.quoteA!.status).toBe('unverified');
    expect(result!.quoteB!.status).toBe('unverified');
  });

  // SUSPECTED BUG: when the revision changes a single word in a long sentence, the other side's
  // wording is a >= 0.9 token match and verifies as `fuzzy` - a presentable "close match". That
  // is exactly the case compare exists for, and the route's own comment says verifying against
  // each side "is what stops a change being illustrated with text from the wrong version".
  it('marks a wrong-side quote unverified even when the versions differ by one word', () => {
    const before = clause(
      'c010',
      '5',
      'Either party may end this employment at any time by giving thirty days written notice to the other party.',
      0,
    );
    const after = clause(
      'c010',
      '5',
      'Either party may end this employment at any time by giving ninety days written notice to the other party.',
      0,
    );
    const [result] = toChanges(
      [change({ pairId: 'c010-c010', quoteA: after.text, quoteB: after.text })],
      [pair('c010-c010', before, after)],
    );

    expect(result!.quoteB!.status).toBe('verified');
    expect(result!.quoteA!.status).toBe('unverified');
  });

  it('drops a change whose pair id was never sent', () => {
    const result = toChanges(
      [change({ pairId: 'c404-c404' }), change({ pairId: 'c002-c002' })],
      [CHANGED],
    );
    expect(result.map((item) => item.pairId)).toEqual(['c002-c002']);
  });

  it.each([
    ['ADDED', 'REMOVED' as const],
    ['ADDED', 'CHANGED' as const],
  ])(
    'reports a clause only in version B as %s even when the model says %s',
    (expected, claimed) => {
      const [result] = toChanges(
        [change({ pairId: 'none-c003', changeType: claimed, quoteA: null, quoteB: null })],
        [ADDED],
      );
      expect(result!.changeType).toBe(expected);
    },
  );

  it.each([
    ['REMOVED', 'ADDED' as const],
    ['REMOVED', 'CHANGED' as const],
  ])(
    'reports a clause only in version A as %s even when the model says %s',
    (expected, claimed) => {
      const [result] = toChanges(
        [change({ pairId: 'c003-none', changeType: claimed, quoteA: null, quoteB: null })],
        [REMOVED],
      );
      expect(result!.changeType).toBe(expected);
    },
  );

  it('reports a clause present on both sides as CHANGED even when the model says ADDED', () => {
    const [result] = toChanges([change({ changeType: 'ADDED' })], [CHANGED]);
    expect(result!.changeType).toBe('CHANGED');
  });

  it('gives a missing side a null quote, even if the model quoted something for it', () => {
    const [added] = toChanges(
      [
        change({
          pairId: 'none-c003',
          quoteA: 'text that cannot exist in an absent clause',
          quoteB: 'you shall not join any business that competes with the Company',
        }),
      ],
      [ADDED],
    );
    expect(added!.quoteA).toBeNull();
    expect(added!.quoteB).toMatchObject({ clauseId: 'c003', status: 'verified' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('turns a %s quote into null rather than an unverified empty quote', (_label, quote) => {
    const [result] = toChanges([change({ quoteA: quote, quoteB: quote })], [CHANGED]);
    expect(result!.quoteA).toBeNull();
    expect(result!.quoteB).toBeNull();
  });

  it("takes the category from our pairing and keeps the model's impact and summary", () => {
    const [result] = toChanges([change({ impact: 'UNCLEAR', summary: 'Hard to say.' })], [CHANGED]);
    expect(result).toMatchObject({
      pairId: 'c002-c002',
      category: 'NOTICE_PERIOD',
      impact: 'UNCLEAR',
      summary: 'Hard to say.',
    });
  });
});

describe('POST /api/compare', () => {
  it('short-circuits identical documents with no changes and never asks the model', async () => {
    const response = await compare(compareBody({ clausesB: VERSION_A }));

    expect(response.status).toBe(200);
    expect(compareResponseSchema.parse(await response.json())).toEqual({
      changes: [],
      unchangedCount: VERSION_A.length,
    });
    expect(createGeminiClient).not.toHaveBeenCalled();
    expect(response.headers.get('RateLimit-Remaining')).toBe('9');
  });

  it('explains a real change in mock mode with quotes verified against their own versions', async () => {
    const response = await compare(compareBody());

    expect(response.status).toBe(200);
    const result = compareResponseSchema.parse(await response.json());
    expect(result.unchangedCount).toBe(1);

    const notice = result.changes.find((item) => item.pairId === 'c002-c002')!;
    expect(notice.changeType).toBe('CHANGED');
    expect(notice.impact).toBe('WORSE_FOR_EMPLOYEE');
    expect(notice.quoteA!.status).toBe('verified');
    expect(notice.quoteB!.status).toBe('verified');
    expect(A_NOTICE.text.slice(notice.quoteA!.start, notice.quoteA!.end)).toBe(
      notice.quoteA!.quote,
    );
    expect(B_NOTICE.text.slice(notice.quoteB!.start, notice.quoteB!.end)).toBe(
      notice.quoteB!.quote,
    );
  });

  it('reports a clause dropped from the revision as REMOVED and a new one as ADDED', async () => {
    const result = compareResponseSchema.parse(await (await compare(compareBody())).json());

    const removed = result.changes.find((item) => item.pairId === 'c003-none')!;
    expect(removed.changeType).toBe('REMOVED');
    expect(removed.quoteA!.status).toBe('verified');
    expect(removed.quoteB).toBeNull();

    const added = result.changes.find((item) => item.pairId === 'none-c003')!;
    expect(added.changeType).toBe('ADDED');
    expect(added.quoteA).toBeNull();
    expect(added.quoteB!.status).toBe('verified');
  });

  it('asks the model only about changed pairs, with the compare prompt and settings', async () => {
    const calls = scriptModel(() => ({ raw: { changes: [] } }));
    await compare(compareBody({ language: 'hi', readingLevel: 'simple' }), liveEnv());

    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.systemInstruction).toBe(
      compareSystemPrompt({ language: 'hi', readingLevel: 'simple' }),
    );
    expect(sent.userPrompt).toContain('<pair id="c002-c002">');
    expect(sent.userPrompt).not.toContain('<pair id="c001-c001">');
    expect(sent.responseSchema).toBe(COMPARE_SCHEMA);
    expect(sent.schema).toBe(compareModelOutputSchema);
    expect(sent.temperature).toBe(0.2);
    expect(sent.maxOutputTokens).toBe(4096);
  });

  it('sends at most sixty pairs in one call, so a rewritten document cannot blow the budget', async () => {
    const rewritten = (version: string) =>
      Array.from({ length: 65 }, (_, index) =>
        clause(
          `c${String(index + 1).padStart(3, '0')}`,
          String(index + 1),
          `The allowance under clause ${index + 1} is paid ${version}.`,
          index,
        ),
      );
    const calls = scriptModel(() => ({ raw: { changes: [] } }));
    const response = await compare(
      compareBody({ clausesA: rewritten('monthly'), clausesB: rewritten('quarterly') }),
      liveEnv(),
    );

    expect(response.status).toBe(200);
    expect(calls[0]!.userPrompt.match(/<pair id=/g)).toHaveLength(60);
  });

  it('drops a change the model invents for a pair it was never shown', async () => {
    scriptModel(() => ({
      raw: {
        changes: [
          change({ pairId: 'c777-c777' }),
          change({ pairId: 'c002-c002', quoteA: QUOTE_A, quoteB: QUOTE_B }),
        ],
      },
    }));
    const result = compareResponseSchema.parse(
      await (await compare(compareBody(), liveEnv())).json(),
    );

    expect(result.changes.map((item) => item.pairId)).toEqual(['c002-c002']);
  });

  it.each([
    ['MODEL_INVALID_OUTPUT', 502],
    ['MODEL_BLOCKED', 422],
    ['UPSTREAM_TIMEOUT', 504],
  ] as const)('returns the %s failure as HTTP %i', async (code, status) => {
    scriptModel(() => code);
    const response = await compare(compareBody(), liveEnv());

    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
  });

  it('returns 502 when the model output does not match the schema', async () => {
    scriptModel(() => ({ raw: { changes: [{ pairId: 'c002-c002', changeType: 'MOVED' }] } }));
    const response = await compare(compareBody(), liveEnv());
    expect(response.status).toBe(502);
  });
});

describe('POST /api/compare refusals', () => {
  it('returns 401 without a session token and never reaches the model', async () => {
    const response = await call({ request: request(compareBody()), env: testEnv() });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('UNAUTHORIZED');
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not JSON', async () => {
    const response = await compare('{"clausesA": [');
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_INPUT');
  });

  it.each([
    ['an empty version B', compareBody({ clausesB: [] })],
    ['version B missing', compareBody({ clausesB: undefined })],
    ['an unknown reading level', compareBody({ readingLevel: 'legalese' })],
    [
      'two documents that together exceed the character budget',
      compareBody({
        clausesA: Array.from({ length: 16 }, (_, index) =>
          clause(`c${String(index + 1).padStart(3, '0')}`, String(index), 'a'.repeat(4_000), index),
        ),
        clausesB: Array.from({ length: 16 }, (_, index) =>
          clause(`c${String(index + 1).padStart(3, '0')}`, String(index), 'b'.repeat(4_000), index),
        ),
      }),
    ],
  ])('returns 400 for %s, before any model call', async (_label, body) => {
    const response = await compare(body);
    expect(response.status).toBe(400);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After on the eleventh comparison in an hour', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 10; index += 1) {
      expect((await compare(compareBody(), env)).status).toBe(200);
    }
    vi.mocked(createGeminiClient).mockClear();

    const limited = await compare(compareBody(), env);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });
});
