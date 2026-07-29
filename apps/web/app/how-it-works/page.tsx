import type { Metadata } from 'next';
import { ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CallButton } from '../../components/CallButton';
import { business } from '../../lib/business-config';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Fixed prices where the job is predictable, an itemised quote you approve where it is not. Nothing starts until you agree the price.',
};

/**
 * The pricing explanation, moved off the home page. It is genuinely useful but
 * it is read once, not daily — so it belongs on its own page rather than adding
 * three screens of scroll to the front door.
 */
const STEPS = [
  {
    n: 1,
    title: 'Tell him what is wrong',
    body: `Call ${business.ownerName}, or pick the service online and answer a couple of questions about it. Photos help if you have them.`,
  },
  {
    n: 2,
    title: 'He confirms a time',
    body: 'Same day where he can, otherwise the next slot that suits you. You get the time agreed, not a four-hour window.',
  },
  {
    n: 3,
    title: 'You agree the price before work starts',
    body: 'Straightforward jobs have a fixed price you see up front. Anything that needs looking at first gets an itemised quote on site — labour and parts listed separately.',
  },
  {
    n: 4,
    title: 'Work happens, then you pay',
    body: 'UPI, card or cash. Labour is covered for 30 days: if the same fault returns, he comes back and redoes it at no labour charge.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold leading-tight text-ink">How it works</h1>
        <p className="max-w-prose text-base text-ink-muted">
          No surprise bills. You know the price, or you approve the quote, before anyone picks up a
          tool.
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step) => (
          <Card as="li" key={step.n} tone="plain" className="flex gap-3.5 p-4">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary text-sm font-bold text-primary-ink"
            >
              {step.n}
            </span>
            <div>
              <p className="text-base font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{step.body}</p>
            </div>
          </Card>
        ))}
      </ol>

      {/* The inspect-first model, explained properly since this is the page for it. */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-5">
        <h2 className="text-xl font-bold text-ink">
          Why some jobs cannot be priced over the phone
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          A damp patch on a ceiling could be a loose joint behind a panel, or a cracked pipe buried
          in a slab. One is twenty minutes, the other is most of a day. Quoting blind means either
          frightening you with the worst case or landing you with a bigger bill later.
        </p>
        <p className="max-w-prose text-sm text-ink-muted">
          So for those jobs {business.ownerName} comes and looks first. You pay nothing to book the
          visit. He sends you an itemised quote — labour and parts, line by line — and work starts
          only if you approve it. If you decline, you pay just the visit charge, which is shown on
          the service page before you book.
        </p>
        <div className="mt-1 flex flex-col gap-2.5 sm:flex-row">
          <ButtonLink href="/services" variant="secondary">
            See services and prices
          </ButtonLink>
          <CallButton size="md" variant="secondary" showNumber={false} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-ink">Payment</h2>
        <p className="max-w-prose text-sm text-ink-muted">
          UPI, card or cash on completion. Prices include GST where it is shown. You get a bill
          listing what was done and what each part cost.
        </p>
      </section>
    </div>
  );
}
