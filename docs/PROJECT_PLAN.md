# SignSure – Project Planner

**Goal:** a deployed, tested, accessible SignSure submitted on Cloudflare Pages, with blog + LinkedIn post, before the deadline.
**Rule of thumb:** a working, verified, *narrow* product beats a broad unfinished one. Must-haves first, stretch only when all Must boxes are ticked.

Legend: ⬜ todo · 🟨 in progress · ✅ done · Est = focused hours

---

## Phase 0 – Setup (Day 1) · Est 4h
- ✅ Create GitHub repo `signsure`, add these docs, `.gitignore` (node_modules, dist, .dev.vars, .env*, coverage, playwright-report)
- ✅ Scaffold Vite + React + TS; enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ✅ ESLint (typescript-eslint, react-hooks, jsx-a11y, `no-restricted-syntax` for `dangerouslySetInnerHTML`), Prettier
- ✅ Tailwind CSS, base layout, skip link, header/footer, disclaimer banner
- ✅ Vitest + RTL + vitest-axe; Playwright + axe
- ✅ `wrangler.toml`, `.dev.vars.example`, `functions/api/health.ts`
- ✅ CI workflow green on an empty app
- 🟨 First deploy to Cloudflare Pages (hello world) – **prove hosting on day 1** (needs a Cloudflare login: `HUMAN_TASKS.md` #2 and #5; everything else is ready)
**Done when:** CI green, deployed URL shows the shell, `/api/health` returns ok.

## Phase 1 – Shared core (Day 2) · Est 6h
- ⬜ `shared/types.ts`, `shared/schemas.ts` (Zod), `shared/limits.ts`
- ⬜ `shared/normalize.ts` + `shared/verify.ts` with full tests (100% coverage)
- ⬜ `shared/lenses.ts`
- ⬜ `shared/rules/employment.ts` from `LEGAL_RULES.md` + tests for every rule
**Done when:** `npm test` covers verify + rules at 100%.

## Phase 2 – Parsing & segmentation (Day 3) · Est 6h
- ⬜ Lazy-loaded pdf.js parser with page tracking; scanned-PDF detection
- ⬜ Lazy-loaded mammoth DOCX parser; paste-text path
- ⬜ File guards: type sniffing, size/page/char limits
- ⬜ Segmenter + tests
- ⬜ Upload UI + parse preview ("32 clauses across 5 pages")
- ⬜ Synthetic sample offer letter in `src/sample/` + "Try with a sample" button
**Done when:** sample and a real test PDF produce sensible clauses with correct pages.

## Phase 3 – Secure backend (Day 4) · Est 6h
- ⬜ `_middleware.ts`: headers, body cap, origin check, error envelope
- ⬜ Turnstile verification + `/api/session` signed token
- ⬜ KV rate limiter + tests (in-memory KV fake)
- ⬜ `functions/lib/gemini.ts`: typed wrapper, timeout, retry, JSON repair retry, **mock mode**
- ⬜ `public/_headers` with CSP
**Done when:** unauthenticated/oversized/over-limit requests are rejected in tests.

## Phase 4 – Analyze (Day 5–6) · Est 10h
- ⬜ Prompts + response schema (`AI_PIPELINE.md` §3–4)
- ⬜ `/api/analyze`: validate → batch → Gemini → Zod → verify → rules
- ⬜ Record real responses into `tests/fixtures/gemini/` for mock mode
- ⬜ Lens picker UI
- ⬜ Report: Overview (summary fields with "Not stated"), red flags, rule cards
- ⬜ Clauses tab: filters, ClauseCard, **SideBySide** with `<mark>` highlight, verification badges
- ⬜ Loading/error states with live regions
**Done when:** sample doc yields verified HIGH flags with correct side-by-side highlights.

## Phase 5 – Ask (Day 7) · Est 6h
- ⬜ `/api/ask` with downgrade rule
- ⬜ Ask panel: suggested questions from lenses, answer cards with status, citation buttons → focus clause
- ⬜ Handler tests for all statuses
**Done when:** answerable → cited; unanswerable → "Your document doesn't say this".

## Phase 6 – Prepare & export (Day 8) · Est 5h
- ⬜ `/api/prepare` + rule-question merge
- ⬜ Prepare tab: checklist, questions for HR/lawyer, missing info, documents to bring
- ⬜ Export: print stylesheet, copy, download `.md`
**Done when:** exported file contains flagged clause texts and questions.

## Phase 7 – Accessibility & language (Day 9) · Est 6h
- ⬜ i18n helper + `en`, `hi` dictionaries; rule text translations
- ⬜ Reading-level toggle wired to prompts
- ⬜ Read-aloud component
- ⬜ Glossary popovers
- ⬜ Full keyboard + screen reader pass; fix axe findings; 200% zoom, 320 px
**Done when:** Lighthouse a11y ≥ 95, axe clean, keyboard-only journey passes in E2E.

## Phase 8 – Compare (Day 10) · Est 5h · *Should*
- ⬜ Deterministic clause matcher + tests
- ⬜ `/api/compare` + verification on both sides
- ⬜ Compare tab UI (Added/Removed/Changed table)

## Phase 9 – Quality & eval (Day 11) · Est 6h
- ⬜ Golden set (4–6 synthetic contracts + expected.json)
- ⬜ `scripts/eval.ts`; record metrics in README
- ⬜ Coverage thresholds met; E2E suite complete
- ⬜ Security checklist in `SECURITY.md` §4 all ticked
- ⬜ Bundle analysis; confirm lazy loading; Lighthouse mobile
- ⬜ Repo size check: `git count-objects -vH` well under 10 MB

## Phase 10 – Ship (Day 12–13) · Est 6h
- ⬜ Final production deploy, smoke test on phone
- ⬜ README polish: screenshots (compressed), metrics, rubric table
- ⬜ Record demo video (see `SUBMISSION.md`)
- ⬜ Publish technical blog post + LinkedIn build-in-public post
- ⬜ Submit: repo URL + live URL + blog + post
- ⬜ Keep one of the 3 submission attempts in reserve for fixes

---

## Stretch backlog (only after all Must items)
- Scanned PDF via Gemini document understanding with explicit consent
- Salary breakup explainer (estimates, clearly labelled)
- Context caching for long Q&A sessions
- More Indian languages
- Client-side PII redaction toggle

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Gemini free-tier rate limits during demo | Mock mode for dev; paid key or fresh quota on demo day; built-in sample with cached fixture as last resort (clearly labelled "demo data") |
| Poor PDF text extraction | Paste-text fallback; sample document; segmenter tests on varied layouts |
| Model returns bad JSON | Schema + Zod + repair retry + mock fixtures |
| Legal inaccuracy | Rule text reviewed against primary sources; cautious language; disclaimers |
| Scope creep | Freeze scope at end of Day 8; Compare is the only Should in the core plan |
| Repo size limit | No binaries, compressed screenshots, tiny fixtures |

## Daily log template
```
### Day N – YYYY-MM-DD
Done:
Blocked:
Decisions:
Next:
```

---

## Daily log

### Day 1 – 2026-09-20
Done: Phase 0 complete. Vite 8 + React 19 + TS 6 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) scaffold; three-project tsconfig split (app / functions / node);
ESLint 10 with type-aware rules, jsx-a11y, react-hooks and a `no-restricted-syntax` ban on
`dangerouslySetInnerHTML` / `eval` / `new Function`; Prettier; Tailwind v4 design tokens with
light and dark palettes; app shell with skip link, sticky header (language + reading level),
disclaimer banner on every screen and footer; i18n `t()` helper; preferences context backed by
`sessionStorage`; `functions/api/health.ts` + typed `Env`; `public/_headers` with CSP;
`wrangler.toml`, `.dev.vars.example`; secret-scan and bundle-budget scripts; GitHub Actions CI.
Blocked: nothing. Cloudflare deploy needs a human login (`HUMAN_TASKS.md`).
Decisions: D01–D10 in `docs/DECISIONS.md` — notably `gemini-3.8-flash` as the current stable
Flash model, TypeScript pinned to 6.0.3 for typescript-eslint support, and Pages Functions run
inside Vite locally because every `wrangler@4` needs Node 22 and this machine runs Node 20.
Gate: lint ✅ · typecheck ✅ · 31 tests, coverage 96.9% lines ✅ · build ✅ · initial JS 68.1 kB
gzip against a 180 kB budget ✅.
Next: Phase 1 — shared types, Zod schemas, limits, normalize/verify, lenses, India rule library.
