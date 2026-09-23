import { useCallback, useId, useMemo, useState } from 'react';
import type { Clause, CompareResult } from '@shared/types';
import { Button } from '@/components/Button';
import { VerificationBadge } from '@/components/Badge';
import { Dropzone } from '@/features/upload/Dropzone';
import { parseFile, type ParseFailure } from '@/features/parsing/parseDocument';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * Side-by-side comparison of two versions of an offer.
 *
 * Rendered as a real `<table>` with row and column headers, because that is what it is: a grid
 * of changes with two comparable columns. A screen reader can then say "Changed, Worse for you,
 * Original: ninety days" as it moves across a row, which a stack of divs cannot do.
 *
 * Impact is a word, never a colour alone, for the same reason as everywhere else.
 */

export interface CompareTabProps {
  result: CompareResult | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorKey: TranslationKey | null;
  clausesA: readonly Clause[];
  onSecondDocument: (clauses: Clause[]) => void;
  onCompare: () => void;
  hasSecondDocument: boolean;
}

export function CompareTab({
  result,
  status,
  errorKey,
  clausesA,
  onSecondDocument,
  onCompare,
  hasSecondDocument,
}: CompareTabProps) {
  const t = useT();
  const [parseError, setParseError] = useState<ParseFailure | null>(null);
  const statusId = useId();

  const byIdA = useMemo(() => new Map(clausesA.map((clause) => [clause.id, clause])), [clausesA]);

  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);
      parseFile(file)
        .then((parsed) => {
          if (parsed.ok) onSecondDocument(parsed.document.clauses);
          // Keep the specific reason: "this is a scanned PDF" tells the reader what to do next,
          // where a generic "could not be read" does not.
          else setParseError(parsed);
        })
        .catch(() => {
          setParseError({ ok: false, reason: 'UNKNOWN' });
        });
    },
    [onSecondDocument],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('compare.heading')}</h2>
        <p className="prose-measure mt-1 text-sm text-muted">{t('compare.intro')}</p>
      </div>

      {hasSecondDocument ? null : <Dropzone onFile={handleFile} />}

      {parseError === null ? null : (
        <p role="alert" className="text-sm text-high">
          {t(`upload.error.${parseError.reason}` as TranslationKey, parseError.detail)}
        </p>
      )}

      {hasSecondDocument ? (
        <div>
          <Button variant="primary" disabled={status === 'loading'} onClick={onCompare}>
            {t('compare.run')}
          </Button>
        </div>
      ) : null}

      <p id={statusId} aria-live="polite" className="min-h-5 text-sm text-muted">
        {status === 'loading' ? t('compare.running') : ''}
      </p>

      {status === 'error' && errorKey !== null ? (
        <p role="alert" className="text-sm text-high">
          {t(errorKey)}
        </p>
      ) : null}

      {result === null ? null : result.changes.length === 0 ? (
        <p className="text-sm text-muted">{t('compare.noChanges')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">{t('compare.tableLabel')}</caption>
              <thead>
                <tr className="border-b border-line text-start">
                  <th scope="col" className="p-2 text-start font-semibold text-ink">
                    {t('compare.changeColumn')}
                  </th>
                  <th scope="col" className="p-2 text-start font-semibold text-ink">
                    {t('compare.versionA')}
                  </th>
                  <th scope="col" className="p-2 text-start font-semibold text-ink">
                    {t('compare.versionB')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.changes.map((change) => (
                  <tr key={change.pairId} className="border-b border-line align-top">
                    <th scope="row" className="p-2 text-start font-normal">
                      <span className="block font-medium text-ink">
                        {t(`compare.changeType.${change.changeType}` as TranslationKey)}
                      </span>
                      <span className="block text-xs text-muted">
                        {t(`compare.impact.${change.impact}` as TranslationKey)}
                      </span>
                      <span className="mt-1 block text-xs text-ink">{change.summary}</span>
                    </th>
                    <td className="p-2">
                      {change.quoteA === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          <VerificationBadge status={change.quoteA.status} />
                          <blockquote className="mt-1 text-ink">{change.quoteA.quote}</blockquote>
                          <span className="text-xs text-muted">
                            {byIdA.get(change.quoteA.clauseId)?.label ?? ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="p-2">
                      {change.quoteB === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          <VerificationBadge status={change.quoteB.status} />
                          <blockquote className="mt-1 text-ink">{change.quoteB.quote}</blockquote>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            {t('compare.unchanged', { count: result.unchangedCount })}
          </p>
        </>
      )}
    </div>
  );
}
