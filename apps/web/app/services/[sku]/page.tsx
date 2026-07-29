import Link from 'next/link';
import type { Metadata } from 'next';
import { loadService } from '../../../lib/api';
import {
  durationLabel,
  materialsLabel,
  skillTierLabel,
  skillTierPhrase,
  toolLabel,
  urgencyShortLabel,
  warrantyLabel,
} from '../../../lib/labels';
import { parsePreVisitQuestions } from '../../../lib/previsit';
import { ButtonLink } from '../../../components/ui/Button';
import { Pill } from '../../../components/ui/Pill';
import { PriceBlock, hasUpfrontPrice } from '../../../components/ui/PriceBlock';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Notice, SampleDataNotice } from '../../../components/ui/Notice';
import { InspectFirstExplainer } from '../../../components/InspectFirstExplainer';

interface PageProps {
  params: Promise<{ sku: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sku } = await params;
  const result = await loadService(sku);
  if (result.status !== 'ok') return { title: 'Service not found' };
  const { service } = result;
  return {
    title: service.name,
    description: hasUpfrontPrice(service.price)
      ? `${service.name} in Bengaluru — ${service.price.headline}. ${service.price.note}`
      : `${service.name} in Bengaluru — inspected first, then quoted. ${service.price.note}`,
  };
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { sku } = await params;
  const result = await loadService(sku);

  if (result.status === 'not-found') {
    return (
      <div className="flex flex-col gap-5">
        {result.source === 'sample' ? <SampleDataNotice reason={result.reason} /> : null}
        <EmptyState
          title="We could not find that service"
          body={
            result.source === 'sample'
              ? `"${sku}" is not in the bundled sample catalogue, and the live catalogue is not reachable right now.`
              : `"${sku}" is not in the Bengaluru catalogue. It may have been renamed or withdrawn.`
          }
          action={{ href: '/services', label: 'Browse all services' }}
          tone="problem"
        />
      </div>
    );
  }

  const { service } = result;
  const upfront = hasUpfrontPrice(service.price);
  const questions = parsePreVisitQuestions(service.preVisitQuestions);

  // The seed sets shortDesc = name for most SKUs, so only show a description
  // when it actually adds something the heading has not already said.
  const description =
    service.longDesc ?? (service.shortDesc === service.name ? null : service.shortDesc);

  const included: string[] = [
    `Labour by ${skillTierPhrase(service.skillTier)}`,
    'On-site diagnosis and a plain-language explanation of what is wrong',
    materialsLabel(service.materialsPolicy),
    'Clean-up of the work area and a GST invoice in the app',
  ];
  if (service.warrantyDays > 0) {
    included.push(warrantyLabel(service.warrantyDays));
  }

  return (
    <div className="flex flex-col gap-6">
      {result.source === 'sample' ? <SampleDataNotice reason={result.reason} /> : null}

      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/services" className="font-semibold text-primary no-underline hover:underline">
          All services
        </Link>
        <span className="mx-1.5 text-ink-faint" aria-hidden="true">
          /
        </span>
        <Link
          href={`/services?category=${service.categoryCode}`}
          className="font-semibold text-primary no-underline hover:underline"
        >
          {service.categoryCode}
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold leading-tight text-ink">{service.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="neutral">{durationLabel(service.estDurationMin)}</Pill>
          <Pill tone="neutral">{skillTierLabel(service.skillTier)}</Pill>
          {service.warrantyDays > 0 ? (
            <Pill tone="verify">{warrantyLabel(service.warrantyDays)}</Pill>
          ) : null}
          {!upfront ? <Pill tone="primary">{service.price.headline}</Pill> : null}
          {service.urgencyEligible.includes('E0') ? <Pill tone="sos">SOS eligible</Pill> : null}
        </div>
        {description !== null ? (
          <p className="max-w-prose text-base text-ink-muted">{description}</p>
        ) : (
          <p className="max-w-prose text-base text-ink-muted">
            {upfront
              ? `We send ${skillTierPhrase(service.skillTier)}, who does the job and leaves you with a GST invoice. ${service.price.note}`
              : `We send ${skillTierPhrase(service.skillTier)} to find out what is actually wrong and quote you for it. Nothing is charged to book.`}
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          {!upfront ? <InspectFirstExplainer price={service.price} /> : null}

          <section aria-labelledby="included-heading">
            <h2 id="included-heading" className="text-xl font-bold text-ink">
              What&rsquo;s included
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {included.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill bg-verify-soft text-2xs font-bold text-verify-soft-ink"
                  >
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {service.materialsPolicy !== 'INCLUDED' ? (
              <p className="mt-3 text-sm text-ink-faint">
                Parts we have to buy are never added silently. The plumber shows you the part, the
                price, and waits for your yes.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="detail-heading">
            <h2 id="detail-heading" className="text-xl font-bold text-ink">
              The details
            </h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  Typical time on site
                </dt>
                <dd className="text-sm text-ink">{durationLabel(service.estDurationMin)}</dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  Who comes out
                </dt>
                <dd className="text-sm text-ink">{skillTierLabel(service.skillTier)}</dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  Labour warranty
                </dt>
                <dd className="text-sm text-ink">{warrantyLabel(service.warrantyDays)}</dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  Parts and materials
                </dt>
                <dd className="text-sm text-ink">{materialsLabel(service.materialsPolicy)}</dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  How soon we can come
                </dt>
                <dd className="text-sm text-ink">
                  {service.urgencyEligible.map(urgencyShortLabel).join(' · ')}
                </dd>
              </div>
              {service.requiredTools.length > 0 ? (
                <div>
                  <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                    Equipment brought
                  </dt>
                  <dd className="text-sm text-ink">
                    {service.requiredTools.map(toolLabel).join(', ')}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  Service code
                </dt>
                <dd className="font-mono text-sm text-ink-muted">{service.sku}</dd>
              </div>
            </dl>
          </section>

          {questions.length > 0 ? (
            <section aria-labelledby="questions-heading">
              <h2 id="questions-heading" className="text-xl font-bold text-ink">
                We will ask you {questions.length} quick{' '}
                {questions.length === 1 ? 'question' : 'questions'}
              </h2>
              <p className="mt-1 max-w-prose text-sm text-ink-muted">
                Answering these when you book means the plumber turns up with the right tools the
                first time.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {questions.map((question) => (
                  <li
                    key={question.q}
                    className="rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink"
                  >
                    {question.q}
                    {question.options !== undefined ? (
                      <span className="mt-1 block text-xs text-ink-faint">
                        {question.options.join(' · ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Sticky price + CTA rail on desktop, plain block on a phone. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <PriceBlock price={service.price} variant="detail" />
            <ButtonLink href={`/book/${service.sku}`} size="lg" fullWidth>
              {upfront ? 'Book this service' : 'Book an inspection — ₹0 now'}
            </ButtonLink>
            {!upfront ? (
              <Notice tone="info">
                Booking costs nothing. The price is agreed after the plumber has seen the problem,
                and only you can approve it.
              </Notice>
            ) : null}
            {!service.urgencyEligible.includes('E2') ? (
              <Notice tone="info">
                This job is planned, not same-day — you will pick a slot when you book.
              </Notice>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
