import { useId } from 'react';
import type { Clause } from '@shared/types';
import { useT } from '@/state/preferences';
import { ClauseTitle } from './SideBySide';

/**
 * A clause SignSure has nothing to say about.
 *
 * Shown so the Clauses tab really does list every clause: the reader can read the whole document
 * in one place, and a citation to any clause, including one with no finding, has a place to
 * land. The text is the document's own, shown as-is.
 */
export function PlainClauseCard({ clause }: { clause: Clause }) {
  const t = useT();
  const headingId = useId();

  return (
    <article aria-labelledby={headingId} className="rounded-xl border border-line bg-raised p-4">
      <h3 id={headingId} className="text-base font-normal">
        <ClauseTitle clause={clause} />
      </h3>
      <p className="prose-measure mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">
        {clause.text}
      </p>
      <p className="mt-2 text-xs text-muted">{t('clauses.noNotes')}</p>
    </article>
  );
}
