# SignSure – UX Flow and Screens

## Principles
1. **Evidence beside every claim** – explanation on the left, original clause on the right (stacked on mobile).
2. **Most important first** – red flags before summaries; lenses decide order.
3. **Calm, not alarming** – neutral colours, plain words, no legal jargon without a tooltip.
4. **Honest limits** – show "not in document" and "couldn't verify" states prominently, never hide them.
5. **Mobile first** – most users will open this on a phone.

## Screens

### 1. Home
- Headline: "Understand every clause before you sign."
- Three trust points: *Shows its sources* · *Says when it doesn't know* · *Your file stays on your device*.
- Primary CTA: "Check my offer letter". Secondary: "Try with a sample".
- Disclaimer link.

### 2. Upload
- Dropzone (also a real `<input type="file">` button), paste-text tab.
- No security check yet: a visitor who only reads the home page never contacts Cloudflare.
- After parse: "We found 32 clauses across 5 pages." + preview of first clauses.
- Language + reading level selectors here and in header.

### 3. Concerns (lenses)
- Turnstile widget (managed) starts here and keeps running into the report if needed; Analyse waits for it.
Checkbox cards (multi-select, keyboard accessible):
- I might quit early (notice, bond, exit costs)
- Future jobs (non-compete, non-solicit, confidentiality)
- My salary (CTC, variable pay, deductions, clawbacks)
- Getting fired (termination, probation)
- Show me everything
Button: "Analyse".

### 4. Report (tabs: Overview · Clauses · Ask · Compare · Prepare)
**Overview**
- Summary card: document type, parties, role, start date, notice period, bond (each field shows "Not stated" if absent, with a citation if present).
- Red flags list (HIGH → MEDIUM), each expandable to side-by-side view.
- Legal context cards from rule engine.

**Clauses**
- Filter by category and risk; search box.
- Each row: label, category chip, risk chip (text + icon, never colour alone), explanation, "View original" (side panel/section) with page number and highlighted quote.
- Verification badge: ✓ Verified quote / ⚠ Couldn't verify.

**Ask**
- Suggested questions based on lenses.
- Chat-like list but each answer is a card with status: Answered / Not in document / Talk to a lawyer; citations as buttons that scroll to the clause.
- `aria-live="polite"` region for new answers.

**Compare**
- Upload second document → table of Added / Removed / Changed with both texts.

**Prepare**
- Signing checklist (checkboxes, local state only).
- Questions for HR / lawyer, missing information, documents to bring.
- Export: Print · Copy · Download .md.

## States to design
Loading (skeletons + progress text, `aria-busy`), empty, parse error, scanned PDF, rate limited ("Please wait a minute"), model/safety error, offline, partial verification.

## Visual tokens (suggested)
- Font: system UI stack (Noto Sans / Noto Sans Devanagari for Hindi, self-hosted subset or system).
- Base size 16px, line-height 1.6, max line length ~70ch.
- Colours (all ≥ 4.5:1 on background): ink `#1B1F24`, surface `#FFFFFF`, muted `#57606A`, primary `#1F4ED8`, risk-high `#B42318`, risk-med `#B54708`, risk-low `#067647`, verified `#067647`. Dark mode equivalents via CSS variables.
- Risk always = icon + word + colour.
- Touch targets ≥ 44×44 px (exceeds WCAG 2.2's 24×24 minimum).
