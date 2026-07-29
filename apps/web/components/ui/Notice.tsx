import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'sample' | 'dev' | 'problem';

const TONES: Record<NoticeTone, string> = {
  info: 'border-line bg-surface-2 text-ink-muted',
  sample: 'border-accent bg-accent-soft text-accent-soft-ink',
  dev: 'border-line-strong bg-surface-sunk text-ink-muted',
  problem: 'border-line-strong bg-surface-2 text-ink',
};

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  return (
    <div
      className={`rounded-control border px-3 py-2.5 text-sm ${TONES[tone]} ${className ?? ''}`.trim()}
    >
      {title !== undefined ? <p className="font-semibold">{title}</p> : null}
      <div className={title === undefined ? '' : 'mt-0.5'}>{children}</div>
    </div>
  );
}

/**
 * Shown whenever a page is rendering the bundled sample catalogue instead of
 * live data. Honesty rule: a reviewer must never mistake sample data for real.
 */
export function SampleDataNotice({ reason }: { reason?: string }) {
  return (
    <Notice tone="sample">
      <span className="font-semibold">Showing sample data</span> — we could not load the live
      PipeFix catalogue{reason === undefined ? '' : ` (${reason})`}. What you see below is a small
      bundled copy, so the interface can still be reviewed. None of it is live.
    </Notice>
  );
}
