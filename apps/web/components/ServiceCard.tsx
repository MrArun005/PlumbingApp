import Link from 'next/link';
import type { ServiceView } from '../lib/types';
import { durationLabel, skillTierLabel } from '../lib/labels';
import { Card } from './ui/Card';
import { Pill } from './ui/Pill';
import { PriceBlock } from './ui/PriceBlock';

export function ServiceCard({ service }: { service: ServiceView }) {
  return (
    <Card as="li" className="h-full transition-shadow duration-150 hover:shadow-lift">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold leading-snug text-ink">
            <Link
              href={`/services/${service.sku}`}
              className="text-ink no-underline hover:text-primary"
            >
              {service.name}
            </Link>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="neutral">{durationLabel(service.estDurationMin)}</Pill>
            <Pill tone="neutral">{skillTierLabel(service.skillTier)}</Pill>
            {service.urgencyEligible.includes('E0') ? <Pill tone="sos">SOS eligible</Pill> : null}
          </div>
        </div>

        <PriceBlock price={service.price} variant="card" />

        <div className="mt-auto flex items-center gap-3 pt-1">
          <Link
            href={`/book/${service.sku}`}
            className="inline-flex min-h-tap flex-1 items-center justify-center rounded-control bg-primary px-4 text-sm font-semibold text-primary-ink no-underline hover:bg-primary-hover"
          >
            {service.inspectFirst ? 'Book an inspection' : 'Book this'}
          </Link>
          <Link
            href={`/services/${service.sku}`}
            className="text-sm font-semibold text-primary no-underline hover:underline"
          >
            Details
          </Link>
        </div>
      </div>
    </Card>
  );
}
