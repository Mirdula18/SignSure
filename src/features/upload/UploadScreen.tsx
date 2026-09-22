import { useCallback, useId, useState } from 'react';
import { LIMITS } from '@shared/limits';
import { Button } from '@/components/Button';
import { Dropzone } from './Dropzone';
import { parseFile, parseText, type ParseFailureReason } from '@/features/parsing/parseDocument';
import { SAMPLE_LABEL, SAMPLE_OFFER_LETTER } from '@/sample/offerLetter';
import { useAppState } from '@/state/appState';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * The upload screen: file, paste, or the built-in sample.
 *
 * Parsing happens here, in the browser, before anything is sent anywhere. The result is a
 * clause count the user can sanity-check ("we found 32 clauses across 5 pages") before they
 * commit to an analysis - which is also the moment the promise that the file never leaves the
 * device is most visible.
 */

type Mode = 'file' | 'paste';

interface ParseError {
  reason: ParseFailureReason;
  detail?: Readonly<Record<string, string | number>>;
}

/** Error reasons map one-to-one onto i18n keys, so a new reason is a compile-time gap. */
function errorKey(reason: ParseFailureReason): TranslationKey {
  return `upload.error.${reason}` as TranslationKey;
}

export function UploadScreen() {
  const t = useT();
  const { dispatch } = useAppState();
  const [mode, setMode] = useState<Mode>('file');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ParseError | null>(null);
  const statusId = useId();
  const pasteId = useId();

  const accept = useCallback(
    (result: ReturnType<typeof parseText>) => {
      if (result.ok) {
        setError(null);
        dispatch({ type: 'documentParsed', document: result.document });
        return;
      }
      setError(
        result.detail
          ? { reason: result.reason, detail: result.detail }
          : { reason: result.reason },
      );
    },
    [dispatch],
  );

  const handleFile = useCallback(
    (file: File) => {
      setBusy(true);
      setError(null);
      parseFile(file)
        .then(accept)
        .catch(() => {
          setError({ reason: 'UNKNOWN' });
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [accept],
  );

  const handleSample = useCallback(() => {
    accept(parseText(SAMPLE_OFFER_LETTER, 'sample'));
  }, [accept]);

  const handlePaste = useCallback(() => {
    accept(parseText(pasted, 'paste'));
  }, [accept, pasted]);

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-6">
      <h2 id="upload-heading" className="text-2xl font-semibold text-ink">
        {t('upload.heading')}
      </h2>

      <div className="flex gap-2" role="group" aria-label={t('upload.heading')}>
        {(['file', 'paste'] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? 'primary' : 'secondary'}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
            }}
          >
            {t(value === 'file' ? 'upload.tabFile' : 'upload.tabPaste')}
          </Button>
        ))}
      </div>

      {mode === 'file' ? (
        <Dropzone onFile={handleFile} disabled={busy} />
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={pasteId} className="text-sm font-medium text-ink">
            {t('upload.pasteLabel')}
          </label>
          <p className="text-xs text-muted">{t('upload.pasteHint')}</p>
          <textarea
            id={pasteId}
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
            }}
            rows={10}
            maxLength={LIMITS.maxTotalChars}
            className="w-full rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink"
          />
          <div>
            <Button variant="primary" disabled={pasted.trim().length === 0} onClick={handlePaste}>
              {t('upload.pasteAction')}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-raised p-4">
        <Button onClick={handleSample}>{t('upload.sampleAction')}</Button>
        <p className="mt-2 text-xs text-muted">{t('upload.sampleNote')}</p>
        <p className="mt-1 text-xs text-muted">{SAMPLE_LABEL}</p>
      </div>

      {/* Live region: parse results and failures are announced without moving focus. */}
      <div id={statusId} aria-live="polite" className="min-h-6">
        {busy ? <p className="text-sm text-muted">{t('upload.reading')}</p> : null}
      </div>

      {error === null ? null : (
        <div role="alert" className="rounded-lg border border-high bg-high-soft p-4 text-sm">
          <p className="font-semibold text-high">{t('error.heading')}</p>
          <p className="mt-1 text-ink">{t(errorKey(error.reason), error.detail)}</p>
        </div>
      )}
    </section>
  );
}
