import { vi } from 'vitest';

export type TurnstileRenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

/**
 * A stand-in for Cloudflare's widget that lets each test decide how the check goes.
 *
 * `behaviour` runs when the widget renders. Keep the options it receives to finish the check
 * later, which is how a test reproduces a reader who moves on before the check is done.
 */
export function installTurnstile(
  behaviour: (options: TurnstileRenderOptions) => void = () => undefined,
) {
  const remove = vi.fn();
  const render = vi.fn((_container: HTMLElement, options: TurnstileRenderOptions) => {
    behaviour(options);
    return 'widget-1';
  });
  window.turnstile = { render, remove };
  return { render, remove };
}

export function uninstallTurnstile(): void {
  delete window.turnstile;
}
