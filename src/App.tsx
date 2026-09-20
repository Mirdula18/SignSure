import { AppFooter } from '@/components/AppFooter';
import { AppHeader } from '@/components/AppHeader';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';
import { SkipLink } from '@/components/SkipLink';
import { useT } from '@/state/preferences';

export default function App() {
  const t = useT();
  return (
    <>
      <SkipLink />
      <AppHeader />
      <DisclaimerBanner />
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {t('app.tagline')}
        </h1>
      </main>
      <AppFooter />
    </>
  );
}
