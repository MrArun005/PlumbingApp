import type { ReactNode } from 'react';
import { ButtonLink } from './Button';

interface EmptyStateProps {
  title: string;
  body: ReactNode;
  action?: { href: string; label: string };
  /** `problem` for "something went wrong", `calm` for "nothing here yet". */
  tone?: 'calm' | 'problem';
}

export function EmptyState({ title, body, action, tone = 'calm' }: EmptyStateProps) {
  return (
    <div
      className={`rounded-card border px-5 py-8 text-center ${
        tone === 'problem' ? 'border-line bg-surface' : 'border-line bg-surface'
      }`}
    >
      <p
        aria-hidden="true"
        className={`mx-auto mb-3 flex size-11 items-center justify-center rounded-pill text-lg font-bold ${
          tone === 'problem'
            ? 'bg-accent-soft text-accent-soft-ink'
            : 'bg-primary-soft text-primary-soft-ink'
        }`}
      >
        {tone === 'problem' ? '!' : '·'}
      </p>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-prose text-sm text-ink-muted">{body}</div>
      {action !== undefined ? (
        <div className="mt-5 flex justify-center">
          <ButtonLink href={action.href} variant="secondary">
            {action.label}
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
