import { useCallback, useId, useState } from 'react';
import { LENSES, type Lens } from '@shared/lenses';
import { Button } from '@/components/Button';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * The concern picker.
 *
 * Real checkboxes in a real `<fieldset>`, not clickable divs: the grouping, the legend and the
 * keyboard behaviour all come for free and are impossible to get subtly wrong. The card styling
 * hangs off `:has(:checked)`, so the visual state can never disagree with the control state.
 *
 * "Show me everything" is exclusive with the others, because choosing a focus *and* asking for
 * no focus is a contradiction the ranking cannot honour.
 */
export interface LensPickerProps {
  initial?: readonly Lens[];
  onSubmit: (lenses: Lens[]) => void;
  onBack?: () => void;
  submitting?: boolean;
}

export function LensPicker({
  initial = [],
  onSubmit,
  onBack,
  submitting = false,
}: LensPickerProps) {
  const t = useT();
  const [selected, setSelected] = useState<Set<Lens>>(new Set(initial));
  const headingId = useId();

  const toggle = useCallback((lens: Lens) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(lens)) {
        next.delete(lens);
        return next;
      }
      if (lens === 'EVERYTHING') return new Set<Lens>(['EVERYTHING']);
      next.delete('EVERYTHING');
      next.add(lens);
      return next;
    });
  }, []);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div>
        <h2 id={headingId} className="text-2xl font-semibold text-ink">
          {t('lenses.heading')}
        </h2>
        <p className="prose-measure mt-2 text-sm text-muted">{t('lenses.intro')}</p>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('lenses.heading')}</legend>
        {LENSES.map((lens) => {
          const title = t(`lenses.${lens}` as TranslationKey);
          const hint = t(`lenses.${lens}.hint` as TranslationKey);
          return (
            <div
              key={lens}
              className="tap-target flex items-start gap-3 rounded-xl border border-line bg-surface p-4 has-checked:border-primary has-checked:bg-primary-soft"
            >
              <input
                id={`${headingId}-${lens}`}
                type="checkbox"
                className="mt-1 size-4"
                checked={selected.has(lens)}
                aria-describedby={`${headingId}-${lens}-hint`}
                onChange={() => {
                  toggle(lens);
                }}
              />
              <label htmlFor={`${headingId}-${lens}`} className="cursor-pointer">
                <span className="block font-medium text-ink">{title}</span>
                <span id={`${headingId}-${lens}-hint`} className="block text-xs text-muted">
                  {hint}
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={submitting}
          onClick={() => {
            onSubmit([...selected]);
          }}
        >
          {t('lenses.analyse')}
        </Button>
        {onBack === undefined ? null : <Button onClick={onBack}>{t('lenses.back')}</Button>}
      </div>
    </section>
  );
}
