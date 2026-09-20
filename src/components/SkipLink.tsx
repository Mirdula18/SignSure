import { useT } from '@/state/preferences';

/**
 * First focusable element on the page (WCAG 2.4.1). Visually hidden until focused rather than
 * `display:none`, so it stays in the tab order.
 */
export function SkipLink() {
  const t = useT();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-ink focus:shadow-lg"
    >
      {t('app.skipToContent')}
    </a>
  );
}
