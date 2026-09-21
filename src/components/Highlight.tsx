import { Fragment, type ReactElement } from 'react';

/**
 * Renders clause text with a range marked.
 *
 * The obvious implementation - wrap the match in `<mark>` and set it as HTML - would hand a
 * document that someone else wrote a way to inject markup into the page. So the string is
 * *split* into React nodes instead: React escapes every piece, and `dangerouslySetInnerHTML`
 * never appears in this codebase (ESLint forbids it outright).
 *
 * Offsets come from `shared/verify.ts` and index the original, unmodified clause text.
 */
export interface HighlightProps {
  text: string;
  /** Inclusive start offset, or undefined when the quote could not be located. */
  start?: number | undefined;
  /** Exclusive end offset. */
  end?: number | undefined;
  /** Announced to screen readers so the highlight is not a purely visual cue. */
  label?: string;
  /**
   * Announced where the highlight ends. Passed in rather than written here, because this
   * component has no access to the translator and a Hindi reader should not hear English.
   */
  endLabel?: string;
}

export function Highlight({ text, start, end, label, endLabel }: HighlightProps): ReactElement {
  const hasRange =
    typeof start === 'number' &&
    typeof end === 'number' &&
    start >= 0 &&
    end > start &&
    start < text.length;

  if (!hasRange) return <>{text}</>;

  const safeEnd = Math.min(end, text.length);
  const before = text.slice(0, start);
  const marked = text.slice(start, safeEnd);
  const after = text.slice(safeEnd);

  return (
    <Fragment>
      {before}
      <mark className="rounded-xs">
        {label === undefined ? null : <span className="sr-only">{label}: </span>}
        {marked}
        {endLabel === undefined ? null : <span className="sr-only"> ({endLabel})</span>}
      </mark>
      {after}
    </Fragment>
  );
}
