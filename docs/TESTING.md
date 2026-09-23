# SignSure – Testing Strategy

## 1. Layers
| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `shared/*` (normalize, verify, rules, lenses, schemas), `functions/lib/*` (session, ratelimit, http), segmenter |
| API handler | Vitest + mocked Gemini + in-memory KV | Each `/api/*` route: happy path, validation errors, auth, rate limit, model failures, verification downgrade |
| Component | Vitest + React Testing Library + `vitest-axe` | Upload, LensPicker, ClauseCard, SideBySide, AskPanel states, PrepareSheet export |
| End-to-end | Playwright (Chromium desktop + Pixel 7) + `@axe-core/playwright` | Full journeys, accessibility and security suites against `vite build` + `vite preview` with the Pages Functions mounted in-process (`tools/pagesFunctions.ts`) and `MOCK_GEMINI=true`. Wrangler needs Node 22, so it is used to deploy, not to test. |
| Golden set (offline) | Vitest, `tests/golden.test.ts` | Six synthetic contracts: segmentation, the rule library and missing-information rules against expectations a reader would agree with. Runs on every `npm test`, no key needed. |
| Config | Vitest, `tests/headers.test.ts` | Pins the CSP and hardening headers in `public/_headers`, which the preview server does not serve. |
| AI eval | `npm run eval` (real Gemini, manual) · `npm run eval -- --mock` (harness check) | Golden set through the live HTTP API; metrics in `tests/evalMetrics.ts` (unit tested). See AI_PIPELINE.md §9. |

## 2. Coverage targets
- Overall: ≥ 80% lines, statements, branches and functions.
- 100% for `shared/verify.ts`, `shared/normalize.ts` and everything in `shared/rules/`.
- Both enforced as thresholds in `vitest.config.ts`; CI fails below them. Actual figures are in the README.

## 3. Must-have test cases
**verify.ts**
- exact match → verified with correct offsets
- curly vs straight quotes, extra whitespace, line breaks, soft hyphens → verified
- one word changed → fuzzy
- quote from a different clause → unverified
- quote shorter than 12 chars → unverified
- Hindi/Devanagari text normalisation

**segmenter**
- numbered clauses (1., 1.1, 1.1.1), "Clause 5", "(a)/(i)" sub-items, ALL-CAPS headings
- clause spanning two pages keeps start page + pageEnd
- no numbering → paragraph fallback with size bounds
- empty/whitespace input → []

**rules**
- each rule: ≥ 2 positive and ≥ 2 negative fixtures
- NONCOMPETE-POST vs NONCOMPETE-DURING distinction
- bond amount extraction: "Rs. 2,00,000", "₹2 lakh", "INR 150000"

**api/ask**
- model says answered, citations verify → answered
- model says answered, citations fail → downgraded to not_in_document
- model returns unknown clause ID → citation dropped
- model returns invalid JSON on the first call, the retry and the JSON-only repair attempt (three calls) → 502 MODEL_INVALID_OUTPUT (`functions/lib/gemini.test.ts`)
- missing token → 401; bad body → 400; big body → 413

**security**
- prompt-injection fixture clause does not alter response shape
- no secret values appear in any error response

**e2e**
1. Sample document → lenses → report shows ≥1 HIGH flag with verified badge → open side-by-side → original text highlighted.
2. Ask answerable question → citation button scrolls/focuses clause.
3. Ask unanswerable question → "Your document doesn't say this".
4. Switch to Hindi + simple reading level → UI strings change.
5. Prepare → download `.md` file contains flagged clause text.
6. Keyboard-only journey (no mouse) completes steps 1–3.
7. axe scan on every screen: 0 serious/critical.
8. Upload `.exe` renamed `.pdf` → rejected.

## 4. Fixtures
- `tests/fixtures/contracts/`: six synthetic `.txt` offer letters with `.expected.json` beside each (fair, bond-heavy, its revised version for Compare, non-compete-heavy, missing-notice, prompt-injection). Under 20 KB in total, enforced by a test.
- Mock mode does not replay recorded responses. `functions/lib/mock/` builds each response from the clause text in the prompt, so quotes still go through real verification. Recording real responses is a possible follow-up.
- No binary fixtures. The PDF and DOCX parser tests stub pdf.js and mammoth at their boundary and test our code around them: page numbering, the scanned-PDF check, error mapping. The E2E suite builds its "executable renamed to .pdf" file in memory.

## 5. CI (`.github/workflows/ci.yml`)
Node 22 on Ubuntu, on every push to `main` and every pull request:
secret scan → lint → typecheck → format check → `test:coverage` (thresholds enforced) → build →
bundle budget (`npm run size`) → Playwright (Chromium, `MOCK_GEMINI=true`), with the report
uploaded on failure. A second job runs `npm audit --omit=dev --audit-level=high`.
`npm run eval` is deliberately not in CI: it spends real quota and varies from run to run.
