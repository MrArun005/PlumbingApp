import Link from 'next/link';
import type { Metadata } from 'next';
import { loadService } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SampleDataNotice } from '../../../components/ui/Notice';
import { BookingFlow } from './BookingFlow';

interface PageProps {
  params: Promise<{ sku: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sku } = await params;
  const result = await loadService(sku);
  return {
    title: result.status === 'ok' ? `Book ${result.service.name}` : 'Book a service',
  };
}

export default async function BookPage({ params }: PageProps) {
  const { sku } = await params;
  const result = await loadService(sku);

  if (result.status === 'not-found') {
    return (
      <EmptyState
        title="That service is not available to book"
        body={`We could not load "${sku}". It may have been withdrawn, or the catalogue is temporarily unreachable.`}
        action={{ href: '/services', label: 'Browse all services' }}
        tone="problem"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {result.source === 'sample' ? <SampleDataNotice reason={result.reason} /> : null}

      <nav aria-label="Breadcrumb" className="text-sm">
        <Link
          href={`/services/${result.service.sku}`}
          className="font-semibold text-primary no-underline hover:underline"
        >
          ← Back to {result.service.name}
        </Link>
      </nav>

      <BookingFlow service={result.service} liveCatalog={result.source === 'api'} />
    </div>
  );
}
