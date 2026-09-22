import { useId, useMemo, useState } from 'react';
import { CLAUSE_CATEGORIES, RISK_LEVELS } from '@shared/types';
import type { AnalysisResult, Clause, ClauseCategory, RiskLevel } from '@shared/types';
import { normalize } from '@shared/normalize';
import { categoryKey } from '@/i18n';
import { useT } from '@/state/preferences';
import { FindingCard } from './FindingCard';

/**
 * Every clause, filterable.
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

  const byId = useMemo(() => new Map(clauses.map((clause) => [clause.id, clause])), [clauses]);

  const visible = useMemo(() => {
    const needle = normalize(search);
    return analysis.findings.filter((finding) => {
      if (category !== 'ALL' && finding.category !== category) return false;
      if (risk !== 'ALL' && finding.risk !== risk) return false;
      if (needle.length === 0) return true;
      const clause = byId.get(finding.clauseId);
      return clause !== undefined && normalize(clause.text).includes(needle);
    });
  }, [analysis.findings, byId, category, risk, search]);

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
        {t('clauses.count', { shown: visible.length, total: analysis.findings.length })}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{t('clauses.none')}</p>
      ) : (
        <ol className="flex list-none flex-col gap-4 p-0">
          {visible.map((finding) => {
            const clause = byId.get(finding.clauseId);
            if (!clause) return null;
            return (
              <li key={`${finding.clauseId}-${finding.title}`}>
                <FindingCard
                  finding={finding}
                  clause={clause}
                  defaultOpen={finding.clauseId === focusedClauseId}
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
