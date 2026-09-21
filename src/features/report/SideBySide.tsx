import { useId } from 'react';
import type { Clause, VerifiedQuote } from '@shared/types';
import { Highlight } from '@/components/Highlight';
import { VerificationBadge } from '@/components/Badge';
import { useT } from '@/state/preferences';

/**
 * Explanation on the left, the document's own words on the right.
 *
 * This layout is the product's central claim made visible: you never have to take an
 * explanation on trust, because the clause it came from is right there with the quote marked.
 * On a phone the two stack, explanation first, since that is what the reader came for.
 *
 * Each side is a labelled region rather than a bare column, so a screen-reader user can tell
 * which is the explanation and which is the original, and the original's label carries the
 * clause number and page.
 */

export interface SideBySideProps {
  clause: Clause;
  evidence: VerifiedQuote;
  children: React.ReactNode;
}

/** Human location for a clause: a page for PDFs, a paragraph number otherwise. */
export function useClauseLocation(clause: Clause): string {
  const t = useT();
  if (clause.page === null) return t('clauses.paragraph', { order: clause.order + 1 });
  if (clause.pageEnd !== null && clause.pageEnd > clause.page) {
    return t('clauses.pageRange', { page: clause.page, pageEnd: clause.pageEnd });
  }
  return t('clauses.page', { page: clause.page });
}

export function ClauseTitle({ clause }: { clause: Clause }): React.ReactElement {
  const t = useT();
  const location = useClauseLocation(clause);
  const label =
    clause.label === null
      ? t('clauses.paragraph', { order: clause.order + 1 })
      : t('clauses.clauseLabel', { label: clause.label });

  return (
    <span className="text-sm text-muted">
      {label}
      <span aria-hidden="true"> · </span>
      {location}
      {clause.heading === null ? null : (
        <>
          <span aria-hidden="true"> · </span>
          {clause.heading}
        </>
      )}
    </span>
  );
}

export function SideBySide({ clause, evidence, children }: SideBySideProps) {
  const t = useT();
  const explanationId = useId();
  const originalId = useId();
  const location = useClauseLocation(clause);

  const originalLabel = `${t('clauses.originalText')}, ${
    clause.label === null
      ? t('clauses.paragraph', { order: clause.order + 1 })
      : t('clauses.clauseLabel', { label: clause.label })
  }, ${location}`;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby={explanationId} className="flex flex-col gap-2">
        <h4 id={explanationId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t('clauses.explanation')}
        </h4>
        {children}
      </section>

      <section aria-labelledby={originalId} className="flex flex-col gap-2">
        <h4 id={originalId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          <span className="sr-only">{originalLabel}</span>
          <span aria-hidden="true">{t('clauses.originalText')}</span>
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge status={evidence.status} />
          <span className="text-xs text-muted">{location}</span>
        </div>
        <blockquote className="rounded-lg border border-line bg-sunken p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink">
          <Highlight
            text={clause.text}
            start={evidence.start}
            end={evidence.end}
            label={t('verify.verified')}
          />
        </blockquote>
      </section>
    </div>
  );
}
