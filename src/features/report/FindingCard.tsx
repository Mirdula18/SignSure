import { useId, useState } from 'react';
import type { Clause, ClauseFinding } from '@shared/types';
import { CategoryBadge, RiskBadge, VerificationBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { useT } from '@/state/preferences';
import { ClauseTitle, SideBySide } from './SideBySide';
import { GlossaryText } from '@/features/a11y/GlossaryText';
import { ReadAloud } from '@/features/a11y/ReadAloud';
import type { TranslationKey } from '@/i18n';

/**
 * One finding, collapsed to a summary until the reader opens it.
 *
 * The original text is behind a disclosure rather than always visible because a report with
 * thirty clauses printed in full is unreadable on a phone. The control is a real button with
 * `aria-expanded`, and opening it reveals content in the DOM order a screen reader follows.
 */
export interface FindingCardProps {
  finding: ClauseFinding;
  clause: Clause;
  /** Open on mount, used when a citation sends the reader straight to a clause. */
  defaultOpen?: boolean;
}

function categoryLabel(category: ClauseFinding['category']): string {
  return category
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function FindingCard({ finding, clause, defaultOpen = false }: FindingCardProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const detailsId = useId();

  return (
    <article
      aria-labelledby={headingId}
      id={`clause-${clause.id}`}
      // -1 makes the card a target for programmatic focus without adding it to the Tab order.
      // Following a citation calls focus() on it; without this, focus() on an article is a
      // silent no-op and a keyboard user is left wherever they were.
      tabIndex={-1}
      className="scroll-mt-28 rounded-xl border border-line bg-surface p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={finding.risk} />
        <CategoryBadge label={categoryLabel(finding.category)} />
        <VerificationBadge status={finding.evidence.status} />
      </header>

      <h3 id={headingId} className="mt-2 text-base font-semibold text-ink">
        {finding.title}
      </h3>
      <ClauseTitle clause={clause} />

      <p className="prose-measure mt-2 text-sm leading-relaxed text-ink">
        <GlossaryText text={finding.explanation} />
      </p>

      <p className="prose-measure mt-2 text-sm leading-relaxed text-muted">
        <span className="font-medium text-ink">{t('clauses.whyItMatters')}: </span>
        <GlossaryText text={finding.whyItMatters} />
      </p>

      {finding.questionsToAsk.length === 0 ? null : (
        <div className="mt-3">
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t('clauses.questionsToAsk')}
          </h4>
          <ul className="mt-1 list-disc ps-5 text-sm text-ink">
            {finding.questionsToAsk.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ReadAloud
          label={finding.title}
          text={`${finding.title}. ${finding.explanation} ${finding.whyItMatters}`}
        />
        <Button
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {t((open ? 'clauses.hideOriginal' : 'clauses.viewOriginal') satisfies TranslationKey)}
        </Button>
      </div>

      <div id={detailsId} hidden={!open} className="mt-4 border-t border-line pt-4">
        <SideBySide clause={clause} evidence={finding.evidence}>
          <p className="prose-measure text-sm leading-relaxed text-ink">{finding.explanation}</p>
        </SideBySide>
      </div>
    </article>
  );
}
