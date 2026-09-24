import { useId, useMemo, useState } from 'react';
import { CLAUSE_CATEGORIES, RISK_LEVELS } from '@shared/types';
import type {
  AnalysisResult,
  Clause,
  ClauseCategory,
  ClauseFinding,
  RiskLevel,
} from '@shared/types';
import { normalize } from '@shared/normalize';
import { categoryKey } from '@/i18n';
import { useT } from '@/state/preferences';
import { FindingCard } from './FindingCard';
import { PlainClauseCard } from './PlainClauseCard';

/**
 * Every clause, in document order, filterable.
 *
 * Clauses with findings show them; the rest show their own text, so the whole document can be
 * read here and a citation to any clause has somewhere to land. Each clause is wrapped once and
 * that wrapper is the citation target, so two findings on one clause never share an id.
 *
 * Search runs over *normalised* text, the same normalisation quote verification uses, so
 * searching for "Rs. 2,00,000" finds the clause whether the document wrote it with a
 * non-breaking space or a different dash. Filtering is client-side and instant: the report is
 * already in memory and there is nothing to fetch.
 *
 * Results are announced in a live region, because a filter that silently empties the list tells
 * a sighted user something and a screen-reader user nothing.
 */

export interface ClauseListProps {
  analysis: AnalysisResult;
  clauses: readonly Clause[];
  focusedClauseId: string | null;
}

export function ClauseList({ analysis, clauses, focusedClauseId }: ClauseListProps) {
  const t = useT();
  const [category, setCategory] = useState<ClauseCategory | 'ALL'>('ALL');
  const [risk, setRisk] = useState<RiskLevel | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const categoryId = useId();
  const riskId = useId();
  const searchId = useId();
  const searchHintId = useId();

  const findingsByClause = useMemo(() => {
    const grouped = new Map<string, ClauseFinding[]>();
    for (const finding of analysis.findings) {
      grouped.set(finding.clauseId, [...(grouped.get(finding.clauseId) ?? []), finding]);
    }
    return grouped;
  }, [analysis.findings]);

  // Each visible clause with the findings that pass the filters. With no category or risk
  // filter, a clause with no findings still shows; with one, only clauses that match do.
  const visible = useMemo(() => {
    const needle = normalize(search);
    const filtering = category !== 'ALL' || risk !== 'ALL';
    return clauses
      .map((clause) => ({
        clause,
        findings: (findingsByClause.get(clause.id) ?? []).filter(
          (finding) =>
            (category === 'ALL' || finding.category === category) &&
            (risk === 'ALL' || finding.risk === risk),
        ),
      }))
      .filter(({ clause, findings }) => {
        if (filtering && findings.length === 0) return false;
        return needle.length === 0 || normalize(clause.text).includes(needle);
      });
  }, [clauses, findingsByClause, category, risk, search]);

  const presentCategories = useMemo(
    () =>
      CLAUSE_CATEGORIES.filter((value) =>
        analysis.findings.some((finding) => finding.category === value),
      ),
    [analysis.findings],
  );

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-ink">{t('clauses.heading')}</h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={categoryId} className="text-sm font-medium text-ink">
            {t('clauses.filterCategory')}
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as ClauseCategory | 'ALL');
            }}
            className="tap-target rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink"
          >
            <option value="ALL">{t('clauses.filterAll')}</option>
            {presentCategories.map((value) => (
              <option key={value} value={value}>
                {t(categoryKey(value))}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={riskId} className="text-sm font-medium text-ink">
            {t('clauses.filterRisk')}
          </label>
          <select
            id={riskId}
            value={risk}
            onChange={(event) => {
              setRisk(event.target.value as RiskLevel | 'ALL');
            }}
            className="tap-target rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink"
          >
            <option value="ALL">{t('clauses.filterAll')}</option>
            {RISK_LEVELS.map((value) => (
              <option key={value} value={value}>
                {t(`risk.${value.toLowerCase()}` as 'risk.high')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium text-ink">
            {t('clauses.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            aria-describedby={searchHintId}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="tap-target rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          />
          <p id={searchHintId} className="text-xs text-muted">
            {t('clauses.searchHint')}
          </p>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted">
        {t('clauses.count', { shown: visible.length, total: clauses.length })}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{t('clauses.none')}</p>
      ) : (
        <ol className="flex list-none flex-col gap-4 p-0">
          {visible.map(({ clause, findings }) => (
            <li
              key={clause.id}
              id={`clause-${clause.id}`}
              // -1 makes the clause a target for programmatic focus without adding a tab stop.
              // Following a citation calls focus() on it; on an element that cannot take focus
              // that call is a silent no-op and a keyboard user is left wherever they were.
              tabIndex={-1}
              className="render-when-visible flex scroll-mt-28 flex-col gap-3 rounded-xl"
            >
              {findings.length === 0 ? (
                <PlainClauseCard clause={clause} />
              ) : (
                findings.map((finding) => (
                  <FindingCard
                    key={`${finding.title}-${finding.evidence.quote}`}
                    finding={finding}
                    clause={clause}
                    defaultOpen={clause.id === focusedClauseId}
                  />
                ))
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
