import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, analyzeDocument, clearCachedResponses, resetAiCallBudget } from './client';

/**
 * The schemas arrive in their own chunk on the first API call. This file makes that chunk fail
 * to load, the way it does when the connection drops or a deploy has replaced it.
 */
vi.mock('@shared/schemas', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

const INPUT = {
  clauses: [
    {
      id: 'c001',
      label: '1',
      heading: 'Notice',
      text: 'Either party may give thirty days notice.',
      page: 1,
      pageEnd: 1,
      order: 0,
    },
  ],
  lenses: [],
  language: 'en',
  readingLevel: 'standard',
} as const;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  clearCachedResponses();
  resetAiCallBudget();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the request to fail, but it succeeded');
}

describe('when the schema chunk cannot load', () => {
  it('reports a retryable failure instead of a raw import error', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const error = await failure(analyzeDocument('token', INPUT));
    expect(error.code).toBe('INTERNAL');
    expect(error.retryable).toBe(true);
  });

  it('still reports the network failure alone when the request fails too, with nothing left unhandled', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await failure(analyzeDocument('token', INPUT));
    expect(error.code).toBe('INTERNAL');
    // Vitest fails the run on an unhandled rejection, which is what the ignored load would be.
  });
});
