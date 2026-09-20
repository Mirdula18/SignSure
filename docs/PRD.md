# SignSure – Product Requirements Document

## 1. Vision
Turn "I have the contract" into "I understand the contract and know what to do next", with every explanation traceable to the original text.

## 2. The four core questions

**1. Who exactly is the user?**
An Indian first-job employee or early-career job switcher (21–27), often a fresh graduate from a tier-2/3 city, sometimes more comfortable in an Indian language than in legal English. They have an offer letter or employment agreement, 1–3 days to accept, and no lawyer.

**2. What exact problems do they struggle with?**
- They can't tell which clauses matter (notice period, bond, non-compete are buried among boilerplate).
- They don't know if a clause is normal, one-sided, or possibly unenforceable in India.
- They can't compute real take-home from a CTC breakup.
- They don't know what to negotiate or ask HR.
- When they ask a chatbot, they can't verify the answer, and it may confidently guess.

**3. Why does GenAI make it meaningfully better?**
Contracts use endless phrasing variations that keyword tools miss. Gemini can read the whole document, classify clauses, and explain them in plain English or Hindi at the user's reading level, in seconds, at near-zero cost.

**4. Why not a general-purpose AI assistant?**
SignSure adds what a chat box lacks: code-verified citations with side-by-side source text, explicit "not in the document" answers, a deterministic India-specific rule library, concern-based lenses instead of blanket summaries, version comparison, and actionable outputs (checklist, lawyer prep sheet). Documents are parsed in the browser and never stored.

## 3. Personas

**Priya, 22 – fresh graduate, first job (primary).** B.Tech from a tier-2 college, offer from a mid-size IT services firm. The offer mentions a "service agreement" and a training bond. She is anxious and wants to know: "If I leave after a year, what happens?"

**Arjun, 26 – job switcher (secondary).** Two years' experience, moving to a startup. Worried about a 2-year non-compete and a 90-day notice period. Received a revised offer and wants to know what changed.

**Meena, 24 – Hindi-first reader (accessibility persona).** Comfortable with conversational English but not legal English. Prefers explanations in Hindi and reads on a phone.

## 4. User journey
1. Land → understand what SignSure does and doesn't do (disclaimer, privacy promise).
2. Upload PDF/DOCX (or paste text) → parsed locally, clause count and pages shown.
3. Choose concerns (lenses) → e.g. "I might quit early".
4. See report: top red flags first, each with source clause side by side.
5. Ask questions → grounded answers or "the document doesn't say".
6. Optionally compare with another version.
7. Export signing checklist and lawyer prep sheet.

## 5. Features and priority

| ID | Feature | Priority |
|---|---|---|
| F1 | Upload PDF/DOCX or paste text; local parsing with page tracking | Must |
| F2 | Clause segmentation with stable IDs and detected numbering | Must |
| F3 | Clause classification + plain-language explanation + risk level | Must |
| F4 | Side-by-side view: explanation ↔ original clause text with page | Must |
| F5 | Server-side quote verification; unverified claims flagged/hidden | Must |
| F6 | Grounded Q&A with explicit "not in document" status | Must |
| F7 | India rule library red flags (deterministic) | Must |
| F8 | Concern lenses re-ranking the report | Must |
| F9 | Lawyer prep sheet + signing checklist, export (print/copy/.md) | Must |
| F10 | Secure proxy: Turnstile, rate limit, validation, headers | Must |
| F11 | Reading-level toggle (Simple / Standard) | Should |
| F12 | Hindi explanations (+ one more Indian language) | Should |
| F13 | Read aloud (Web Speech API) | Should |
| F14 | Compare two versions of an offer | Should |
| F15 | Salary breakup explainer (CTC → estimated monthly in-hand, clearly labelled as estimate) | Could |
| F16 | Scanned-PDF fallback via Gemini document understanding (with explicit consent) | Could |
| F17 | Demo mode with a built-in sample offer letter | Must (for judges) |

## 6. User stories and acceptance criteria

**US1 – Upload.** As Priya, I want to upload my offer letter so I can analyse it.
- Accepts `.pdf`, `.docx`, `.txt`, or pasted text; rejects others with a clear message.
- Max 10 MB, max 40 pages, max 120,000 characters; errors are announced to screen readers.
- Text-less (scanned) PDFs are detected and the user is told why they can't be read (F16 is stretch).
- File bytes never leave the browser in the default flow.

**US2 – Report.** As Priya, I want the important clauses first.
- Red flags (HIGH) appear at top, sorted by the selected lens.
- Each item shows: category, risk level, 1–3 sentence explanation, clause label (e.g. "Clause 7.2"), page, and the original text.
- Any claim whose quote fails verification is not shown as fact; it shows "Couldn't verify against the document".

**US3 – Ask.** As Arjun, I want to ask "Can they stop me from joining a competitor?"
- Answer cites ≥1 verified clause, OR status is `not_in_document` with the message "Your document doesn't say this" plus suggested questions for HR/a lawyer.
- Answer never states a legal conclusion as certain; uses "generally", "courts have held", and recommends professional advice for high-stakes items.

**US4 – Legal context.** As Arjun, I want to know if my non-compete is enforceable.
- If a post-employment non-compete is detected, show the rule card (Indian Contract Act s.27) with source and "last reviewed" date.
- Rule cards are produced by the rule engine, not by free-form model text.

**US5 – Lawyer prep.** As Priya, I want a list of questions to take to a lawyer or HR.
- Sheet includes: flagged clauses (with text), open questions, missing information, documents to bring.
- Exportable via Print (print stylesheet), Copy, and Download `.md`.

**US6 – Compare.** As Arjun, I want to see what changed between offers.
- Clauses are matched by category and similarity; changes are labelled Added / Removed / Changed with both texts side by side.

**US7 – Accessibility.** As Meena, I want explanations in Hindi and read aloud.
- Language switch affects explanations and UI strings; original clause text is never translated in place (shown as-is, translation clearly labelled).
- All features usable by keyboard only; passes axe with zero serious/critical issues.

## 7. Non-goals
- Not a lawyer; no drafting of legally binding documents; no "you should sign / not sign" verdicts.
- No accounts, no document storage, no history on the server.
- Not covering non-Indian jurisdictions in v1.

## 8. Success metrics (for demo and eval)
- ≥95% of displayed quotes verified against source on the golden set.
- 100% correct refusal on the golden set's unanswerable questions.
- Report for a 5-page document in < 15 s (p50) on Gemini Flash.
- Lighthouse Accessibility ≥ 95; axe: 0 serious/critical.
- Initial JS bundle < 180 KB gzip.

## 9. Scope and safety language (use consistently)
- Header banner: "SignSure explains your document. It isn't legal advice."
- Refusal: "Your document doesn't say this. You may want to ask HR or a lawyer: …"
- High-risk escalation: "This could have serious consequences. Please discuss it with a qualified lawyer before signing."
