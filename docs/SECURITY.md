# SignSure – Security & Privacy

## 1. Principles
1. **The Gemini key never reaches the browser.** Only Pages Functions call Gemini.
2. **Collect nothing we don't need.** Documents are parsed on-device; only clause text is sent, processed in memory, and discarded.
3. **Treat all input as hostile:** files, clause text, questions, and model output.
4. **Fail closed** with generic error messages.

## 2. Threat model
| Threat | Impact | Control |
|---|---|---|
| API key theft | Quota/billing abuse | Key only as Cloudflare secret; never in `VITE_*` vars; CI grep check for `AIza` patterns; `.dev.vars` gitignored |
| Proxy abuse / denial-of-wallet | Quota exhaustion | Signed session token bound to a hashed IP; KV rate limits on every route including session issuing; payload caps; per-request batch cap. **No human check**, so the limits are the only defence: keep an eye on Gemini usage if the URL is shared widely |
| Prompt injection in document | Model ignores rules, fake citations | Delimited `<document>`, explicit "data not instructions" rule, strict JSON schema, server-side quote verification, rule text never model-generated |
| Prompt injection in question | Same | Question length cap (500 chars), same rules, verification |
| XSS via model or document text | Session/UI compromise | React escaping only; **no `dangerouslySetInnerHTML`** (ESLint rule); strict CSP; highlight via text splitting, not HTML |
| Malicious files (zip bombs, huge PDFs) | Browser hang | Type sniffing (magic bytes `%PDF`, `PK`), 10 MB cap, 40-page cap, parse in try/catch with timeout |
| Oversized API payloads | CPU/cost | 256 KB request body cap in middleware; Zod max lengths |
| PII leakage | Privacy harm | No server logging of bodies; optional client-side redaction of emails/phones/PAN/Aadhaar-like numbers before sending; no analytics on content |
| CSRF / cross-origin use | Abuse | Bearer token (not cookies); writes must come from the same origin or `ALLOWED_ORIGIN`; no permissive CORS |
| Clickjacking | UI redress | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Dependency vulnerabilities | Supply chain | `npm audit` in CI, lockfile, minimal dependencies, Dependabot |
| Hallucinated legal claims | User harm | Verification pipeline, refusal path, reviewed rule text, disclaimers, escalation language |

## 3. Controls in detail

### 3.1 Secrets
| Name | Where |
|---|---|
| `GEMINI_API_KEY` | `wrangler pages secret put` / dashboard → Encrypted |
| `SESSION_SECRET` | secret (32+ random bytes) |
| `IP_HASH_SALT` | secret |

### 3.2 Session token
`base64url(payload).base64url(HMAC_SHA256(SESSION_SECRET, payload))`, payload `{ iat, exp, ih }` where `ih` = first 16 hex of `SHA-256(IP_HASH_SALT + ip)`. Verified with Web Crypto `crypto.subtle` using constant-time compare. Lifetime 30 min.

### 3.3 Rate limits (Workers KV, fixed window)
| Route | Limit |
|---|---|
| `/api/session` | 10 / 10 min / IP |
| `/api/analyze` | 8 / hour / IP |
| `/api/ask` | 40 / hour / IP |
| `/api/compare`, `/api/prepare` | 10 / hour / IP |
Keys: `rl:{route}:{ipHash}:{windowStart}` with `expirationTtl`. KV is eventually consistent, so limits are approximate; acceptable for this threat level and documented as such.

### 3.4 Validation
- Zod on every request body; unknown keys stripped.
- Limits from `shared/limits.ts`: max 400 clauses, 4,000 chars per clause, 120,000 total chars, question 500 chars.
- Model output also Zod-validated; clause IDs must exist in the request.

### 3.5 Headers (`public/_headers` for static, `_middleware.ts` for API)
The authoritative copy is `public/_headers`, pinned by `tests/headers.test.ts`:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; frame-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```
`style-src 'unsafe-inline'` is a deliberate trade-off; inline *scripts* stay
blocked. API responses also set `Cache-Control: no-store`.

### 3.6 Privacy (aligned with the spirit of India's DPDP Act, 2023)
- Purpose limitation: text is used only to produce the requested analysis.
- Data minimisation: raw file never uploaded; optional redaction.
- No storage: no database, no document logs; KV holds only hashed-IP counters with TTL. The one thing held at all is a response cache in the Worker isolate's memory: validated model output for up to 10 minutes, keyed by a SHA-256 of the request, never written to KV or disk. An entry can only be reached by sending the identical document text, so it gives nothing to anyone who does not already have the document.
- Transparency: a plain-language Privacy page explaining exactly what is sent to Google's Gemini API. Note that free-tier Gemini API usage may be used by Google to improve products; production should use a paid tier.
- User control: "Clear everything" button wipes in-memory state.

## 4. Security checklist (verify before each submission)
- [x] `git grep -nE "AIza[0-9A-Za-z_-]{20,}"` returns nothing — verified 2026-09-21; `npm run secretscan` (run in CI) checks this and five other credential shapes on every push.
- [x] `.dev.vars`, `.env*` in `.gitignore` — `.dev.vars`, `.dev.vars.*`, `.env`, `.env.*` ignored; only the `.example` files are tracked.
- [x] No `dangerouslySetInnerHTML`, no `eval`, no `new Function` — banned by three `no-restricted-syntax` selectors in `eslint.config.js` (lint runs in CI); `git grep` finds them only in comments explaining the ban.
- [ ] CSP header present on deployed site (check with securityheaders.com) — **needs the live URL**, so it is checked right after the first deploy. The file that sets it, `public/_headers`, is pinned by `tests/headers.test.ts`: no inline or eval script, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.
- [x] Calling `/api/analyze` without token → 401 — `e2e/security.spec.ts` ("rejects /api/analyze without a session token", plus forged and replayed-from-another-network tokens).
- [x] 9th analyze in an hour → 429 — `e2e/security.spec.ts` ("refuses the ninth analysis from one address within the hour") and `functions/lib/ratelimit.test.ts`.
- [x] 300 KB body → 413 — `e2e/security.spec.ts` ("rejects a 300 KB body before the route reads it") and `functions/_middleware.test.ts`.
- [x] Injection fixture ("Ignore previous instructions…" inside a clause) does not change behaviour — deterministic half: `functions/lib/prompts.test.ts` (fence and marker forging), `tests/golden.test.ts` (injection contract), `e2e/security.spec.ts` (response shape and verification unchanged). Model half: `npm run eval` fails on any injection violation; run it with a real key before submitting.
- [x] `npm audit --omit=dev` has no high/critical — 0 vulnerabilities (full `npm audit` also 0), 2026-09-21.
