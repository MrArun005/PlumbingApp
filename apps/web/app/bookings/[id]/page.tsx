import Link from 'next/link';
import type { Metadata } from 'next';
import { BookingDetail } from './BookingDetail';

export const metadata: Metadata = {
  title: 'Booking',
  description: 'Your PipeFix booking: status, what happens next, and the estimate or quote.',
};

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/bookings" className="font-semibold text-primary no-underline hover:underline">
          ← All bookings
        </Link>
      </nav>
      <BookingDetail bookingId={id} />
    </div>
  );
}
