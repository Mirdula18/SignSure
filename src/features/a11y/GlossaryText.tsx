import { Fragment, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';
import { splitOnGlossaryTerms, type GlossaryTermId } from './glossary';

/**
 * Text with its legal terms made explainable.
 *
 * Each term is a real button that expands a definition right after it, rather than a tooltip:
 * a tooltip that only appears on hover is unreachable by keyboard and by touch, and one that
 * floats over the text breaks at 320px. The definition is inline, so it reflows with the
 * paragraph, and Escape closes it without losing the reader's place.
 */

function GlossaryTerm({ term, text }: { term: GlossaryTermId; text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const definitionId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={definitionId}
        title={t('glossary.open', { term: text })}
        onClick={() => {
          setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
        className="cursor-help rounded-xs underline decoration-dotted underline-offset-4"
      >
        {text}
      </button>
      <span
        id={definitionId}
        role="note"
        hidden={!open}
        className="mx-1 inline rounded-md bg-info-soft px-1.5 py-0.5 text-sm text-ink"
      >
        {t(`glossary.${term}.definition` as TranslationKey)}
      </span>
    </>
  );
}

export function GlossaryText({ text }: { text: string }) {
  const segments = splitOnGlossaryTerms(text);
  return (
    <>
      {segments.map((segment, index) =>
        typeof segment === 'string' ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <GlossaryTerm key={index} term={segment.term} text={segment.text} />
        ),
      )}
    </>
  );
}
