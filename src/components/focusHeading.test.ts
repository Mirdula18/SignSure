import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { focusHeadingWhenReady } from './focusHeading';

afterEach(() => {
  document.body.innerHTML = '';
});

function root(html: string): HTMLElement {
  const element = document.createElement('main');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

describe('focusHeadingWhenReady', () => {
  it('focuses the heading that is already there, without adding a tab stop', () => {
    const main = root('<p>intro</p><h1>Your report</h1>');
    focusHeadingWhenReady(main);
    const heading = main.querySelector('h1');
    expect(document.activeElement).toBe(heading);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });

  it('waits for a heading that arrives later, as a screen loaded on demand does', async () => {
    const main = root('<p>Loading…</p>');
    focusHeadingWhenReady(main);
    expect(document.activeElement).toBe(document.body);

    const heading = document.createElement('h1');
    heading.textContent = 'Your report';
    main.append(heading);
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('stops waiting once cleaned up, so a screen the reader left cannot steal focus', async () => {
    const main = root('<p>Loading…</p>');
    const stop = focusHeadingWhenReady(main);
    stop();

    main.append(document.createElement('h1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing without a root', () => {
    const stop = focusHeadingWhenReady(null);
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
