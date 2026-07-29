'use client';

/**
 * Bottom tab bar — the primary navigation on a phone.
 *
 * Why this rather than putting these four in the hamburger: they are the things
 * people do repeatedly, and down here they are inside the thumb's natural arc
 * and always visible. A hamburger would add a tap and hide the fact that
 * booking and calling exist at all.
 *
 * Hidden on the owner console, which has its own two tabs, and on desktop where
 * the header nav has room.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { business, telHref } from '../lib/business-config';

interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
  /** `tel:` links leave the app, so they are plain anchors. */
  external?: boolean;
  match?: (pathname: string) => boolean;
}

export function BottomTabs() {
  const pathname = usePathname();
  if (pathname === '/dad' || pathname.startsWith('/dad/')) return null;

  const tabs: Tab[] = [
    { href: '/', label: 'Home', icon: <HomeIcon />, match: (p) => p === '/' },
    {
      href: '/services',
      label: 'Services',
      icon: <ListIcon />,
      match: (p) => p.startsWith('/services') || p.startsWith('/book'),
    },
    {
      href: '/bookings',
      label: 'Bookings',
      icon: <CalendarIcon />,
      match: (p) => p.startsWith('/bookings'),
    },
    { href: telHref(), label: `Call ${business.ownerName}`, icon: <PhoneIcon />, external: true },
  ];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/97 backdrop-blur sm:hidden"
    >
      <ul className="mx-auto flex max-w-5xl">
        {tabs.map((tab) => {
          const active = tab.match?.(pathname) ?? false;
          const inner = (
            <>
              <span className={active ? 'text-primary' : 'text-ink-muted'} aria-hidden="true">
                {tab.icon}
              </span>
              <span
                className={`text-2xs font-semibold ${active ? 'text-primary' : 'text-ink-muted'}`}
              >
                {tab.label}
              </span>
            </>
          );

          const shell =
            'flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 px-1 pb-1 pt-1.5 no-underline';

          return (
            <li key={tab.href} className="flex-1">
              {tab.external === true ? (
                <a href={tab.href} className={shell}>
                  {inner}
                </a>
              ) : (
                <Link href={tab.href} aria-current={active ? 'page' : undefined} className={shell}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const ICON = 'size-6';
const STROKE = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...STROKE}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...STROKE}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...STROKE}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...STROKE}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
