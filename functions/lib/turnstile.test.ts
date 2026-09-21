import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's documented always-pass test secret, which the module short-circuits. */
const ALWAYS_PASS_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Any other secret, so the request really goes to (our stand-in for) siteverify. */
const SECRET = 'unit-test-turnstile-secret';
const TOKEN = 'turnstile-response-token';
const IP = '203.0.113.7';

type Fetch = typeof fetch;

/** Replaces the global fetch for one test, so no test can reach the real network. */
function stubFetch(respond: Fetch) {
  const fetchMock = vi.fn<Fetch>(respond);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function siteverify(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** The form the module posted, so a test can read exactly which fields were sent. */
function sentForm(fetchMock: ReturnType<typeof stubFetch>): FormData {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  expect(body).toBeInstanceOf(FormData);
  return body as FormData;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('verifyTurnstile without a usable secret', () => {
  it.each([
    ['unset', undefined],
    ['blank', ''],
  ])(
    'reports NOT_CONFIGURED when the secret is %s, and never calls siteverify',
    async (_label, secret) => {
      const fetchMock = stubFetch(() => siteverify({ success: true }));
      expect(await verifyTurnstile(TOKEN, secret, IP)).toEqual({
        ok: false,
        reason: 'NOT_CONFIGURED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('passes the documented always-pass test secret without a network round-trip', async () => {
    // Cloudflare itself passes every token for this key, so skipping the call changes nothing
    // except making the end-to-end suite hermetic.
    const fetchMock = stubFetch(() => siteverify({ success: false }));
    expect(await verifyTurnstile(TOKEN, ALWAYS_PASS_TEST_SECRET, IP)).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifyTurnstile against siteverify', () => {
  it('accepts a token siteverify reports as a success', async () => {
    stubFetch(() => siteverify({ success: true, 'error-codes': [] }));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual({ ok: true });
  });

  it('rejects a token siteverify reports as a failure', async () => {
    stubFetch(() => siteverify({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual({ ok: false, reason: 'REJECTED' });
  });

  it('never passes Cloudflare error codes on to the caller, so a script cannot tune itself', async () => {
    stubFetch(() => siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(JSON.stringify(await verifyTurnstile(TOKEN, SECRET, IP))).not.toContain('timeout');
  });

  it('posts the secret and the token to the siteverify endpoint', async () => {
    const fetchMock = stubFetch(() => siteverify({ success: true }));
    await verifyTurnstile(TOKEN, SECRET, IP);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const form = sentForm(fetchMock);
    expect(form.get('secret')).toBe(SECRET);
    expect(form.get('response')).toBe(TOKEN);
  });

  it('sends the client IP as remoteip when the edge reported one', async () => {
    const fetchMock = stubFetch(() => siteverify({ success: true }));
    await verifyTurnstile(TOKEN, SECRET, IP);
    expect(sentForm(fetchMock).get('remoteip')).toBe(IP);
  });

  it('omits remoteip when the IP is unknown, rather than sending the placeholder', async () => {
    const fetchMock = stubFetch(() => siteverify({ success: true }));
    await verifyTurnstile(TOKEN, SECRET, 'unknown');
    expect(sentForm(fetchMock).has('remoteip')).toBe(false);
  });
});

describe('verifyTurnstile failing closed', () => {
  // Turnstile is the control that stops unbounded spend, so every failure to get a clear answer
  // must refuse the session rather than wave it through.
  const UNREACHABLE = { ok: false, reason: 'UNREACHABLE' };

  it.each([500, 503, 403])('treats an HTTP %i from siteverify as unreachable', async (status) => {
    stubFetch(() => siteverify({ success: true }, status));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual(UNREACHABLE);
  });

  it('treats a body that is not JSON as unreachable', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 200 })));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual(UNREACHABLE);
  });

  it.each([
    ['a string success flag', { success: 'true' }],
    ['no success flag at all', { 'error-codes': [] }],
    ['JSON null', null],
    ['a bare boolean', true],
  ])('treats a JSON body with %s as unreachable, not as a pass', async (_label, body) => {
    stubFetch(() => siteverify(body));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual(UNREACHABLE);
  });

  it('treats a network error as unreachable', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await verifyTurnstile(TOKEN, SECRET, IP)).toEqual(UNREACHABLE);
  });

  it('gives up after eight seconds, because a user is waiting on the other end', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    let settled = false;
    const pending = verifyTurnstile(TOKEN, SECRET, IP).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(UNREACHABLE);
  });
});
