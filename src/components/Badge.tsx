import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { RiskLevel, VerificationStatus } from '@shared/types';
import { useT } from '@/state/preferences';
import type { TranslationKey } from '@/i18n';

/**
 * Status chips for risk and verification.
 *
 * Every chip carries an icon *and* a word, never colour alone (WCAG 1.4.1). The icon is
 * `aria-hidden` because the word beside it already says the same thing, and announcing "warning
 * sign High risk" would just be noise.
 */

interface ChipProps {
  icon: string;
  label: string;
  className: string;
  title?: string;
}

function Chip({ icon, label, className, title }: ChipProps): ReactNode {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
      {...(title === undefined ? {} : { title })}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

const RISK_STYLE: Readonly<
  Record<RiskLevel, { icon: string; className: string; key: TranslationKey }>
> = {
  HIGH: {
    icon: '▲',
    className: 'border-high bg-high-soft text-high',
    key: 'risk.high',
  },
  MEDIUM: {
    icon: '◆',
    className: 'border-medium bg-medium-soft text-medium',
    key: 'risk.medium',
  },
  LOW: {
    icon: '●',
    className: 'border-low bg-low-soft text-low',
    key: 'risk.low',
  },
  INFO: {
    icon: 'ⓘ',
    className: 'border-info bg-info-soft text-info',
    key: 'risk.info',
  },
};

export function RiskBadge({ risk }: { risk: RiskLevel }): ReactNode {
  const t = useT();
  const style = RISK_STYLE[risk];
  return <Chip icon={style.icon} label={t(style.key)} className={style.className} />;
}

const VERIFICATION_STYLE: Readonly<
  Record<
    VerificationStatus,
    { icon: string; className: string; key: TranslationKey; hintKey: TranslationKey }
  >
> = {
  verified: {
    icon: '✓',
    className: 'border-low bg-low-soft text-low',
    key: 'verify.verified',
    hintKey: 'verify.verifiedHint',
  },
  fuzzy: {
    icon: '≈',
    className: 'border-medium bg-medium-soft text-medium',
    key: 'verify.fuzzy',
    hintKey: 'verify.fuzzyHint',
  },
  unverified: {
    icon: '✕',
    className: 'border-line-strong bg-sunken text-muted',
    key: 'verify.unverified',
    hintKey: 'verify.unverifiedHint',
  },
};

export function VerificationBadge({ status }: { status: VerificationStatus }): ReactNode {
  const t = useT();
  const style = VERIFICATION_STYLE[status];
  return (
    <Chip
      icon={style.icon}
      label={t(style.key)}
      className={style.className}
      title={t(style.hintKey)}
    />
  );
}

export function CategoryBadge({ label }: { label: string }): ReactNode {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-muted">
      {label}
    </span>
  );
}
