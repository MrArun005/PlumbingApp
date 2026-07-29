/**
 * Single place that decides how the business presents itself.
 *
 * WHY THIS EXISTS: the platform underneath supports a full multi-plumber
 * marketplace — dispatch rings, surge pricing, a 30-minute SLA with an
 * automatic money-back guarantee. Running one plumber, most of that should not
 * be *promised* to customers even though the code can do it. So the features
 * stay built and stay tested; this file just decides which of them the customer
 * is told about.
 *
 * Flip a flag to true when the business genuinely grows into it. Nothing needs
 * rewriting — the backend already handles all of it.
 */

export interface BusinessConfig {
  /** Shown throughout the site. */
  name: string;
  /** The person customers ask for by name. */
  ownerName: string;
  /** E.164, used for the tap-to-call button. The single most-used control. */
  phone: string;
  /** Pretty version for display. */
  phoneDisplay: string;
  /** Where the business works, in plain words. */
  serviceArea: string;
  /**
   * ONE plumber, not a pool. Changes copy from "we ring nearby plumbers until
   * one accepts" to "we'll confirm your time", and hides anything that only
   * makes sense with competing supply.
   */
  singlePlumberMode: boolean;
  /**
   * The E0/E1 SOS tier with its ≤30-minute promise. OFF by default: a hard
   * arrival SLA needs a paid standby roster to back it (see the dispatch
   * simulator — it takes roughly 120 plumbers to hold 85% on-time). Promising it
   * with one person would mean breaking it.
   */
  showEmergencyTier: boolean;
  /** The automatic refund-if-late guarantee. Only honest alongside the above. */
  showMoneyBackGuarantee: boolean;
  /** Surge multipliers on emergency jobs. Off: local trade, fixed prices. */
  showSurgePricing: boolean;
  /** AMC subscription plans. Off until someone actually sells one. */
  showAmcPlans: boolean;
  /** "Police-verified partners" style trust badges — plural, marketplace framing. */
  showVerifiedPartnerBadges: boolean;
}

/**
 * Current setup: one plumber, phone-first, no promises the business cannot keep.
 *
 * Set the phone number via NEXT_PUBLIC_BUSINESS_PHONE so it is not hard-coded
 * into the bundle for whoever forks this.
 */
export const business: BusinessConfig = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME ?? 'PipeFix Plumbing',
  ownerName: process.env.NEXT_PUBLIC_OWNER_NAME ?? 'Arun',
  phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? '+919900000000',
  phoneDisplay: formatPhoneForDisplay(process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? '+919900000000'),
  serviceArea: process.env.NEXT_PUBLIC_SERVICE_AREA ?? 'Bengaluru',

  singlePlumberMode: true,
  showEmergencyTier: false,
  showMoneyBackGuarantee: false,
  showSurgePricing: false,
  showAmcPlans: false,
  showVerifiedPartnerBadges: false,
};

/** +919876543210 → "+91 98765 43210" */
export function formatPhoneForDisplay(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match === null ? e164 : `+91 ${match[1]} ${match[2]}`;
}

/** `tel:` href for the business line. */
export function telHref(): string {
  return `tel:${business.phone}`;
}

/**
 * A maps link for an address, so the plumber taps once to navigate. Uses the
 * generic geo-search URL, which every phone hands to its default maps app
 * rather than forcing Google Maps.
 */
export function mapsHref(parts: {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  pincode: string;
}): string {
  const query = [parts.line1, parts.line2, parts.landmark, parts.pincode]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
