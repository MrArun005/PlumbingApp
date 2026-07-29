/**
 * The ONLY component allowed to render a service price.
 *
 * The product rule it enforces: some services have no up-front price at all.
 * The plumber inspects, then raises an itemised quote the customer approves.
 * For those (`kind` INSPECTION_FIRST or QUOTE_ONLY) the API sends no
 * `amountPaise` / `amountLabel`, and this component will not show an amount
 * even if one somehow appears — see NO_UPFRONT_PRICE below.
 *
 * It also does no arithmetic. `headline`, `note` and `visitChargeLabel` are
 * printed exactly as the API produced them. There is no currency formatting,
 * no summing, no per-unit multiplication anywhere in this file — or anywhere
 * else in this app.
 */
import type { PriceDisplay, PriceDisplayKind } from '../../lib/types';
import { Pill } from './Pill';

const NO_UPFRONT_PRICE: ReadonlySet<PriceDisplayKind> = new Set<PriceDisplayKind>([
  'INSPECTION_FIRST',
  'QUOTE_ONLY',
]);

export function hasUpfrontPrice(price: PriceDisplay): boolean {
  return !NO_UPFRONT_PRICE.has(price.kind);
}

interface PriceBlockProps {
  price: PriceDisplay;
  /** `card` is the compact form on a list tile; `detail` is the page hero. */
  variant?: 'card' | 'detail';
  /** Hide the "you only pay this if you decline the quote" line. */
  showVisitCharge?: boolean;
}

export function PriceBlock({ price, variant = 'card', showVisitCharge = true }: PriceBlockProps) {
  const upfront = hasUpfrontPrice(price);

  if (variant === 'card') {
    return (
      <div className="flex flex-col gap-1">
        {upfront ? (
          <p className="text-lg font-bold text-accent">{price.headline}</p>
        ) : (
          // `headline` is the API's own wording — "Price after inspection" for
          // INSPECTION_FIRST, "Price after site visit" for QUOTE_ONLY. Never an
          // amount, and never a phrase we invented.
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            <Pill tone="primary">{price.headline}</Pill>
          </p>
        )}
        <p className="text-xs text-ink-faint">
          {upfront ? price.note : `You pay ₹0 to book. ${price.note}`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
          {upfront ? 'Price' : 'How the price is set'}
        </p>
        <p className={upfront ? 'text-3xl font-bold text-accent' : 'text-2xl font-bold text-ink'}>
          {price.headline}
        </p>
      </div>
      <p className="text-sm text-ink-muted">{price.note}</p>
      {showVisitCharge ? (
        <p className="rounded-control bg-surface-sunk px-3 py-2 text-sm text-ink-muted">
          {upfront ? (
            <>
              <span className="font-semibold text-ink">Visit charge {price.visitChargeLabel}</span>{' '}
              — applies only if you decline the work after our plumber has seen it.
            </>
          ) : (
            <>
              <span className="font-semibold text-ink">
                Nothing to pay to book. Visit charge {price.visitChargeLabel}
              </span>{' '}
              — that is all you owe if you say no to the quote.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
