# Building SignSure: AI explanations of an offer letter that you can actually check

> Draft for Hashnode / dev.to / Medium. Before publishing: add the live link and repo link where
> marked, upload the screenshots from `docs/screenshots/`, and paste in the live eval figures
> from `npm run eval` (`HUMAN_TASKS.md` 1). Everything else is ready to publish.

---

Picture your first offer letter: a training bond, a notice period you don't quite understand,
and a clause about "liquidated damages" on page four. You have two days to sign it and nobody
to ask.

That's the situation SignSure is built for. It reads an Indian offer letter or employment
agreement, explains it clause by clause in plain English or Hindi, flags the terms worth a
closer look, and answers questions **only from the document**, with the exact clause and page
beside every answer. When the document doesn't say something, it says so.

**Try it:** `<live link>` · **Code:** `<repo link>`

![The SignSure report for a sample offer letter](docs/screenshots/report.jpg)

## Having the document isn't the same as understanding it

First-time employees in India get offer letters full of phrases like *"restraint"*,
*"notwithstanding anything contained herein"* and *"liquidated damages towards training cost"*.
The terms that actually cost money (a ₹2 lakh bond, a 90-day notice period, a two-year
non-compete, the employer holding your original certificates) sit in the same grey paragraphs
as the boilerplate. A lawyer is expensive, and a friend who has "signed one before" is not a
lawyer.

## Why not paste it into a chatbot?

You can, and the answer will sound confident. That's the problem. A general chatbot will:

- give you fluent answers with no way to check them against your own document,
- fill gaps with what offer letters *usually* say when yours is silent,
- sometimes quote text that isn't in your document at all.

For a legal document, an answer you can't check is worse than no answer. So the one design
rule behind SignSure is: **code decides, the model explains.**

## Architecture: the model explains, the code checks

```
Browser                          Cloudflare Pages Functions                 Gemini
PDF / DOCX / text                middleware: origin check, 256 KB cap
  → pdf.js / mammoth (on device) → Turnstile session + KV rate limit
  → segmenter: clause ids, pages → Zod-validated request ─────────────────→ structured JSON
                                 ← validate output, drop unknown clause ids ←
                                   verify every quote, run India rules
Report ←──────────────────────── verified findings + rule cards
```

A few decisions do most of the work:

**The file never leaves the device.** pdf.js and mammoth run in the browser, and only clause
text and ids are sent. Both libraries load only when someone actually picks a file, so the home
page stays light.

**The model never sees page numbers.** The segmenter assigns every clause an id and records the
page it came from. The model can only cite a clause id and a quote, and the page shown to the
user comes from our own parse.

**Every quote is verified by code.** The model has to back each explanation with a quote from
the clause it cites, and `shared/verify.ts` checks it: exact match first, after Unicode
normalisation (curly quotes, soft hyphens, Devanagari), then a strict token-level fuzzy match.
Anything that fails is shown separately as "couldn't verify" and never counted as a red flag.

**Legal context comes from reviewed text, not the model.** Sixteen rules for Indian employment
law (Section 27 on non-competes, Section 74 on bonds and liquidated damages, the Code on Wages,
gratuity for fixed-term roles and more) are plain TypeScript with fixed text, a legal basis and
a review date:

```ts
{
  id: 'IN-EMP-NONCOMPETE-POST',
  appliesTo: ['NON_COMPETE'],
  evaluate: flag('HIGH', (text) => COMPETE_RESTRICTION.test(text) && POST_EMPLOYMENT.test(text)),
  title: 'Non-compete after you leave',
  message: 'Section 27 of the Indian Contract Act, 1872 makes agreements that restrain a person '
    + 'from carrying on a lawful profession or trade void, ... Whether any part of this clause '
    + 'could be enforced depends on its exact wording and the facts, so please confirm with a lawyer.',
  basis: "Indian Contract Act, 1872, s.27; Percept D'Mark (India) Pvt Ltd v. Zaheer Khan ...",
  lastReviewed: REVIEWED,
}
```

The model's role here is classification: it says which clause is a non-compete. One subtlety
took a while to get right: a category only switches on a rule if the finding that assigned it
has a verified quote. Otherwise an unverified claim could decide which legal card you see.

![A finding opened beside the original clause, with the verified quote highlighted](docs/screenshots/side-by-side.jpg)

## Designing the refusal

"The document doesn't say" is a feature. The Ask endpoint enforces it in code:

```ts
// "answered" with nothing that checks out is indistinguishable from a confident guess.
if (model.status === 'answered' && supported.length === 0) {
  return { status: 'not_in_document', answer: DOWNGRADE_ANSWER, citations: [], ... };
}
```

A refusal still gives you something to do: what's missing, and questions to ask HR instead.
Six missing-information checks (notice period, salary breakup, role, location, leave,
probation) work the same way for the whole document, because a silent offer letter is a risk
too.

![SignSure saying the document does not cover a question, with questions to ask instead](docs/screenshots/ask-refusal.jpg)

## Security and privacy

It's a public proxy in front of a paid API that handles people's employment documents, so:

- The Gemini key lives only in Cloudflare Functions `env`. A secret scan runs in CI, and test
  fixtures use fake secrets written so they can't look like real ones.
- Cloudflare Turnstile (managed mode, no puzzles) earns a 30-minute HMAC session token bound to
  a hashed IP. Workers KV rate-limits each route.
- Request bodies are capped at 256 KB before any route reads them, and every body is validated
  with Zod.
- Document and question text are untrusted. Every prompt fences them, and a sanitiser
  neutralises any fence tag in the text, so a clause can't close its own `<document>` block
  and pretend to be instructions. One of the six golden-set contracts is a prompt-injection
  letter.
- Nothing is stored and nothing about the document is logged.

## Accessibility and language

The people this is for often read on a phone, sometimes in Hindi first. So: English and Hindi
interfaces, including the rule cards; a "simple" reading level; read-aloud; an inline glossary
for terms like *CTC* and *liquidated damages*; keyboard-only operation; 44 px touch targets;
reflow at 320 px and 200% zoom. axe runs on every screen in the end-to-end suite, and
Lighthouse scores accessibility at 100.

![The report on a phone in dark mode](docs/screenshots/phone-report.jpg)

## Testing an AI product

Unit tests are the easy part: 1,500+ of them, with 100% coverage enforced on quote
verification, normalisation and the rule library. The interesting part is testing the
behaviour around the model.

**A golden set.** Six synthetic contracts (fair, bond-heavy, its revised version,
non-compete-heavy, one that leaves most things out, and a prompt-injection letter), each with
what a careful reader would expect. The deterministic half runs on every commit. The first run
caught five real gaps: a probation cap written as "no more than three further months" wasn't
recognised, "thirty (30) days written notice" wasn't counted as a notice period, and an
unnumbered letter was being merged into a single clause.

**A live eval.** `npm run eval` sends the same contracts through the real HTTP API and reports
quote verification, refusal accuracy, rule and category recall, citation precision and latency.
It fails the run below 95% verification, below 100% refusal accuracy, or on any sign that the
injection letter changed the model's behaviour.

| Live eval (Gemini Flash) | Result |
|---|---|
| Quote verification | `<from npm run eval>` |
| Refusal accuracy | `<from npm run eval>` |
| Rule recall | `<from npm run eval>` |
| Latency p50 / p95 | `<from npm run eval>` |

**End-to-end tests against the production build**, on a desktop and a phone viewport, with a
mock model that builds its answers from the document's own clauses, so verification is real
even offline.

**And measuring the real thing.** Profiling the production build found a bug every test had
missed, because the test stub for the security check answers instantly: the check was mounted
on the upload screen, so someone who clicked "Try the sample" in the first second tore it down
mid-challenge, and the report waited forever for a session. It now lives in a component that
survives screen changes, and there's a test that finishes the check only after Analyse has
been pressed.

## What's next

- Live eval figures on a paid key, and a review of the Hindi rule text by a Hindi-speaking
  lawyer.
- More Indian languages.
- Scanned PDFs, with explicit consent before sending page images to the model.
- A salary breakup explainer that turns CTC into an estimated monthly in-hand figure.

SignSure gives legal *information*, not legal advice. What it aims for is simpler: that someone
signing their first offer letter knows what they're agreeing to, and walks into the
conversation with HR or a lawyer with the right questions.

`<live link>` · `<repo link>`
