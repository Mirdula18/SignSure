import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Highlight, type HighlightProps } from './Highlight';

const TEXT = 'The Employee shall give ninety (90) days written notice.';
const QUOTE = 'ninety (90) days';
const START = TEXT.indexOf(QUOTE);
const END = START + QUOTE.length;

/** Renders inside a paragraph, as the report does, so the container holds only this text. */
function renderHighlight(props: HighlightProps) {
  return render(
    <p>
      <Highlight {...props} />
    </p>,
  );
}

describe('Highlight', () => {
  it('renders the text unmarked when there is no range, because an unlocated quote has nothing to point at', () => {
    const { container } = renderHighlight({ text: TEXT });
    expect(container).toHaveTextContent(TEXT);
    expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  });

  it('wraps exactly the quoted range in a mark and keeps the text either side intact', () => {
    const { container } = renderHighlight({ text: TEXT, start: START, end: END });
    const mark = screen.getByRole('mark');
    expect(mark.textContent).toBe(QUOTE);
    expect(container.textContent).toBe(TEXT);
    expect(container.firstElementChild?.firstChild?.textContent).toBe(TEXT.slice(0, START));
    expect(mark.nextSibling?.textContent).toBe(TEXT.slice(END));
  });

  it('marks a range that starts at the very beginning of the clause', () => {
    renderHighlight({ text: TEXT, start: 0, end: 3 });
    expect(screen.getByRole('mark').textContent).toBe('The');
  });

  it.each<[string, Partial<HighlightProps>]>([
    ['only a start', { start: 4 }],
    ['only an end', { end: 12 }],
    ['an end equal to the start', { start: 10, end: 10 }],
    ['an end before the start', { start: 12, end: 4 }],
    ['a negative start', { start: -1, end: 5 }],
    ['a start at the end of the text', { start: TEXT.length, end: TEXT.length + 5 }],
    ['a start beyond the text', { start: TEXT.length + 10, end: TEXT.length + 20 }],
  ])(
    'renders the whole text without a mark when given %s, rather than highlighting the wrong words',
    (_description, range) => {
      const { container } = renderHighlight({ text: TEXT, ...range });
      expect(screen.queryByRole('mark')).not.toBeInTheDocument();
      expect(container.textContent).toBe(TEXT);
    },
  );

  it('clamps an end that runs past the text, so a slightly long offset still highlights the tail', () => {
    const { container } = renderHighlight({ text: TEXT, start: START, end: TEXT.length + 50 });
    expect(screen.getByRole('mark').textContent).toBe(TEXT.slice(START));
    expect(container.textContent).toBe(TEXT);
  });

  it('announces the label inside the mark, so the highlight is not a purely visual cue', () => {
    renderHighlight({
      text: TEXT,
      start: START,
      end: END,
      label: 'Quoted in the explanation',
      endLabel: 'end of highlight',
    });
    const mark = screen.getByRole('mark');
    expect(mark).toHaveTextContent(
      'Quoted in the explanation: ninety (90) days (end of highlight)',
    );
    // Both announcements are screen-reader only; sighted readers see the highlight itself.
    const hidden = mark.querySelectorAll('.sr-only');
    expect(hidden).toHaveLength(2);
    expect(hidden[0]?.textContent).toBe('Quoted in the explanation: ');
    expect(hidden[1]?.textContent).toBe(' (end of highlight)');
  });

  it('announces the end of the highlight in whatever language it is given', () => {
    // The component writes no fixed text of its own, so a Hindi reader hears Hindi.
    renderHighlight({ text: TEXT, start: START, end: END, endLabel: 'हाइलाइट ख़त्म' });
    expect(screen.getByRole('mark')).toHaveTextContent('(हाइलाइट ख़त्म)');
    expect(screen.getByRole('mark')).not.toHaveTextContent('end of highlight');
  });

  it('adds no screen-reader text when no label is given', () => {
    renderHighlight({ text: TEXT, start: START, end: END });
    const mark = screen.getByRole('mark');
    expect(mark.textContent).toBe(QUOTE);
    expect(mark.querySelector('.sr-only')).toBeNull();
  });

  // This is the XSS test. Clause text comes from a document someone else wrote, so markup in it
  // must reach the page as literal characters and never as elements the browser would run.
  it('renders markup in the text as text, never as HTML, even inside the highlighted range', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const text = `Before ${hostile} after <script>alert(2)</script>`;
    const start = text.indexOf(hostile);
    const { container } = renderHighlight({
      text,
      start,
      end: start + hostile.length,
      label: 'Quote',
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('mark')).toHaveTextContent(hostile);
    expect(container.textContent).toContain(hostile);
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('renders markup as text when there is no range at all', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = renderHighlight({ text: hostile });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(hostile);
  });

  it('has no axe violations', async () => {
    const { container } = renderHighlight({
      text: TEXT,
      start: START,
      end: END,
      label: 'Quoted in the explanation',
    });
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
