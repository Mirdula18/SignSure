/**
 * Type declaration for the `toHaveNoViolations` matcher registered in `vitest.setup.ts`.
 *
 * `vitest-axe@0.1.0` still augments the old global `Vi` namespace, which Vitest 4 no longer
 * reads, so the matcher works at runtime but is invisible to the compiler without this.
 */
import type { AxeResults } from 'axe-core';

declare module 'vitest' {
  interface Matchers<T = unknown> {
    /** Only meaningful on the result of `axe()`, which is what the matcher inspects. */
    toHaveNoViolations: T extends AxeResults | Promise<AxeResults> ? () => void : never;
  }
}

export {};
