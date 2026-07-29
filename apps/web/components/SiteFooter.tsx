'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { business, telHref } from '../lib/business-config';

/**
 * Footer copy is driven by `business-config.ts`, so nothing here promises
 * something the business cannot deliver. The marketplace version claimed "every
 * plumber is police-verified" (plural) and warned about emergency surge pricing —
 * both are real platform features, both are currently switched off, so neither
 * is mentioned.
 */
export function SiteFooter() {
  const pathname = usePathname();

  // The owner's console needs no customer links and no marketing copy.
  if (pathname === '/dad' || pathname.startsWith('/dad/')) {
    return (
      <footer className="mt-10 border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-5 text-xs text-ink-faint">
          {business.name} · owner console
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-14 border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/services" className="font-semibold text-ink no-underline hover:text-primary">
            All services
          </Link>
          <Link href="/bookings" className="font-semibold text-ink no-underline hover:text-primary">
            My bookings
          </Link>
          <a href={telHref()} className="font-semibold text-ink no-underline hover:text-primary">
            Call {business.ownerName} · {business.phoneDisplay}
          </a>
        </div>

        <p className="max-w-prose">
          {business.name} covers {business.serviceArea}. You see the price — or an itemised quote —
          before any work starts, and you approve it. Labour is covered for 30 days.
        </p>

        <p className="text-xs text-ink-faint">
          Prices include GST where shown.
          {business.showSurgePricing
            ? ' Emergency bookings may carry a surge, capped at 2×, shown before you pay.'
            : ''}
        </p>
      </div>
    </footer>
  );
}
