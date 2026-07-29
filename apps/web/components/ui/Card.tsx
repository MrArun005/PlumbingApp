import Link from 'next/link';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** `sunk` for panels inside a card; `plain` drops the shadow. */
  tone?: 'raised' | 'plain' | 'sunk';
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}

const TONES = {
  raised: 'bg-surface border border-line shadow-card',
  plain: 'bg-surface border border-line',
  sunk: 'bg-surface-sunk border border-line',
} as const;

export function Card({ children, tone = 'raised', className, as = 'div' }: CardProps) {
  const Tag = as;
  return <Tag className={`rounded-card ${TONES[tone]} ${className ?? ''}`.trim()}>{children}</Tag>;
}

interface CardLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/** A whole card that is one tap target. */
export function CardLink({ href, children, className, ariaLabel }: CardLinkProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`block rounded-card border border-line bg-surface shadow-card transition-shadow duration-150 hover:shadow-lift focus-visible:shadow-lift ${className ?? ''}`.trim()}
    >
      {children}
    </Link>
  );
}
