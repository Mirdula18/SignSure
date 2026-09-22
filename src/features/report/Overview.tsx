import { localiseMissingInfo } from '@shared/rules';
import type { AnalysisResult, Clause } from '@shared/types';
import { usePreferences } from '@/state/preferences';
import { FindingCard } from './FindingCard';
import { RuleCard } from './RuleCard';
import type { TranslationKey } from '@/i18n';

/**
 * The first thing a reader sees.
 *
 * Ordered by what a person actually needs: what this document is, then what is worth a close
 * look, then the India-specific legal context, then what the document never says, and finally -
 * separately, and last - anything SignSure could not verify.
 *
 * Unverified findings are not hidden. Hiding them would be the comfortable choice; showing them
 * under their own heading, excluded from the red-flag count, is the honest one.
 */

const SUMMARY_FIELDS = [
  ['documentType', 'overview.documentType'],
  ['employer', 'overview.employer'],
  ['role', 'overview.role'],
  ['startDate', 'overview.startDate'],
  ['noticePeriod', 'overview.noticePeriod'],
  ['probation', 'overview.probation'],
  ['bondOrPenalty', 'overview.bondOrPenalty'],
] as const satisfies readonly (readonly [
  keyof AnalysisResult['documentSummary'],
  TranslationKey,
])[];

export interface OverviewProps {
  analysis: AnalysisResult;
  clauseById: (id: string) => Clause | undefined;
}

export function Overview({ analysis, clauseById }: OverviewProps) {
  const { language, t } = usePreferences();

  const verifiedFindings = analysis.findings.filter(
    (finding) => finding.evidence.status !== 'unverified',
  );
  const unverifiedFindings = analysis.findings.filter(
    (finding) => finding.evidence.status === 'unverified',
  );
  const redFlags = verifiedFindings.filter(
    (finding) => finding.risk === 'HIGH' || finding.risk === 'MEDIUM',
  );

  const total = analysis.findings.length;
  const sources = analysis.documentSummary.sourceClauseIds
    .map((id) => clauseById(id))
    .filter((clause): clause is Clause => clause !== undefined)
    .map((clause) =>
      clause.label === null
        ? t('clauses.paragraph', { order: clause.order + 1 })
        : t('clauses.clauseLabel', { label: clause.label }),
    );

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="overview-summary">
        <h2 id="overview-summary" className="text-lg font-semibold text-ink">
          {t('overview.summaryHeading')}
        </h2>
        <p className="prose-measure mt-1 text-sm text-muted">{analysis.documentSummary.overview}</p>

        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {SUMMARY_FIELDS.map(([field, key]) => {
            const value = analysis.documentSummary[field];
            return (
              <div key={field} className="border-b border-line pb-2">
                <dt className="text-xs tracking-wide text-muted uppercase">{t(key)}</dt>
                <dd className={value === null ? 'text-sm text-muted italic' : 'text-sm text-ink'}>
                  {value ?? t('overview.notStated')}
                </dd>
              </div>
            );
          })}
        </dl>

        {/* The summary is the model's reading, not a checked quote, so it says where it came from. */}
        <p className="mt-3 text-xs text-muted">
          {sources.length > 0
            ? t('overview.summarySources', { clauses: sources.join(', ') })
            : t('overview.summaryNoSources')}
        </p>

        {analysis.partial ? (
          // Not an alert: it describes the report, it is not an event the reader must act on now.
          <p className="mt-4 rounded-lg border border-medium bg-medium-soft p-3 text-sm text-ink">
            <span aria-hidden="true">◆ </span>
            {t('report.partial')}
          </p>
        ) : null}

        <p className="mt-4 text-xs text-muted">
          {t('report.verifiedCount', { verified: analysis.stats.verified, total })}
          {analysis.stats.unverified > 0
            ? ` ${t('report.unverifiedNote', { count: analysis.stats.unverified })}`
            : null}
        </p>
      </section>

      <section aria-labelledby="overview-flags">
        <h2 id="overview-flags" className="text-lg font-semibold text-ink">
          {t('overview.redFlagsHeading')}
        </h2>
        {redFlags.length === 0 ? (
          <p className="prose-measure mt-2 text-sm text-muted">{t('overview.noRedFlags')}</p>
        ) : (
          <ol className="mt-3 flex list-none flex-col gap-4 p-0">
            {redFlags.map((finding) => {
              const clause = clauseById(finding.clauseId);
              if (!clause) return null;
              return (
                <li key={`${finding.clauseId}-${finding.title}`}>
                  <FindingCard finding={finding} clause={clause} />
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {analysis.ruleHits.length === 0 ? null : (
        <section aria-labelledby="overview-rules">
          <h2 id="overview-rules" className="text-lg font-semibold text-ink">
            {t('overview.rulesHeading')}
          </h2>
          <ol className="mt-3 flex list-none flex-col gap-4 p-0">
            {analysis.ruleHits.map((hit) => (
              <li key={`${hit.ruleId}-${hit.clauseId}`}>
                <RuleCard hit={hit} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {analysis.missingInfo.length === 0 ? null : (
        <section aria-labelledby="overview-missing">
          <h2 id="overview-missing" className="text-lg font-semibold text-ink">
            {t('overview.missingHeading')}
          </h2>
          <p className="prose-measure mt-1 text-sm text-muted">{t('overview.missingIntro')}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {analysis.missingInfo
              .map((item) => localiseMissingInfo(item, language))
              .map((item) => (
                <li
                  key={item.ruleId}
                  className="rounded-lg border border-line bg-raised p-3 text-sm"
                >
                  <span className="font-medium text-ink">{item.label}</span>
                  <span className="mt-1 block text-muted">{item.question}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {unverifiedFindings.length === 0 ? null : (
        <section aria-labelledby="overview-unverified">
          <h2 id="overview-unverified" className="text-lg font-semibold text-ink">
            {t('overview.unverifiedHeading')}
          </h2>
          <p className="prose-measure mt-1 text-sm text-muted">{t('overview.unverifiedIntro')}</p>
          {/*
            Set apart with a dashed rule rather than reduced opacity. Opacity is the obvious way
            to say "trust this less", and it quietly drags every colour inside toward the
            background until the text no longer meets contrast - which is the one group of
            readers who most need this caveat to be legible.
          */}
          <ol className="mt-3 flex list-none flex-col gap-4 rounded-xl border border-dashed border-line-strong p-3">
            {unverifiedFindings.map((finding) => {
              const clause = clauseById(finding.clauseId);
              if (!clause) return null;
              return (
                <li key={`${finding.clauseId}-${finding.title}`}>
                  <FindingCard finding={finding} clause={clause} />
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
