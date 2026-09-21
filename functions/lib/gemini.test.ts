import type { GenerateContentParameters } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelId, type Env } from './env';
import {
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
  await vi.runAllTimersAsync();
  return pending;
}

function live(env: Env = LIVE) {
  return createGeminiClient(env);
}

beforeEach(() => {
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
    vi.useFakeTimers();
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
    ['a 429 quota error', new Error('[429 Too Many Requests] RESOURCE_EXHAUSTED')],
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

  it('waits between a transient failure and its retry, so retries do not hammer the API', async () => {
    genai.generateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce(reply(VALID));
    const pending = live().generate(OPTIONS);

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
