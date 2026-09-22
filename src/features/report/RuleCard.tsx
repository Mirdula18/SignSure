import { localiseHit } from '@shared/rules';
import type { RuleHit } from '@shared/types';
import { RiskBadge } from '@/components/Badge';
import type { TranslationKey } from '@/i18n';
import { usePreferences } from '@/state/preferences';

/** Labels for the values a rule pulls out of a clause, such as a bond amount. */
const DETAIL_LABELS: Readonly<Record<string, TranslationKey>> = {
  amount: 'rule.detail.amount',
  period: 'rule.detail.period',
  yours: 'rule.detail.yours',
  theirs: 'rule.detail.theirs',
};

/** A detail's translated label, or its key if a rule ever adds one this list does not know. */
function detailLabel(key: string, t: (key: TranslationKey) => string): string {
  const label = DETAIL_LABELS[key];
  return label === undefined ? key : t(label);
}

/**
 * A card from the India rule library.
 *
 * Every word of `title`, `message`, `basis` and `questions` was written and reviewed by a
 * person and comes from `shared/rules`, never from the model. The card says so by showing the
 * statute or judgment it rests on and the date the wording was last checked - which is the
 * difference between legal context a reader can follow up and an assertion they have to
 * take on faith.
 *
 * In Hindi the title, message and questions come from the reviewed translation in
 * `shared/rules/hindi.ts`; the basis stays as cited.
 */
export function RuleCard({ hit: original }: { hit: RuleHit }) {
  const { language, t } = usePreferences();
  const hit = localiseHit(original, language);

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
              <dt className="text-muted">{detailLabel(key, t)}:</dt>
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
