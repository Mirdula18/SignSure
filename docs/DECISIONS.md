# SignSure – Decision Log

One line per gap, conflict, or assumption resolved while building. Newest at the bottom of each
phase. Where the docs were ambiguous, the simpler option that respects `CLAUDE.md` was chosen.

## Phase 0 – Setup (2026-09-20)

| # | Decision | Why |
|---|---|---|
| D01 | Gemini model default is `gemini-3.8-flash`, not the `gemini-2.5-flash` placeholder in the docs. | `docs/AI_PIPELINE.md` says "check the Gemini docs for the latest stable Flash ID at build time". Verified against ai.google.dev/gemini-api/docs/models on 2026-09-20: `gemini-3.8-flash` is the current stable Flash model. Overridable via the `GEMINI_MODEL` var. |
| D02 | TypeScript pinned to 6.0.3 rather than the newest 7.0.2. | `typescript-eslint@8.70.0` declares `typescript >=4.8.4 <6.1.0`. Linting with type information is worth more than being on the newest compiler. Revisit when typescript-eslint ships TS 7 support. |
| D03 | ESLint 10 kept, with an npm `overrides` entry relaxing `eslint-plugin-jsx-a11y`'s peer range. | jsx-a11y 6.10.2 has not been republished since 2024 and declares `eslint <=9`, but runs correctly on ESLint 10 (verified by running the full lint). The alternative, ESLint 9.39.5, is marked deprecated by upstream. |
| D04 | Vitest 4.1.11, jsdom 29.1.1 (not the newest 5.x / 30.x). | The newest releases require Node >= 22; the development machine runs Node 20.19.6. Both pinned versions support Node ^20.19. |
| D05 | Pages Functions run inside Vite in development and E2E via `tools/pagesFunctions.ts`, instead of `wrangler pages dev`. | Every `wrangler@4` release requires Node >= 22 and refuses to start on Node 20. The adapter mirrors Cloudflare's routing (`_middleware.ts` then `functions/api/<name>.ts`, `onRequest`/`onRequest<Method>`), so the same source files run in both places. `wrangler` remains the deployment tool and CI runs on Node 22. |
| D06 | Three separate `tsconfig`s (app / functions / node) with no project references. | `@cloudflare/workers-types` and the DOM lib both declare `Request`, `Response` and friends, so a single config cannot type both sides. Plain `-p` runs avoid composite build artefacts entirely. |
| D07 | Dark mode follows `prefers-color-scheme` only; no in-app theme toggle. | `docs/ACCESSIBILITY.md` asks for the media query to be respected; a toggle is extra surface with no requirement behind it. |
| D08 | `style-src` allows `'unsafe-inline'`. | Vite injects the stylesheet link and Tailwind emits a `<style>` element during development; the alternative is per-build nonces, which Cloudflare Pages' static `_headers` cannot generate. No inline `<script>` is allowed, which is where the XSS risk actually lives. |
| D09 | Preferences (language, reading level) persist in `sessionStorage`; nothing else is stored. | `docs/ARCHITECTURE.md` section 8 allows exactly this. Document text never touches storage. |
| D10 | `@google/genai`, `pdfjs-dist` and `mammoth` are runtime `dependencies`, not dev. | Cloudflare Pages bundles Functions from `dependencies`, and the parsers ship to the browser (lazily). |
