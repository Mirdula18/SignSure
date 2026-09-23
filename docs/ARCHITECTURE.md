# SignSure – Architecture

## 1. Overview
SignSure is a single, standalone repository: a React single-page app served by **Cloudflare Pages**, with a thin backend in **Cloudflare Pages Functions** (`/functions`) that is the only component allowed to talk to the Gemini API.

Design rule: **deterministic code decides, the model explains.** Parsing, segmentation, page mapping, quote verification, and India-law red flags are plain TypeScript. Gemini classifies and explains clauses and answers questions, always returning structured JSON that the server validates and verifies before the UI sees it.

```mermaid
flowchart TB
  subgraph Browser
    A[Upload / paste] --> B[Parser<br/>pdf.js · mammoth]
    B --> C[Segmenter<br/>clauses with IDs + pages]
    C --> D[(In-memory store)]
    D --> E[Report UI]
  end
  subgraph Cloudflare Pages Functions
    M[_middleware<br/>headers · body limit · error shape]
    AN[/api/analyze]
    AS[/api/ask]
    CP[/api/compare]
    LP[/api/prepare]
    L[lib: gemini · verify · rules · ratelimit · session]
  end
  C -- clauses JSON --> M --> AN & AS & CP & LP
  AN & AS & CP & LP --> L --> G[(Gemini API)]
  L -- verified result --> D
  KV[(Workers KV<br/>rate-limit counters)] --- L
```

## 2. Repository layout
```
signsure/
├─ functions/                     # Cloudflare Pages Functions (server)
│  ├─ _middleware.ts              # security headers, JSON error envelope, body size cap
│  ├─ api/
│  │  ├─ session.ts               # POST: issue a signed, IP-bound session token
│  │  ├─ analyze.ts               # POST: classify + explain clauses
│  │  ├─ ask.ts                   # POST: grounded Q&A
│  │  ├─ compare.ts               # POST: compare two clause sets
│  │  ├─ prepare.ts               # POST: lawyer prep sheet
│  │  └─ health.ts                # GET: liveness (no secrets)
│  └─ lib/
│     ├─ env.ts                   # typed Env bindings
│     ├─ gemini.ts                # typed Gemini wrapper, retries, timeouts, mock mode
│     ├─ prompts.ts               # system prompts + builders
│     ├─ responseSchemas.ts       # Gemini response schemas
│     ├─ session.ts               # HMAC-signed short-lived token
│     ├─ ratelimit.ts             # KV fixed-window limiter, hashed IP keys
│     ├─ http.ts                  # json(), error(), parseBody(zod)
│     └─ mock/                    # fixture responses for MOCK_GEMINI
├─ shared/                        # pure TS used by BOTH browser and functions
│  ├─ types.ts                    # Clause, AnalysisResult, AskResult …
│  ├─ schemas.ts                  # Zod schemas for requests & responses
│  ├─ normalize.ts                # text normalisation for matching
│  ├─ verify.ts                   # quote verification
│  ├─ rules/                      # India employment rule library
│  │  ├─ index.ts
│  │  └─ employment.ts
│  ├─ lenses.ts                   # concern lenses → category weights
│  └─ limits.ts                   # size/page/char limits (single source of truth)
├─ src/                           # React app
│  ├─ main.tsx, App.tsx
│  ├─ components/                 # generic UI (Button, Tabs, Badge, Dialog, Skeleton)
│  ├─ features/
│  │  ├─ upload/                  # Dropzone, paste text, sample
│  │  ├─ session/                 # SessionGate
│  │  ├─ parsing/                 # pdfParser.ts, docxParser.ts, segmenter.ts
│  │  ├─ lenses/
│  │  ├─ report/                  # Overview, ClauseList, SideBySide, RedFlagCard, RuleCard
│  │  ├─ ask/
│  │  ├─ compare/
│  │  ├─ prepare/                 # checklist, export
│  │  └─ a11y/                    # ReadAloud, ReadingLevel, LanguageSwitch
│  ├─ state/                      # context + reducer (no external state lib)
│  ├─ api/client.ts               # fetch wrapper, typed, zod-validated responses
│  ├─ i18n/                       # en.ts, hi.ts (+ ta.ts etc.), t() helper
│  ├─ sample/                     # built-in synthetic sample offer letter (text)
│  └─ styles/
├─ tests/                         # Vitest unit & component tests, fixtures
│  └─ fixtures/contracts/         # synthetic contracts + expected results
├─ e2e/                           # Playwright specs
├─ scripts/eval.ts                # golden-set evaluation against real Gemini
├─ public/_headers                # static security headers (CSP etc.)
├─ .github/workflows/ci.yml
├─ wrangler.toml
├─ .dev.vars.example
├─ README.md, docs/
└─ package.json, tsconfig*.json, vite.config.ts, eslint.config.js
```

## 3. Core data model (`shared/types.ts`)
```ts
export type ClauseCategory =
  | 'NOTICE_PERIOD' | 'BOND_OR_EXIT_PENALTY' | 'NON_COMPETE' | 'NON_SOLICIT'
  | 'CONFIDENTIALITY' | 'IP_ASSIGNMENT' | 'COMPENSATION' | 'PROBATION'
  | 'TERMINATION' | 'WORKING_HOURS_LEAVE' | 'BENEFITS' | 'MOONLIGHTING'
  | 'DISPUTE_RESOLUTION' | 'DOCUMENT_RETENTION' | 'GENERAL' | 'OTHER';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface Clause {
  id: string;            // stable, e.g. "c012"
  label: string | null;  // detected numbering, e.g. "7.2" or "(b)"
  heading: string | null;
  text: string;          // original text, never modified
  page: number | null;   // 1-based; null for DOCX/paste (use paragraph index)
  order: number;
}

export interface VerifiedQuote {
  clauseId: string;
  quote: string;
  status: 'verified' | 'fuzzy' | 'unverified';
  start?: number; end?: number; // offsets in clause.text for highlighting
}

export interface ClauseFinding {
  clauseId: string;
  category: ClauseCategory;
  risk: RiskLevel;
  title: string;          // short, plain
  explanation: string;    // plain language, reading-level aware
  whyItMatters: string;
  evidence: VerifiedQuote;
  questionsToAsk: string[];
  modelConfidence: 'high' | 'medium' | 'low';
}

export interface RuleHit {
  ruleId: string;         // e.g. "IN-EMP-NONCOMPETE-POST"
  clauseId: string;
  severity: RiskLevel;
  title: string;
  message: string;        // pre-written, reviewed text
  basis: string;          // statute / case reference
  lastReviewed: string;   // ISO date
}

export interface AskResult {
  status: 'answered' | 'not_in_document' | 'needs_professional';
  answer: string;
  citations: VerifiedQuote[];
  missingInfo: string[];
  suggestedQuestions: string[];
}
```

## 4. Request flow

### 4.1 Session
1. Once a document is loaded, `App` mounts `SessionGate`, which calls `POST /api/session` with an empty body. It renders nothing, and stays mounted across the concern and report screens until a session exists. Nothing is proved to get a token: the endpoint is open, and what limits abuse is the per-address rate limit on it and on every route behind it.
2. Server verifies with Cloudflare siteverify, returns `{ token }`: an HMAC-SHA256 signed payload `{ iat, exp (30 min), ipHash }`.
3. All other `/api/*` calls send `Authorization: Bearer <token>`. The token is bound to a hashed IP and expires after thirty minutes, so a script cannot spread one address's budget across many callers.

### 4.2 Analyze
```
POST /api/analyze
{ clauses: Clause[], lenses: Lens[], language: 'en'|'hi'|..., readingLevel: 'simple'|'standard' }
→ { documentSummary, findings: ClauseFinding[], ruleHits: RuleHit[], stats: { verified, fuzzy, unverified } }
```
Server steps:
1. Validate with Zod; enforce `shared/limits.ts`.
2. Rate-limit (KV) by hashed IP + session.
3. Build prompt: clauses serialised as `[[c012 | 7.2 | p3]] text` inside `<document>` delimiters.
4. Call Gemini with `responseMimeType: application/json` + response schema. For > 80 clauses, split into batches and run in parallel (`Promise.all`, max 4).
5. Validate model JSON with Zod; drop unknown clause IDs.
6. `verifyQuote()` each finding's evidence against the referenced clause text.
7. Run rule engine over clauses + model categories → `RuleHit[]`.
8. Findings with `unverified` evidence are returned with `evidence.status = 'unverified'`; the UI labels them and excludes them from red-flag counts.

### 4.3 Ask
```
POST /api/ask { clauses, question, history?: last 4 Q/A, language, readingLevel }
→ AskResult
```
Server post-rule: if `status === 'answered'` but zero citations verify → downgrade to `not_in_document` with message "I couldn't find support for an answer in your document."

### 4.4 Compare
Deterministic first: pair clauses across A/B by matching label, then by token-set similarity (Jaccard ≥ 0.35), with each clause tokenised once. Gemini only summarises *meaningful* differences per pair and returns quotes from both sides, each verified.

### 4.5 Prepare
Input: findings + ruleHits + unanswered questions. Output: checklist, questions for HR, questions for a lawyer, missing information, documents to bring. Rule-engine questions are always included verbatim.

## 5. Client-side parsing & segmentation
- **PDF:** `pdfjs-dist`, loaded with dynamic `import()` only after a file is chosen. Worker via `?url` import. For each page, join `textContent.items` using `hasEOL` and y-position changes to rebuild lines. Keep `page` per line.
- **Scanned detection:** if total extracted chars / pages < 100 → treat as scanned; show message (F16 stretch: consented Gemini OCR).
- **DOCX:** `mammoth.extractRawText` (dynamic import). No page concept → `page: null`, show "Paragraph N" instead.
- **Segmenter (`src/features/parsing/segmenter.ts`):** line-based state machine. A new clause starts at lines matching:
  - `^\s*(\d+(\.\d+){0,3})[.)]?\s+\S` (1. / 1.1 / 2.3.4)
  - `^\s*(Clause|Section|Article)\s+\d+` (case-insensitive)
  - `^\s*\(?[a-z]{1}\)\s+` or `^\s*\(?[ivx]{1,4}\)\s+` (sub-items, attached to parent if short)
  - ALL-CAPS heading lines ≤ 8 words
  - Fallback: blank-line paragraphs, merged until ≥ 200 chars, split if > 2,000 chars at sentence boundary.
- IDs: `c` + zero-padded order (`c001`). A clause spanning pages gets the **starting** page and a `pageEnd`.

## 6. Quote verification (`shared/verify.ts`)
```
normalize(s): NFKC → lower-case → curly quotes/dashes → ASCII → collapse whitespace → strip soft hyphens and zero-width chars
verifyQuote(clauseText, quote):
  if len(quote) < 12 → 'unverified' (too short to be meaningful)
  if normalize(clauseText).includes(normalize(quote)) → 'verified' (+ offsets mapped back)
  else token-sequence similarity over sliding window ≥ 0.9 → 'fuzzy'
  else → 'unverified'
```
The model supplies **clauseId + quote**; the page shown to the user always comes from our own `Clause.page`, never from the model.

## 7. Rule engine (`shared/rules`)
Each rule: `{ id, appliesTo: ClauseCategory[], test(clause, finding?) => boolean, severity, title, message, basis, questions[], lastReviewed }`. Rules use regex/keyword tests (e.g. non-compete + time period after "termination|cessation|leaving"). Content lives in [`LEGAL_RULES.md`](LEGAL_RULES.md). Runs server-side in `/api/analyze`, and is unit-tested with fixtures.

## 8. State management
React Context + `useReducer` in `src/state/`. State: `document`, `clauses`, `lenses`, `analysis`, `qa[]`, `compare`, `prefs (language, readingLevel)`. Nothing persisted by default; optional `sessionStorage` for prefs only.

## 9. Error model
All API errors: `{ error: { code, message, retryable } }` with codes `INVALID_INPUT`, `TOO_LARGE`, `RATE_LIMITED`, `UNAUTHORIZED`, `MODEL_BLOCKED`, `MODEL_INVALID_OUTPUT`, `UPSTREAM_TIMEOUT`, `INTERNAL`. Never leak stack traces or model raw output. Client maps codes to i18n messages.

Gemini wrapper: 25 s timeout via `AbortController`; one retry on 429/5xx with jittered backoff; on invalid JSON, one repair retry with "Return valid JSON only"; then `MODEL_INVALID_OUTPUT`.

## 10. Performance budgets
| Budget | Target |
|---|---|
| Initial JS (gzip) | < 180 KB (pdf.js, mammoth lazy-loaded) |
| LCP (4G mobile) | < 2.5 s |
| Analyze 5-page doc | < 15 s p50 |
| Functions CPU per request | well under 10 ms free-tier cap: no parsing server-side, only validation, string matching, rules |
| Payload | ≤ 120k chars of clause text per request |

Token efficiency: send text not PDF bytes; one batched classification call; `temperature: 0.2`; bounded `maxOutputTokens`; thinking budget low for classification; context caching (stretch) for multi-question sessions.

## 11. Configuration
`wrangler.toml` binds `RATE_LIMIT_KV`. Secrets: `GEMINI_API_KEY`, `SESSION_SECRET`, `IP_HASH_SALT`. Vars: `GEMINI_MODEL` (default Flash, verify latest ID at build time), `GEMINI_THINKING`, `MOCK_GEMINI`, `ALLOWED_ORIGIN`. The client needs no build-time variables.
