import { business, telHref } from '../lib/business-config';

/**
 * Tap-to-call. Expect this to be the most-used control on the whole site:
 * plenty of customers will not fill in a booking form at all, they will just
 * ring the plumber — and that is a perfectly good outcome, not a funnel leak.
 *
 * A plain `<a href="tel:">` rather than a Next `Link`, because it hands off to
 * the phone dialler instead of doing client-side navigation.
 */
export function CallButton({
  size = 'lg',
  variant = 'primary',
  showNumber = true,
  fullWidth = false,
}: {
  size?: 'md' | 'lg';
  variant?: 'primary' | 'secondary';
  showNumber?: boolean;
  fullWidth?: boolean;
}) {
  const sizing = size === 'lg' ? 'min-h-[3.25rem] px-6 text-lg' : 'min-h-tap px-5 text-base';
  const tone =
    variant === 'primary'
      ? 'bg-primary text-primary-ink hover:bg-primary-hover'
      : 'bg-surface text-ink border border-line-strong hover:bg-surface-2';

  return (
    <a
      href={telHref()}
      className={[
        'inline-flex items-center justify-center gap-2.5 rounded-control font-semibold no-underline',
        'transition-colors duration-150',
        sizing,
        tone,
        fullWidth ? 'w-full' : '',
      ]
        .filter((c) => c.length > 0)
        .join(' ')}
    >
      <PhoneIcon />
      <span>
        Call {business.ownerName}
        {showNumber ? (
          <span className="ml-1.5 font-normal opacity-80">{business.phoneDisplay}</span>
        ) : null}
      </span>
    </a>
  );
}

// A sticky call bar used to live here. It was removed once the bottom tab bar
// gained a Call tab — two permanently-visible call affordances on a 390px screen
// is just clutter, and the tab bar is the one that survives scrolling anyway.

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
