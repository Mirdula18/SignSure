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
 * the same data the page renders and in the same language, so what is exported is exactly what
 * was shown.
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

/** Every piece of fixed text in the export, already translated by the caller. */
export interface MarkdownText {
  title: string;
  document: (name: string) => string;
  flaggedHeading: string;
  footer: string;
  sections: Readonly<Record<(typeof SECTIONS)[number][1], string>>;
}

/**
 * Builds the downloadable sheet. Plain Markdown so it opens anywhere, including on a phone.
 *
 * Takes its fixed text as a parameter instead of calling `t()` itself, so it stays a pure
 * function that is easy to test - and a Hindi reader gets a Hindi file, not one with English
 * headings wrapped around Hindi content.
 */
export function toMarkdown(
  sheet: PrepareResult,
  documentName: string | null,
  flagged: PrepareSheetProps['flagged'],
  text: MarkdownText,
): string {
  const lines: string[] = [`# ${text.title}`, ''];
  if (documentName !== null) lines.push(text.document(documentName), '');

  for (const [key, headingKey] of SECTIONS) {
    const items = sheet[key];
    if (items.length === 0) continue;
    lines.push(`## ${text.sections[headingKey]}`, '');
    for (const item of items) lines.push(`- [ ] ${item}`);
    lines.push('');
  }

  if (flagged.length > 0) {
    lines.push(`## ${text.flaggedHeading}`, '');
    for (const clause of flagged) {
      lines.push(`### ${clause.label} — ${clause.title} (${clause.risk})`, '');
      lines.push('> ' + clause.text.replace(/\n/g, '\n> '), '');
    }
  }

  lines.push('---', '', text.footer);
  return lines.join('\n');
}

type CopyStatus = 'idle' | 'copied' | 'failed';

export function PrepareSheet({ sheet, documentName, flagged }: PrepareSheetProps) {
  const t = useT();
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  // Bumped on every copy so a second copy is announced again: a live region only speaks when
  // its content changes, and "Copied" replaced by "Copied" is no change at all.
  const [copyCount, setCopyCount] = useState(0);
  const statusId = useId();

  const markdown = toMarkdown(sheet, documentName, flagged, {
    title: t('prepare.exportTitle'),
    document: (name) => t('prepare.exportDocument', { name }),
    flaggedHeading: t('prepare.exportFlagged'),
    footer: t('prepare.exportFooter'),
    sections: {
      'prepare.checklist': t('prepare.checklist'),
      'prepare.questionsForHR': t('prepare.questionsForHR'),
      'prepare.questionsForLawyer': t('prepare.questionsForLawyer'),
      'prepare.missingInformation': t('prepare.missingInformation'),
      'prepare.documentsToBring': t('prepare.documentsToBring'),
    },
  });

  const copy = useCallback(() => {
    setCopyCount((count) => count + 1);
    // Older browsers and non-secure contexts have no async clipboard at all.
    if (typeof navigator.clipboard?.writeText !== 'function') {
      setCopyStatus('failed');
      return;
    }
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopyStatus('copied');
      })
      .catch(() => {
        setCopyStatus('failed');
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

      <p
        id={statusId}
        aria-live="polite"
        className={
          copyStatus === 'failed' ? 'min-h-5 text-sm text-high' : 'min-h-5 text-sm text-low'
        }
      >
        {copyStatus === 'idle' ? null : (
          <span key={copyCount}>
            {copyStatus === 'copied' ? t('prepare.copied') : t('prepare.copyFailed')}
          </span>
        )}
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
              {items.map((item, index) => (
                // Index as part of the key: the model can repeat an item, and duplicate keys
                // make React drop or merge list rows.
                <li key={`${String(index)}-${item}`}>
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
