import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's button.
 *
 * `tap-target` is applied to every variant: WCAG 2.2 requires 24x24 CSS pixels, and this aims
 * at the 44x44 that actually works on a phone, which is where most of this audience will read
 * their offer letter.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-primary-ink hover:opacity-90 border-transparent',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-raised',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-raised',
  danger: 'bg-surface text-high border-high hover:bg-high-soft',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'tap-target inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2',
        'text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
