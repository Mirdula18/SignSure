# SignSure – Accessibility

Target: **WCAG 2.2 Level AA**, Lighthouse Accessibility ≥ 95, axe 0 serious/critical issues.

Accessibility here is also about *comprehension*: plain language, reading levels, Indian languages, and read-aloud are core features, not extras.

## 1. Structure and semantics
- One `<h1>` per view; logical heading order.
- Landmarks: `<header>`, `<nav>`, `<main id="main">`, `<footer>`; "Skip to main content" link as first focusable element.
- Tabs follow the WAI-ARIA Tabs pattern (`role="tablist"`, arrow-key navigation, `aria-selected`, `aria-controls`).
- Clause list is a real list (`<ol>`); each clause card is an `<article>` with `aria-labelledby`.
- Side-by-side view: explanation and original text are two labelled regions ("Explanation", "Original text, Clause 7.2, page 3").
- Highlighted quote uses `<mark>`; screen readers announce "highlighted".

## 2. Keyboard
- Everything operable by keyboard; no keyboard traps; visible focus ring (≥ 2px, 3:1 contrast).
- Dropzone has a real "Choose file" button (drag-and-drop is optional; WCAG 2.5.7 alternative to dragging).
- Citation buttons move focus to the target clause heading.
- Focus not obscured by sticky header (2.4.11): use `scroll-margin-top`.
- Dialogs trap focus while open and return focus on close; `Esc` closes.

## 3. Dynamic content
- Analysis progress: `aria-busy="true"` on the report region + polite live region with stage text ("Reading clauses… Checking quotes…").
- New Q&A answers announced via `aria-live="polite"`; errors via `role="alert"`.
- Don't move focus unexpectedly on async completion; announce instead.

## 4. Visual
- Text contrast ≥ 4.5:1; large text and UI components ≥ 3:1. Checked for both light and dark themes.
- Risk and verification never shown by colour alone: icon + text ("High risk", "Verified quote").
- Supports 200% zoom and 320 px width without horizontal scroll (reflow).
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Touch targets ≥ 44×44 px (WCAG 2.2 minimum is 24×24).
- Base font 16 px, line-height ≥ 1.5, paragraph width ~70ch.

## 5. Forms and errors
- Every input has a visible `<label>`; hints linked with `aria-describedby`.
- Errors describe the fix: "This file is 14 MB. Please upload a file under 10 MB."
- Consistent help (3.2.6): "How SignSure works" and "Disclaimer" links in the same place on every screen.
- No redundant entry (3.3.7): lenses and language persist across tabs.
- Turnstile uses the managed/invisible mode; no cognitive puzzle (3.3.8 accessible authentication).

## 6. Comprehension features
- **Reading level:** Simple / Standard toggle, passed to the model.
- **Languages:** English + Hindi at launch (UI strings + explanations); add Tamil/Telugu/Bengali/Marathi as stretch. Set `lang` attribute on translated blocks (`lang="hi"`). Original clause text keeps the document's language.
- **Glossary tooltips:** common legal terms (indemnity, liquidated damages, arbitration, notice period, CTC) with plain definitions, accessible as buttons with popovers (not hover-only).
- **Read aloud:** Web Speech API `speechSynthesis`, voice chosen by language (`en-IN`, `hi-IN`); play/pause/stop buttons with labels; hidden if unsupported.

## 7. Testing
- Automated: `vitest-axe` in component tests; `@axe-core/playwright` on every screen in E2E; eslint-plugin-jsx-a11y.
- Manual (record in PR description): keyboard-only walkthrough; NVDA + Firefox or VoiceOver + Safari pass on upload → report → ask; 200% zoom; mobile 360 px.
