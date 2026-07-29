'use client';

/**
 * The booking flow: questions → address → when → how the price is set → review.
 *
 * Two things in here are load-bearing product rules:
 *
 *  1. The inspect-first toggle. It sends `inspectFirst: true` and is FORCED ON
 *     (and locked) for services the catalogue says have no up-front price. The
 *     API enforces the same thing server-side; this is the customer-facing half.
 *
 *  2. No price arithmetic. Even with a quantity above 1, this component never
 *     multiplies anything. It shows the API's `headline` and lets the API price
 *     the booking. There is no total on the review step for that reason.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { BookingView, CreateBookingRequest, ServiceView } from '../../../lib/types';
import { durationLabel, urgencyLabel } from '../../../lib/labels';
import { isAnswerable, parsePreVisitQuestions } from '../../../lib/previsit';
import { createBooking, newIdempotencyKey } from '../../../lib/client-api';
import { readSession } from '../../../lib/session';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { Choice, TextField } from '../../../components/ui/Field';
import { Notice } from '../../../components/ui/Notice';
import { PriceBlock, hasUpfrontPrice } from '../../../components/ui/PriceBlock';
import { Pill } from '../../../components/ui/Pill';
import { EstimateBlock, StatusPill } from '../../../components/BookingCard';

const SLOTS = [
  { id: '09-11', label: '9:00 am – 11:00 am', startHour: 9, endHour: 11 },
  { id: '11-13', label: '11:00 am – 1:00 pm', startHour: 11, endHour: 13 },
  { id: '13-15', label: '1:00 pm – 3:00 pm', startHour: 13, endHour: 15 },
  { id: '15-17', label: '3:00 pm – 5:00 pm', startHour: 15, endHour: 17 },
  { id: '17-19', label: '5:00 pm – 7:00 pm', startHour: 17, endHour: 19 },
] as const;

/** Today in IST as YYYY-MM-DD — the earliest date a slot can be booked for. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** All business time is IST, so the offset is fixed at +05:30 (no DST in India). */
function istIso(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`;
}

type StepId = 'questions' | 'address' | 'when' | 'pricing' | 'review';

interface AddressForm {
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  pincode: string;
  city: string;
  savedAddressId: string;
}

const EMPTY_ADDRESS: AddressForm = {
  label: 'Home',
  line1: '',
  line2: '',
  landmark: '',
  pincode: '',
  city: 'Bengaluru',
  savedAddressId: '',
};

export function BookingFlow({
  service,
  liveCatalog,
}: {
  service: ServiceView;
  liveCatalog: boolean;
}) {
  const questions = useMemo(
    () => parsePreVisitQuestions(service.preVisitQuestions),
    [service.preVisitQuestions],
  );
  const forcedInspectFirst = service.inspectFirst;
  const upfront = hasUpfrontPrice(service.price);

  // The bookings endpoint handles the planned tiers only; E0/E1 go through the
  // dedicated emergency path, so we offer the intersection and nothing else.
  const tiers = useMemo(
    () => (['E2', 'E3'] as const).filter((t) => service.urgencyEligible.includes(t)),
    [service.urgencyEligible],
  );
  const onlyTier = tiers.length === 1 ? tiers[0] : undefined;

  const steps = useMemo<StepId[]>(
    () => [
      ...(questions.length > 0 ? (['questions'] as StepId[]) : []),
      'address',
      'when',
      'pricing',
      'review',
    ],
    [questions.length],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [tier, setTier] = useState<'E2' | 'E3'>(onlyTier ?? 'E2');
  const [slotDate, setSlotDate] = useState<string>(istToday());
  const [slotId, setSlotId] = useState<string>(SLOTS[0].id);
  const [inspectFirst, setInspectFirst] = useState<boolean>(forcedInspectFirst);
  const [quantity, setQuantity] = useState<number>(1);
  const [couponCode, setCouponCode] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingView | null>(null);

  const step = steps[stepIndex] ?? 'review';
  const slot = SLOTS.find((s) => s.id === slotId) ?? SLOTS[0];
  const perUnit = service.price.kind === 'PER_UNIT';

  if (confirmed !== null) {
    return <Confirmation booking={confirmed} />;
  }

  function goNext(): void {
    const problem = validate(step);
    if (problem !== null) {
      setStepError(problem);
      return;
    }
    setStepError(null);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function goBack(): void {
    setStepError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function validate(current: StepId): string | null {
    if (current === 'questions') {
      const unanswered = questions
        .filter((q) => isAnswerable(q) && q.optional !== true)
        .filter((q) => (answers[q.q] ?? '').trim().length === 0);
      if (unanswered.length > 0) {
        return 'Please answer the questions above — they decide which tools the plumber brings.';
      }
      return null;
    }
    if (current === 'address') {
      if (address.line1.trim().length === 0) return 'We need a house or flat number and street.';
      if (!/^[1-9]\d{5}$/.test(address.pincode.trim())) {
        return 'Enter a 6-digit PIN code so we can match you to a serviceable area.';
      }
      return null;
    }
    if (current === 'when') {
      if (tier === 'E3' && slotDate.trim().length === 0) return 'Pick a date for the visit.';
      return null;
    }
    return null;
  }

  async function onConfirm(): Promise<void> {
    setSubmitError(null);

    const session = readSession();
    if (session === null) {
      setSubmitError(
        'You need to be signed in to confirm a booking. Nothing has been submitted yet.',
      );
      return;
    }
    if (address.savedAddressId.trim().length === 0) {
      setSubmitError(
        'This build cannot save a new address yet — the API has no address endpoint. Paste a saved address ID on the address step to submit the booking.',
      );
      return;
    }

    const preVisitAnswers = questions
      .filter((q) => (answers[q.q] ?? '').trim().length > 0)
      .map((q) => ({ q: q.q, a: answers[q.q] }));

    const request: CreateBookingRequest = {
      addressId: address.savedAddressId.trim(),
      items: [{ sku: service.sku, quantity, preVisitAnswers }],
      urgencyTier: tier,
      inspectFirst,
      ...(tier === 'E3'
        ? {
            scheduledSlotStart: istIso(slotDate, slot.startHour),
            scheduledSlotEnd: istIso(slotDate, slot.endHour),
          }
        : {}),
      ...(couponCode.trim().length > 0 ? { couponCode: couponCode.trim() } : {}),
    };

    setBusy(true);
    // One key per confirm attempt: a retry of THIS attempt must not double-book.
    const result = await createBooking(session.accessToken, request, newIdempotencyKey());
    setBusy(false);

    if (!result.ok) {
      setSubmitError(result.message);
      return;
    }
    setConfirmed(result.data);
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight text-ink">Book: {service.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="neutral">{durationLabel(service.estDurationMin)}</Pill>
          {!upfront ? <Pill tone="primary">{service.price.headline}</Pill> : null}
        </div>
      </header>

      <Stepper steps={steps} current={stepIndex} />

      {!liveCatalog ? (
        <Notice tone="sample">
          <span className="font-semibold">Sample service.</span> The catalogue is not reachable, so
          this page is showing a bundled copy of {service.sku}. You can walk the flow, but
          confirming will fail until the API is up.
        </Notice>
      ) : null}

      <div className="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        {step === 'questions' ? (
          <QuestionsStep questions={questions} answers={answers} onChange={setAnswers} />
        ) : null}

        {step === 'address' ? <AddressStep address={address} onChange={setAddress} /> : null}

        {step === 'when' ? (
          <WhenStep
            tiers={tiers}
            tier={tier}
            onTier={setTier}
            slotDate={slotDate}
            onSlotDate={setSlotDate}
            slotId={slotId}
            onSlot={setSlotId}
          />
        ) : null}

        {step === 'pricing' ? (
          <PricingStep
            service={service}
            inspectFirst={inspectFirst}
            forced={forcedInspectFirst}
            onToggle={setInspectFirst}
            perUnit={perUnit}
            quantity={quantity}
            onQuantity={setQuantity}
          />
        ) : null}

        {step === 'review' ? (
          <ReviewStep
            service={service}
            questions={questions.map((q) => ({ q: q.q, a: answers[q.q] ?? '' }))}
            address={address}
            tier={tier}
            slotLabel={tier === 'E3' ? `${slotDate}, ${slot.label}` : null}
            inspectFirst={inspectFirst}
            quantity={quantity}
            perUnit={perUnit}
            couponCode={couponCode}
            onCoupon={setCouponCode}
          />
        ) : null}

        {stepError !== null ? (
          <Notice tone="problem" className="mt-4">
            {stepError}
          </Notice>
        ) : null}

        {submitError !== null ? (
          <Notice tone="problem" title="Booking not submitted" className="mt-4">
            {submitError}{' '}
            {submitError.includes('signed in') ? (
              <Link href={`/login?next=/book/${service.sku}`} className="font-semibold underline">
                Sign in
              </Link>
            ) : null}
          </Notice>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          {step === 'review' ? (
            <Button size="lg" onClick={onConfirm} disabled={busy}>
              {busy ? 'Confirming…' : inspectFirst ? 'Confirm — pay ₹0 now' : 'Confirm booking'}
            </Button>
          ) : (
            <Button size="lg" onClick={goNext}>
              Continue
            </Button>
          )}
          {stepIndex > 0 ? (
            <Button size="lg" variant="secondary" onClick={goBack} disabled={busy}>
              Back
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Steps ───────────────────────────────────────────────────────────────── */

const STEP_TITLES: Record<StepId, string> = {
  questions: 'A few questions',
  address: 'Where',
  when: 'When',
  pricing: 'Price',
  review: 'Review',
};

function Stepper({ steps, current }: { steps: StepId[]; current: number }) {
  return (
    <ol className="scroll-x -mx-4 flex gap-2 px-4 pb-1" aria-label="Booking steps">
      {steps.map((id, index) => {
        const state = index === current ? 'current' : index < current ? 'done' : 'todo';
        return (
          <li key={id} className="shrink-0">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={`inline-flex min-h-tap items-center gap-2 rounded-pill border px-3.5 text-sm font-semibold ${
                state === 'current'
                  ? 'border-primary bg-primary text-primary-ink'
                  : state === 'done'
                    ? 'border-line-strong bg-primary-soft text-primary-soft-ink'
                    : 'border-line bg-surface text-ink-faint'
              }`}
            >
              <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
              {STEP_TITLES[id]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function QuestionsStep({
  questions,
  answers,
  onChange,
}: {
  questions: ReturnType<typeof parsePreVisitQuestions>;
  answers: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-ink">A few questions before we come</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          These decide which tools and which level of plumber we send. Getting them right saves a
          second visit.
        </p>
      </div>

      {questions.map((question, index) => {
        if (!isAnswerable(question)) {
          return (
            <Notice tone="info" key={question.q}>
              <span className="font-semibold">{question.q}</span> — photo uploads are not available
              on the website yet. You can send it in the chat once a plumber is assigned.
            </Notice>
          );
        }

        const fieldId = `q-${index}`;
        const value = answers[question.q] ?? '';

        if (question.options === undefined) {
          return (
            <TextField
              key={question.q}
              id={fieldId}
              label={question.q}
              optional={question.optional === true}
              value={value}
              onChange={(e) => onChange({ ...answers, [question.q]: e.target.value })}
            />
          );
        }

        return (
          <fieldset key={question.q} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">
              {question.q}
              {question.optional === true ? (
                <span className="ml-1.5 font-normal text-ink-faint">(optional)</span>
              ) : null}
            </legend>
            {question.options.map((option) => (
              <Choice
                key={option}
                name={fieldId}
                value={option}
                checked={value === option}
                onSelect={(next) => onChange({ ...answers, [question.q]: next })}
                title={option}
              />
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

function AddressStep({
  address,
  onChange,
}: {
  address: AddressForm;
  onChange: (next: AddressForm) => void;
}) {
  function set<K extends keyof AddressForm>(key: K, value: AddressForm[K]): void {
    onChange({ ...address, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Where should we come?</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Bengaluru only for now. The plumber calls before setting off.
        </p>
      </div>

      <TextField
        id="line1"
        label="Flat / house number and street"
        autoComplete="address-line1"
        placeholder="9, 5th Cross"
        value={address.line1}
        onChange={(e) => set('line1', e.target.value)}
      />
      <TextField
        id="line2"
        label="Area or locality"
        optional
        autoComplete="address-line2"
        placeholder="Koramangala"
        value={address.line2}
        onChange={(e) => set('line2', e.target.value)}
      />
      <TextField
        id="landmark"
        label="Landmark"
        optional
        placeholder="Opposite the BDA park"
        value={address.landmark}
        onChange={(e) => set('landmark', e.target.value)}
        hint="Anything that helps a plumber on a two-wheeler find the gate."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="pincode"
          label="PIN code"
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          placeholder="560095"
          value={address.pincode}
          onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
        />
        <TextField
          id="city"
          label="City"
          value={address.city}
          onChange={(e) => set('city', e.target.value)}
          readOnly
          hint="We are live in Bengaluru only."
        />
      </div>
      <TextField
        id="label"
        label="Save this as"
        value={address.label}
        onChange={(e) => set('label', e.target.value)}
        hint="Home, Office, Mum's place — whatever you will recognise later."
      />

      {/*
        Honest gap: POST /bookings needs an `addressId` of an address that
        already belongs to the customer, and the API has no endpoint to create
        one yet (there is no /addresses route in apps/api). Until it exists this
        flow cannot turn the form above into a saved address, so confirming needs
        an existing id. Documented in the UI rather than hidden.
      */}
      <details className="rounded-control border border-line bg-surface-sunk px-3 py-2.5">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Saved address ID (needed to submit — see why)
        </summary>
        <p className="mt-2 text-sm text-ink-muted">
          The PipeFix API does not yet have an endpoint for saving a new address, so it can only
          accept a booking against an address that already exists on your account. Until that lands,
          paste an existing address ID here to submit a real booking. Everything you typed above is
          still shown on the review step.
        </p>
        <div className="mt-3">
          <TextField
            id="savedAddressId"
            label="Existing address ID"
            value={address.savedAddressId}
            onChange={(e) => set('savedAddressId', e.target.value)}
            placeholder="cuid from the Address table"
          />
        </div>
      </details>
    </div>
  );
}

function WhenStep({
  tiers,
  tier,
  onTier,
  slotDate,
  onSlotDate,
  slotId,
  onSlot,
}: {
  tiers: readonly ('E2' | 'E3')[];
  tier: 'E2' | 'E3';
  onTier: (next: 'E2' | 'E3') => void;
  slotDate: string;
  onSlotDate: (next: string) => void;
  slotId: string;
  onSlot: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-ink">When suits you?</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Need someone right now instead? Emergency SOS is a separate, faster route from the home
          page.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">Urgency</legend>
        {tiers.includes('E2') ? (
          <Choice
            name="tier"
            value="E2"
            checked={tier === 'E2'}
            onSelect={() => onTier('E2')}
            title="Today"
            description="We find you a plumber for the next available window today."
          />
        ) : null}
        {tiers.includes('E3') ? (
          <Choice
            name="tier"
            value="E3"
            checked={tier === 'E3'}
            onSelect={() => onTier('E3')}
            title="Pick a date and time"
            description="Best for planned work. Choose a two-hour window that suits you."
          />
        ) : null}
        {tiers.length === 1 ? (
          <p className="text-xs text-ink-faint">
            This service is only offered as {urgencyLabel(tiers[0] ?? 'E3').toLowerCase()}.
          </p>
        ) : null}
      </fieldset>

      {tier === 'E3' ? (
        <div className="flex flex-col gap-4 rounded-control border border-line bg-surface-sunk p-3">
          <TextField
            id="slotDate"
            label="Date"
            type="date"
            min={istToday()}
            value={slotDate}
            onChange={(e) => onSlotDate(e.target.value)}
            hint="All times are IST."
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Two-hour window</legend>
            {SLOTS.map((s) => (
              <Choice
                key={s.id}
                name="slot"
                value={s.id}
                checked={slotId === s.id}
                onSelect={onSlot}
                title={s.label}
              />
            ))}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

function PricingStep({
  service,
  inspectFirst,
  forced,
  onToggle,
  perUnit,
  quantity,
  onQuantity,
}: {
  service: ServiceView;
  inspectFirst: boolean;
  forced: boolean;
  onToggle: (next: boolean) => void;
  perUnit: boolean;
  quantity: number;
  onQuantity: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-ink">How the price gets set</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Whatever you choose here, no work happens until you have agreed the amount.
        </p>
      </div>

      <div className="rounded-control border border-line bg-surface-sunk p-3">
        <PriceBlock price={service.price} variant="detail" />
      </div>

      <div
        className={`rounded-control border p-3 ${
          inspectFirst ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface'
        }`}
      >
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={inspectFirst}
            disabled={forced}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-[var(--color-primary)]"
            aria-describedby="inspect-first-help"
          />
          <span className="flex flex-col gap-1">
            <span
              className={`text-sm font-bold ${inspectFirst ? 'text-primary-soft-ink' : 'text-ink'}`}
            >
              Inspect first — decide the price on site
            </span>
            <span
              id="inspect-first-help"
              className={`text-sm ${inspectFirst ? 'text-primary-soft-ink' : 'text-ink-muted'}`}
            >
              You pay nothing to book. The plumber looks at the job, sends you an itemised quote,
              and starts only once you approve it. Decline and only the visit charge of{' '}
              {service.price.visitChargeLabel} applies.
            </span>
          </span>
        </label>

        {forced ? (
          <p className="mt-3 rounded-control bg-surface px-3 py-2 text-sm text-ink-muted">
            <span className="font-semibold text-ink">Always on for this service.</span> Nobody can
            price {service.name.toLowerCase()} honestly without seeing it, so we do not pretend
            otherwise — there is no up-front amount to charge you.
          </p>
        ) : null}
      </div>

      {perUnit && !inspectFirst ? (
        <div className="flex flex-col gap-2">
          <TextField
            id="quantity"
            label="How many?"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={String(quantity)}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              onQuantity(Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 1), 20));
            }}
            hint="Priced per unit. We do not show a total here — the plumber confirms the count on site and PipeFix prices it, so the number you approve is the real one."
          />
        </div>
      ) : null}
    </div>
  );
}

function ReviewStep({
  service,
  questions,
  address,
  tier,
  slotLabel,
  inspectFirst,
  quantity,
  perUnit,
  couponCode,
  onCoupon,
}: {
  service: ServiceView;
  questions: { q: string; a: string }[];
  address: AddressForm;
  tier: 'E2' | 'E3';
  slotLabel: string | null;
  inspectFirst: boolean;
  quantity: number;
  perUnit: boolean;
  couponCode: string;
  onCoupon: (next: string) => void;
}) {
  const answered = questions.filter((q) => q.a.trim().length > 0);
  const addressLines = [address.line1, address.line2, address.landmark, address.pincode]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Check this over</h2>
        <p className="mt-1 text-sm text-ink-muted">Nothing is charged until you tap confirm.</p>
      </div>

      <dl className="flex flex-col divide-y divide-line rounded-control border border-line bg-surface">
        <Row term="Service">
          {service.name}
          {perUnit && !inspectFirst && quantity > 1 ? ` × ${quantity}` : ''}
        </Row>
        <Row term="Price">
          {inspectFirst ? (
            <>
              <span className="font-semibold">₹0 to book</span> — price agreed on site from an
              itemised quote you approve. Visit charge {service.price.visitChargeLabel} if you
              decline.
            </>
          ) : (
            <>
              {service.price.headline}
              <span className="block text-ink-faint">{service.price.note}</span>
            </>
          )}
        </Row>
        <Row term="When">
          {tier === 'E2' ? 'Today, next available window' : (slotLabel ?? 'Scheduled')}
        </Row>
        <Row term="Address">
          {addressLines.length > 0 ? (
            <>
              <span className="block">{address.label}</span>
              <span className="block text-ink-muted">
                {addressLines.join(', ')}, {address.city}
              </span>
            </>
          ) : (
            'Not provided'
          )}
        </Row>
        {answered.length > 0 ? (
          <Row term="Your answers">
            <ul className="flex flex-col gap-1">
              {answered.map((item) => (
                <li key={item.q}>
                  <span className="text-ink-muted">{item.q}</span>{' '}
                  <span className="font-semibold">{item.a}</span>
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </dl>

      <TextField
        id="coupon"
        label="Coupon code"
        optional
        value={couponCode}
        onChange={(e) => onCoupon(e.target.value.toUpperCase())}
        placeholder="e.g. FIRST100"
        hint={
          inspectFirst
            ? 'Coupons apply to the quote you approve on site, not to the booking.'
            : 'The discount is worked out by PipeFix and shown on your booking.'
        }
      />

      <Notice tone="info">
        Your plumber&rsquo;s name, photo and arrival time appear in your booking as soon as one
        accepts. You can cancel free until they set off.
      </Notice>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-3 sm:flex-row sm:gap-4">
      <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-ink-faint sm:w-32 sm:shrink-0 sm:pt-0.5">
        {term}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function Confirmation({ booking }: { booking: BookingView }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill booking={booking} />
          <Pill tone="verify">Booking created</Pill>
        </div>
        <h1 className="mt-3 text-2xl font-bold text-ink">
          {booking.items[0]?.name ?? 'Your booking'} is booked
        </h1>
        <p className="mt-3 rounded-control bg-primary-soft px-3 py-2.5 text-sm font-medium text-primary-soft-ink">
          {booking.whatHappensNext}
        </p>
        <div className="mt-4">
          <EstimateBlock booking={booking} />
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={`/bookings/${booking.id}`} size="lg">
            Track this booking
          </ButtonLink>
          <ButtonLink href="/services" size="lg" variant="secondary">
            Book something else
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
