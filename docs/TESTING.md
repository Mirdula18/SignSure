# SignSure – Testing Strategy

## 1. Layers
| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `shared/*` (normalize, verify, rules, lenses, schemas), `functions/lib/*` (session, ratelimit, http), segmenter |
| API handler | Vitest + mocked Gemini + in-memory KV | Each `/api/*` route: happy path, validation errors, auth, rate limit, model failures, verification downgrade |
| Component | Vitest + React Testing Library + `vitest-axe` | Upload, LensPicker, ClauseCard, SideBySide, AskPanel states, PrepareSheet export |
| End-to-end | Playwright (Chromium + mobile viewport) + `@axe-core/playwright` | Full journeys against `wrangler pages dev` with `MOCK_GEMINI=true` |
| AI eval | `scripts/eval.ts` (real Gemini, manual/nightly) | Golden-set metrics (see AI_PIPELINE.md §9) |

## 2. Coverage targets
- `shared/` and `functions/lib/`: ≥ 90% lines, 100% for `verify.ts` and `rules/`.
- Overall: ≥ 80% lines. Enforced in `vitest.config.ts` thresholds.

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
- model returns invalid JSON twice → 502 MODEL_INVALID_OUTPUT
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
`tests/fixtures/contracts/`: synthetic `.txt` (and 1 tiny generated `.pdf`, < 50 KB) offer letters; `tests/fixtures/gemini/`: recorded JSON responses used by `MOCK_GEMINI` and handler tests. Keep all fixtures small.

## 5. CI (`.github/workflows/ci.yml`)
```yaml
name: ci
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:coverage
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env: { MOCK_GEMINI: 'true' }
      - name: secret scan
        run: "! git grep -nE 'AIza[0-9A-Za-z_-]{20,}'"
```
