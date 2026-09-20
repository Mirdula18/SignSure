# Claude Code kickoff prompt

Put this repo's docs in place first (`README.md`, `CLAUDE.md`, `docs/`), then open Claude Code in the repo root and paste the prompt below.

---

```
You are the lead engineer building SignSure, a competition entry for Google PromptWars
(theme: AI for legal assistance and access). It must score well on: Problem Statement
Alignment, Code Quality, Security, Efficiency, Testing, and Accessibility.

Before writing any code:
1. Read CLAUDE.md, README.md, and every file in docs/ (PRD, ARCHITECTURE, AI_PIPELINE,
   LEGAL_RULES, UX_FLOW, SECURITY, TESTING, ACCESSIBILITY, DEPLOYMENT, PROJECT_PLAN, SUBMISSION).
2. Give me a short summary (max 15 bullets) of what you will build, and list any gaps,
   conflicts, or risky assumptions you found in the docs, with your proposed resolution.
3. Check the current stable versions of the approved dependencies and the current Gemini
   Flash model ID, and tell me what you'll use.

Then execute docs/PROJECT_PLAN.md phase by phase, starting with Phase 0 (setup) and
Phase 1 (shared core). Rules:
- Follow CLAUDE.md strictly, especially: the Gemini key never reaches the browser; the model
  never supplies page numbers or rule text; every quote is verified in code; answered
  responses without verified citations are downgraded to not_in_document.
- Write tests alongside each module (verify.ts and rules/ need 100% coverage).
- Build MOCK_GEMINI mode early so everything runs and tests without a real API key.
- Keep the repo lean (no binaries, tiny synthetic fixtures, under 10 MB).
- Accessibility is part of done for every UI piece (semantic HTML, keyboard, focus,
  live regions, labels, contrast, non-colour indicators).
- After each phase: run lint, typecheck, tests (and e2e once it exists), update the
  checkboxes in docs/PROJECT_PLAN.md, commit with conventional messages, summarise what
  changed and any decisions, then STOP and wait for my "continue".

Start now with steps 1–3, then Phase 0.
```

---

## Useful follow-up prompts
- **Review pass:** "Act as a strict PromptWars judge. Review the repo against the six criteria, score each 1–10 with evidence (file paths), and list the top 10 fixes ranked by impact per hour."
- **Security pass:** "Go through docs/SECURITY.md §4 and verify every item with actual commands/tests. Fix anything failing."
- **Accessibility pass:** "Run the axe E2E suite and a keyboard-only walkthrough of every screen. Fix all issues and add regression tests."
- **Eval pass:** "Run npm run eval, report the metrics table, and improve prompts only where refusal accuracy < 100% or verification rate < 95%. Show before/after."
- **Pre-submit:** "Run the full checklist in docs/SUBMISSION.md and report pass/fail for each item."
