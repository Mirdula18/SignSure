import { describe, expect, it } from 'vitest';
import type { Clause, ClauseCategory, RuleHit } from '../types';
import {
  EMPLOYMENT_RULES,
  findMissingInfo,
  MISSING_INFO_RULES,
  ruleQuestions,
  runRules,
} from './index';

/**
 * Everything here is driven through `runRules` rather than by calling `rule.test` directly.
 * That is deliberate: the engine also applies category gating, computes severity and extracts
 * details, so a fixture that fires the right rule at the wrong severity still fails.
 */

function clause(text: string, overrides: Partial<Clause> = {}): Clause {
  return {
    id: 'c001',
    label: null,
    heading: null,
    text,
    page: 1,
    pageEnd: 1,
    order: 0,
    ...overrides,
  };
}

function hitsFor(text: string, category?: ClauseCategory): RuleHit[] {
  return runRules([clause(text)], { c001: category });
}

function hitIds(text: string, category?: ClauseCategory): string[] {
  return hitsFor(text, category).map((hit) => hit.ruleId);
}

function hitFor(text: string, ruleId: string, category?: ClauseCategory): RuleHit {
  return hitsFor(text, category).find((hit) => hit.ruleId === ruleId)!;
}

const POST_NON_COMPETE =
  'For a period of twenty-four (24) months after the termination of employment, the Employee shall not, directly or indirectly, engage in any business that competes with the Company.';

const DURING_NON_COMPETE =
  'During the term of employment, the Employee shall not take up any other employment or freelance assignment without prior written approval.';

const BOTH_NON_COMPETE =
  'During employment and for twelve (12) months after termination, the Employee shall not join a competing business.';

const BOND_WITH_AMOUNT =
  'The Employee shall serve the Company for a minimum period of 24 months. If the Employee resigns earlier, the Employee shall pay the Company Rs. 2,00,000 towards training cost.';

const CONFIDENTIALITY =
  'The Employee shall not disclose any confidential information of the Company during or after employment.';

describe('IN-EMP-NONCOMPETE-POST', () => {
  it('flags a two-year restriction that starts after termination', () => {
    const hit = hitFor(POST_NON_COMPETE, 'IN-EMP-NONCOMPETE-POST', 'NON_COMPETE');
    expect(hit.severity).toBe('HIGH');
    expect(hit.title).toBe('Non-compete after you leave');
  });

  it('flags a restriction counted from the date of resignation', () => {
    expect(
      hitIds(
        'The Employee agrees not to join any rival organisation for a period of one year from the date of resignation.',
        'NON_COMPETE',
      ),
    ).toContain('IN-EMP-NONCOMPETE-POST');
  });

  it('does not flag a restriction limited to the employment period', () => {
    // Near miss: the same restraint on competing, but it stops when the job stops.
    expect(
      hitIds(
        'During the term of employment, the Employee shall not engage in any business that competes with the Company.',
        'NON_COMPETE',
      ),
    ).not.toContain('IN-EMP-NONCOMPETE-POST');
  });

  it('does not flag a post-employment obligation that is not about competing', () => {
    expect(
      hitIds(
        'The Employee shall not disclose any client list after termination of employment.',
        'NON_COMPETE',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-NONCOMPETE-DURING', () => {
  it('notes an exclusivity term that applies while you are employed', () => {
    const hit = hitFor(DURING_NON_COMPETE, 'IN-EMP-NONCOMPETE-DURING', 'NON_COMPETE');
    expect(hit.severity).toBe('INFO');
  });

  it('notes a moonlighting restriction worded as "while employed"', () => {
    expect(
      hitIds(
        'While employed with the Company, you shall not undertake any parallel employment, moonlighting or dual employment.',
        'MOONLIGHTING',
      ),
    ).toEqual(['IN-EMP-NONCOMPETE-DURING']);
  });

  it('does not fire when the same clause also reaches past the last working day', () => {
    // Near miss: "during employment" appears, but so does a post-employment restraint.
    expect(hitIds(BOTH_NON_COMPETE, 'NON_COMPETE')).not.toContain('IN-EMP-NONCOMPETE-DURING');
  });

  it('does not fire on a plain duty-of-diligence clause', () => {
    expect(
      hitIds(
        'The Employee shall devote full time and attention to the duties assigned by the Company.',
        'NON_COMPETE',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-NONCOMPETE-POST vs IN-EMP-NONCOMPETE-DURING', () => {
  it('treats a restriction that starts after termination as post-employment only', () => {
    expect(hitIds(POST_NON_COMPETE, 'NON_COMPETE')).toEqual(['IN-EMP-NONCOMPETE-POST']);
  });

  it('treats a restriction limited to the job as an exclusivity term only', () => {
    expect(hitIds(DURING_NON_COMPETE, 'NON_COMPETE')).toEqual(['IN-EMP-NONCOMPETE-DURING']);
  });

  it('prefers the post-employment rule when a clause is worded both ways', () => {
    expect(hitIds(BOTH_NON_COMPETE, 'NON_COMPETE')).toEqual(['IN-EMP-NONCOMPETE-POST']);
  });

  it('never reports both rules for the same clause', () => {
    for (const text of [POST_NON_COMPETE, DURING_NON_COMPETE, BOTH_NON_COMPETE]) {
      const ids = hitIds(text, 'NON_COMPETE');
      expect(
        ids.includes('IN-EMP-NONCOMPETE-POST') && ids.includes('IN-EMP-NONCOMPETE-DURING'),
      ).toBe(false);
    }
  });
});

describe('IN-EMP-BOND', () => {
  it('treats a bond with a stated amount as high risk and shows the amount', () => {
    const hit = hitFor(BOND_WITH_AMOUNT, 'IN-EMP-BOND', 'BOND_OR_EXIT_PENALTY');
    expect(hit.severity).toBe('HIGH');
    expect(hit.details).toEqual({ amount: 'Rs. 2,00,000' });
  });

  it('treats a minimum-service undertaking with no amount as medium risk', () => {
    const hit = hitFor(
      'This offer is subject to execution of a service agreement requiring a minimum service period of two years.',
      'IN-EMP-BOND',
      'BOND_OR_EXIT_PENALTY',
    );
    expect(hit.severity).toBe('MEDIUM');
    expect(hit.details).toBeUndefined();
  });

  it('shows the largest amount when the clause names more than one', () => {
    const hit = hitFor(
      'On early resignation the Employee shall pay the Company liquidated damages of Rs. 50,000 or INR 150000, whichever is higher.',
      'IN-EMP-BOND',
      'BOND_OR_EXIT_PENALTY',
    );
    expect(hit.details).toEqual({ amount: 'Rs. 1,50,000' });
  });

  it('does not flag the company reimbursing the employee', () => {
    // Near miss: the money moves the other way, so there is no exit penalty here.
    expect(
      hitIds(
        'The Company shall reimburse the Employee for travel expenses incurred on official duty.',
        'BOND_OR_EXIT_PENALTY',
      ),
    ).toEqual([]);
  });

  it('does not flag training that carries no repayment obligation', () => {
    expect(
      hitIds(
        'The Employee will attend an induction and training programme arranged by the Company.',
        'BOND_OR_EXIT_PENALTY',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-NOTICE-ASYMMETRIC', () => {
  it('flags a clause where you owe ninety days and the company owes thirty', () => {
    const hit = hitFor(
      'The Employee shall give ninety (90) days written notice of resignation. The Company may terminate the employment by giving thirty (30) days notice.',
      'IN-EMP-NOTICE-ASYMMETRIC',
      'NOTICE_PERIOD',
    );
    expect(hit.severity).toBe('MEDIUM');
    expect(hit.details).toEqual({ yours: 'ninety (90) days', theirs: 'thirty (30) days' });
  });

  it('flags the same imbalance written as a termination clause', () => {
    const hit = hitFor(
      'You are required to serve a notice period of three (3) months; the Company shall be entitled to terminate your services on one (1) month notice.',
      'IN-EMP-NOTICE-ASYMMETRIC',
      'TERMINATION',
    );
    expect(hit.details).toEqual({ yours: 'three (3) months', theirs: 'one (1) month' });
  });

  it('does not flag a clause where the company owes the longer notice', () => {
    expect(
      hitIds(
        'The Employee shall give thirty (30) days notice. The Company shall give ninety (90) days notice.',
        'NOTICE_PERIOD',
      ),
    ).not.toContain('IN-EMP-NOTICE-ASYMMETRIC');
  });

  it('does not flag a single notice period that binds both sides', () => {
    // Near miss: two parties in one sentence, but only one period, so there is no asymmetry.
    expect(
      hitIds(
        'Either the Employee or the Company may terminate this employment on thirty (30) days notice.',
        'NOTICE_PERIOD',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-NOTICE-LONG', () => {
  it('treats a sixty-day notice period as medium risk', () => {
    const hit = hitFor(
      'The Employee shall give sixty (60) days written notice of resignation.',
      'IN-EMP-NOTICE-LONG',
      'NOTICE_PERIOD',
    );
    expect(hit.severity).toBe('MEDIUM');
    expect(hit.details).toEqual({ period: 'sixty (60) days' });
  });

  it('treats a ninety-day notice period as high risk', () => {
    const hit = hitFor(
      'The Employee shall give ninety (90) days written notice of resignation.',
      'IN-EMP-NOTICE-LONG',
      'NOTICE_PERIOD',
    );
    expect(hit.severity).toBe('HIGH');
    expect(hit.details).toEqual({ period: 'ninety (90) days' });
  });

  it('falls back to the longest unattributed period when no party is named', () => {
    const hit = hitFor(
      'A notice period of ninety (90) days shall apply; a notice period of thirty (30) days shall apply during probation.',
      'IN-EMP-NOTICE-LONG',
      'NOTICE_PERIOD',
    );
    expect(hit.severity).toBe('HIGH');
    expect(hit.details).toEqual({ period: 'ninety (90) days' });
  });

  it('does not fire on a thirty-day notice period', () => {
    expect(
      hitIds(
        'The Employee shall give thirty (30) days written notice of resignation.',
        'NOTICE_PERIOD',
      ),
    ).toEqual([]);
  });

  it('does not fire on a clause that states no notice period at all', () => {
    expect(
      hitIds('Salaries are credited on the last working day of each month.', 'NOTICE_PERIOD'),
    ).toEqual([]);
  });
});

describe('IN-EMP-DOC-RETENTION', () => {
  it('flags a requirement to deposit original certificates on joining', () => {
    const hit = hitFor(
      'The Employee shall deposit original certificates and mark sheets with the Human Resources department at the time of joining.',
      'IN-EMP-DOC-RETENTION',
    );
    expect(hit.severity).toBe('HIGH');
  });

  it('flags the company keeping an original degree certificate in safe custody', () => {
    expect(
      hitIds(
        'The Company shall retain the original degree certificate in safe custody until the end of the service period.',
      ),
    ).toEqual(['IN-EMP-DOC-RETENTION']);
  });

  it('does not flag a request for attested copies', () => {
    // Near miss: certificates are submitted, but only as copies.
    expect(
      hitIds(
        'Please submit attested copies of your educational certificates at the time of joining.',
      ),
    ).toEqual([]);
  });

  it('does not flag originals that are verified and handed straight back', () => {
    expect(
      hitIds('Originals of your documents will be verified and returned to you immediately.'),
    ).toEqual([]);
  });
});

describe('IN-EMP-NONSOLICIT', () => {
  it('flags a restriction on approaching clients after leaving', () => {
    const hit = hitFor(
      'For twelve (12) months after leaving, you shall not solicit any client of the Company.',
      'IN-EMP-NONSOLICIT',
      'NON_SOLICIT',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags a restriction on enticing away colleagues', () => {
    expect(
      hitIds(
        'The Employee shall not induce or entice away any employee of the Company to join another organisation.',
        'NON_SOLICIT',
      ),
    ).toEqual(['IN-EMP-NONSOLICIT']);
  });

  it('does not flag approaching the HR team with a grievance', () => {
    // Near miss: "approach" appears, but not aimed at a client, customer or colleague.
    expect(
      hitIds(
        'The Employee may approach the Human Resources team with any grievance.',
        'NON_SOLICIT',
      ),
    ).toEqual([]);
  });

  it('does not flag an obligation to keep the client list secure', () => {
    expect(
      hitIds('The Employee shall keep the Company client list secure at all times.', 'NON_SOLICIT'),
    ).toEqual([]);
  });
});

describe('IN-EMP-CONFIDENTIALITY', () => {
  it('explains a confidentiality obligation that continues after employment', () => {
    const hit = hitFor(CONFIDENTIALITY, 'IN-EMP-CONFIDENTIALITY', 'CONFIDENTIALITY');
    expect(hit.severity).toBe('INFO');
  });

  it('explains an obligation worded as trade secrets and proprietary information', () => {
    expect(
      hitIds(
        'You agree to protect the Company trade secrets and proprietary information at all times.',
        'CONFIDENTIALITY',
      ),
    ).toEqual(['IN-EMP-CONFIDENTIALITY']);
  });

  it('does not fire on a discretion request that never uses the word confidential', () => {
    // Near miss: reads like a secrecy clause but contains none of the defined terms.
    expect(
      hitIds(
        'Your salary details are personal and should not be discussed with colleagues.',
        'CONFIDENTIALITY',
      ),
    ).toEqual([]);
  });

  it('does not fire on a reporting line', () => {
    expect(
      hitIds('The Employee shall report to the Manager, Engineering.', 'CONFIDENTIALITY'),
    ).toEqual([]);
  });
});

describe('IN-EMP-IP-BROAD', () => {
  it('flags ownership of work created whether or not during working hours', () => {
    const hit = hitFor(
      'All intellectual property created by the Employee, whether or not during working hours, shall vest in the Company.',
      'IN-EMP-IP-BROAD',
      'IP_ASSIGNMENT',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags ownership of anything invented at any time, including outside office hours', () => {
    expect(
      hitIds(
        'Any invention or work product developed at any time, including outside office hours, shall belong to the Company.',
        'IP_ASSIGNMENT',
      ),
    ).toEqual(['IN-EMP-IP-BROAD']);
  });

  it('does not flag an assignment limited to work done in the course of employment', () => {
    // Near miss: a normal, narrow IP assignment.
    expect(
      hitIds(
        'All intellectual property created by the Employee in the course of employment using Company resources shall vest in the Company.',
        'IP_ASSIGNMENT',
      ),
    ).toEqual([]);
  });

  it('does not flag a return-of-equipment clause that happens to say "at any time"', () => {
    expect(
      hitIds(
        'The Employee shall return all Company equipment at any time upon request.',
        'IP_ASSIGNMENT',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-TERMINATION-NO-NOTICE', () => {
  it('flags termination at any time without notice or reason', () => {
    const hit = hitFor(
      'The Company may terminate your employment at any time without any notice or reason.',
      'IN-EMP-TERMINATION-NO-NOTICE',
      'TERMINATION',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags termination at the sole discretion of the company', () => {
    expect(
      hitIds(
        'The Company reserves the right to terminate this employment at its sole discretion.',
        'TERMINATION',
      ),
    ).toEqual(['IN-EMP-TERMINATION-NO-NOTICE']);
  });

  it('does not flag dismissal without notice for proven misconduct', () => {
    // Near miss: summary dismissal for misconduct is ordinary and not worth alarming anyone about.
    expect(
      hitIds(
        'The Company may terminate your employment without notice in case of proven misconduct.',
        'TERMINATION',
      ),
    ).toEqual([]);
  });

  it('does not flag termination on notice by either party', () => {
    expect(
      hitIds(
        'Either party may terminate this employment by giving thirty (30) days written notice.',
        'TERMINATION',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-CLAWBACK', () => {
  it('flags a joining bonus that must be repaid on early resignation', () => {
    const hit = hitFor(
      'A joining bonus of Rs. 1,00,000 will be paid, which you must repay in full if you resign within twelve (12) months.',
      'IN-EMP-CLAWBACK',
      'COMPENSATION',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags relocation assistance recovered from the final settlement', () => {
    expect(
      hitIds(
        'Relocation assistance will be recovered from your final settlement if you leave within one year.',
        'BENEFITS',
      ),
    ).toEqual(['IN-EMP-CLAWBACK']);
  });

  it('does not flag a joining bonus with no repayment condition', () => {
    // Near miss: the bonus is there, the clawback is not.
    expect(
      hitIds(
        'A joining bonus of Rs. 1,00,000 will be paid with your first month salary.',
        'COMPENSATION',
      ),
    ).toEqual([]);
  });

  it('does not flag a routine tax deduction', () => {
    expect(
      hitIds('The Company will deduct tax at source from your monthly salary.', 'COMPENSATION'),
    ).toEqual([]);
  });
});

describe('IN-EMP-UNILATERAL-CHANGE', () => {
  it('flags a right to amend terms and policies at the company’s sole discretion', () => {
    const hit = hitFor(
      'The Company reserves the right to amend these terms and policies from time to time at its sole discretion.',
      'IN-EMP-UNILATERAL-CHANGE',
      'GENERAL',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags a right to modify compensation at the company’s discretion', () => {
    expect(
      hitIds(
        'The Company may modify your compensation structure and benefits at its discretion.',
        'COMPENSATION',
      ),
    ).toEqual(['IN-EMP-UNILATERAL-CHANGE']);
  });

  it('does not flag a change that needs the employee’s written consent', () => {
    // Near miss: the power to amend is there, but it is not unilateral.
    expect(
      hitIds(
        'The Company may modify the terms of this agreement with the written consent of the Employee.',
        'GENERAL',
      ),
    ).toEqual([]);
  });

  it('does not flag policies that are merely published from time to time', () => {
    expect(
      hitIds(
        'Company policies are published on the intranet and may be viewed from time to time.',
        'GENERAL',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-PROBATION-EXTEND', () => {
  it('flags probation that may be extended at the company’s discretion', () => {
    const hit = hitFor(
      'You will be on probation for six (6) months, which may be extended at the discretion of the Company.',
      'IN-EMP-PROBATION-EXTEND',
      'PROBATION',
    );
    expect(hit.severity).toBe('MEDIUM');
  });

  it('flags probation that is liable to be extended on performance grounds', () => {
    expect(
      hitIds(
        'The probation period is liable to be extended if performance is not satisfactory.',
        'PROBATION',
      ),
    ).toEqual(['IN-EMP-PROBATION-EXTEND']);
  });

  it('does not flag an extension that is capped', () => {
    // Near miss: extendable, but the clause states a maximum.
    expect(
      hitIds(
        'You will be on probation for six (6) months, which may be extended up to a total of twelve (12) months.',
        'PROBATION',
      ),
    ).toEqual([]);
  });

  it('does not flag a fixed probation period', () => {
    expect(
      hitIds(
        'You will be on probation for three (3) months and confirmed in writing thereafter.',
        'PROBATION',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-WAGES-50', () => {
  it('explains a CTC that is split across basic pay and allowances', () => {
    const hit = hitFor(
      'Your CTC is Rs. 12,00,000 per annum, comprising basic pay, house rent allowance and a special allowance.',
      'IN-EMP-WAGES-50',
      'COMPENSATION',
    );
    expect(hit.severity).toBe('INFO');
  });

  it('explains a gross salary quoted alongside provident fund and gratuity', () => {
    expect(
      hitIds(
        'The gross salary includes a provident fund contribution and gratuity as per applicable law.',
        'COMPENSATION',
      ),
    ).toEqual(['IN-EMP-WAGES-50']);
  });

  it('does not fire when only one salary component is named', () => {
    // Near miss: a CTC is mentioned, but there is no breakup to explain.
    expect(
      hitIds(
        'Your CTC will be communicated separately by the Human Resources team.',
        'COMPENSATION',
      ),
    ).toEqual([]);
  });

  it('does not fire on a clause that only says when salary is paid', () => {
    expect(
      hitIds(
        'Your annual salary will be credited on the last working day of each month.',
        'COMPENSATION',
      ),
    ).toEqual([]);
  });
});

describe('IN-EMP-GRATUITY-FTE', () => {
  it('explains gratuity for an appointment described as fixed-term', () => {
    const hit = hitFor(
      'This is a fixed-term appointment and the term may be renewed by mutual agreement.',
      'IN-EMP-GRATUITY-FTE',
      'GENERAL',
    );
    expect(hit.severity).toBe('INFO');
  });

  it('explains gratuity for an engagement on a contract basis', () => {
    expect(
      hitIds(
        'Your engagement is on a contract basis and gratuity will be payable as per applicable law.',
        'BENEFITS',
      ),
    ).toEqual(['IN-EMP-GRATUITY-FTE']);
  });

  it('explains gratuity for an engagement stated as a term of months', () => {
    expect(
      hitIds('You are engaged for a term of 12 months from the date of joining.', 'OTHER'),
    ).toEqual(['IN-EMP-GRATUITY-FTE']);
  });

  it('does not fire on an ordinary gratuity clause for a permanent role', () => {
    // Near miss: gratuity is discussed, but the role is not fixed-term.
    expect(
      hitIds(
        'The Company will provide gratuity in accordance with applicable law after five years of continuous service.',
        'BENEFITS',
      ),
    ).toEqual([]);
  });

  it('does not fire on a permanent appointment', () => {
    expect(hitIds('You are appointed as a permanent employee of the Company.', 'GENERAL')).toEqual(
      [],
    );
  });
});

describe('IN-EMP-JURISDICTION', () => {
  it('notes an arbitration clause', () => {
    const hit = hitFor(
      'Any dispute shall be referred to arbitration in Bengaluru under the Arbitration and Conciliation Act, 1996.',
      'IN-EMP-JURISDICTION',
      'DISPUTE_RESOLUTION',
    );
    expect(hit.severity).toBe('INFO');
  });

  it('notes an exclusive jurisdiction clause naming a city', () => {
    expect(
      hitIds(
        'The courts at Mumbai shall have exclusive jurisdiction over any dispute under this agreement.',
        'DISPUTE_RESOLUTION',
      ),
    ).toEqual(['IN-EMP-JURISDICTION']);
  });

  it('does not fire on an internal grievance procedure', () => {
    // Near miss: a dispute process, but not a forum for legal proceedings.
    expect(
      hitIds(
        'Grievances shall first be raised with the reporting manager and then with the head of Human Resources.',
        'DISPUTE_RESOLUTION',
      ),
    ).toEqual([]);
  });

  it('does not fire on a general compliance clause', () => {
    expect(
      hitIds(
        'The Employee shall comply with all applicable laws and Company policies.',
        'DISPUTE_RESOLUTION',
      ),
    ).toEqual([]);
  });
});

describe('category gating', () => {
  it('does not run a category-specific rule when the model chose a different category', () => {
    expect(hitIds(POST_NON_COMPETE, 'COMPENSATION')).toEqual([]);
  });

  it('does not run a category-specific rule when the model gave no category', () => {
    expect(hitIds(POST_NON_COMPETE)).toEqual([]);
  });

  it('runs a rule with no category restriction on wording alone', () => {
    expect(
      hitIds('The Company shall retain the original certificates of the Employee in safe custody.'),
    ).toEqual(['IN-EMP-DOC-RETENTION']);
  });

  it('runs a rule with no category restriction even when the clause was mis-classified', () => {
    expect(
      hitIds(
        'The Company shall retain the original certificates of the Employee in safe custody.',
        'OTHER',
      ),
    ).toEqual(['IN-EMP-DOC-RETENTION']);
  });
});

describe('runRules ordering', () => {
  const NOTICE_CLAUSE = clause(
    'The Employee shall give ninety (90) days written notice of resignation. The Company may terminate the employment by giving thirty (30) days notice.',
    { id: 'c001', order: 0 },
  );
  const NON_COMPETE_CLAUSE = clause(
    `${POST_NON_COMPETE} The Employee shall also deposit original certificates with the Company, which it may retain until the restriction ends.`,
    { id: 'c002', order: 1 },
  );
  const CONFIDENTIALITY_CLAUSE = clause(CONFIDENTIALITY, { id: 'c003', order: 2 });

  const ordered = runRules([NOTICE_CLAUSE, NON_COMPETE_CLAUSE, CONFIDENTIALITY_CLAUSE], {
    c001: 'NOTICE_PERIOD',
    c002: 'NON_COMPETE',
    c003: 'CONFIDENTIALITY',
  });

  it('puts HIGH before MEDIUM before INFO, then orders by clause id and rule id', () => {
    expect(ordered.map((hit) => [hit.severity, hit.clauseId, hit.ruleId])).toEqual([
      ['HIGH', 'c001', 'IN-EMP-NOTICE-LONG'],
      ['HIGH', 'c002', 'IN-EMP-DOC-RETENTION'],
      ['HIGH', 'c002', 'IN-EMP-NONCOMPETE-POST'],
      ['MEDIUM', 'c001', 'IN-EMP-NOTICE-ASYMMETRIC'],
      ['INFO', 'c003', 'IN-EMP-CONFIDENTIALITY'],
    ]);
  });

  it('returns an empty list for a document with no clauses', () => {
    expect(runRules([])).toEqual([]);
  });

  it('returns an empty list when no clause matches any rule', () => {
    expect(runRules([clause('You will be issued a laptop on your first day.')])).toEqual([]);
  });
});

describe('a realistic offer letter', () => {
  const CLAUSES: readonly Clause[] = [
    clause(
      'Notice period. The Employee shall give ninety (90) days written notice of resignation. The Company may terminate the employment by giving thirty (30) days notice.',
      { id: 'c001', label: '5.1', order: 0 },
    ),
    clause(POST_NON_COMPETE, { id: 'c002', label: '9.2', page: 2, pageEnd: 2, order: 1 }),
    clause(BOND_WITH_AMOUNT, { id: 'c003', label: '7.1', page: 2, pageEnd: 2, order: 2 }),
    clause(CONFIDENTIALITY, { id: 'c004', label: '8.1', page: 2, pageEnd: 2, order: 3 }),
    clause(
      'Any dispute shall be referred to arbitration in Bengaluru under the Arbitration and Conciliation Act, 1996.',
      { id: 'c005', label: '12.1', page: 3, pageEnd: 3, order: 4 },
    ),
  ];

  const hits = runRules(CLAUSES, {
    c001: 'NOTICE_PERIOD',
    c002: 'NON_COMPETE',
    c003: 'BOND_OR_EXIT_PENALTY',
    c004: 'CONFIDENTIALITY',
    c005: 'DISPUTE_RESOLUTION',
  });

  it('produces a hit for each of the risky clauses', () => {
    expect(hits.map((hit) => hit.ruleId)).toEqual([
      'IN-EMP-NOTICE-LONG',
      'IN-EMP-NONCOMPETE-POST',
      'IN-EMP-BOND',
      'IN-EMP-NOTICE-ASYMMETRIC',
      'IN-EMP-CONFIDENTIALITY',
      'IN-EMP-JURISDICTION',
    ]);
  });

  it('ties every hit to a clause that is actually in the document', () => {
    const ids = CLAUSES.map((item) => item.id);
    for (const hit of hits) expect(ids).toContain(hit.clauseId);
  });

  it('carries a review date, a legal basis and questions on every hit', () => {
    for (const hit of hits) {
      expect(hit.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(hit.basis.length).toBeGreaterThan(0);
      expect(hit.questions.length).toBeGreaterThan(0);
      expect(hit.message.length).toBeGreaterThan(0);
    }
  });
});

describe('cautious language', () => {
  // SignSure gives information, not advice: it must never state a legal conclusion as certain,
  // and must never tell someone whether to sign.
  const FORBIDDEN = [
    'is void',
    'is illegal',
    'unenforceable',
    'you should sign',
    'do not sign',
    'must not sign',
  ];

  it('never states a legal conclusion as certain in any rule message', () => {
    for (const rule of EMPLOYMENT_RULES) {
      const message = rule.message.toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(`${rule.id}: ${message}`).not.toContain(phrase);
      }
    }
  });

  it('never tells the reader whether to sign in any rule title or question', () => {
    for (const rule of EMPLOYMENT_RULES) {
      const text = [rule.title, ...rule.questions].join(' ').toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(`${rule.id}: ${text}`).not.toContain(phrase);
      }
    }
  });

  it('dates every rule so the UI can show when it was last reviewed', () => {
    for (const rule of EMPLOYMENT_RULES) {
      expect(rule.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rule.basis.length).toBeGreaterThan(0);
    }
  });

  it('gives every rule a unique id', () => {
    const ids = EMPLOYMENT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findMissingInfo', () => {
  const COMPLETE: readonly Clause[] = [
    clause(
      'Your designation is Software Engineer and you will be reporting to the Engineering Manager.',
      {
        id: 'c001',
        order: 0,
      },
    ),
    clause('Your CTC is Rs. 12,00,000 per annum, comprising basic pay and house rent allowance.', {
      id: 'c002',
      order: 1,
    }),
    clause('Your work location is Bengaluru and you may be posted at any other office.', {
      id: 'c003',
      order: 2,
    }),
    clause('You will be on probation for six (6) months from the date of joining.', {
      id: 'c004',
      order: 3,
    }),
    clause('The notice period is ninety (90) days for both parties.', { id: 'c005', order: 4 }),
    clause('You are entitled to eighteen (18) days of paid leave in each calendar year.', {
      id: 'c006',
      order: 5,
    }),
  ];

  function missingIds(clauses: readonly Clause[]): string[] {
    return findMissingInfo(clauses).map((hit) => hit.ruleId);
  }

  function without(id: string): Clause[] {
    return COMPLETE.filter((item) => item.id !== id);
  }

  it('reports nothing for a document that covers all six items', () => {
    expect(missingIds(COMPLETE)).toEqual([]);
  });

  it('reports all six items for an empty document', () => {
    expect(missingIds([])).toEqual(MISSING_INFO_RULES.map((rule) => rule.id));
  });

  it('recognises a stated notice period and asks for one when it is absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-NOTICE');
    expect(missingIds(without('c005'))).toEqual(['IN-EMP-MISSING-NOTICE']);
  });

  it('recognises stated salary details and asks for them when they are absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-SALARY');
    expect(missingIds(without('c002'))).toEqual(['IN-EMP-MISSING-SALARY']);
  });

  it('recognises a stated designation and asks for one when it is absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-ROLE');
    expect(missingIds(without('c001'))).toEqual(['IN-EMP-MISSING-ROLE']);
  });

  it('recognises a stated work location and asks for one when it is absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-LOCATION');
    expect(missingIds(without('c003'))).toEqual(['IN-EMP-MISSING-LOCATION']);
  });

  it('recognises a stated leave entitlement and asks for one when it is absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-LEAVE');
    expect(missingIds(without('c006'))).toEqual(['IN-EMP-MISSING-LEAVE']);
  });

  it('recognises stated probation terms and asks for them when they are absent', () => {
    expect(missingIds(COMPLETE)).not.toContain('IN-EMP-MISSING-PROBATION');
    expect(missingIds(without('c004'))).toEqual(['IN-EMP-MISSING-PROBATION']);
  });

  it('carries a label and a question the reader can take to HR', () => {
    for (const hit of findMissingInfo([])) {
      expect(hit.label.length).toBeGreaterThan(0);
      expect(hit.question.length).toBeGreaterThan(0);
    }
  });
});

describe('ruleQuestions', () => {
  it('returns nothing when no rule fired', () => {
    expect(ruleQuestions([])).toEqual([]);
  });

  it('de-duplicates questions when the same rule fires on two clauses', () => {
    const hits = runRules(
      [
        clause(CONFIDENTIALITY, { id: 'c001', order: 0 }),
        clause('All proprietary information of the Company shall remain confidential.', {
          id: 'c002',
          order: 1,
        }),
      ],
      { c001: 'CONFIDENTIALITY', c002: 'CONFIDENTIALITY' },
    );
    expect(hits).toHaveLength(2);

    const questions = ruleQuestions(hits);
    expect(new Set(questions).size).toBe(questions.length);
    expect(questions).toEqual(hits[0]!.questions);
  });

  it('collects the questions from every rule that fired', () => {
    const hits = runRules(
      [
        clause(BOND_WITH_AMOUNT, { id: 'c001', order: 0 }),
        clause(POST_NON_COMPETE, { id: 'c002', order: 1 }),
      ],
      { c001: 'BOND_OR_EXIT_PENALTY', c002: 'NON_COMPETE' },
    );
    const questions = ruleQuestions(hits);
    expect(questions).toContain('What specific training costs does this amount cover?');
    expect(questions).toContain(
      'Is this restriction meant to apply after I leave, and for how long?',
    );
    expect(new Set(questions).size).toBe(questions.length);
  });
});
