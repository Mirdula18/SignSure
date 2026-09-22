/**
 * Moves focus to the first `h1` inside `root` as soon as there is one.
 *
 * Why: when a button that starts a new screen is replaced by that screen, focus falls back to the
 * page body and a keyboard or screen-reader user is left at the top with no idea what changed
 * (WCAG 2.4.3). Focusing the new heading reads its name and puts them at the start of the
 * content. A screen loaded on demand has no heading yet, so this waits for it to appear.
 *
 * Returns a cleanup that stops waiting.
 */
export function focusHeadingWhenReady(root: HTMLElement | null): () => void {
  if (root === null) return () => undefined;

  const tryFocus = (): boolean => {
    const heading = root.querySelector('h1');
    if (heading === null) return false;
    // Headings are not focusable by default; -1 allows focus without adding a tab stop.
    heading.setAttribute('tabindex', '-1');
    heading.focus();
    return true;
  };

  if (tryFocus()) return () => undefined;

  const observer = new MutationObserver(() => {
    if (tryFocus()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
