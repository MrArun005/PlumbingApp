'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { clearSession, onSessionChange, readSession } from '../lib/session';
import { business } from '../lib/business-config';

const NAV = [
  { href: '/services', label: 'Services' },
  { href: '/bookings', label: 'My bookings' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);

  /**
   * The owner's console is a different surface with a different session. Showing
   * customer navigation and a customer "Sign in" button there is just confusing
   * chrome on a screen he uses one-handed on a doorstep.
   */
  const ownerConsole = pathname === '/dad' || pathname.startsWith('/dad/');

  useEffect(() => {
    const sync = (): void => setName(readSession()?.user.name ?? null);
    sync();
    return onSessionChange(sync);
  }, []);

  return (
    <>
      {/* Only this slim bar is sticky. On a 360px phone the mobile nav row below
          is another 44px of chrome, and pinning both eats a sixth of the screen. */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5">
          <Link
            href="/"
            className="mr-auto flex items-center gap-2 text-lg font-bold tracking-[-0.02em] text-ink no-underline"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-control bg-primary text-primary-ink"
            >
              ⌇
            </span>
            {business.name}
          </Link>

          <nav
            aria-label="Main"
            className={`${ownerConsole ? 'hidden' : 'hidden sm:flex'} items-center gap-1`}
          >
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

          <ThemeToggle />

          {ownerConsole ? null : name === null ? (
            <Link
              href="/login"
              className="inline-flex min-h-tap items-center rounded-control border border-line-strong px-3 text-sm font-semibold text-ink no-underline hover:bg-surface-2"
            >
              Sign in
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => clearSession()}
              className="inline-flex min-h-tap items-center rounded-control border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2"
              title={`Signed in as ${name}`}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* Mobile nav: the two destinations that matter, scrolls away with the page. */}
      <nav
        aria-label="Main (mobile)"
        className={`border-b border-line bg-surface px-3 pb-2 pt-1.5 ${ownerConsole ? 'hidden' : 'sm:hidden'}`}
      >
        <div className="flex items-stretch gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-tap flex-1 items-center justify-center rounded-control px-3 text-center text-sm font-semibold no-underline ${
                  active ? 'bg-primary-soft text-primary-soft-ink' : 'text-ink-muted'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
