# SignSure – Project Planner

**Goal:** a deployed, tested, accessible SignSure submitted on Cloudflare Pages, with blog + LinkedIn post, before the deadline.
**Rule of thumb:** a working, verified, *narrow* product beats a broad unfinished one. Must-haves first, stretch only when all Must boxes are ticked.

Legend: ⬜ todo · 🟨 in progress · ✅ done · ➖ replaced (see the note) · Est = focused hours

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
- ✅ `shared/types.ts`, `shared/schemas.ts` (Zod), `shared/limits.ts`
- ✅ `shared/normalize.ts` + `shared/verify.ts` with full tests (100% coverage)
- ✅ `shared/lenses.ts`
- ✅ `shared/rules/employment.ts` from `LEGAL_RULES.md` + tests for every rule (16 rules, 6 missing-information checks)
**Done when:** `npm test` covers verify + rules at 100%. ✅ Enforced as a coverage threshold.

## Phase 2 – Parsing & segmentation (Day 3) · Est 6h
- ✅ Lazy-loaded pdf.js parser with page tracking; scanned-PDF detection
- ✅ Lazy-loaded mammoth DOCX parser; paste-text path
- ✅ File guards: type sniffing, size/page/char limits
- ✅ Segmenter + tests (section titles fold into their clauses, D39)
- ✅ Upload UI + parse preview ("We found 32 clauses across 5 pages")
- ✅ Synthetic sample offer letter in `src/sample/` + "Try with a sample" button
**Done when:** sample and a real test PDF produce sensible clauses with correct pages. 🟨 The sample and six golden contracts are checked in tests, and the PDF parser's page tracking is tested with pdf.js stubbed. A smoke test with a real PDF on the deployed site is on the Phase 10 list.

## Phase 3 – Secure backend (Day 4) · Est 6h
- ✅ `_middleware.ts`: headers, body cap, origin check, error envelope
- ✅ Turnstile verification + `/api/session` signed token
- ✅ KV rate limiter + tests (in-memory KV fake)
- ✅ `functions/lib/gemini.ts`: typed wrapper, timeout, retry, JSON repair retry, **mock mode**
- ✅ `public/_headers` with CSP (pinned by `tests/headers.test.ts`)
**Done when:** unauthenticated/oversized/over-limit requests are rejected in tests. ✅ Unit and E2E.

## Phase 4 – Analyze (Day 5–6) · Est 10h
- ✅ Prompts + response schema (`AI_PIPELINE.md` §3–4)
- ✅ `/api/analyze`: validate → batch → Gemini → Zod → verify → rules
- ➖ Record real responses into `tests/fixtures/gemini/` for mock mode — replaced: mock mode builds responses from the prompt's own clauses so verification stays real (D19). Recording live responses needs a key.
- ✅ Lens picker UI
- ✅ Report: Overview (summary fields with "Not stated"), red flags, rule cards
- ✅ Clauses tab: filters, ClauseCard, **SideBySide** with `<mark>` highlight, verification badges
- ✅ Loading/error states with live regions
**Done when:** sample doc yields verified HIGH flags with correct side-by-side highlights. ✅ `e2e/journey.spec.ts`.

## Phase 5 – Ask (Day 7) · Est 6h
- ✅ `/api/ask` with downgrade rule
- ✅ Ask panel: suggested questions from lenses, answer cards with status, citation buttons → focus clause
- ✅ Handler tests for all statuses
**Done when:** answerable → cited; unanswerable → "Your document doesn't say this". ✅

## Phase 6 – Prepare & export (Day 8) · Est 5h
- ✅ `/api/prepare` + rule-question merge (in the sheet's language, D41)
- ✅ Prepare tab: checklist, questions for HR/lawyer, missing info, documents to bring
- ✅ Export: print stylesheet, copy, download `.md`
**Done when:** exported file contains flagged clause texts and questions. ✅

## Phase 7 – Accessibility & language (Day 9) · Est 6h
- ✅ i18n helper + `en`, `hi` dictionaries; rule text translations (drafted, awaiting a Hindi reviewer: `HUMAN_TASKS.md` 8)
- ✅ Reading-level toggle wired to prompts
- ✅ Read-aloud component
- ✅ Glossary (inline disclosure rather than popovers, D25)
- ✅ Full keyboard + screen reader pass; fix axe findings; 200% zoom, 320 px
**Done when:** Lighthouse a11y ≥ 95, axe clean, keyboard-only journey passes in E2E. ✅ Lighthouse accessibility 100 (desktop and mobile), axe clean on every screen, keyboard journey in `e2e/accessibility.spec.ts`.

## Phase 8 – Compare (Day 10) · Est 5h · *Should*
- ✅ Deterministic clause matcher + tests
- ✅ `/api/compare` + verification on both sides
- ✅ Compare tab UI (Added/Removed/Changed table)

## Phase 9 – Quality & eval (Day 11) · Est 6h
- ✅ Golden set (6 synthetic contracts + expected.json)
- 🟨 `scripts/eval.ts`; record metrics in README — harness built and checked with `--mock`; offline golden results are in the README; live figures need a Gemini key (`HUMAN_TASKS.md` 1)
- ✅ Coverage thresholds met; E2E suite complete
- 🟨 Security checklist in `SECURITY.md` §4 all ticked — all but the live-site CSP check, which needs the deployed URL
- ✅ Bundle analysis; confirm lazy loading; Lighthouse mobile
- ✅ Repo size check: `git count-objects -vH` well under 10 MB (1.9 MB tracked)

## Phase 10 – Ship (Day 12–13) · Est 6h
- ⬜ Final production deploy, smoke test on phone (`HUMAN_TASKS.md` 2–5)
- ✅ README polish: screenshots (compressed), metrics, rubric table
- ⬜ Record demo video (see `SUBMISSION.md`)
- ⬜ Publish technical blog post + LinkedIn build-in-public post (draft: `docs/BLOG_DRAFT.md`)
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

### Day 2 – 2026-09-21
Done: Phases 1–8 built and tested. Shared core (types, Zod schemas, NFKC normalisation with
separate start/end maps, quote verification with a token-level fuzzy fallback, concern lenses,
16 India rules and 6 missing-information checks at 100% coverage); browser parsing (lazy pdf.js
and mammoth, file guards, segmenter); secure backend (middleware, Turnstile-backed HMAC
sessions, KV rate limits, Gemini wrapper with retry and JSON repair, mock mode); analyze, ask,
compare and prepare routes and their UI; English and Hindi; read-aloud and glossary; axe,
keyboard, 320 px and 200% zoom checks in E2E. Review passes found and fixed bugs in session
handling, the prompt sanitiser, compare verification and several screen-reader paths. Golden
set of six synthetic contracts; `npm run eval`.
Blocked: live model evaluation and deployment need a Gemini key and a Cloudflare login.
Decisions: D12–D34, notably code-only category steering of rules (D21), exact-only quotes in
compare (D28) and the sentence-aware segmenter merge (D31).
Gate: lint ✅ · typecheck ✅ · 1,463 unit tests, 99.69% lines ✅ · build ✅ · 76 E2E ✅.
Next: hardening passes.

### Day 3 – 2026-09-22
Done: Hardening. Security: every prompt fence tag sanitised (D38), same-origin writes always
accepted so preview deployments work (D35), CSP pinned by test, secret scan made strict again.
Efficiency: the report and the Turnstile script load only when needed (D36, D37); initial JS
117 kB gzip; Lighthouse accessibility, best practices and SEO 100. Correctness: the security
check could be torn down mid-challenge and leave the report waiting forever (fixed, D37);
section titles no longer become clauses (D39); the demo data now matches the sample letter
(D40). Language: Hindi rule cards, category names and preparation-sheet lines (D41). Code
quality: duplicate helpers and unused types removed, every exported function documented.
README rewritten with screenshots and measured figures. Commit authorship corrected to the
repository owner.
Blocked: as Day 2 — deployment, live eval, demo video and posts are in `HUMAN_TASKS.md`.
Decisions: D35–D41.
Gate: lint ✅ · typecheck ✅ · 1,569 unit tests, 99.88% lines ✅ · build ✅ · 76 E2E ✅.
Next: blog draft, judge review, final report.
