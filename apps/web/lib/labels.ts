/**
 * Enum → plain English, and dates → IST strings.
 *
 * Deliberately contains NO money handling. Amounts are rendered only from the
 * `*Label` strings the API sends (see PriceBlock); nothing in the browser adds,
 * multiplies, or reformats a currency value.
 */
import type { BookingStatus } from './types';

/** Skill tiers, per docs/PLAN.md §2.1: L1 helper · L2 plumber · L3 specialist. */
export function skillTierLabel(tier: string): string {
  switch (tier) {
    case 'L1':
      return 'Helper (L1)';
    case 'L2':
      return 'Certified plumber (L2)';
    case 'L3':
      return 'Senior specialist (L3)';
    default:
      return tier;
  }
}

/** Mid-sentence form, e.g. "Labour by a certified plumber". */
export function skillTierPhrase(tier: string): string {
  switch (tier) {
    case 'L1':
      return 'a trained helper';
    case 'L2':
      return 'a certified plumber';
    case 'L3':
      return 'a senior specialist';
    default:
      return `a ${tier} plumber`;
  }
}

export function materialsLabel(policy: string): string {
  switch (policy) {
    case 'INCLUDED':
      return 'Materials included';
    case 'CONSUMABLES_ONLY':
      return 'Small parts included (washers, O-rings, tape)';
    case 'EXCLUDED':
      return 'Parts billed separately, only with your approval';
    default:
      return policy;
  }
}

export function urgencyLabel(tier: string): string {
  switch (tier) {
    case 'E0':
      return 'Emergency SOS — within 30 minutes';
    case 'E1':
      return 'Urgent — within 2 hours';
    case 'E2':
      return 'Same day';
    case 'E3':
      return 'Scheduled';
    default:
      return tier;
  }
}

export function urgencyShortLabel(tier: string): string {
  switch (tier) {
    case 'E0':
      return 'SOS 30 min';
    case 'E1':
      return 'Urgent 2 h';
    case 'E2':
      return 'Same day';
    case 'E3':
      return 'Scheduled';
    default:
      return tier;
  }
}

export function toolLabel(tool: string): string {
  return tool
    .toLowerCase()
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? '1 hour' : `${hours} hours`;
  return rest === 0 ? `about ${hourPart}` : `about ${hourPart} ${rest} min`;
}

export function warrantyLabel(days: number): string {
  if (days <= 0) return 'No labour warranty on this service';
  if (days === 30) return '30-day labour warranty';
  return `${days}-day labour warranty`;
}

export function categoryLabel(code: string, known: { code: string; name: string }[]): string {
  return known.find((c) => c.code === code)?.name ?? code;
}

/* ── Booking status ─────────────────────────────────────────────────────── */

export type StatusTone = 'neutral' | 'progress' | 'good' | 'attention' | 'stopped';

export function statusLabel(status: BookingStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft';
    case 'PENDING_PAYMENT':
      return 'Payment due';
    case 'EXPIRED':
      return 'Expired';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'DISPATCHING':
      return 'Finding a plumber';
    case 'FAILED_TO_ASSIGN':
      return 'No plumber found';
    case 'ASSIGNED':
      return 'Plumber assigned';
    case 'EN_ROUTE':
      return 'On the way';
    case 'ARRIVED':
      return 'Arrived';
    case 'DIAGNOSING':
      return 'Checking the problem';
    case 'QUOTE_PENDING':
      return 'Quote waiting for you';
    case 'QUOTE_REVISED':
      return 'Revised quote waiting';
    case 'VISIT_CHARGE_ONLY':
      return 'Quote declined — visit charge only';
    case 'IN_PROGRESS':
      return 'Work in progress';
    case 'WORK_DONE':
      return 'Work done';
    case 'PAYMENT_PENDING':
      return 'Payment pending';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED_BY_USER':
      return 'Cancelled by you';
    case 'CANCELLED_BY_PARTNER':
      return 'Cancelled by plumber';
    case 'NO_SHOW_CUSTOMER':
      return 'Nobody at home';
    case 'NO_SHOW_PARTNER':
      return 'Plumber did not arrive';
    case 'DISPUTED':
      return 'Under review';
    default:
      return status;
  }
}

export function statusTone(status: BookingStatus): StatusTone {
  switch (status) {
    case 'COMPLETED':
    case 'CONFIRMED':
      return 'good';
    case 'DISPATCHING':
    case 'ASSIGNED':
    case 'EN_ROUTE':
    case 'ARRIVED':
    case 'DIAGNOSING':
    case 'IN_PROGRESS':
    case 'WORK_DONE':
      return 'progress';
    case 'PENDING_PAYMENT':
    case 'PAYMENT_PENDING':
    case 'QUOTE_PENDING':
    case 'QUOTE_REVISED':
      return 'attention';
    case 'EXPIRED':
    case 'FAILED_TO_ASSIGN':
    case 'CANCELLED_BY_USER':
    case 'CANCELLED_BY_PARTNER':
    case 'NO_SHOW_CUSTOMER':
    case 'NO_SHOW_PARTNER':
    case 'DISPUTED':
    case 'VISIT_CHARGE_ONLY':
      return 'stopped';
    default:
      return 'neutral';
  }
}

/** All business time is IST (docs/BUILD-PROMPT.md rule 6). */
const IST = 'Asia/Kolkata';

export function formatIstDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatIstDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatIstTimeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return `${startIso} – ${endIso}`;
  return `${formatIstDate(startIso)}, ${fmt.format(start)} – ${fmt.format(end)}`;
}
