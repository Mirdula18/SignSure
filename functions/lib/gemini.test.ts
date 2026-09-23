import type { GenerateContentParameters } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelId, type Env } from './env';
import {
  clearResponseCache,
  createGeminiClient,
  REQUEST_TIMEOUT_MS,
  stripCodeFence,
  type GenerateOptions,
  type MockResponder,
} from './gemini';

/** The only part of a Gemini response the client reads. */
interface FakeResponse {
  text: string | undefined;
}

/**
 * Stand-in for the SDK. The client only ever does `new GoogleGenAI({ apiKey })` and calls
 * `models.generateContent`, so that is all the fake implements, and it records both.
 */
const genai = vi.hoisted(() => {
  const constructedWith: unknown[] = [];
  return {
    constructedWith,
    generateContent: vi.fn<(params: GenerateContentParameters) => Promise<FakeResponse>>(),
  };
});

vi.mock('@google/genai', () => ({
  // The client maps its ladder through this enum, so the fake module carries it as well.
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
  GoogleGenAI: class {
    readonly models = { generateContent: genai.generateContent };

    constructor(options: unknown) {
      genai.constructedWith.push(options);
    }
  },
}));

const schema = z.object({ answer: z.string() });

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' } },
  required: ['answer'],
};

const OPTIONS: GenerateOptions<typeof schema> = {
  systemInstruction: 'You are a unit test.',
  userPrompt: '<document>\n[[c001]] Either party may give thirty days notice.\n</document>',
  responseSchema: RESPONSE_SCHEMA,
  schema,
  temperature: 0.2,
  maxOutputTokens: 256,
};

const API_KEY = 'unit-test-gemini-key';
const LIVE: Env = { GEMINI_API_KEY: API_KEY };

const VALID = '{"answer":"Thirty days."}';

function reply(text: string | undefined): FakeResponse {
  return { text };
}

/**
 * Runs a generate call to completion under fake timers.
 *
 * The live client sleeps 400-800 ms between attempts; draining the timer queue keeps the retry
 * paths honest without making the suite wait for real.
 */
async function settle<T>(pending: Promise<T>): Promise<T> {
  let settled = false;
  const mark = () => {
    settled = true;
  };
  pending.then(mark, mark);
  // The retry timers only exist once the cache key has been hashed, so drain until done.
  while (!settled) {
    await vi.runAllTimersAsync();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return pending;
}

/**
 * Waits, on the real clock, until the first request reaches the SDK. Deadlines and backoff are
 * measured from there, and the cache key is hashed before it, so advancing the fake clock any
 * earlier would move time before the timers it is meant to test even exist.
 */
async function untilSent(): Promise<void> {
  while (genai.generateContent.mock.calls.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function live(env: Env = LIVE) {
  return createGeminiClient(env);
}

beforeEach(() => {
  clearResponseCache();
  genai.generateContent.mockReset();
  genai.constructedWith.length = 0;
});

describe('stripCodeFence', () => {
  it('removes a ```json fence, which models add despite being asked for raw JSON', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes a plain ``` fence with no language tag', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('tolerates whitespace around the fence and on the same line as the JSON', () => {
    expect(stripCodeFence('  ```json {"a":1} ```  \n')).toBe('{"a":1}');
  });

  it('leaves plain JSON untouched', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('leaves commentary around a fence alone, so it fails parsing instead of being half-read', () => {
    const text = 'Here is the JSON:\n```json\n{"a":1}\n```';
    expect(stripCodeFence(text)).toBe(text);
  });
});

describe('createGeminiClient in mock mode', () => {
  const MOCK: Env = { MOCK_GEMINI: 'true' };

  it('fails with INTERNAL when no fixture responder was supplied, rather than inventing output', async () => {
    expect(await createGeminiClient(MOCK).generate(OPTIONS)).toEqual({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('fails with MODEL_INVALID_OUTPUT when the fixture does not match the schema', async () => {
    const responder: MockResponder = () => ({ answer: 42 });
    expect(await createGeminiClient(MOCK, responder).generate(OPTIONS)).toEqual({
      ok: false,
      code: 'MODEL_INVALID_OUTPUT',
    });
  });

  it('returns the parsed fixture when it matches the schema', async () => {
    const responder: MockResponder = () => ({ answer: 'Thirty days.', extra: 'stripped' });
    expect(await createGeminiClient(MOCK, responder).generate(OPTIONS)).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
  });

  it('hands the fixture exactly the two prompts, which is all it needs to route', async () => {
    const responder = vi.fn<MockResponder>(() => ({ answer: 'ok' }));
    await createGeminiClient(MOCK, responder).generate(OPTIONS);
    expect(responder).toHaveBeenCalledWith({
      systemInstruction: OPTIONS.systemInstruction,
      userPrompt: OPTIONS.userPrompt,
    });
  });

  it('never constructs the live SDK, even when a key happens to be configured', async () => {
    const responder: MockResponder = () => ({ answer: 'ok' });
    await createGeminiClient({ ...MOCK, GEMINI_API_KEY: API_KEY }, responder).generate(OPTIONS);
    expect(genai.constructedWith).toEqual([]);
    expect(genai.generateContent).not.toHaveBeenCalled();
  });
});

describe('createGeminiClient in live mode', () => {
  beforeEach(() => {
    // Only the clock the client sleeps on. setImmediate stays real so settle() can yield to the
    // cache-key hash, which Web Crypto computes outside the fake clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['unset', {}],
    ['blank', { GEMINI_API_KEY: '' }],
  ])(
    'fails with INTERNAL when the API key is %s, without constructing the SDK',
    async (_label, env: Env) => {
      expect(await settle(live(env).generate(OPTIONS))).toEqual({ ok: false, code: 'INTERNAL' });
      expect(genai.constructedWith).toEqual([]);
    },
  );

  it('constructs the SDK with the key from env, and nothing else', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));
    await settle(live().generate(OPTIONS));
    expect(genai.constructedWith).toEqual([{ apiKey: API_KEY }]);
  });

  it('asks for JSON against the response schema, with the temperature and budget it was given', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));
    await settle(live().generate(OPTIONS));

    expect(genai.generateContent).toHaveBeenCalledTimes(1);
    const params = genai.generateContent.mock.calls[0]![0];
    expect(params.model).toBe(modelId(LIVE));
    expect(params.contents).toEqual([{ role: 'user', parts: [{ text: OPTIONS.userPrompt }] }]);
    expect(params.config?.systemInstruction).toBe(OPTIONS.systemInstruction);
    expect(params.config?.responseMimeType).toBe('application/json');
    expect(params.config?.responseSchema).toBe(RESPONSE_SCHEMA);
    expect(params.config?.temperature).toBe(0.2);
    expect(params.config?.maxOutputTokens).toBe(256);
    expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('asks for minimal thinking, because every call is structured extraction', async () => {
    // Measured on 2026-09-23: left to think freely, a whole-document analysis passed the
    // request deadline every time, while a single question came back in about seven seconds.
    genai.generateContent.mockResolvedValue(reply(VALID));
    await settle(live().generate(OPTIONS));
    expect(genai.generateContent.mock.calls[0]![0].config?.thinkingConfig).toEqual({
      thinkingLevel: 'MINIMAL',
    });
  });

  it('steps down to LOW when a model refuses MINIMAL, and remembers it', async () => {
    // gemini-3.7-flash answers 400 "Thinking level MINIMAL is not supported for this model".
    const refusal = new Error('[400 Bad Request] Thinking level MINIMAL is not supported');
    genai.generateContent.mockRejectedValueOnce(refusal).mockResolvedValue(reply(VALID));
    const client = live();

    expect(await settle(client.generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent.mock.calls[1]![0].config?.thinkingConfig).toEqual({
      thinkingLevel: 'LOW',
    });

    // The next call starts where the last one left off rather than paying for the refusal again.
    // A different question, so it reaches the model instead of the response cache.
    await settle(client.generate({ ...OPTIONS, userPrompt: `${OPTIONS.userPrompt}\nProbation?` }));
    expect(genai.generateContent.mock.calls[2]![0].config?.thinkingConfig).toEqual({
      thinkingLevel: 'LOW',
    });
  });

  it('drops the hint entirely when every level is refused, rather than failing the request', async () => {
    const refusal = new Error('INVALID_ARGUMENT: thinking_level is not supported');
    genai.generateContent
      .mockRejectedValueOnce(refusal)
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce(reply(VALID));

    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(3);
    expect(genai.generateContent.mock.calls[2]![0].config?.thinkingConfig).toBeUndefined();
  });

  it('leaves the decision to the model when GEMINI_THINKING is auto', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));
    await settle(live({ ...LIVE, GEMINI_THINKING: 'auto' }).generate(OPTIONS));
    expect(genai.generateContent.mock.calls[0]![0].config?.thinkingConfig).toBeUndefined();
  });

  it('gives a call its own deadline when one is asked for, as analyze does', async () => {
    genai.generateContent.mockImplementation(
      (params) =>
        new Promise<FakeResponse>((_resolve, reject) => {
          params.config?.abortSignal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    let settled = false;
    const pending = live()
      .generate({ ...OPTIONS, timeoutMs: 45_000 })
      .finally(() => {
        settled = true;
      });

    // Still waiting where the default deadline would already have given up.
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(await pending).toEqual({ ok: false, code: 'UPSTREAM_TIMEOUT' });
  });

  it('calls the model named in GEMINI_MODEL when one is configured', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));
    await settle(live({ ...LIVE, GEMINI_MODEL: 'gemini-test-model' }).generate(OPTIONS));
    expect(genai.generateContent.mock.calls[0]![0].model).toBe('gemini-test-model');
  });

  it('returns the parsed data when the model answers with valid JSON', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
  });

  it('accepts JSON wrapped in a ```json fence on the first attempt', async () => {
    genai.generateContent.mockResolvedValue(reply(`\`\`\`json\n${VALID}\n\`\`\``));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n '],
    ['missing', undefined],
  ])(
    'reports MODEL_BLOCKED for %s text and does not retry, since a safety block will not change',
    async (_label, text) => {
      genai.generateContent.mockResolvedValue(reply(text));
      expect(await settle(live().generate(OPTIONS))).toEqual({
        ok: false,
        code: 'MODEL_BLOCKED',
      });
      expect(genai.generateContent).toHaveBeenCalledTimes(1);
    },
  );

  it('fails with MODEL_INVALID_OUTPUT only after a retry and a repair attempt all return junk', async () => {
    genai.generateContent.mockResolvedValue(reply('Sure! The notice period is thirty days.'));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: false,
      code: 'MODEL_INVALID_OUTPUT',
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(3);
  });

  it('adds a JSON-only reminder to the prompt for the repair attempt, and only for that one', async () => {
    genai.generateContent.mockResolvedValue(reply('not json'));
    await settle(live().generate(OPTIONS));

    const prompts = genai.generateContent.mock.calls.map(([params]) =>
      JSON.stringify(params.contents),
    );
    expect(prompts[0]).not.toContain('Return valid JSON only');
    expect(prompts[1]).not.toContain('Return valid JSON only');
    expect(prompts[2]).toContain('Return valid JSON only');
  });

  it('treats JSON that fails the Zod schema exactly like unparseable text', async () => {
    genai.generateContent.mockResolvedValue(reply('{"answer":7}'));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: false,
      code: 'MODEL_INVALID_OUTPUT',
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(3);
  });

  it('recovers when the retry after one unparseable reply comes back valid', async () => {
    genai.generateContent
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply(VALID));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(2);
  });

  it('recovers when only the repair attempt comes back valid', async () => {
    genai.generateContent
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply('still not json'))
      .mockResolvedValueOnce(reply(VALID));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a 503 from the API', new Error('got status: 503 Service Unavailable')],
    ['an overloaded model', new Error('The model is overloaded. Please try again later.')],
    ['a rate-limit message', new Error('Rate limit exceeded for this project')],
    ['a non-Error rejection', 'upstream unavailable'],
  ])('retries once after %s and returns the second answer', async (_label, failure) => {
    genai.generateContent.mockRejectedValueOnce(failure).mockResolvedValueOnce(reply(VALID));
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a 429', new Error('[429 Too Many Requests] RESOURCE_EXHAUSTED')],
    ['a quota message', new Error('You exceeded your current quota, please check your plan')],
  ])(
    'reports %s as RATE_LIMITED at once, without spending another call',
    async (_label, failure) => {
      // Found by a live eval run against an exhausted free tier: the reader was told "something
      // went wrong" after two calls, when the truth was "wait and try again".
      genai.generateContent.mockRejectedValue(failure);
      expect(await settle(live().generate(OPTIONS))).toEqual({ ok: false, code: 'RATE_LIMITED' });
      expect(genai.generateContent).toHaveBeenCalledTimes(1);
    },
  );

  it('waits between a transient failure and its retry, so retries do not hammer the API', async () => {
    genai.generateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce(reply(VALID));
    const pending = live().generate(OPTIONS);

    await untilSent();
    await vi.advanceTimersByTimeAsync(399);
    expect(genai.generateContent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(401);
    expect(genai.generateContent).toHaveBeenCalledTimes(2);
    expect((await pending).ok).toBe(true);
  });

  it('gives up with INTERNAL after two transient failures, with no repair attempt', async () => {
    genai.generateContent.mockRejectedValue(new Error('503 Service Unavailable'));
    expect(await settle(live().generate(OPTIONS))).toEqual({ ok: false, code: 'INTERNAL' });
    expect(genai.generateContent).toHaveBeenCalledTimes(2);
  });

  it('fails straight away with INTERNAL on an error retrying cannot fix, such as a bad key', async () => {
    genai.generateContent.mockRejectedValue(new Error('[400 Bad Request] API key not valid.'));
    expect(await settle(live().generate(OPTIONS))).toEqual({ ok: false, code: 'INTERNAL' });
    expect(genai.generateContent).toHaveBeenCalledTimes(1);
  });

  it('never leaks the upstream error message into the result', async () => {
    genai.generateContent.mockRejectedValue(new Error(`bad key ${API_KEY}`));
    const result = await settle(live().generate(OPTIONS));
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it('aborts a slow request after REQUEST_TIMEOUT_MS and reports UPSTREAM_TIMEOUT without retrying', async () => {
    genai.generateContent.mockImplementation(
      (params) =>
        new Promise<FakeResponse>((_resolve, reject) => {
          params.config?.abortSignal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    let settled = false;
    const pending = live()
      .generate(OPTIONS)
      .finally(() => {
        settled = true;
      });

    await untilSent();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, code: 'UPSTREAM_TIMEOUT' });
    expect(genai.generateContent).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout at the 25 seconds documented in docs/AI_PIPELINE.md', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(25_000);
  });
});

describe('the live client response cache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers an identical request without calling Gemini again, even from a new client', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));

    const first = await settle(live().generate(OPTIONS));
    const second = await settle(live().generate(OPTIONS));

    expect(second).toEqual(first);
    expect(genai.generateContent).toHaveBeenCalledTimes(1);
  });

  it('sends identical requests that arrive together as one call', async () => {
    genai.generateContent.mockResolvedValue(reply(VALID));

    const results = await settle(Promise.all([live().generate(OPTIONS), live().generate(OPTIONS)]));

    expect(results[0]).toEqual({ ok: true, data: { answer: 'Thirty days.' } });
    expect(results[1]).toEqual(results[0]);
    expect(genai.generateContent).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure, so the next reader gets a fresh attempt', async () => {
    genai.generateContent
      .mockRejectedValueOnce(new Error('[403] API key not valid'))
      .mockResolvedValueOnce(reply(VALID));

    expect(await settle(live().generate(OPTIONS))).toEqual({ ok: false, code: 'INTERNAL' });
    expect(await settle(live().generate(OPTIONS))).toEqual({
      ok: true,
      data: { answer: 'Thirty days.' },
    });
    expect(genai.generateContent).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Partial<GenerateOptions<typeof schema>>, Env]>([
    ['a different document or question', { userPrompt: 'Another letter.' }, LIVE],
    ['a different language or reading level', { systemInstruction: 'Answer in Hindi.' }, LIVE],
    ['a different output budget', { maxOutputTokens: 512 }, LIVE],
    ['a different model', {}, { ...LIVE, GEMINI_MODEL: 'gemini-other-flash' }],
  ])('treats %s as a new request', async (_label, change, env) => {
    genai.generateContent.mockResolvedValue(reply(VALID));

    await settle(live().generate(OPTIONS));
    await settle(live(env).generate({ ...OPTIONS, ...change }));

    expect(genai.generateContent).toHaveBeenCalledTimes(2);
  });
});
