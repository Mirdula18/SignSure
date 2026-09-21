import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';
import { RISK_LEVELS, type RiskLevel, type VerificationStatus } from '@shared/types';
import { CategoryBadge, RiskBadge, VerificationBadge } from './Badge';
import { PreferencesProvider } from '@/state/preferences';

function renderWith(ui: ReactElement) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}

const RISK_WORDS: Readonly<Record<RiskLevel, string>> = {
  HIGH: 'High risk',
  MEDIUM: 'Worth checking',
  LOW: 'Standard',
  INFO: 'Background',
};

const VERIFICATION: readonly (readonly [VerificationStatus, string, string])[] = [
  ['verified', 'Verified quote', 'This exact text was found in your document.'],
  ['fuzzy', 'Close match', 'Nearly identical text was found in your document.'],
  ['unverified', 'Could not verify', 'We could not find this text in your document.'],
];

/** The icon is the chip's first child; the word is the chip's own text. */
function iconOf(chip: HTMLElement): Element {
  const icon = chip.firstElementChild;
  if (icon === null) throw new Error('The chip has no icon');
  return icon;
}

describe('RiskBadge', () => {
  it.each(RISK_LEVELS)('shows %s as a word and an icon, never colour alone', (risk) => {
    renderWith(<RiskBadge risk={risk} />);
    const chip = screen.getByText(RISK_WORDS[risk]);
    const icon = iconOf(chip);
    expect(icon.textContent).not.toBe('');
    // The word already says it, so the icon is hidden rather than read out as noise.
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives every risk level its own icon, so the chips differ even in greyscale', () => {
    renderWith(
      <>
        {RISK_LEVELS.map((risk) => (
          <RiskBadge key={risk} risk={risk} />
        ))}
      </>,
    );
    const icons = RISK_LEVELS.map((risk) => iconOf(screen.getByText(RISK_WORDS[risk])).textContent);
    expect(new Set(icons).size).toBe(RISK_LEVELS.length);
  });

  it('speaks the chosen language, because the word is what carries the meaning', () => {
    sessionStorage.setItem('signsure.prefs', JSON.stringify({ language: 'hi' }));
    try {
      renderWith(<RiskBadge risk="HIGH" />);
      expect(screen.getByText('ज़्यादा जोखिम')).toBeInTheDocument();
      expect(screen.queryByText('High risk')).not.toBeInTheDocument();
    } finally {
      sessionStorage.clear();
    }
  });
});

describe('VerificationBadge', () => {
  it.each(VERIFICATION)(
    'shows %s as a word and a hidden icon, with a hint saying what it means',
    (status, word, hint) => {
      renderWith(<VerificationBadge status={status} />);
      const chip = screen.getByText(word);
      const icon = iconOf(chip);
      expect(icon.textContent).not.toBe('');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(chip).toHaveAttribute('title', hint);
    },
  );

  it('gives every status its own icon', () => {
    renderWith(
      <>
        {VERIFICATION.map(([status]) => (
          <VerificationBadge key={status} status={status} />
        ))}
      </>,
    );
    const icons = VERIFICATION.map(([, word]) => iconOf(screen.getByText(word)).textContent);
    expect(new Set(icons).size).toBe(VERIFICATION.length);
  });
});

describe('CategoryBadge', () => {
  it('renders the label it is given', () => {
    renderWith(<CategoryBadge label="Notice period" />);
    expect(screen.getByText('Notice period')).toBeInTheDocument();
  });

  it('renders a label containing markup as plain text', () => {
    const { container } = renderWith(<CategoryBadge label="<b>Bond</b>" />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>Bond</b>')).toBeInTheDocument();
  });
});

describe('Badges', () => {
  it('have no axe violations', async () => {
    const { container } = renderWith(
      <p>
        {RISK_LEVELS.map((risk) => (
          <RiskBadge key={risk} risk={risk} />
        ))}
        {VERIFICATION.map(([status]) => (
          <VerificationBadge key={status} status={status} />
        ))}
        <CategoryBadge label="Notice period" />
      </p>,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
