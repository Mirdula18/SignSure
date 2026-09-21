import { useCallback, useId, useState } from 'react';
import { LIMITS } from '@shared/limits';
import { suggestedQuestionKeys } from '@shared/lenses';
import type { AskStatus, Clause } from '@shared/types';
import { Button } from '@/components/Button';
import { VerificationBadge } from '@/components/Badge';
import { GlossaryText } from '@/features/a11y/GlossaryText';
import { ReadAloud } from '@/features/a11y/ReadAloud';
import { useAppState, type QaEntry } from '@/state/appState';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * Grounded question answering.
 *
 * Three things here are load-bearing for trust. The status of every answer is a *word*, not a
 * colour, and "Your document does not say this" is given the same visual weight as an answer,
 * because a refusal is a useful result rather than a failure. Citations are buttons that move
 * focus to the clause they came from, so checking a claim takes one keystroke. And answers
 * arrive in a polite live region rather than stealing focus, so a screen-reader user is told
 * the answer is ready without losing their place.
 */

export interface AskPanelProps {
  clauses: readonly Clause[];
  onAsk: (question: string) => void;
  onCitationFollowed: (clauseId: string) => void;
}

const STATUS_KEY: Readonly<Record<AskStatus, TranslationKey>> = {
  answered: 'ask.answeredStatus',
  not_in_document: 'ask.notInDocumentStatus',
  needs_professional: 'ask.needsProfessionalStatus',
};

const STATUS_STYLE: Readonly<Record<AskStatus, string>> = {
  answered: 'border-low bg-low-soft text-low',
  not_in_document: 'border-line-strong bg-sunken text-muted',
  needs_professional: 'border-medium bg-medium-soft text-medium',
};

export function AskPanel({ clauses, onAsk, onCitationFollowed }: AskPanelProps) {
  const t = useT();
  const { state } = useAppState();
  const [question, setQuestion] = useState('');
  const inputId = useId();
  const hintId = useId();

  const tooLong = question.length > LIMITS.maxQuestionChars;
  const canSend = question.trim().length >= 3 && !tooLong;

  const submit = useCallback(() => {
    if (!canSend) return;
    onAsk(question.trim());
    setQuestion('');
  }, [canSend, onAsk, question]);

  const suggestions = suggestedQuestionKeys(state.lenses);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('ask.heading')}</h2>
        <p className="prose-measure mt-1 text-sm text-muted">{t('ask.intro')}</p>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {t('ask.label')}
        </label>
        <textarea
          id={inputId}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          rows={3}
          aria-describedby={hintId}
          aria-invalid={tooLong}
          placeholder={t('ask.placeholder')}
          className="w-full rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink"
        />
        <p id={hintId} className={tooLong ? 'text-xs text-high' : 'text-xs text-muted'}>
          {tooLong ? t('ask.tooLong', { limit: LIMITS.maxQuestionChars }) : t('ask.intro')}
        </p>
        <div>
          <Button type="submit" variant="primary" disabled={!canSend}>
            {t('ask.send')}
          </Button>
        </div>
      </form>

      <section aria-labelledby="ask-suggestions">
        <h3 id="ask-suggestions" className="text-sm font-medium text-ink">
          {t('ask.suggested')}
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((key) => (
            <li key={key}>
              <Button
                onClick={() => {
                  onAsk(t(key as TranslationKey));
                }}
              >
                {t(key as TranslationKey)}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ask-answers">
        <h3 id="ask-answers" className="sr-only">
          {t('ask.answerRegion')}
        </h3>
        <div aria-live="polite" className="flex flex-col gap-4">
          {state.qa.length === 0 ? (
            <p className="text-sm text-muted">{t('ask.empty')}</p>
          ) : (
            state.qa.map((entry) => (
              <AnswerCard
                key={entry.id}
                entry={entry}
                clauses={clauses}
                onCitationFollowed={onCitationFollowed}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

interface AnswerCardProps {
  entry: QaEntry;
  clauses: readonly Clause[];
  onCitationFollowed: (clauseId: string) => void;
}

function AnswerCard({ entry, clauses, onCitationFollowed }: AnswerCardProps) {
  const t = useT();
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <h4 className="text-sm font-semibold text-ink">{entry.question}</h4>

      {entry.status === 'loading' ? (
        <p className="mt-2 text-sm text-muted">{t('ask.sending')}</p>
      ) : null}

      {entry.status === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-high">
          {t(`error.${entry.errorCode ?? 'INTERNAL'}` as TranslationKey)}
        </p>
      ) : null}

      {entry.result === null ? null : (
        <>
          <p
            className={`mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[entry.result.status]}`}
          >
            {t(STATUS_KEY[entry.result.status])}
          </p>

          <p className="prose-measure mt-2 text-sm leading-relaxed text-ink">
            <GlossaryText text={entry.result.answer} />
          </p>
          <ReadAloud label={entry.question} text={entry.result.answer} />

          {entry.result.citations.length === 0 ? null : (
            <div className="mt-3">
              <h5 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('ask.citations')}
              </h5>
              <ul className="mt-2 flex flex-col gap-2">
                {entry.result.citations.map((citation) => {
                  const clause = byId.get(citation.clauseId);
                  const label = clause?.label ?? citation.clauseId;
                  return (
                    <li
                      key={`${citation.clauseId}-${citation.quote}`}
                      className="rounded-lg border border-line bg-sunken p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <VerificationBadge status={citation.status} />
                        <Button
                          onClick={() => {
                            onCitationFollowed(citation.clauseId);
                          }}
                        >
                          {t('ask.citationButton', { label })}
                        </Button>
                      </div>
                      <blockquote className="mt-2 text-sm text-ink italic">
                        {citation.quote}
                      </blockquote>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {entry.result.missingInfo.length === 0 ? null : (
            <div className="mt-3">
              <h5 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('ask.missingInfo')}
              </h5>
              <ul className="mt-1 list-disc ps-5 text-sm text-ink">
                {entry.result.missingInfo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {entry.result.suggestedQuestions.length === 0 ? null : (
            <div className="mt-3">
              <h5 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('ask.suggestedNext')}
              </h5>
              <ul className="mt-1 list-disc ps-5 text-sm text-ink">
                {entry.result.suggestedQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </article>
  );
}
