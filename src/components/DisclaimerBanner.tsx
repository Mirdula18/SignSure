import { useT } from '@/state/preferences';

/**
 * Shown on every screen (docs/PRD.md section 9). Kept as a `<p>` inside a labelled region so a
 * screen-reader user can find it, but not as an alert - it is standing context, not an event.
 */
export function DisclaimerBanner() {
  const t = useT();
  return (
    <div className="border-b border-line bg-info-soft text-ink">
      <p className="mx-auto flex max-w-5xl items-start gap-2 px-4 py-2 text-sm">
        <span aria-hidden="true">⚖️</span>
        <span>
          <strong className="font-semibold">{t('app.disclaimerShort')}</strong>{' '}
          <a className="underline underline-offset-2" href="#disclaimer">
            {t('app.disclaimerLink')}
          </a>
        </span>
      </p>
    </div>
  );
}
