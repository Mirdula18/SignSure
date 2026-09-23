import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemoryKv, type MinimalKv } from '../../tools/memoryKv';
import { LIMITS } from '../../shared/limits';
import {
  analyzeModelOutputSchema,
  analyzeResponseSchema,
  apiErrorSchema,
} from '../../shared/schemas';
import { RISK_ORDER, type Clause } from '../../shared/types';
import type { Env } from '../lib/env';
import type * as Gemini from '../lib/gemini';
import {
  createGeminiClient,
  type GeminiClient,
  type GeminiFailure,
  type GeminiResult,
  type GenerateOptions,
} from '../lib/gemini';
import { analyzeSystemPrompt, analyzeUserPrompt } from '../lib/prompts';
import { ANALYZE_SCHEMA } from '../lib/responseSchemas';
import { hashIp, issueSession } from '../lib/session';
import { batchClauses, mapWithLimit, onRequestPost } from './analyze';

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
const ANALYZE_URL = 'https://signsure.pages.dev/api/analyze';

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

function clause(id: string, label: string | null, text: string, order: number): Clause {
  return { id, label, heading: null, text, page: 1, pageEnd: 1, order };
}

const CLAUSES: Clause[] = [
  clause(
    'c001',
    null,
    'Acme Technologies Private Limited is pleased to offer you the position of Software Engineer, starting on 1 July 2026.',
    0,
  ),
  clause(
    'c002',
    '1',
    'Your annual cost to company (CTC) will be Rs. 6,00,000, made up of basic salary, house rent allowance and special allowance.',
    1,
  ),
  clause(
    'c003',
    '2',
    'You agree to serve the Company for a minimum period of twenty-four months. If you resign earlier you shall pay Rs. 2,00,000 as liquidated damages towards training cost.',
    2,
  ),
  clause(
    'c004',
    '3',
    'For twelve months after the termination of your employment, you shall not join any business that competes with the Company.',
    3,
  ),
];

const SENT_IDS = new Set(CLAUSES.map((item) => item.id));

/** Short, unremarkable clauses in bulk, for the batching paths. */
function manyClauses(count: number): Clause[] {
  return Array.from({ length: count }, (_, index) =>
    clause(
      `c${String(index + 1).padStart(3, '0')}`,
      String(index + 1),
      `Clause ${index + 1} sets out an ordinary administrative term of employment.`,
      index,
    ),
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
  return new Request(ANALYZE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function analyzeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clauses: CLAUSES,
    lenses: [],
    language: 'en',
    readingLevel: 'standard',
    ...overrides,
  };
}

async function analyze(body: unknown, env: TestEnv = testEnv()): Promise<Response> {
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
  timeoutMs: number | undefined;
}

/** Raw model output, schema-checked as the real client would, or a failure code. */
type Reply = { raw: unknown } | GeminiFailure;

interface Script {
  calls: ModelCall[];
  /** Most batches the route ever had in flight at once. */
  maxInFlight: () => number;
}

/**
 * Makes the next request use a model whose reply the test scripts.
 *
 * The reply still goes through the route's own Zod schema, exactly as it would from the real
 * client, so a test cannot hand the route a shape the real pipeline would never let through.
 * Replies settle on a later tick, so concurrent batches genuinely overlap.
 */
function scriptModel(reply: (call: ModelCall) => Reply): Script {
  const calls: ModelCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const client: GeminiClient = {
    generate<S extends z.ZodType>(options: GenerateOptions<S>): Promise<GeminiResult<z.infer<S>>> {
      const recorded: ModelCall = {
        systemInstruction: options.systemInstruction,
        userPrompt: options.userPrompt,
        responseSchema: options.responseSchema,
        schema: options.schema,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
      };
      calls.push(recorded);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      const settle = (): GeminiResult<z.infer<S>> => {
        inFlight -= 1;
        const outcome = reply(recorded);
        if (typeof outcome === 'string') return { ok: false, code: outcome };
        const parsed = options.schema.safeParse(outcome.raw);
        if (!parsed.success) return { ok: false, code: 'MODEL_INVALID_OUTPUT' };
        return { ok: true, data: parsed.data };
      };
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(settle());
        }, 0);
      });
    },
  };
  vi.mocked(createGeminiClient).mockReturnValueOnce(client);
  return { calls, maxInFlight: () => maxInFlight };
}

/** A minimal valid model reply, with overrides for the part a test cares about. */
function modelOutput({
  summary = {},
  findings = [],
}: {
  summary?: Record<string, unknown>;
  findings?: Record<string, unknown>[];
} = {}): { raw: unknown } {
  return {
    raw: {
      documentSummary: { overview: 'An offer of employment.', sourceClauseIds: [], ...summary },
      findings,
    },
  };
}

function finding(clauseId: string, quote: string, overrides: Record<string, unknown> = {}) {
  return {
    clauseId,
    category: 'GENERAL',
    risk: 'LOW',
    title: 'A finding',
    explanation: 'What the clause says.',
    whyItMatters: 'Why it matters.',
    quote,
    questionsToAsk: [],
    confidence: 'high',
    ...overrides,
  };
}

/** The first clause id in a batch prompt, so a script can tell batches apart. */
function firstIdIn(prompt: string): string {
  return /\[\[(c\d+)/.exec(prompt)?.[1] ?? '';
}

async function errorCode(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.code;
}

afterEach(() => {
  vi.mocked(createGeminiClient).mockReset();
  vi.useRealTimers();
});

describe('batchClauses', () => {
  it('returns no batches for no clauses, rather than one empty prompt', () => {
    expect(batchClauses([])).toEqual([]);
  });

  it('keeps a document of exactly one batch size in a single batch', () => {
    const batches = batchClauses(manyClauses(LIMITS.clauseBatchSize));
    expect(batches.map((batch) => batch.length)).toEqual([LIMITS.clauseBatchSize]);
  });

  it('starts a second batch for the clause just past the batch size', () => {
    const batches = batchClauses(manyClauses(LIMITS.clauseBatchSize + 1));
    expect(batches.map((batch) => batch.length)).toEqual([LIMITS.clauseBatchSize, 1]);
    expect(batches[1]![0]!.id).toBe('c081');
  });

  it('splits an exact multiple into full batches with no empty remainder', () => {
    const batches = batchClauses(manyClauses(LIMITS.clauseBatchSize * 2));
    expect(batches.map((batch) => batch.length)).toEqual([80, 80]);
  });

  it('keeps every clause, in document order, across several batches', () => {
    const clauses = manyClauses(170);
    const batches = batchClauses(clauses);
    expect(batches.map((batch) => batch.length)).toEqual([80, 80, 10]);
    expect(batches.map((batch) => batch[0]!.id)).toEqual(['c001', 'c081', 'c161']);
    expect(batches.flat()).toEqual(clauses);
  });
});

describe('POST /api/analyze in mock mode', () => {
  it('returns a report whose every finding is about a clause that was actually sent', async () => {
    const response = await analyze(analyzeBody());

    expect(response.status).toBe(200);
    const result = analyzeResponseSchema.parse(await response.json());
    expect(result.findings.length).toBeGreaterThan(0);
    for (const item of result.findings) expect(SENT_IDS.has(item.clauseId)).toBe(true);
  });

  it('gives every finding a verification status, and counts them so they add up', async () => {
    const result = analyzeResponseSchema.parse(await (await analyze(analyzeBody())).json());

    const { verified, fuzzy, unverified } = result.stats;
    expect(verified + fuzzy + unverified).toBe(result.findings.length);
    expect(verified).toBe(
      result.findings.filter((item) => item.evidence.status === 'verified').length,
    );
    // The fixture deliberately misquotes once, so the unverified path is exercised for real.
    expect(unverified).toBeGreaterThan(0);
    for (const item of result.findings) {
      if (item.evidence.status === 'unverified') continue;
      const source = CLAUSES.find((candidate) => candidate.id === item.clauseId)!;
      expect(source.text.slice(item.evidence.start, item.evidence.end)).toBe(item.evidence.quote);
    }
  });

  it('adds the reviewed rule hits for the clauses the model classified', async () => {
    const result = analyzeResponseSchema.parse(await (await analyze(analyzeBody())).json());

    const ruleIds = result.ruleHits.map((hit) => hit.ruleId);
    expect(ruleIds).toContain('IN-EMP-BOND');
    expect(ruleIds).toContain('IN-EMP-NONCOMPETE-POST');
    const bond = result.ruleHits.find((hit) => hit.ruleId === 'IN-EMP-BOND')!;
    expect(bond.clauseId).toBe('c003');
    expect(bond.severity).toBe('HIGH');
    for (const hit of result.ruleHits) expect(SENT_IDS.has(hit.clauseId)).toBe(true);
  });

  it('reports what the document never says', async () => {
    const result = analyzeResponseSchema.parse(await (await analyze(analyzeBody())).json());

    const gaps = result.missingInfo.map((gap) => gap.ruleId);
    expect(gaps).toContain('IN-EMP-MISSING-NOTICE');
    expect(gaps).toContain('IN-EMP-MISSING-LEAVE');
    expect(gaps).not.toContain('IN-EMP-MISSING-SALARY');
  });

  it('lists the most serious findings first', async () => {
    const result = analyzeResponseSchema.parse(await (await analyze(analyzeBody())).json());

    const weights = result.findings.map((item) => RISK_ORDER[item.risk]);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(result.findings[0]!.risk).toBe('HIGH');
  });

  it('summarises the document, citing only clauses that were sent', async () => {
    const result = analyzeResponseSchema.parse(await (await analyze(analyzeBody())).json());

    expect(result.documentSummary.employer).toBe('Acme Technologies Private Limited');
    expect(result.documentSummary.overview.length).toBeGreaterThan(0);
    for (const id of result.documentSummary.sourceClauseIds) expect(SENT_IDS.has(id)).toBe(true);
  });

  it('reports the remaining budget in the rate-limit headers', async () => {
    const response = await analyze(analyzeBody());
    expect(response.headers.get('RateLimit-Limit')).toBe('8');
    expect(response.headers.get('RateLimit-Remaining')).toBe('7');
  });
});

describe('POST /api/analyze with a scripted model', () => {
  it('asks the model with the analyze prompt, schema, temperature and token budget', async () => {
    const script = scriptModel(() => modelOutput());
    await analyze(analyzeBody({ lenses: ['QUIT_EARLY'], language: 'hi' }), liveEnv());

    expect(script.calls).toHaveLength(1);
    const sent = script.calls[0]!;
    expect(sent.systemInstruction).toBe(
      analyzeSystemPrompt({ language: 'hi', readingLevel: 'standard' }, ['QUIT_EARLY']),
    );
    expect(sent.userPrompt).toBe(analyzeUserPrompt(CLAUSES));
    expect(sent.responseSchema).toBe(ANALYZE_SCHEMA);
    expect(sent.schema).toBe(analyzeModelOutputSchema);
    expect(sent.temperature).toBe(0.2);
    expect(sent.maxOutputTokens).toBe(8192);
    // Reading a whole document takes longer than answering one question about it.
    expect(sent.timeoutMs).toBe(45_000);
  });

  it('drops a finding about a clause id that was never sent, since there is nothing to check it against', async () => {
    scriptModel(() =>
      modelOutput({
        findings: [
          finding('c004', 'you shall not join any business that competes with the Company', {
            category: 'NON_COMPETE',
            risk: 'HIGH',
          }),
          finding('c999', 'you shall pay Rs. 10,00,000 if you ever leave', {
            category: 'BOND_OR_EXIT_PENALTY',
            risk: 'HIGH',
          }),
        ],
      }),
    );
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody(), liveEnv())).json(),
    );

    expect(result.findings.map((item) => item.clauseId)).toEqual(['c004']);
    expect(result.findings[0]!.evidence.status).toBe('verified');
    expect(result.stats).toEqual({ verified: 1, fuzzy: 0, unverified: 0 });
  });

  it('keeps a finding whose quote is not in its clause, but marks it unverified', async () => {
    scriptModel(() =>
      modelOutput({
        findings: [finding('c002', 'you will receive a joining bonus of Rs. 1,00,000')],
      }),
    );
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody(), liveEnv())).json(),
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.evidence).toEqual({
      clauseId: 'c002',
      quote: 'you will receive a joining bonus of Rs. 1,00,000',
      status: 'unverified',
    });
    expect(result.stats).toEqual({ verified: 0, fuzzy: 0, unverified: 1 });
  });

  it('filters invented clause ids out of the summary and turns missing fields into null', async () => {
    scriptModel(() =>
      modelOutput({
        summary: {
          employer: 'Acme Technologies Private Limited',
          role: null,
          overview: 'An offer of employment.',
          sourceClauseIds: ['c001', 'c404', 'c002', 'not-an-id'],
        },
      }),
    );
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody(), liveEnv())).json(),
    );

    expect(result.documentSummary).toEqual({
      documentType: null,
      employer: 'Acme Technologies Private Limited',
      role: null,
      startDate: null,
      noticePeriod: null,
      probation: null,
      bondOrPenalty: null,
      overview: 'An offer of employment.',
      sourceClauseIds: ['c001', 'c002'],
    });
  });

  it('returns an empty summary when no batch produced an overview', async () => {
    scriptModel(() => modelOutput({ summary: { overview: '', employer: 'Ignored Ltd' } }));
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody(), liveEnv())).json(),
    );

    expect(result.documentSummary).toEqual({
      documentType: null,
      employer: null,
      role: null,
      startDate: null,
      noticePeriod: null,
      probation: null,
      bondOrPenalty: null,
      overview: '',
      sourceClauseIds: [],
    });
  });

  it('takes the summary from the first batch that wrote one, which saw the start of the document', async () => {
    scriptModel((sent) =>
      firstIdIn(sent.userPrompt) === 'c001'
        ? modelOutput({ summary: { overview: 'From the first batch.', employer: 'First Ltd' } })
        : modelOutput({ summary: { overview: 'From the second batch.', employer: 'Second Ltd' } }),
    );
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody({ clauses: manyClauses(81) }), liveEnv())).json(),
    );

    expect(result.documentSummary.overview).toBe('From the first batch.');
    expect(result.documentSummary.employer).toBe('First Ltd');
  });

  it('falls back to a later batch for the summary when the first wrote no overview', async () => {
    scriptModel((sent) =>
      firstIdIn(sent.userPrompt) === 'c001'
        ? modelOutput({ summary: { overview: '' } })
        : modelOutput({ summary: { overview: 'From the second batch.' } }),
    );
    const result = analyzeResponseSchema.parse(
      await (await analyze(analyzeBody({ clauses: manyClauses(81) }), liveEnv())).json(),
    );

    expect(result.documentSummary.overview).toBe('From the second batch.');
  });

  it('sends a long document in batches, each carrying only its own clauses', async () => {
    const script = scriptModel(() => modelOutput());
    await analyze(analyzeBody({ clauses: manyClauses(81) }), liveEnv());

    expect(script.calls).toHaveLength(2);
    expect(script.calls[0]!.userPrompt).toContain('[[c080 ');
    expect(script.calls[0]!.userPrompt).not.toContain('[[c081 ');
    expect(script.calls[1]!.userPrompt).toContain('[[c081 ');
    expect(script.calls[1]!.userPrompt).not.toContain('[[c001 ');
  });

  it('never has more than four batches in flight, because Workers cap subrequests', async () => {
    const script = scriptModel(() => modelOutput());
    const response = await analyze(analyzeBody({ clauses: manyClauses(330) }), liveEnv());

    expect(response.status).toBe(200);
    expect(script.calls).toHaveLength(5);
    expect(script.maxInFlight()).toBe(LIMITS.maxParallelBatches);
  });

  it("returns the first batch's failure code when every batch fails", async () => {
    scriptModel((sent) =>
      firstIdIn(sent.userPrompt) === 'c001' ? 'MODEL_BLOCKED' : 'UPSTREAM_TIMEOUT',
    );
    const response = await analyze(analyzeBody({ clauses: manyClauses(81) }), liveEnv());

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('MODEL_BLOCKED');
    expect(response.headers.get('RateLimit-Limit')).toBe('8');
  });

  it('returns 502 MODEL_INVALID_OUTPUT when a single batch comes back malformed', async () => {
    scriptModel(() => ({ raw: { findings: 'none' } }));
    const response = await analyze(analyzeBody(), liveEnv());

    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('MODEL_INVALID_OUTPUT');
  });

  it('returns what the successful batches found when only some batches fail', async () => {
    scriptModel((sent) => {
      const first = firstIdIn(sent.userPrompt);
      if (first !== 'c001') return 'UPSTREAM_TIMEOUT';
      return modelOutput({
        findings: [finding('c001', 'sets out an ordinary administrative term of employment')],
      });
    });
    const response = await analyze(analyzeBody({ clauses: manyClauses(81) }), liveEnv());

    expect(response.status).toBe(200);
    const result = analyzeResponseSchema.parse(await response.json());
    expect(result.findings.map((item) => item.clauseId)).toEqual(['c001']);
    expect(result.findings[0]!.evidence.status).toBe('verified');
  });
});

describe('POST /api/analyze refusals', () => {
  it('returns 401 without a session token and never reaches the model', async () => {
    const response = await call({ request: request(analyzeBody()), env: testEnv() });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('UNAUTHORIZED');
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 500 rather than trusting any token when the session secret is missing', async () => {
    const response = await call({
      request: request(analyzeBody(), { authorization: await bearer() }),
      env: testEnv({ SESSION_SECRET: '' }),
    });
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe('INTERNAL');
  });

  it('returns 400 for a body that is not JSON', async () => {
    const response = await analyze('not json at all');
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_INPUT');
  });

  it.each([
    ['an unknown lens', analyzeBody({ lenses: ['EVERYTHING', 'LOTTERY'] })],
    ['a malformed clause id', analyzeBody({ clauses: [clause('clause-1', null, 'Text.', 0)] })],
    ['duplicate clause ids', analyzeBody({ clauses: [CLAUSES[0], CLAUSES[0]] })],
    ['too many clauses', analyzeBody({ clauses: manyClauses(LIMITS.maxClauses + 1) })],
  ])('returns 400 for a body with %s, before any model call', async (_label, body) => {
    const response = await analyze(body);
    expect(response.status).toBe(400);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After on the ninth analysis in an hour, without calling the model', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const env = testEnv();

    for (let index = 0; index < 8; index += 1) {
      expect((await analyze(analyzeBody(), env)).status).toBe(200);
    }
    vi.mocked(createGeminiClient).mockClear();

    const limited = await analyze(analyzeBody(), env);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });
});

describe('mapWithLimit', () => {
  /** A task that finishes only when the test says so, recording when it started. */
  function controllable() {
    const started: number[] = [];
    const finish = new Map<number, (value: string) => void>();
    const run = (item: number) =>
      new Promise<string>((resolve) => {
        started.push(item);
        finish.set(item, resolve);
      });
    const release = async (item: number) => {
      finish.get(item)?.(`done ${String(item)}`);
      // Let the freed worker pick up its next item.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { started, run, release };
  }

  it('returns nothing for no items, without starting any work', async () => {
    const run = vi.fn(() => Promise.resolve('unused'));
    expect(await mapWithLimit([], 4, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('never runs more than the limit at once', async () => {
    const { started, run, release } = controllable();
    const pending = mapWithLimit([1, 2, 3, 4, 5, 6], 4, run);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 2, 3, 4]);

    for (const item of [1, 2, 3, 4, 5, 6]) await release(item);
    await pending;
  });

  it('starts the next item as soon as any one finishes, not when the slowest does', async () => {
    const { started, run, release } = controllable();
    const pending = mapWithLimit([1, 2, 3, 4, 5], 4, run);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Item 1 is slow. Item 2 finishing is enough for item 5 to start.
    await release(2);
    expect(started).toEqual([1, 2, 3, 4, 5]);

    for (const item of [1, 3, 4, 5]) await release(item);
    await pending;
  });

  it('returns results in input order, whatever order they finish in', async () => {
    const { run, release } = controllable();
    const pending = mapWithLimit([1, 2, 3], 2, run);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await release(2);
    await release(3);
    await release(1);
    expect(await pending).toEqual(['done 1', 'done 2', 'done 3']);
  });
});
