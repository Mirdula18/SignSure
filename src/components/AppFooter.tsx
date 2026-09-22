import { useT } from '@/state/preferences';

export function AppFooter() {
  const t = useT();
  return (
    <footer className="mt-16 border-t border-line bg-raised">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted">
        <h2 id="disclaimer" className="mb-2 text-base font-semibold text-ink">
          {t('app.disclaimerShort')}
        </h2>
        <p className="prose-measure">{t('app.footerNote')}</p>

        <h2 id="privacy" className="mt-6 mb-2 text-base font-semibold text-ink">
          {t('app.privacy')}
        </h2>
        <p className="prose-measure">{t('app.privacyNote')}</p>
      </div>
    </footer>
  );
}
