import type { Metadata } from 'next';
import { Card } from '../../components/ui/Card';
import { CallButton } from '../../components/CallButton';
import { ButtonLink } from '../../components/ui/Button';
import { business } from '../../lib/business-config';

export const metadata: Metadata = {
  title: `About ${business.ownerName}`,
  description: `${business.name} covers ${business.serviceArea}. One plumber, 30-day labour warranty, price agreed before work starts.`,
};

/**
 * The trust content, moved off the home page.
 *
 * Note what is NOT claimed here: no "police-verified" badge, no skill-tier
 * certification, no insurance cover. Those are marketplace features the platform
 * supports, and stating them without the paperwork actually being in place would
 * be a lie a customer might rely on. Add each line only once it is true — the
 * flags in lib/business-config.ts control the marketplace-wide versions.
 */
const POINTS = [
  {
    title: 'You deal with one person',
    body: `${business.ownerName} does the work himself. Nothing gets lost between an office and a technician, and you know who is coming to your door.`,
  },
  {
    title: '30 days on labour',
    body: 'If the same fault comes back within 30 days of the visit, he returns and redoes the work at no labour charge. Parts are covered by whatever warranty the manufacturer gives.',
  },
  {
    title: 'The price is agreed, not discovered',
    body: 'Fixed prices are shown before you book. Anything that needs looking at first gets an itemised quote you approve — so the number on the bill is the number you said yes to.',
  },
  {
    title: 'Materials billed at cost, with the receipt',
    body: 'If parts are needed he shows you the bill for them. No hidden markup buried in a lump-sum figure.',
  },
];

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold leading-tight text-ink">About {business.ownerName}</h1>
        <p className="max-w-prose text-base text-ink-muted">
          {business.name} is a working plumber covering {business.serviceArea}. Domestic jobs mostly
          — leaks, blockages, bathroom and kitchen fittings, geysers, tanks and pumps, and new
          pipework.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {POINTS.map((point) => (
          <Card as="li" key={point.title} tone="plain" className="p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-verify-soft text-2xs font-bold text-verify-soft-ink"
              >
                ✓
              </span>
              {point.title}
            </p>
            <p className="mt-1.5 text-sm text-ink-muted">{point.body}</p>
          </Card>
        ))}
      </ul>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-xl font-bold text-ink">Getting hold of him</h2>
        <p className="text-sm text-ink-muted">
          Calling is quickest, especially for anything urgent. Booking online works too — he
          confirms the time with you.
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <CallButton size="md" />
          <ButtonLink href="/services" variant="secondary">
            Book online
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
