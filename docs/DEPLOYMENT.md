# SignSure – Deployment (Cloudflare Pages)

## 1. Prerequisites
- Cloudflare account, GitHub repo, Node 20+, `npx wrangler login`.
- Gemini API key from Google AI Studio.
- Turnstile widget created in the Cloudflare dashboard (domain = your `*.pages.dev` + `localhost`).

## 2. `wrangler.toml`
```toml
name = "signsure"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

[vars]
GEMINI_MODEL = "gemini-3.8-flash"   # confirm the latest stable Flash ID before submitting
GEMINI_THINKING = "minimal"          # or "auto" for a model that rejects the setting
MOCK_GEMINI = "false"
ALLOWED_ORIGIN = "https://signsure.pages.dev"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<created-with: npx wrangler kv namespace create RATE_LIMIT_KV>"
```

## 3. Local development
`.dev.vars.example` (copy to `.dev.vars`, never commit):
```
GEMINI_API_KEY=
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SESSION_SECRET=change-me-32-bytes-min
IP_HASH_SALT=change-me
MOCK_GEMINI=true
ALLOWED_ORIGIN=http://localhost:5173
```
`.env.local` (frontend): `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's always-pass test key).

Scripts:
```json
{
  "dev": "vite",
  "dev:api": "wrangler pages dev --port 8788 --compatibility-date=2026-09-01 -- vite build --watch",
  "preview:full": "npm run build && wrangler pages dev dist --port 8788"
}
```
`vite.config.ts` proxies `/api` → `http://localhost:8788`. If the watch combo is awkward, use `preview:full` for full-stack checks.

## 4. Production deploy
**Option A – Git integration (recommended):** Pages → Create project → connect GitHub repo → build command `npm run build`, output `dist`, env var `NODE_VERSION=20`. Add secrets under Settings → Variables and Secrets (type *Secret*): `GEMINI_API_KEY`, `TURNSTILE_SECRET_KEY`, `SESSION_SECRET`, `IP_HASH_SALT`. Add build variable `VITE_TURNSTILE_SITE_KEY`. Bind KV namespace `RATE_LIMIT_KV`.

**Option B – CLI:**
```bash
npm run build
npx wrangler pages deploy dist --project-name signsure
npx wrangler pages secret put GEMINI_API_KEY --project-name signsure
```

## 5. Post-deploy checks
- `GET /api/health` → `{ ok: true }` (no config values leaked).
- Security headers present (securityheaders.com or `curl -I`).
- Full journey with the sample document on a real phone.
- Turnstile works on the production domain.
- Lighthouse (mobile): Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.

## 6. Limits to remember
- Pages Functions run on the Workers runtime and count towards your Workers plan, so the Workers CPU limit applies: **10 ms of CPU per request on the Free plan**, 30 s by default on the Paid plan (Cloudflare limits page, checked 2026-09-23). Waiting on Gemini is not CPU, so the model call itself is free; our own work is not. Measured locally: quote verification and the rule engine on a 26-clause letter are a few milliseconds, but comparing two 150-clause versions is about 120 ms. **A long document on the Free plan can exceed 10 ms and fail with error 1102.** Use the Workers Paid plan for anything beyond the sample, and keep parsing in the browser.
- Workers free plan subrequest cap per invocation; batch Gemini calls (≤ 4 parallel).
- Gemini free-tier RPM/RPD are low; keep `MOCK_GEMINI` for development and use the real key for demo/eval. Consider a paid key for judging day.

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| `/api/*` returns HTML | Functions not detected; ensure `functions/` at repo root and deploy via Pages, not static upload only |
| pdf.js worker fails in prod | Check CSP `worker-src 'self' blob:` and `?url` worker import |
| Turnstile "invalid domain" | Add the production hostname to the widget |
| 500 with `MODEL_INVALID_OUTPUT` | Inspect schema mismatch in local mock; ensure `responseSchema` matches Zod |
