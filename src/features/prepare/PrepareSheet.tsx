import { useCallback, useId, useState } from 'react';
import type { PrepareResult } from '@shared/types';
import { Button } from '@/components/Button';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * The sheet the user takes to HR or a lawyer.
 *
 * Checkboxes are local state only: nothing about which boxes are ticked leaves the browser or
 * survives a reload, and the hint under the list says so rather than leaving the reader to
 * assume either way.
 *
 * Export is three routes because people actually use all three - print for a meeting, copy for
 * a WhatsApp message to a parent or a friend, download for a lawyer. The Markdown is built from
 * the same data the page renders, so what is exported is exactly what was shown.
 */

const SECTIONS = [
  ['checklistBeforeSigning', 'prepare.checklist'],
  ['questionsForHR', 'prepare.questionsForHR'],
  ['questionsForLawyer', 'prepare.questionsForLawyer'],
  ['missingInformation', 'prepare.missingInformation'],
  ['documentsToBring', 'prepare.documentsToBring'],
] as const satisfies readonly (readonly [keyof PrepareResult, TranslationKey])[];

export interface PrepareSheetProps {
  sheet: PrepareResult;
  documentName: string | null;
  /** Flagged clauses, included in the export so the sheet stands alone without the app. */
  flagged: readonly { label: string; risk: string; title: string; text: string }[];
}

/** Builds the downloadable sheet. Plain Markdown so it opens anywhere, including on a phone. */
export function toMarkdown(
  sheet: PrepareResult,
  documentName: string | null,
  flagged: PrepareSheetProps['flagged'],
  headings: Readonly<Record<string, string>>,
): string {
  const lines: string[] = ['# Preparing to discuss your offer', ''];
  if (documentName !== null) lines.push(`Document: ${documentName}`, '');

  for (const [key, headingKey] of SECTIONS) {
    const items = sheet[key];
    if (items.length === 0) continue;
    lines.push(`## ${headings[headingKey] ?? headingKey}`, '');
    for (const item of items) lines.push(`- [ ] ${item}`);
    lines.push('');
  }

  if (flagged.length > 0) {
    lines.push('## Clauses worth a close look', '');
    for (const clause of flagged) {
      lines.push(`### ${clause.label} — ${clause.title} (${clause.risk})`, '');
      lines.push('> ' + clause.text.replace(/\n/g, '\n> '), '');
    }
  }

  lines.push('---', '');
  lines.push(
    'Prepared with SignSure. This is information, not legal advice. Please confirm anything important with a qualified advocate.',
  );
  return lines.join('\n');
}

export function PrepareSheet({ sheet, documentName, flagged }: PrepareSheetProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const statusId = useId();

  const headings: Record<string, string> = {};
  for (const [, headingKey] of SECTIONS) headings[headingKey] = t(headingKey);

  const markdown = toMarkdown(sheet, documentName, flagged, headings);

  const copy = useCallback(() => {
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [markdown]);

  const download = useCallback(() => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'signsure-preparation.md';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [markdown]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('prepare.heading')}</h2>
        <p className="prose-measure mt-1 text-sm text-muted">{t('prepare.intro')}</p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        <Button
          onClick={() => {
            window.print();
          }}
        >
          {t('prepare.print')}
        </Button>
        <Button onClick={copy}>{t('prepare.copy')}</Button>
        <Button onClick={download}>{t('prepare.download')}</Button>
      </div>

      <p id={statusId} aria-live="polite" className="min-h-5 text-sm text-low">
        {copied ? t('prepare.copied') : ''}
      </p>

      {SECTIONS.map(([key, headingKey]) => {
        const items = sheet[key];
        if (items.length === 0) return null;
        return (
          <section key={key} aria-labelledby={`prepare-${key}`}>
            <h3 id={`prepare-${key}`} className="text-base font-semibold text-ink">
              {t(headingKey)}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {items.map((item) => (
                <li key={item}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                    <input type="checkbox" className="mt-1 size-4" />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-xs text-muted">{t('prepare.checkboxHint')}</p>
    </div>
  );
}
