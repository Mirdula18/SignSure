import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { parseFile, parseText } from './parseDocument';

const CLAUSE_TEXT =
  '1. The Employee shall give ninety (90) days written notice of resignation to the Company.';

describe('parseText', () => {
  it('segments pasted text into clauses', () => {
    const result = parseText(CLAUSE_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.clauses).toHaveLength(1);
    expect(result.document.source).toBe('paste');
    expect(result.document.fileName).toBeNull();
    expect(result.document.pageCount).toBeNull();
  });

  it('records the character count used for the payload limit', () => {
    const result = parseText(CLAUSE_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.charCount).toBe(CLAUSE_TEXT.length);
  });

  it('marks the built-in sample as its own source, so the UI can label it', () => {
    const result = parseText(CLAUSE_TEXT, 'sample');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.source).toBe('sample');
  });

  it.each(['', '   \n\t  '])('reports no readable text for %j', (text) => {
    const result = parseText(text);
    expect(result).toEqual({ ok: false, reason: 'NO_TEXT' });
  });

  it('refuses text over the total character budget and says by how much', () => {
    const huge = `1. ${'word '.repeat(LIMITS.maxTotalChars / 4)}`;
    const result = parseText(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('TOO_MUCH_TEXT');
    expect(result.detail?.limit).toBe(LIMITS.maxTotalChars);
  });
});

describe('parseFile', () => {
  it('parses a .txt file and keeps its name', async () => {
    const file = new File([CLAUSE_TEXT], 'offer.txt', { type: 'text/plain' });
    const result = await parseFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.source).toBe('txt');
    expect(result.document.fileName).toBe('offer.txt');
  });

  it('passes a guard rejection straight through with its detail intact', async () => {
    const file = new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46])], 'malware.pdf');
    const result = await parseFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONTENT_MISMATCH');
    expect(result.detail?.claimed).toBe('PDF');
  });

  it('rejects an unsupported type before loading any parser', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const result = await parseFile(file);
    expect(result).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
      detail: { extension: '.png' },
    });
  });

  it('reports a text file with nothing readable in it', async () => {
    const file = new File(['   \n  \n'], 'blank.txt', { type: 'text/plain' });
    const result = await parseFile(file);
    expect(result).toEqual({ ok: false, reason: 'NO_TEXT' });
  });
});
