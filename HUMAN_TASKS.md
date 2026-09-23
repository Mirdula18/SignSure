# Things only you can do

Everything else in SignSure is built, tested and runnable offline with `MOCK_GEMINI=true`.
These tasks need your accounts or your face. Each one should take a few minutes.

Work top to bottom. Items 1–5 are needed for a live deployment; 6–9 are for the submission.

---

## 1. Gemini API key (5 min)

1. Open <https://aistudio.google.com/apikey> and sign in.
2. **Create API key** → pick or create a Google Cloud project → copy the key (starts with `AIza…`).
3. Local use: put it in `.dev.vars` (already gitignored):
   ```
   GEMINI_API_KEY=AIza...
   MOCK_GEMINI=false
   ```
4. Check it works without deploying anything (one contract, about a minute):
   ```bash
   npm run eval -- --only fair-offer
   ```
5. Then run the whole golden set once (about 3 minutes, ~20 requests, paced for the free tier)
   and paste the table it prints into the **Evaluation** section of `README.md`:
   ```bash
   npm run eval
   ```
   It exits non-zero if quote verification is under 95%, if any "not in the document" question
   was answered, or if the prompt-injection contract changed the model's behaviour. Full results
   land in `eval-results/` (gitignored). If it fails, send me the printed lists; each one names
   the contract and the rule or question involved.

> **The free tier allows 20 requests per day, per model.** Measured on 2026-09-23 with your key:
> `GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit: 20, model: gemini-3.8-flash`. One
> full `npm run eval` is about 16 model calls, so it fits once a day and leaves nothing for
> trying the app. Enable billing on the Google Cloud project before judging day: it also keeps
> your documents out of Google's product improvement, which the free tier does not (see
> `docs/SECURITY.md` §3.6). The quota is per model, so switching `GEMINI_MODEL` (for example to
> `gemini-3.6-flash`) gives a separate daily allowance.
>
> **Free-tier capacity is not guaranteed either.** On 2026-09-23 several Flash models answered
> 503 "This model is currently experiencing high demand" for minutes at a time, which is why the
> live eval has not been completed yet. Billing removes both problems; enable it before the demo
> rather than on the day.

---

## 2. Cloudflare account and Pages project (5 min)

1. Sign up / log in at <https://dash.cloudflare.com>.
2. Install Node 22 or newer **once** (wrangler refuses to run on Node 20):
   ```bash
   nvm install 22 && nvm use 22   # or volta install node@22
   ```
3. Authenticate: `npx wrangler login`
4. Create the project:
   ```bash
   npm run build
   npx wrangler pages project create signsure --production-branch main
   ```

---

## 3. KV namespace for rate limiting (2 min)

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Copy the printed `id` into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.
Then bind it in the dashboard: **Workers & Pages → signsure → Settings → Bindings → KV namespace**,
variable name `RATE_LIMIT_KV`.

> Without this binding the API still works: `functions/lib/ratelimit.ts` fails open and logs
> nothing, but you lose abuse protection. Do not ship to production without it.

---

## 4. Turnstile keys (5 min)

1. Dashboard → **Turnstile** → **Add widget**.
2. Name `signsure`, mode **Managed**, hostnames: `signsure.pages.dev` **and** `localhost`.
3. Copy the **site key** (public) and **secret key** (private).
4. Site key goes in the Pages build variables as `VITE_TURNSTILE_SITE_KEY`.
5. Secret key goes in as a *secret* (next step).

Development already uses Cloudflare's documented always-pass test pair
(`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`), so nothing is blocked locally.

---

## 5. Upload secrets and deploy (5 min)

```bash
# 32+ characters for the secret, 16+ for the salt; this gives 64 hex characters
node -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"

npx wrangler pages secret put GEMINI_API_KEY       --project-name signsure
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name signsure
npx wrangler pages secret put SESSION_SECRET       --project-name signsure
npx wrangler pages secret put IP_HASH_SALT         --project-name signsure

npm run deploy
```

Then set, in **Settings → Variables and Secrets** (plain text, not secret):

| Name | Value |
|---|---|
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `MOCK_GEMINI` | `false` |
| `ALLOWED_ORIGIN` | your live origin, e.g. `https://signsure.pages.dev` (optional: same-origin requests, including preview deployments and custom domains, are always allowed) |
| `VITE_TURNSTILE_SITE_KEY` | your Turnstile site key (build variable) |
| `NODE_VERSION` | `22` |

> **Plan note.** Pages Functions share the Workers CPU limit: 10 ms per request on the Free plan,
> 30 s on the Paid plan. Waiting for Gemini does not count, but our own verification and rules do,
> and a long document can pass 10 ms. The $5/month Workers Paid plan avoids error 1102 on
> anything larger than the sample letter.

Smoke test afterwards: `curl -s https://<your-domain>/api/health` should return
`{"ok":true,"mode":"live",...}` with every `configured` flag `true`, and
<https://securityheaders.com> should grade the site A or better.

---

## 6. Demo video (30 min)

Script and timings are in `docs/SUBMISSION.md` §2. Record with the sample document so nothing
personal appears. Keep it under 3 minutes.

---

## 7. Blog post (20 min)

Full draft is ready in `docs/BLOG_DRAFT.md`. Paste into Hashnode / Medium / dev.to, add the two
screenshots you took for the README, publish, and put the URL in `README.md`.

---

## 8. Review the Hindi rule text (30 min, needs a Hindi speaker)

The India rule cards, missing-information checks and reviewed questions have Hindi versions in
`shared/rules/hindi.ts`. I drafted them carefully, keeping the same cautious wording as the
English, but they have not been checked by a person. Ask someone fluent in Hindi (ideally with a
legal background) to read them against the English in `shared/rules/employment.ts`. Tests check
that nothing is missing and that no text says a clause *is* void or tells the reader whether to
sign, but only a person can check that the meaning is right.

---

## 9. LinkedIn post + submission (10 min)

Draft is in `docs/SUBMISSION.md` §4. Post it, then submit repo URL + live URL + blog URL + post URL.
Keep one submission attempt in reserve.

---

## Placeholders currently in the repo

| File | Placeholder | Replace with |
|---|---|---|
| `wrangler.toml` | `REPLACE_WITH_KV_NAMESPACE_ID` | KV namespace id from task 3 |
| `wrangler.toml` | `ALLOWED_ORIGIN` | your live origin |
| `README.md` | live URL, blog URL | the real URLs |
