'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BookingView } from '../../../lib/types';
import { cancelBooking, getBooking } from '../../../lib/client-api';
import { clearSession, readSession } from '../../../lib/session';
import { formatIstDateTime, formatIstTimeRange, urgencyLabel } from '../../../lib/labels';
import { EstimateBlock, StatusPill } from '../../../components/BookingCard';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Button } from '../../../components/ui/Button';
import { Notice } from '../../../components/ui/Notice';

type State =
  | { phase: 'loading' }
  | { phase: 'anonymous' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; booking: BookingView };

/** Statuses where "cancel" is a reasonable thing to offer the customer. */
const CANCELLABLE = new Set<BookingView['status']>([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
]);

export function BookingDetail({ bookingId }: { bookingId: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const session = readSession();
    if (session === null) {
      setState({ phase: 'anonymous' });
      return;
    }
    setState({ phase: 'loading' });
    const result = await getBooking(session.accessToken, bookingId);
    if (result.ok) {
      setState({ phase: 'ready', booking: result.data });
      return;
    }
    if (result.unauthorized === true) {
      clearSession();
      setState({ phase: 'anonymous' });
      return;
    }
    setState({ phase: 'error', message: result.message });
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCancel(): Promise<void> {
    const session = readSession();
    if (session === null) return;
    setCancelError(null);
    setCancelBusy(true);
    const result = await cancelBooking(
      session.accessToken,
      bookingId,
      'Cancelled from the website',
    );
    setCancelBusy(false);
    if (result.ok) {
      setState({ phase: 'ready', booking: result.data });
      return;
    }
    setCancelError(result.message);
  }

  if (state.phase === 'loading') {
    return (
      <div
        className="h-64 animate-pulse rounded-card border border-line bg-surface-2"
        aria-busy="true"
        aria-label="Loading your booking"
      />
    );
  }

  if (state.phase === 'anonymous') {
    return (
      <EmptyState
        title="Sign in to see this booking"
        body="Bookings are private to the account that made them."
        action={{ href: `/login?next=/bookings/${bookingId}`, label: 'Sign in' }}
      />
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="problem" title="We could not load this booking">
          {state.message}
        </Notice>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { booking } = state;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill booking={booking} />
          <span className="text-xs text-ink-faint">
            Booked {formatIstDateTime(booking.createdAt)}
          </span>
        </div>

        <h1 className="text-2xl font-bold leading-tight text-ink">
          {booking.items.map((i) => i.name).join(' + ')}
        </h1>

        <p className="rounded-control bg-primary-soft px-3 py-2.5 text-sm font-medium text-primary-soft-ink">
          {booking.whatHappensNext}
        </p>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Urgency
            </dt>
            <dd className="text-sm text-ink">{urgencyLabel(booking.urgencyTier)}</dd>
          </div>
          {booking.scheduledSlotStart !== null && booking.scheduledSlotEnd !== null ? (
            <div>
              <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                Your slot
              </dt>
              <dd className="text-sm text-ink">
                {formatIstTimeRange(booking.scheduledSlotStart, booking.scheduledSlotEnd)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
              How it is priced
            </dt>
            <dd className="text-sm text-ink">
              {booking.pricingMode === 'INSPECT_FIRST'
                ? 'Inspected first, then quoted for your approval'
                : 'Agreed up front from the catalogue price'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Reference
            </dt>
            <dd className="font-mono text-sm text-ink-muted">{booking.id}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h2 id="items-heading" className="text-xl font-bold text-ink">
          What we are doing
        </h2>
        <ul className="flex flex-col gap-2">
          {booking.items.map((item) => (
            <li
              key={item.sku}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2.5"
            >
              <span className="text-sm font-semibold text-ink">
                {item.name}
                {item.quantity > 1 ? (
                  <span className="ml-1.5 font-normal text-ink-muted">× {item.quantity}</span>
                ) : null}
              </span>
              <span className="text-sm text-ink-muted">
                {item.unitPriceLabel ?? 'Priced after inspection'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="estimate-heading" className="flex flex-col gap-3">
        <h2 id="estimate-heading" className="text-xl font-bold text-ink">
          {booking.estimate === null ? 'Price' : 'Your estimate'}
        </h2>
        <EstimateBlock booking={booking} />
      </section>

      {cancelError !== null ? (
        <Notice tone="problem" title="We could not cancel that">
          {cancelError}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void load()}>
          Refresh status
        </Button>
        {CANCELLABLE.has(booking.status) ? (
          <Button variant="quiet" onClick={() => void onCancel()} disabled={cancelBusy}>
            {cancelBusy ? 'Cancelling…' : 'Cancel this booking'}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
