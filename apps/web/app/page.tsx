import Link from 'next/link';
import { loadCategories, loadServices } from '../lib/api';
import { ButtonLink } from '../components/ui/Button';
import { Card, CardLink } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { SampleDataNotice } from '../components/ui/Notice';
import { EmptyState } from '../components/ui/EmptyState';
import { PriceBlock } from '../components/ui/PriceBlock';
import { CallButton, StickyCallBar } from '../components/CallButton';
import { business } from '../lib/business-config';

/**
 * Trust copy for a single, named plumber. The marketplace version of this page
 * talked about "police-verified plumbers" (plural) and a 30-minute SLA with an
 * automatic refund. Both are supported by the backend and both are switched off
 * in `business-config.ts` — with one person doing the work, promising a hard
 * arrival window would mean breaking it. See that file to turn them back on.
 */
const TRUST = [
  {
    title: 'You deal with one person',
    body: `${business.ownerName} does the work himself, so nothing gets lost between an office and a technician. You know who is coming.`,
  },
  {
    title: '30-day warranty on labour',
    body: 'If the same fault comes back within 30 days, he returns and redoes the work at no labour charge.',
  },
  {
    title: 'You approve every price',
    body: 'Fixed prices are shown up front. Anything else comes as an itemised quote you approve before any work starts.',
  },
];

export default async function HomePage() {
  const [categories, services] = await Promise.all([loadCategories(), loadServices()]);
  const usingSample = categories.source === 'sample' || services.source === 'sample';
  const popular = services.data.slice(0, 4);

  return (
    <div className="flex flex-col gap-10">
      {usingSample ? <SampleDataNotice reason={categories.reason ?? services.reason} /> : null}

      {/* ── Hero: calling is the primary action, not a fallback ─────────── */}
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className="flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="verify">{business.serviceArea}</Pill>
            <Pill tone="neutral">30-day labour warranty</Pill>
          </div>

          <div>
            <h1 className="text-3xl font-bold leading-tight text-ink sm:text-4xl">
              Plumbing work done properly, by someone you can ring.
            </h1>
            <p className="mt-3 max-w-prose text-base text-ink-muted">
              Leaks, blockages, taps, geysers, tanks and new fittings across {business.serviceArea}.
              Tell {business.ownerName} what is wrong on the phone, or book online and he will
              confirm a time with you.
            </p>
          </div>

          {/* Call first. Many customers will never use the form, and that is fine. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <CallButton size="lg" />
            <ButtonLink href="/services" variant="secondary" size="lg">
              Book online instead
            </ButtonLink>
          </div>

          <p className="text-xs text-ink-faint">
            Something flooding right now? Call — do not wait for a form. If you can reach the main
            stopcock safely, turn it off first.
          </p>
        </div>
      </section>

      {/* ── Categories ─────────────────────────────────────────────────── */}
      <section aria-labelledby="categories-heading" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="categories-heading" className="text-2xl font-bold text-ink">
              What needs fixing?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Pick a category, or see the full list of services and prices.
            </p>
          </div>
          <Link
            href="/services"
            className="shrink-0 text-sm font-semibold text-primary no-underline hover:underline"
          >
            See all
          </Link>
        </div>

        {categories.data.length === 0 ? (
          <EmptyState
            title="Service list unavailable"
            body={`The list is not loading right now. Call ${business.ownerName} on ${business.phoneDisplay} and he will sort it out directly.`}
            tone="problem"
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.data.map((category) => (
              <li key={category.code} className="h-full">
                <CardLink
                  href={`/services?category=${category.code}`}
                  className="flex h-full min-h-[5.5rem] flex-col justify-between gap-2 p-3.5 no-underline"
                >
                  <span className="text-sm font-semibold leading-snug text-ink">
                    {category.name}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {category.serviceCount} {category.serviceCount === 1 ? 'service' : 'services'}
                  </span>
                </CardLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Common jobs ───────────────────────────────────────────────── */}
      {popular.length > 0 ? (
        <section aria-labelledby="popular-heading" className="flex flex-col gap-4">
          <h2 id="popular-heading" className="text-2xl font-bold text-ink">
            Common jobs
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {popular.map((service) => (
              <li
                key={service.sku}
                className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card"
              >
                <h3 className="text-base font-semibold text-ink">
                  <Link
                    href={`/services/${service.sku}`}
                    className="text-ink no-underline hover:text-primary"
                  >
                    {service.name}
                  </Link>
                </h3>
                <PriceBlock price={service.price} variant="card" />
                <Link
                  href={`/book/${service.sku}`}
                  className="mt-auto inline-flex min-h-tap items-center justify-center rounded-control border border-line-strong px-4 text-sm font-semibold text-ink no-underline hover:bg-surface-2"
                >
                  {service.inspectFirst ? 'Book an inspection' : 'Book this'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Trust signals ─────────────────────────────────────────────── */}
      <section aria-labelledby="trust-heading" className="flex flex-col gap-4">
        <h2 id="trust-heading" className="text-2xl font-bold text-ink">
          Why people call him back
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TRUST.map((item) => (
            <Card as="li" key={item.title} tone="plain" className="p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className="flex size-5 items-center justify-center rounded-pill bg-verify-soft text-2xs font-bold text-verify-soft-ink"
                >
                  ✓
                </span>
                {item.title}
              </p>
              <p className="mt-1.5 text-sm text-ink-muted">{item.body}</p>
            </Card>
          ))}
        </ul>
      </section>

      {/* ── How inspect-first works ───────────────────────────────────── */}
      <section className="rounded-card border border-line bg-surface-2 p-5">
        <h2 className="text-xl font-bold text-ink">Some jobs cannot be priced over the phone</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          A damp patch on a ceiling could be a loose joint or a cracked concealed line. Rather than
          guess at a number, {business.ownerName} comes and looks. You pay nothing to book, you get
          an itemised quote on site, and work starts only if you approve it. Decline and only the
          visit charge applies.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/services" variant="secondary">
            See which services work this way
          </ButtonLink>
          <CallButton size="md" variant="secondary" showNumber={false} />
        </div>
      </section>

      <StickyCallBar />
    </div>
  );
}
