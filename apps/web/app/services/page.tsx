import Link from 'next/link';
import type { Metadata } from 'next';
import { loadCategories, loadServices } from '../../lib/api';
import { ServiceCard } from '../../components/ServiceCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { SampleDataNotice } from '../../components/ui/Notice';

export const metadata: Metadata = {
  title: 'All plumbing services in Bengaluru',
  description:
    'Every PipeFix service with its price, or an honest "price after inspection" where no price can be given up front.',
};

const CATEGORY_PATTERN = /^[A-Z]{3,4}$/;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = firstParam(params.category);
  // Ignore junk in the query string rather than asking the API to reject it.
  const category = raw !== undefined && CATEGORY_PATTERN.test(raw) ? raw : undefined;

  const [categories, services] = await Promise.all([loadCategories(), loadServices(category)]);
  const usingSample = categories.source === 'sample' || services.source === 'sample';
  const activeName =
    category === undefined
      ? 'All services'
      : (categories.data.find((c) => c.code === category)?.name ?? category);

  const inspectFirstCount = services.data.filter((s) => s.inspectFirst).length;

  return (
    <div className="flex flex-col gap-6">
      {usingSample ? <SampleDataNotice reason={services.reason ?? categories.reason} /> : null}

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-ink">{activeName}</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          {services.data.length} {services.data.length === 1 ? 'service' : 'services'} in Bengaluru.
          {inspectFirstCount > 0
            ? ` ${inspectFirstCount} of these are inspected first, so no price is shown until our plumber has seen the job.`
            : ''}
        </p>
      </header>

      {/* Filter chips scroll inside their own row — the page never scrolls sideways. */}
      <nav aria-label="Filter by category" className="-mx-4 px-4">
        <ul className="scroll-x flex gap-2 pb-1">
          <li className="shrink-0">
            <Link
              href="/services"
              aria-current={category === undefined ? 'true' : undefined}
              className={`inline-flex min-h-tap items-center rounded-pill border px-4 text-sm font-semibold no-underline ${
                category === undefined
                  ? 'border-primary bg-primary text-primary-ink'
                  : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
              }`}
            >
              All
            </Link>
          </li>
          {categories.data.map((c) => {
            const active = c.code === category;
            return (
              <li key={c.code} className="shrink-0">
                <Link
                  href={`/services?category=${c.code}`}
                  aria-current={active ? 'true' : undefined}
                  className={`inline-flex min-h-tap items-center rounded-pill border px-4 text-sm font-semibold no-underline ${
                    active
                      ? 'border-primary bg-primary text-primary-ink'
                      : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
                  }`}
                >
                  {c.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {services.data.length === 0 ? (
        <EmptyState
          title="Nothing here for this category"
          body={
            category === undefined
              ? 'The catalogue came back empty. Try again in a moment.'
              : 'We do not list any services under this category in Bengaluru yet.'
          }
          action={{ href: '/services', label: 'See all services' }}
          tone="problem"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.data.map((service) => (
            <ServiceCard key={service.sku} service={service} />
          ))}
        </ul>
      )}
    </div>
  );
}
