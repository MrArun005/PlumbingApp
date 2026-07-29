import Link from 'next/link';
import type { BookingView } from '../lib/types';
import {
  formatIstDateTime,
  formatIstTimeRange,
  statusLabel,
  statusTone,
  urgencyLabel,
} from '../lib/labels';
import { Pill, type PillTone } from './ui/Pill';

const TONE_MAP: Record<ReturnType<typeof statusTone>, PillTone> = {
  neutral: 'neutral',
  progress: 'progress',
  good: 'verify',
  attention: 'accent',
  stopped: 'neutral',
};

export function StatusPill({ booking }: { booking: BookingView }) {
  const tone = statusTone(booking.status);
  return (
    <Pill tone={TONE_MAP[tone]} dot={tone === 'progress'}>
      {statusLabel(booking.status)}
    </Pill>
  );
}

/**
 * The itemised estimate. `estimate === null` is not an error and not a zero —
 * it means the price genuinely does not exist yet, and we say that in words.
 * Every amount printed here is a label the API produced; nothing is summed.
 */
export function EstimateBlock({ booking }: { booking: BookingView }) {
  if (booking.estimate === null) {
    return (
      <div className="rounded-control border border-line bg-surface-sunk px-3 py-3">
        <p className="text-sm font-semibold text-ink">No price yet — and that is on purpose</p>
        <p className="mt-1 text-sm text-ink-muted">
          This booking is inspect-first, so nothing was charged. Your plumber will look at the job
          and send you an itemised quote. Work starts only if you approve it.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          If you decline the quote, you pay the visit charge of{' '}
          <span className="font-semibold text-ink">{booking.visitChargeLabel}</span> and nothing
          else.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-line bg-surface">
      <div className="scroll-x">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="px-3 pt-3 text-left text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Estimate
          </caption>
          <tbody>
            {booking.estimate.lines.map((line) => (
              <tr key={`${line.code}-${line.label}`} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink-muted">
                  {line.label}
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{line.amountLabel}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink">
                Total
              </th>
              <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums text-accent">
                {booking.estimate.totalLabel}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {booking.estimate.lines.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-ink-faint">
          The line-by-line breakdown is shown on the invoice once the job is done.
        </p>
      ) : null}
    </div>
  );
}

export function BookingCard({ booking }: { booking: BookingView }) {
  return (
    <li className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill booking={booking} />
        <span className="text-xs text-ink-faint">
          Booked {formatIstDateTime(booking.createdAt)}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-0.5">
        {booking.items.map((item) => (
          <li key={item.sku} className="text-base font-semibold text-ink">
            {item.name}
            {item.quantity > 1 ? (
              <span className="ml-1.5 text-sm font-normal text-ink-muted">× {item.quantity}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-1 text-sm text-ink-muted">
        {urgencyLabel(booking.urgencyTier)}
        {booking.scheduledSlotStart !== null && booking.scheduledSlotEnd !== null
          ? ` · ${formatIstTimeRange(booking.scheduledSlotStart, booking.scheduledSlotEnd)}`
          : ''}
      </p>

      <p className="mt-3 rounded-control bg-primary-soft px-3 py-2.5 text-sm font-medium text-primary-soft-ink">
        {booking.whatHappensNext}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-muted">
          {booking.estimate === null ? 'Price after inspection' : booking.estimate.totalLabel}
        </span>
        <Link
          href={`/bookings/${booking.id}`}
          className="text-sm font-semibold text-primary no-underline hover:underline"
        >
          View booking
        </Link>
      </div>
    </li>
  );
}
