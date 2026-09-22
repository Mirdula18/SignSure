import { Button } from '@/components/Button';
import { useT } from '@/state/preferences';

export interface LoadFailedProps {
  /** Injected in tests; jsdom cannot navigate. */
  onReload?: () => void;
}

/**
 * Shown in place of a screen whose code failed to download.
 *
 * The usual cause is a deploy between loading the page and using it: the old chunk names no
 * longer exist. Without this, a failed lazy import would unmount the whole app and leave a
 * blank page with no explanation.
 */
function reloadPage(): void {
  window.location.reload();
}

export function LoadFailed({ onReload = reloadPage }: LoadFailedProps) {
  const t = useT();
  return (
    <div role="alert" className="rounded-xl border border-high bg-high-soft p-4">
      <p className="text-sm text-ink">{t('app.loadFailed')}</p>
      <Button variant="primary" className="mt-3" onClick={onReload}>
        {t('app.reload')}
      </Button>
    </div>
  );
}
