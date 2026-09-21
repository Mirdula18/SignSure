import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);

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
