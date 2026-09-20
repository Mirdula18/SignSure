import { describe, expect, it } from 'vitest';
import { isMockMode, modelId, type Env } from './env';

describe('isMockMode', () => {
  it('is on only for the exact string "true"', () => {
    expect(isMockMode({ MOCK_GEMINI: 'true' })).toBe(true);
    expect(isMockMode({ MOCK_GEMINI: 'TRUE' })).toBe(false);
    expect(isMockMode({ MOCK_GEMINI: '1' })).toBe(false);
    expect(isMockMode({})).toBe(false);
  });
});

describe('modelId', () => {
  it('uses the configured model', () => {
    expect(modelId({ GEMINI_MODEL: 'gemini-3.8-flash-lite' })).toBe('gemini-3.8-flash-lite');
  });

  it('trims surrounding whitespace from the var', () => {
    expect(modelId({ GEMINI_MODEL: '  gemini-3.8-flash  ' })).toBe('gemini-3.8-flash');
  });

  it('falls back to a current stable Flash model when unset or blank', () => {
    const fallback = 'gemini-3.8-flash';
    expect(modelId({})).toBe(fallback);
    expect(modelId({ GEMINI_MODEL: '' })).toBe(fallback);
    expect(modelId({ GEMINI_MODEL: '   ' })).toBe(fallback);
  });

  it('never reads a secret', () => {
    const env: Env = { GEMINI_API_KEY: 'AIzaNOTAREALKEY', GEMINI_MODEL: 'm' };
    expect(modelId(env)).not.toContain('AIza');
  });
});
