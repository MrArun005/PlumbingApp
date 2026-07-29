import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'primary' | 'accent' | 'verify' | 'sos' | 'progress';

const TONES: Record<PillTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-soft-ink',
  primary: 'bg-primary-soft text-primary-soft-ink',
  // Copper: prices and trade moments only.
  accent: 'bg-accent-soft text-accent-soft-ink',
  verify: 'bg-verify-soft text-verify-soft-ink',
  // Signal red: the emergency path only.
  sos: 'bg-sos-soft text-sos-soft-ink',
  progress: 'bg-primary-soft text-primary-soft-ink',
};

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  /** A leading dot reads as a live status indicator. */
  dot?: boolean;
  className?: string;
}

export function Pill({ children, tone = 'neutral', dot = false, className }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold tracking-[0.01em] ${TONES[tone]} ${className ?? ''}`.trim()}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-pill bg-current" /> : null}
      {children}
    </span>
  );
}
