import type { PriceDisplay } from '../lib/types';

const STEPS = [
  {
    n: 1,
    title: 'Our expert inspects — you pay ₹0 to book',
    body: 'Nothing is charged when you book. A senior plumber comes out, looks at the actual problem and works out what it will take.',
  },
  {
    n: 2,
    title: 'You get an itemised quote in the app',
    body: 'Line by line: labour, parts, and any extra work. No lump sums, no "we will see at the end".',
  },
  {
    n: 3,
    title: 'Work starts only after you approve',
    body: 'Say yes and the plumber begins. Say no and the job ends there — only the visit charge applies.',
  },
];

/**
 * The 3-step explainer for services that have no up-front price. It never
 * mentions an amount for the job itself, because none exists yet — the only
 * figure shown is the visit charge the API sent.
 */
export function InspectFirstExplainer({ price }: { price: PriceDisplay }) {
  return (
    <section
      aria-labelledby="inspect-first-heading"
      className="rounded-card border border-line bg-surface-2 p-4"
    >
      <h2 id="inspect-first-heading" className="text-lg font-semibold text-ink">
        Why there is no price on this one
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">
        Nobody can price this honestly from a phone screen. Guessing high is how customers get
        overcharged, so we do it the other way round.
      </p>

      <ol className="mt-4 flex flex-col gap-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex gap-3 rounded-control bg-surface p-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary text-sm font-bold text-primary-ink"
            >
              {step.n}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink-muted">
        <span className="font-semibold text-ink">
          If you decline the quote, you pay the visit charge of {price.visitChargeLabel}
        </span>{' '}
        and nothing else. That covers the plumber&rsquo;s time and travel for coming out to look.
      </p>
    </section>
  );
}
