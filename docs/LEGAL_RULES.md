# SignSure – India Employment Rule Library

> **Important for the team:** This file is the single source of truth for `shared/rules/employment.ts`. Rule messages are *reviewed, fixed text*: the model never writes them. Before submission, re-check every "Basis" item against a primary source (India Code, Supreme Court / High Court judgments, PIB releases) and update `lastReviewed`. Keep language cautious ("generally", "courts have held", "may"). SignSure must never say a clause *is* void or illegal for this user.

## Message conventions
- **Title:** ≤ 8 words, plain.
- **Message:** 2–4 sentences: what the law generally says → what that means for this clause → what to check.
- **Questions:** concrete, answerable by HR or a lawyer.
- **Severity:** HIGH / MEDIUM / INFO.
- Every rule card in the UI shows: Basis, "Last reviewed <date>", and "This is general information, not advice about your situation."

## Clause-level rules

### IN-EMP-NONCOMPETE-POST – Non-compete after you leave
- **Applies to:** NON_COMPETE
- **Trigger:** restriction on joining/starting a competing business AND refers to a period after termination/resignation/leaving (e.g. `after (the )?(termination|cessation|resignation|leaving)|post[- ]employment|for a period of \d+ (months|years) (from|after)`).
- **Severity:** HIGH
- **Message:** Section 27 of the Indian Contract Act, 1872 makes agreements that restrain a person from carrying on a lawful profession or trade void, with a narrow exception for sale of goodwill. Indian courts have generally refused to enforce non-compete restrictions that apply after employment ends. Your confidentiality obligations may still apply after you leave. Whether any part of this clause could be enforced depends on its exact wording and facts, so confirm with a lawyer.
- **Basis:** Indian Contract Act, 1872, s.27; *Percept D'Mark (India) Pvt Ltd v. Zaheer Khan* (2006) 4 SCC 227; *Varun Tyagi v. Daffodil Software Pvt Ltd* (Delhi HC, 2025).
- **Questions:** "Is this restriction meant to apply after I leave, and for how long?" · "Would the company agree to limit it to not using confidential information?"

### IN-EMP-NONCOMPETE-DURING – Exclusivity while employed
- **Applies to:** NON_COMPETE, MOONLIGHTING
- **Trigger:** restriction limited to the period of employment.
- **Severity:** INFO
- **Message:** Restrictions that apply only while you are employed (for example, not working for a competitor at the same time) are generally treated differently from post-employment restraints and are more likely to be upheld.
- **Basis:** *Niranjan Shankar Golikari v. Century Spinning & Mfg. Co.* (1967) SC.
- **Questions:** "Does this stop me from freelancing or side projects unrelated to the company's business?"

### IN-EMP-BOND – Training bond or exit penalty
- **Applies to:** BOND_OR_EXIT_PENALTY
- **Trigger:** `bond|service agreement|liquidated damages|minimum (period of )?service|training cost|pay the company|recover|forfeit` with an amount or period.
- **Severity:** HIGH if an amount is stated; MEDIUM otherwise.
- **Message:** Under Section 74 of the Indian Contract Act, a court generally awards only reasonable compensation up to the stated amount, not an arbitrary penalty. The Supreme Court has upheld a minimum-service bond where the amount was a reasonable pre-estimate of the employer's loss. Whether this bond is reasonable depends on the amount, the period, and what the company actually spends on you.
- **Basis:** Indian Contract Act, 1872, s.73–74; *Vijaya Bank v. Prashant B. Narnaware* (SC, 2025).
- **Questions:** "Is the amount reduced (pro-rated) for each month I serve?" · "What specific training costs does this amount cover?" · "Does it apply if the company terminates me?"
- **Extraction:** capture amount (`₹|Rs\.?|INR` + number, lakh/lakhs) and period for display.

### IN-EMP-NOTICE-ASYMMETRIC – Unequal notice periods
- **Applies to:** NOTICE_PERIOD, TERMINATION
- **Trigger:** two notice durations found where the employee's is longer than the employer's.
- **Severity:** MEDIUM
- **Message:** Your notice period appears to be longer than the company's. This is a contract term you can ask to negotiate.
- **Basis:** Contract terms; general fairness.
- **Questions:** "Can the notice period be the same for both sides?" · "Can I buy out my notice period, and how is that calculated?"

### IN-EMP-NOTICE-LONG – Long notice period
- **Applies to:** NOTICE_PERIOD
- **Trigger:** employee notice ≥ 60 days.
- **Severity:** MEDIUM (≥ 90 days: HIGH)
- **Message:** A long notice period can make it harder to join a new employer quickly. Check whether you can shorten it by paying in lieu of notice or using leave.
- **Basis:** Contract terms.
- **Questions:** "Is notice buyout allowed?" · "Is the notice period shorter during probation?"

### IN-EMP-DOC-RETENTION – Keeping your original documents
- **Applies to:** DOCUMENT_RETENTION
- **Trigger:** `original (certificates|documents|mark ?sheets)` + `retain|deposit|submit|keep|hold`.
- **Severity:** HIGH
- **Message:** The document appears to allow the company to keep your original educational or identity documents. Holding originals can be used to pressure employees not to leave and is widely regarded as an unfair practice. Ask whether copies are enough.
- **Basis:** General contract fairness; confirm with a lawyer.
- **Questions:** "Will attested copies be accepted instead of originals?" · "When exactly will originals be returned?"

### IN-EMP-NONSOLICIT – Non-solicitation after leaving
- **Applies to:** NON_SOLICIT
- **Severity:** MEDIUM
- **Message:** Restrictions on approaching the company's clients or employees after you leave are treated case by case in India. Courts have been more willing to protect confidential information and trade secrets than to stop someone from working.
- **Basis:** Indian Contract Act, 1872, s.27 and related case law.
- **Questions:** "Does this stop former colleagues from approaching me, or only me approaching them?"

### IN-EMP-CONFIDENTIALITY – Confidentiality lasting after you leave
- **Applies to:** CONFIDENTIALITY
- **Severity:** INFO
- **Message:** Obligations to keep the company's confidential information secret generally continue after employment ends and are commonly enforced. Make sure you understand what counts as "confidential".
- **Basis:** Contract law; trade-secret protection through case law.
- **Questions:** "Is general skill and knowledge I gain excluded from 'confidential information'?"

### IN-EMP-IP-BROAD – Wide ownership of your work
- **Applies to:** IP_ASSIGNMENT
- **Trigger:** IP assignment including work done `outside (working|office) hours|whether or not|at any time` or unrelated to the business.
- **Severity:** MEDIUM
- **Message:** This clause may give the company ownership of things you create outside work or unrelated to your job. If you have side projects, ask for them to be excluded in writing.
- **Basis:** Copyright Act, 1957, s.17 (employer ownership of work made in the course of employment); contract terms.
- **Questions:** "Can my existing and personal projects be listed as excluded?"

### IN-EMP-TERMINATION-NO-NOTICE – Termination without notice or reason
- **Applies to:** TERMINATION
- **Trigger:** `without (any )?(notice|reason|cause)|at (its|the company's) sole discretion` not limited to misconduct.
- **Severity:** MEDIUM
- **Message:** The company appears able to end your employment without notice or reason beyond misconduct cases. Protections under labour law depend on your role and category, so ask what notice or pay you would receive.
- **Basis:** Contract terms; Industrial Relations Code, 2020 (applicability depends on role).
- **Questions:** "What notice or pay in lieu applies if the company terminates me without cause?"

### IN-EMP-CLAWBACK – Paying back bonuses or relocation
- **Applies to:** COMPENSATION, BOND_OR_EXIT_PENALTY
- **Trigger:** `joining bonus|sign-?on|relocation|retention bonus` + `repay|refund|recover|claw ?back`.
- **Severity:** MEDIUM
- **Questions:** "Is repayment pro-rated?" · "Does it apply if I'm let go?"

### IN-EMP-UNILATERAL-CHANGE – Company can change terms alone
- **Applies to:** GENERAL, COMPENSATION
- **Trigger:** `(may|reserves the right to) (amend|modify|change|revise)` + `(terms|policies|compensation|this agreement)` + `(sole discretion|without notice|from time to time)`.
- **Severity:** MEDIUM
- **Questions:** "Will changes to my pay or role require my written consent?"

### IN-EMP-PROBATION-EXTEND – Probation that can keep extending
- **Applies to:** PROBATION
- **Trigger:** probation `may be extended` without a maximum.
- **Severity:** MEDIUM
- **Questions:** "What is the maximum probation period?" · "What is the notice period during probation?"

### IN-EMP-WAGES-50 – How your salary is structured
- **Applies to:** COMPENSATION
- **Trigger:** salary breakup present.
- **Severity:** INFO
- **Message:** Under the Code on Wages, 2019 (in force since 21 November 2025), excluded allowances above 50% of total remuneration are added back into "wages". Because PF and gratuity are calculated on wages, the salary structure affects your in-hand pay and long-term benefits. Ask HR for your expected monthly in-hand amount.
- **Basis:** Code on Wages, 2019, definition of "wages"; Labour Codes notified effective 21 Nov 2025 (PIB).
- **Questions:** "What is my expected monthly in-hand salary after PF and tax?" · "Which parts of CTC are variable or conditional?"

### IN-EMP-GRATUITY-FTE – Gratuity for fixed-term roles
- **Applies to:** BENEFITS, GENERAL
- **Trigger:** `fixed[- ]term|contract (period|basis)|for a period of \d+ (months|years)`.
- **Severity:** INFO
- **Message:** Under the Code on Social Security, 2020, fixed-term employees can become eligible for gratuity after one year of continuous service, instead of the usual five. Check how your contract describes your employment type.
- **Basis:** Code on Social Security, 2020 (verify current provision before release).
- **Questions:** "Am I a fixed-term or permanent employee?"

### IN-EMP-JURISDICTION – Disputes in a distant city or by arbitration
- **Applies to:** DISPUTE_RESOLUTION
- **Severity:** INFO
- **Message:** This clause decides where and how disputes are handled. Arbitration or a far-away court can make disputes costly. Note it and ask a lawyer if a dispute ever arises.
- **Questions:** "Who pays arbitration costs?"

## Document-level rules (missing information)
Run after analysis. Each produces a `missingInfo` item and a question, severity MEDIUM.

| Rule ID | Missing item | Suggested question |
|---|---|---|
| IN-EMP-MISSING-NOTICE | Notice period | "What is the notice period for me and for the company?" |
| IN-EMP-MISSING-SALARY | Salary / CTC details | "Can I get the full salary breakup in writing?" |
| IN-EMP-MISSING-ROLE | Job title or duties | "What is my exact designation and reporting manager?" |
| IN-EMP-MISSING-LOCATION | Work location / transfer terms | "Can I be transferred to another city?" |
| IN-EMP-MISSING-LEAVE | Leave entitlement | "How many paid leaves do I get?" |
| IN-EMP-MISSING-PROBATION | Probation terms | "Is there a probation period and what changes after it?" |

## Implementation shape
```ts
export interface Rule {
  id: string;
  appliesTo: ClauseCategory[];
  test: (clause: Clause, finding?: ClauseFinding) => boolean;
  severity: (clause: Clause) => RiskLevel;
  title: string;
  message: string;
  basis: string;
  questions: string[];
  lastReviewed: string; // 'YYYY-MM-DD'
}
```
- Pure functions, no network. 100% unit-test coverage with positive and negative examples for each rule.
- Translations of rule text live in `shared/rules/hindi.ts` keyed by rule ID (reviewed text, never model-translated at runtime). They sit beside the English rather than in `src/i18n` because `/api/prepare` needs them on the server too. The Hindi is a first draft awaiting review by a Hindi-speaking legal reviewer; `basis` citations are not translated.
