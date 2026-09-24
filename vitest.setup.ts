import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as axeMatchers from 'vitest-axe/matchers';
import { loadLanguage } from '@/i18n';

expect.extend(axeMatchers);

// In the app the Hindi dictionary arrives on demand. Component tests are about what a Hindi
// screen shows, not about that wait, so it is on hand from the start; src/i18n/lazy.test.ts
// covers the loading itself with a fresh module.
beforeAll(async () => {
  await loadLanguage('hi');
});

// jsdom implements no layout, so it has no scrollIntoView. Every real browser does, and the
// report calls it when a citation sends the reader to a clause.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    return undefined;
  };
}

afterEach(() => {
  cleanup();
});
