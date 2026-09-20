import { describe, expect, it } from 'vitest';
import { linesFromTextItems, PdfParseError } from './pdfParser';

/**
 * `linesFromTextItems` is tested directly rather than through pdf.js, because the whole point of
 * this function is to rebuild lines from the positioned fragments pdf.js hands back, and those
 * fragments are easy to state exactly and impossible to control through a real file.
 */
function item(str: string, y: number, hasEOL = false) {
  return { str, hasEOL, transform: [1, 0, 0, 1, 0, y] };
}

describe('linesFromTextItems', () => {
  it('joins fragments on the same baseline into one line', () => {
    const lines = linesFromTextItems(
      [item('The Employee ', 700), item('shall give ', 700), item('ninety days notice.', 700)],
      1,
    );
    expect(lines).toEqual([{ text: 'The Employee shall give ninety days notice.', page: 1 }]);
  });

  it('breaks a line when the generator sets hasEOL', () => {
    const lines = linesFromTextItems(
      [item('First line', 700, true), item('Second line', 700, true)],
      2,
    );
    expect(lines.map((line) => line.text)).toEqual(['First line', 'Second line']);
    expect(lines.every((line) => line.page === 2)).toBe(true);
  });

  it('breaks a line on a baseline change when hasEOL is never set', () => {
    const lines = linesFromTextItems([item('First line', 700), item('Second line', 680)], 1);
    expect(lines.map((line) => line.text)).toEqual(['First line', 'Second line']);
  });

  it('does not break on sub-pixel drift within a line', () => {
    const lines = linesFromTextItems(
      [item('Rs. ', 700), item('2,00,000', 700.4), item(' as damages', 699.7)],
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Rs. 2,00,000 as damages');
  });

  it('collapses runs of whitespace introduced by positioning', () => {
    const lines = linesFromTextItems([item('Notice    ', 700), item('   period', 700)], 1);
    expect(lines[0]?.text).toBe('Notice period');
  });

  it('drops fragments that are only whitespace', () => {
    const lines = linesFromTextItems(
      [item('   ', 700, true), item('Real content here', 690, true), item('  ', 680, true)],
      1,
    );
    expect(lines.map((line) => line.text)).toEqual(['Real content here']);
  });

  it('ignores marked-content entries, which carry no text', () => {
    const lines = linesFromTextItems(
      [{ type: 'beginMarkedContent' }, item('Real text', 700), { type: 'endMarkedContent' }],
      1,
    );
    expect(lines.map((line) => line.text)).toEqual(['Real text']);
  });

  it('returns nothing for an empty page', () => {
    expect(linesFromTextItems([], 1)).toEqual([]);
  });

  it('stamps every line with the page it was read from', () => {
    const lines = linesFromTextItems([item('A', 700, true), item('B', 690, true)], 7);
    expect(lines.map((line) => line.page)).toEqual([7, 7]);
  });

  it('preserves the original characters, because quotes are verified against them', () => {
    const original = 'the Company’s “Confidential Information”';
    const lines = linesFromTextItems([item(original, 700)], 1);
    expect(lines[0]?.text).toBe(original);
  });
});

describe('PdfParseError', () => {
  it('carries a reason the UI can turn into an explanation', () => {
    const error = new PdfParseError('The PDF is password protected.', 'ENCRYPTED');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PdfParseError');
    expect(error.reason).toBe('ENCRYPTED');
  });
});
