import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/state/preferences';

/**
 * Cloudflare Turnstile, in managed mode.
 *
 * Managed mode is almost always invisible and never presents a puzzle, which is what makes it
 * acceptable under WCAG 2.2 3.3.8: an accessible authentication check must not depend on a
 * cognitive function test. There is no fallback puzzle here by design.
 *
 * The widget is what earns a session token; without one, the Gemini proxy cannot be called at
 * all. The site key is public by design - it identifies the widget, it does not authorise
 * anything - so it ships in the bundle. The secret lives only in the Worker.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          theme?: 'auto' | 'light' | 'dark';
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type TurnstileState = 'loading' | 'ready' | 'failed';

export interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  onStateChange?: (state: TurnstileState) => void;
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => {
        resolve();
      });
      existing.addEventListener('error', () => {
        reject(new Error('Turnstile failed to load'));
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      resolve();
    });
    script.addEventListener('error', () => {
      reject(new Error('Turnstile failed to load'));
    });
    document.head.append(script);
  });
}

export function TurnstileWidget({ onToken, onStateChange }: TurnstileWidgetProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TurnstileState>('loading');
  const siteKey: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  // The callbacks are held in refs so that a parent re-render does not tear down and re-create
  // the widget - which would ask the visitor to pass the check again for no reason. They are
  // assigned in an effect rather than during render: writing to a ref while rendering is a
  // side effect, and React may render a component twice before committing.
  const callbackRef = useRef(onToken);
  const stateChangeRef = useRef(onStateChange);

  useEffect(() => {
    callbackRef.current = onToken;
    stateChangeRef.current = onStateChange;
  }, [onToken, onStateChange]);

  const statusId = useId();

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    const update = (next: TurnstileState): void => {
      if (cancelled) return;
      setState(next);
      stateChangeRef.current?.(next);
    };

    if (typeof siteKey !== 'string' || siteKey.length === 0) {
      update('failed');
      return;
    }

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          theme: 'auto',
          callback: (token) => {
            update('ready');
            callbackRef.current(token);
          },
          'error-callback': () => {
            update('failed');
          },
          'expired-callback': () => {
            update('loading');
          },
        });
      })
      .catch(() => {
        update('failed');
      });

    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={containerRef} aria-describedby={statusId} />
      <p id={statusId} className="text-xs text-muted" role="status">
        {state === 'failed' ? t('turnstile.failed') : t('turnstile.hint')}
      </p>
    </div>
  );
}
