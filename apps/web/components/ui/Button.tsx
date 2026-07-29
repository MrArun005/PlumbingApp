import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'sos';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 ' +
  'text-center no-underline';

/**
 * `sos` uses the signal-red token and is reserved for the emergency path.
 * If you are reaching for it anywhere other than an SOS call-to-action, you
 * want `primary`.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  quiet: 'bg-transparent text-primary hover:bg-primary-soft',
  sos: 'bg-sos text-sos-ink hover:bg-sos-hover shadow-card',
};

// Every size clears the 44px minimum tap target on a phone.
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-tap px-3.5 text-sm',
  md: 'min-h-tap px-5 text-base',
  lg: 'min-h-[3.25rem] px-6 text-lg',
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

function classes({ variant = 'primary', size = 'md', fullWidth, className }: CommonProps): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth === true ? 'w-full' : '', className ?? '']
    .filter((c) => c.length > 0)
    .join(' ');
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

export function Button({
  variant,
  size,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes({ variant, size, fullWidth, className, children })}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ButtonLinkProps extends CommonProps {
  href: string;
}

export function ButtonLink({
  href,
  variant,
  size,
  fullWidth,
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link href={href} className={classes({ variant, size, fullWidth, className, children })}>
      {children}
    </Link>
  );
}
