'use client';

/**
 * The hamburger. It holds the OVERFLOW — the pages people visit once (how it
 * works, about, warranty) plus account and theme controls.
 *
 * The primary destinations deliberately do NOT live in here: they are in the
 * bottom tab bar, where a thumb can reach them without opening anything. Hiding
 * a four-item nav behind a tap costs a tap and teaches nothing.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { business, telHref } from '../lib/business-config';
import { clearSession, onSessionChange, readSession } from '../lib/session';
import { ThemeToggle } from './ThemeToggle';

const OVERFLOW_LINKS = [
  { href: '/how-it-works', label: 'How it works', hint: 'Prices, quotes and what you approve' },
  { href: '/about', label: `About ${business.ownerName}`, hint: 'Who turns up, and the warranty' },
  { href: '/services', label: 'All services and prices', hint: 'The full list' },
];

export function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const sync = (): void => setName(readSession()?.user.name ?? null);
    sync();
    return onSessionChange(sync);
  }, []);

  // Close on route change — otherwise tapping a link leaves the drawer open
  // over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, and focus goes back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling while the sheet is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-11 items-center justify-center rounded-control border border-line-strong bg-surface text-ink hover:bg-surface-2"
      >
        {open ? <CloseIcon /> : <BurgerIcon />}
      </button>

      {open ? (
        <div className="fixed inset-0 z-40">
          {/* Tapping the dimmed area closes — expected behaviour on a phone. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/40 backdrop-blur-sm"
          />

          <div
            ref={panelRef}
            id="site-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-[19rem] max-w-[85vw] flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4 shadow-lift"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">{business.name}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-9 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Calling is the most likely reason anyone opens this. */}
            <a
              href={telHref()}
              className="inline-flex min-h-tap items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-ink no-underline"
            >
              Call {business.ownerName} · {business.phoneDisplay}
            </a>

            <nav aria-label="More pages" className="flex flex-col gap-1">
              {OVERFLOW_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col rounded-control px-3 py-2.5 no-underline hover:bg-surface-2"
                >
                  <span className="text-sm font-semibold text-ink">{link.label}</span>
                  <span className="text-xs text-ink-faint">{link.hint}</span>
                </Link>
              ))}
            </nav>

            <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Appearance</span>
                <ThemeToggle />
              </div>

              {name === null ? (
                <Link
                  href="/login"
                  className="inline-flex min-h-tap items-center justify-center rounded-control border border-line-strong px-4 text-sm font-semibold text-ink no-underline hover:bg-surface-2"
                >
                  Sign in
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    clearSession();
                    setOpen(false);
                  }}
                  className="inline-flex min-h-tap items-center justify-center rounded-control border border-line-strong px-4 text-sm font-semibold text-ink hover:bg-surface-2"
                >
                  Sign out ({name})
                </button>
              )}

              <Link
                href="/dad"
                className="px-1 text-xs text-ink-faint no-underline hover:text-primary"
              >
                Owner sign-in
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BurgerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
