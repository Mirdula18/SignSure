/**
 * Fixture comparison.
 *
 * The pairs are already matched deterministically before the model is asked anything, so this
 * fixture only has to decide whether a pair changed meaningfully. It compares the two sides
 * directly and quotes each one verbatim, which means the "both quotes verified against their
 * own side" rule is exercised for real.
 */

const PAIR =
  /<pair id="([^"]+)">\s*<version_a>([\s\S]*?)<\/version_a>\s*<version_b>([\s\S]*?)<\/version_b>\s*<\/pair>/g;

const ABSENT = '(absent)';

function quoteFrom(text: string): string | null {
  if (text === ABSENT || text.trim().length === 0) return null;
  const sentence = /[^.]{25,180}\./.exec(text);
  return (sentence?.[0] ?? text.slice(0, 160)).trim();
}

/** Crude signal of who a change favours, based on whether a stated number went up or down. */
function impactOf(a: string, b: string): string {
  const numbersIn = (text: string) =>
    [...text.matchAll(/\b(\d[\d,]*)\b/g)].map((match) => Number(match[1]?.replace(/,/g, '') ?? 0));

  const before = numbersIn(a);
  const after = numbersIn(b);
  if (before.length === 0 || after.length === 0) return 'UNCLEAR';

  const maxBefore = Math.max(...before);
  const maxAfter = Math.max(...after);
  if (maxAfter > maxBefore) return 'WORSE_FOR_EMPLOYEE';
  if (maxAfter < maxBefore) return 'BETTER_FOR_EMPLOYEE';
  return 'NEUTRAL';
}

/** Describes each pair in the prompt, judging impact by comparing the figures on each side. */
export function mockCompare(userPrompt: string): Record<string, unknown> {
  const changes: Record<string, unknown>[] = [];

  for (const match of userPrompt.matchAll(PAIR)) {
    const pairId = match[1];
    const a = (match[2] ?? '').trim();
    const b = (match[3] ?? '').trim();
    if (pairId === undefined) continue;

    if (a === ABSENT && b !== ABSENT) {
      changes.push({
        pairId,
        changeType: 'ADDED',
        impact: 'UNCLEAR',
        summary: 'This clause is new in the revised version.',
        quoteA: null,
        quoteB: quoteFrom(b),
      });
      continue;
    }

    if (b === ABSENT && a !== ABSENT) {
      changes.push({
        pairId,
        changeType: 'REMOVED',
        impact: 'UNCLEAR',
        summary: 'This clause has been removed from the revised version.',
        quoteA: quoteFrom(a),
        quoteB: null,
      });
      continue;
    }

    // Whitespace-insensitive comparison, so reformatting alone is not reported as a change.
    if (a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' ')) continue;

    changes.push({
      pairId,
      changeType: 'CHANGED',
      impact: impactOf(a, b),
      summary: 'The wording of this clause has changed between the two versions.',
      quoteA: quoteFrom(a),
      quoteB: quoteFrom(b),
    });
  }

  return { changes };
}
