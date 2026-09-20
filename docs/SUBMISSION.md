# SignSure – Submission Kit

## 1. Final checklist
- [ ] Live URL works on desktop and phone; sample flow completes in < 30 s
- [ ] Repo public (if required), README complete, no secrets, size well under 10 MB
- [ ] CI badge green; coverage and eval numbers in README
- [ ] Disclaimer visible on every screen
- [ ] Demo video (≤ 3 min) uploaded
- [ ] Technical blog published
- [ ] LinkedIn post published with live link + repo
- [ ] Submission form: repo URL, live URL, blog URL, post URL
- [ ] Re-read the official round rules (tools required, deadlines, file limits) before submitting

## 2. Demo script (≈ 3 minutes)
1. **Hook (15 s):** "Priya got her first offer. It has a bond, a non-compete, and a 90-day notice period on page four. She has two days to sign."
2. **Upload (15 s):** Try the sample; show "parsed on your device".
3. **Lens (10 s):** select "I might quit early" + "Future jobs".
4. **Report (45 s):** top red flag = post-employment non-compete. Open side-by-side: explanation left, original clause 9.2 with page right, highlighted, "Verified quote". Show the rule card with Section 27 basis and "last reviewed".
5. **Ask (40 s):** "Can they stop me joining a competitor?" → cited answer + "needs professional" guidance. Then "Will they pay for my parents' insurance?" → "Your document doesn't say this" + questions to ask HR.
6. **Access (20 s):** switch to Hindi + Simple; press Read aloud.
7. **Prepare (20 s):** download lawyer prep sheet.
8. **Close (15 s):** "Every claim is checked against your document. When it doesn't know, it says so. Nothing is stored."

## 3. Blog post outline
Title: *Building SignSure: making AI legal explanations you can actually check*
1. The problem: access to a document ≠ understanding it
2. Who we built for and why (first-job employees in India)
3. Why not a chatbot: the verification gap
4. Architecture: browser parsing → secure Cloudflare proxy → Gemini structured output → quote verification → rule engine
5. Designing refusal: "the document doesn't say"
6. Security and privacy choices
7. Accessibility: reading levels, Hindi, read-aloud
8. Testing an AI product: golden set and metrics
9. What's next
Include the architecture diagram and 2–3 screenshots.

## 4. LinkedIn post draft
> Your first job offer can come with a bond, a non-compete, and a 90-day notice period hidden on page 4.
>
> For #PromptWars I built **SignSure**: it explains offer letters clause by clause, in English or Hindi, and shows the exact original text and page beside every answer. If the document doesn't say something, SignSure says so instead of guessing.
>
> Built with Google's Gemini API, React, and Cloudflare Pages. Your document is parsed on your device and never stored.
>
> Try it: <live link> · Code: <repo link>
> It's information, not legal advice, and it helps you prepare the right questions for a lawyer.
>
> #GoogleForDevelopers #Gemini #BuildInPublic #LegalTech #AccessToJustice
