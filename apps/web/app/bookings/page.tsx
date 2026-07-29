import type { Metadata } from 'next';
import { BookingsList } from './BookingsList';

export const metadata: Metadata = {
  title: 'My bookings',
  description: 'Track your PipeFix bookings, quotes and visits.',
};

export default function BookingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold text-ink">My bookings</h1>
        <p className="text-sm text-ink-muted">
          Everything you have booked, newest first, with what happens next on each one.
        </p>
      </header>
      <BookingsList />
    </div>
  );
}
