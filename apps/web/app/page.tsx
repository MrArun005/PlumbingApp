import Link from 'next/link';
import { loadCategories } from '../lib/api';
import { ButtonLink } from '../components/ui/Button';
import { CardLink } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { SampleDataNotice } from '../components/ui/Notice';
import { EmptyState } from '../components/ui/EmptyState';
import { CallButton } from '../components/CallButton';
import { business } from '../lib/business-config';

/**
 * Deliberately SHORT. The previous version was ~7,500px tall on a phone — hero,
 * categories, four service cards, three trust panels and an explainer, all on
 * one endless scroll. Nobody reads to the bottom of that.
 *
 * Home now answers one question — "can you fix my thing, and how do I reach
 * you?" — and gets out of the way. The reference content moved to its own pages
 * (/how-it-works, /about), reachable from the hamburger and from the links below.
 */
export default async function HomePage() {
  const categories = await loadCategories();

  return (
    <div className="flex flex-col gap-8">
      {categories.source === 'sample' ? <SampleDataNotice reason={categories.reason} /> : null}

      {/* ── Hero: who, where, and two ways to reach him ─────────────────── */}
      <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="verify">{business.serviceArea}</Pill>
          <Pill tone="neutral">30-day labour warranty</Pill>
        </div>

        <div>
          <h1 className="text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Plumbing work done properly, by someone you can ring.
          </h1>
          <p className="mt-2.5 max-w-prose text-base text-ink-muted">
            Leaks, blockages, taps, geysers, tanks and new fittings. Tell {business.ownerName} what
            is wrong, or book online and he will confirm a time.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <CallButton size="lg" />
          <ButtonLink href="/services" variant="secondary" size="lg">
            Book online
          </ButtonLink>
        </div>

        <p className="text-xs text-ink-faint">
          Something flooding right now? Call — do not wait for a form. If you can reach the main
          stopcock safely, turn it off first.
        </p>
      </section>

      {/* ── Categories: the actual job of this page ─────────────────────── */}
      <section aria-labelledby="categories-heading" className="flex flex-col gap-3.5">
        <div className="flex items-end justify-between gap-3">
          <h2 id="categories-heading" className="text-2xl font-bold text-ink">
            What needs fixing?
          </h2>
          <Link
            href="/services"
            className="shrink-0 text-sm font-semibold text-primary no-underline hover:underline"
          >
            All services
          </Link>
        </div>

        {categories.data.length === 0 ? (
          <EmptyState
            title="Service list unavailable"
            body={`The list is not loading right now. Call ${business.ownerName} on ${business.phoneDisplay} and he will sort it out directly.`}
            tone="problem"
          />
        ) : (
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {categories.data.map((category) => (
              <li key={category.code} className="h-full">
                <CardLink
                  href={`/services?category=${category.code}`}
                  className="flex h-full min-h-[5rem] flex-col justify-between gap-2 p-3.5 no-underline"
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

      {/* ── Two links out, instead of two more screens of copy ──────────── */}
      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <CardLink href="/how-it-works" className="flex flex-col gap-1 p-4 no-underline">
          <span className="text-sm font-semibold text-ink">How pricing works</span>
          <span className="text-xs text-ink-muted">
            Fixed prices, and what happens when a job can only be quoted after a look.
          </span>
        </CardLink>
        <CardLink href="/about" className="flex flex-col gap-1 p-4 no-underline">
          <span className="text-sm font-semibold text-ink">About {business.ownerName}</span>
          <span className="text-xs text-ink-muted">
            Who turns up, the warranty, and the areas covered.
          </span>
        </CardLink>
      </section>
    </div>
  );
}
