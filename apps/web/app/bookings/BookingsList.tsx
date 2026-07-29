'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BookingView } from '../../lib/types';
import { listBookings } from '../../lib/client-api';
import { clearSession, readSession } from '../../lib/session';
import { BookingCard } from '../../components/BookingCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';

type State =
  | { phase: 'loading' }
  | { phase: 'anonymous' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; bookings: BookingView[] };

export function BookingsList() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    const session = readSession();
    if (session === null) {
      setState({ phase: 'anonymous' });
      return;
    }
    setState({ phase: 'loading' });
    const result = await listBookings(session.accessToken);
    if (result.ok) {
      setState({ phase: 'ready', bookings: result.data });
      return;
    }
    if (result.unauthorized === true) {
      // The token is stale. Drop it so the header stops claiming we're signed in.
      clearSession();
      setState({ phase: 'anonymous' });
      return;
    }
    setState({ phase: 'error', message: result.message });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading') {
    return (
      <ul className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="h-36 animate-pulse rounded-card border border-line bg-surface-2"
            aria-hidden="true"
          />
        ))}
        <li className="sr-only">Loading your bookings…</li>
      </ul>
    );
  }

  if (state.phase === 'anonymous') {
    return (
      <EmptyState
        title="Sign in to see your bookings"
        body="Your bookings are tied to your mobile number. Sign in with a one-time code and they will show up here."
        action={{ href: '/login?next=/bookings', label: 'Sign in' }}
      />
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="problem" title="We could not load your bookings">
          {state.message}
        </Notice>
        <div>
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (state.bookings.length === 0) {
    return (
      <EmptyState
        title="No bookings yet"
        body="When you book a plumber, it will appear here with live status — on the way, arrived, quote waiting, done."
        action={{ href: '/services', label: 'Browse services' }}
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {state.bookings.map((booking) => (
          <BookingCard key={booking.id} booking={booking} />
        ))}
      </ul>
      <div>
        <Button variant="quiet" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </>
  );
}
