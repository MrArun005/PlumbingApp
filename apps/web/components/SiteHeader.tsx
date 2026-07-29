'use client';

/**
 * One slim bar: identity on the left, hamburger on the right.
 *
 * The previous version stacked a logo bar AND a second mobile nav row, which on
 * a 360px phone spent roughly a sixth of the screen on chrome before any content
 * appeared. Primary navigation now lives in the bottom tab bar; everything that
 * is visited once rather than daily sits behind the hamburger.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { business } from '../lib/business-config';
import { MenuDrawer } from './MenuDrawer';

/** Desktop only — there is room for these once the viewport is wide. */
const NAV = [
  { href: '/services', label: 'Services' },
  { href: '/bookings', label: 'My bookings' },
  { href: '/how-it-works', label: 'How it works' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const ownerConsole = pathname === '/dad' || pathname.startsWith('/dad/');

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5">
        <Link
          href={ownerConsole ? '/dad' : '/'}
          className="mr-auto flex min-w-0 items-center gap-2 text-base font-bold tracking-[-0.02em] text-ink no-underline sm:text-lg"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-control bg-primary text-primary-ink"
          >
            ⌇
          </span>
          <span className="truncate">{business.name}</span>
        </Link>

        {ownerConsole ? null : (
          <>
            <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-tap items-center rounded-control px-3 text-sm font-semibold no-underline ${
                      active
                        ? 'bg-primary-soft text-primary-soft-ink'
                        : 'text-ink-muted hover:bg-surface-2'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <MenuDrawer />
          </>
        )}
      </div>
    </header>
  );
}
