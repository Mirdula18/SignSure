import type { RuleHit } from '@shared/types';
import { RiskBadge } from '@/components/Badge';
import { useT } from '@/state/preferences';

/**
 * A card from the India rule library.
 *
 * Every word of `title`, `message`, `basis` and `questions` was written and reviewed by a
 * person and comes from `shared/rules`, never from the model. The card says so by showing the
 * statute or judgment it rests on and the date the wording was last checked - which is the
 * difference between legal context a reader can follow up and an assertion they have to
 * take on faith.
 */
export function RuleCard({ hit }: { hit: RuleHit }) {
  const t = useT();

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={hit.severity} />
        <h3 className="text-base font-semibold text-ink">{hit.title}</h3>
      </header>

      <p className="prose-measure mt-2 text-sm leading-relaxed text-ink">{hit.message}</p>

      {hit.details === undefined ? null : (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {Object.entries(hit.details).map(([key, value]) => (
            <div key={key} className="flex gap-1">
              <dt className="text-muted capitalize">{key}:</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {hit.questions.length === 0 ? null : (
        <div className="mt-3">
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t('rule.questions')}
          </h4>
          <ul className="mt-1 list-disc ps-5 text-sm text-ink">
            {hit.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-3 border-t border-line pt-3 text-xs text-muted">
        <p>
          <span className="font-medium">{t('rule.basis')}:</span> {hit.basis}
        </p>
        <p className="mt-1">
          {t('rule.lastReviewed', { date: hit.lastReviewed })}
          <span aria-hidden="true"> · </span>
          {t('rule.generalInfo')}
        </p>
      </footer>
    </article>
  );
}
