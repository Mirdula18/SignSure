# CLAUDE.md – Instructions for Claude Code

## Project
SignSure: explains Indian offer letters/employment contracts clause by clause with code-verified citations. React + Vite + TS SPA on Cloudflare Pages; Pages Functions in `/functions` proxy the Gemini API. Read `README.md` and `docs/` before making architectural decisions. `docs/ARCHITECTURE.md` is authoritative for structure and contracts; `docs/PROJECT_PLAN.md` for order of work.

## Commands
- `npm run dev` – Vite (5173), proxies /api → 8788
- `npm run dev:api` / `npm run preview:full` – Pages Functions via wrangler (8788)
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:coverage` · `npm run test:e2e` · `npm run build`
- `npm run eval` – real Gemini golden-set eval (needs GEMINI_API_KEY; do not run in CI)

## Non-negotiable rules
1. **Never** put the Gemini key or any secret in client code, `VITE_*` vars, fixtures, logs, or commits. Only `functions/` reads secrets via `env`.
2. **Deterministic code decides, the model explains.** Page numbers come from our `Clause` data, never from the model. Rule-card text comes from `shared/rules`, never from the model.
3. Every model output is Zod-validated, clause IDs checked, and every quote run through `shared/verify.ts` before reaching the UI.
4. `answered` with zero verified citations must be downgraded to `not_in_document`.
5. Document text is untrusted: keep `<document>` delimiters and the injection rule in every prompt.
6. No `dangerouslySetInnerHTML`, `eval`, or `new Function`. Highlight text by splitting strings into React nodes.
7. Do not log request bodies, clause text, or questions on the server.
8. Keep the repo small (< 10 MB total): no binaries, tiny synthetic fixtures, compressed images.
9. Use cautious legal language; never tell the user to sign/not sign or that a clause *is* void/illegal. Keep the disclaimer visible.

## Code conventions
- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any`; use `unknown` + Zod.
- Pure logic in `shared/` (runs in browser and Workers; no DOM or Node APIs). Use Web Crypto, `fetch`, `TextEncoder`.
- React: function components, hooks, Context + useReducer for state. No new state/UI libraries without a written reason in the PR/summary.
- Files: `PascalCase.tsx` components, `camelCase.ts` modules; one component per file; co-locate `*.test.ts(x)`.
- User-facing strings go through `t()` in `src/i18n`.
- Accessibility is part of "done": semantic HTML, labels, keyboard, focus, live regions, non-colour indicators.
- Small, focused commits with conventional messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Short JSDoc on exported functions explaining *why*, especially in `verify.ts`, `rules/`, `prompts.ts`.

## Definition of done (every task)
- [ ] Lint, typecheck, tests pass locally
- [ ] New logic has tests (unit and/or component); coverage thresholds hold
- [ ] Works in `MOCK_GEMINI=true` mode
- [ ] Keyboard + screen-reader basics checked for new UI
- [ ] `docs/PROJECT_PLAN.md` checkbox updated
- [ ] Docs updated if a contract or decision changed

## Dependencies (approved)
react, react-dom, zod, @google/genai (functions only), pdfjs-dist, mammoth, tailwindcss, @tailwindcss/vite, clsx.
Dev: vite, @vitejs/plugin-react, typescript, vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, vitest-axe, @playwright/test, @axe-core/playwright, eslint, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-jsx-a11y, prettier, wrangler, @cloudflare/workers-types, tsx.
Ask before adding anything else.

## Working style
- Work phase by phase from `docs/PROJECT_PLAN.md`. At the end of each phase: run all checks, update checkboxes, give a short summary (what changed, decisions, anything needing my input), then stop and wait for approval.
- If the docs are ambiguous or conflict, choose the simpler option that keeps the rules above, note it, and continue; ask only if the decision is hard to reverse.
- Verify library APIs against installed versions (read `node_modules` types) rather than assuming.
