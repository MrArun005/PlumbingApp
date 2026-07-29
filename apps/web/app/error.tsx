'use client';

import { EmptyState } from '../components/ui/EmptyState';

/**
 * Last line of defence. A customer never sees a stack trace — they see a
 * sentence and a way out. The real error is still reported to the browser
 * console by React in development.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        title="Something went wrong on this page"
        body="Nothing you did caused this, and no booking was submitted. Try again — if it keeps happening, the PipeFix service may be down."
        tone="problem"
      />
      <div className="flex justify-center">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-tap items-center rounded-control bg-primary px-5 font-semibold text-primary-ink hover:bg-primary-hover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
