'use client';

/**
 * The plumber's whole day on one screen.
 *
 * Design brief, in priority order — this is used one-handed, outdoors, on a
 * cheap Android phone, often in a hurry:
 *   1. Call the customer          (biggest button on every card)
 *   2. Get directions             (one tap to the maps app)
 *   3. Move the job along         (one obvious next step, never a menu)
 *   4. See what he did last time  (history, on demand)
 *
 * Everything else is noise. There is no dashboard, no chart, no filter bar.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  arriveAtJob,
  completeJob,
  currentCoords,
  getPartnerSession,
  jobAction,
  loadCustomerHistory,
  loadJobs,
  onPartnerSessionChange,
  requestPartnerOtp,
  setPartnerSession,
  verifyPartnerOtp,
  type PartnerJob,
  type PartnerSession,
} from '../../lib/partner';
import { business, formatPhoneForDisplay, mapsHref } from '../../lib/business-config';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Pill } from '../../components/ui/Pill';
import { EmptyState } from '../../components/ui/EmptyState';

type Tab = 'today' | 'done';

export function PlumberConsole() {
  const [session, setSession] = useState<PartnerSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(getPartnerSession());
    setReady(true);
    return onPartnerSessionChange(() => setSession(getPartnerSession()));
  }, []);

  if (!ready) {
    return <p className="py-10 text-center text-sm text-ink-muted">Loading…</p>;
  }
  if (session === null) return <PlumberLogin />;
  return <JobBoard session={session} />;
}

// ── login ────────────────────────────────────────────────────────────────────

function PlumberLogin() {
  const [phone, setPhone] = useState(business.phone);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const result = await requestPartnerOtp(phone.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
    setDevCode(result.data.devCode ?? null);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const result = await verifyPartnerOtp(phone.trim(), code.trim());
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">My jobs</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sign in with your work number to see today&apos;s jobs.
        </p>
      </div>

      <Card tone="plain" className="flex flex-col gap-4 p-4">
        <TextField
          id="partner-phone"
          label="Your mobile number"
          hint="The number registered with the business."
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          disabled={sent}
        />

        {sent ? (
          <>
            <TextField
              id="partner-otp"
              label="6-digit code"
              hint="Sent to your phone by SMS."
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
            />
            {devCode !== null ? (
              <p className="rounded-control bg-surface-2 p-2.5 text-xs text-ink-muted">
                Development only — your code is <strong className="text-ink">{devCode}</strong>. On
                a real deployment this arrives by SMS instead.
              </p>
            ) : null}
            <Button onClick={verify} disabled={busy || code.length !== 6} fullWidth size="md">
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
          </>
        ) : (
          <Button onClick={send} disabled={busy || phone.trim().length < 10} fullWidth size="md">
            {busy ? 'Sending…' : 'Send me a code'}
          </Button>
        )}

        {error !== null ? (
          <p role="alert" className="text-sm font-medium text-sos">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

// ── job board ────────────────────────────────────────────────────────────────

function JobBoard({ session }: { session: PartnerSession }) {
  const [tab, setTab] = useState<Tab>('today');
  const [jobs, setJobs] = useState<PartnerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadJobs(tab === 'today' ? 'active' : 'history');
    setLoading(false);
    if (!result.ok) {
      if (result.unauthorized === true) setPartnerSession(null);
      setError(result.message);
      return;
    }
    setJobs(result.data);
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-5 py-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {tab === 'today' ? "Today's jobs" : 'Finished jobs'}
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {session.partner.name} · {formatPhoneForDisplay(session.partner.phone)}
          </p>
        </div>
        <Button variant="quiet" size="sm" onClick={() => setPartnerSession(null)}>
          Sign out
        </Button>
      </header>

      <div role="tablist" aria-label="Job list" className="flex gap-2">
        {(['today', 'done'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={[
              'min-h-tap flex-1 rounded-control px-4 text-sm font-semibold transition-colors',
              tab === t
                ? 'bg-primary text-primary-ink'
                : 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
            ].join(' ')}
          >
            {t === 'today' ? 'To do' : 'Finished'}
          </button>
        ))}
      </div>

      {error !== null ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-sos">
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">Loading your jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title={tab === 'today' ? 'Nothing booked right now' : 'No finished jobs yet'}
          body={
            tab === 'today'
              ? 'When a customer books, the job appears here with their address and number.'
              : 'Jobs you complete will be listed here so you can look back at what you did.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {jobs.map((job) => (
            <li key={job.jobId}>
              <JobCard job={job} onChanged={() => void refresh()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── one job ──────────────────────────────────────────────────────────────────

/** The single next step for a status, or null when nothing is actionable here. */
function nextStep(
  status: string,
): { label: string; kind: 'simple' | 'otp'; action?: string } | null {
  switch (status) {
    case 'ASSIGNED':
      return { label: 'Start — I am on my way', kind: 'simple', action: 'start' };
    case 'EN_ROUTE':
      return { label: 'I have arrived', kind: 'otp' };
    case 'ARRIVED':
      return { label: 'Start looking at it', kind: 'simple', action: 'diagnose' };
    case 'DIAGNOSING':
      return { label: 'Begin the work', kind: 'simple', action: 'begin-work' };
    case 'IN_PROGRESS':
      return { label: 'Work is finished', kind: 'simple', action: 'finish-work' };
    case 'WORK_DONE':
      return { label: 'Close the job', kind: 'otp' };
    default:
      return null;
  }
}

function JobCard({ job, onChanged }: { job: PartnerJob; onChanged: () => void }) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const [history, setHistory] = useState<PartnerJob[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const step = nextStep(job.status);
  const isDone = job.completedAt !== null;

  async function runSimple(action: string) {
    setBusy(true);
    setError(null);
    const result = await jobAction(
      job.jobId,
      action as 'start' | 'diagnose' | 'begin-work' | 'finish-work',
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged();
  }

  async function runOtp() {
    setBusy(true);
    setError(null);
    // Arrival needs coordinates for the 100 m check; completion does not.
    const result =
      job.status === 'EN_ROUTE'
        ? await arriveAtJob(job.jobId, otp, await currentCoords())
        : await completeJob(job.jobId, otp);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOtp('');
    setShowOtp(false);
    onChanged();
  }

  async function toggleHistory() {
    setHistoryOpen((open) => !open);
    if (history !== null) return;
    const result = await loadCustomerHistory(job.customerPhone);
    setHistory(result.ok ? result.data.filter((h) => h.jobId !== job.jobId) : []);
  }

  return (
    <Card tone="plain" className="flex flex-col gap-3.5 p-4">
      {/* who and what */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold leading-tight text-ink">{job.customerName}</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {job.services.map((s) => s.name).join(', ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill tone={isDone ? 'verify' : 'neutral'}>{humanStatus(job.status)}</Pill>
          {job.requiresPpeProof ? <Pill tone="sos">PPE photo needed</Pill> : null}
        </div>
      </div>

      {/* address */}
      <p className="text-sm leading-relaxed text-ink">
        {job.address.line1}
        {job.address.line2 === null ? '' : `, ${job.address.line2}`}
        {job.address.landmark === null ? '' : ` (near ${job.address.landmark})`}
        <span className="text-ink-muted"> — {job.address.pincode}</span>
        {job.address.floor !== null ? (
          <span className="text-ink-muted">
            {' '}
            · Floor {job.address.floor}
            {job.address.liftAvailable ? ', lift' : ', no lift'}
          </span>
        ) : null}
      </p>
      {job.address.gateInstructions !== null ? (
        <p className="rounded-control bg-surface-2 p-2.5 text-xs text-ink-muted">
          Gate: {job.address.gateInstructions}
        </p>
      ) : null}

      {/* money */}
      <p className="text-sm">
        {isDone && job.finalTotalLabel !== null ? (
          <span className="font-semibold text-ink">Charged {job.finalTotalLabel}</span>
        ) : job.estimateLabel !== null ? (
          <span className="text-ink-muted">
            Quoted price <span className="font-semibold text-ink">{job.estimateLabel}</span>
          </span>
        ) : (
          <span className="text-copper">Price after you look — send a quote from the job</span>
        )}
      </p>

      {/* THE TWO BUTTONS HE ACTUALLY USES */}
      <div className="flex gap-2">
        <a
          href={`tel:${job.customerPhone}`}
          className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-ink no-underline"
        >
          Call customer
        </a>
        <a
          href={mapsHref(job.address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink no-underline hover:bg-surface-2"
        >
          Directions
        </a>
      </div>

      {/* the one next step */}
      {step !== null ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-xs text-ink-faint">{job.nextAction}</p>
          {step.kind === 'simple' ? (
            <Button
              size="md"
              fullWidth
              disabled={busy}
              onClick={() => void runSimple(step.action ?? '')}
            >
              {busy ? 'Saving…' : step.label}
            </Button>
          ) : showOtp ? (
            <div className="flex flex-col gap-2">
              <TextField
                id={`job-otp-${job.jobId}`}
                label={
                  job.status === 'EN_ROUTE'
                    ? "Customer's 4-digit start code"
                    : "Customer's 4-digit closing code"
                }
                hint="Ask them to read it from their phone."
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.currentTarget.value.replace(/\D/g, ''))}
              />
              <Button
                size="md"
                fullWidth
                disabled={busy || otp.length !== 4}
                onClick={() => void runOtp()}
              >
                {busy ? 'Checking…' : 'Confirm'}
              </Button>
            </div>
          ) : (
            <Button size="md" fullWidth onClick={() => setShowOtp(true)}>
              {step.label}
            </Button>
          )}
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-sm font-medium text-sos">
          {error}
        </p>
      ) : null}

      {/* history — the "have I been here before?" question */}
      <div className="border-t border-line pt-3">
        <button
          onClick={() => void toggleHistory()}
          className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          {historyOpen ? 'Hide past jobs' : 'Past jobs for this customer'}
        </button>
        {historyOpen ? (
          history === null ? (
            <p className="mt-2 text-sm text-ink-muted">Looking…</p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">First time at this customer.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {history.map((h) => (
                <li key={h.jobId} className="rounded-control bg-surface-2 p-2.5 text-xs">
                  <span className="font-semibold text-ink">
                    {h.services.map((s) => s.name).join(', ')}
                  </span>
                  <span className="text-ink-muted">
                    {h.completedAt === null ? '' : ` · ${formatDate(h.completedAt)}`}
                    {h.finalTotalLabel === null ? '' : ` · ${h.finalTotalLabel}`}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Card>
  );
}

/** Statuses in words a plumber would use, not enum names. */
function humanStatus(status: string): string {
  const map: Record<string, string> = {
    ASSIGNED: 'Not started',
    EN_ROUTE: 'On the way',
    ARRIVED: 'At the door',
    DIAGNOSING: 'Looking at it',
    QUOTE_PENDING: 'Waiting on customer',
    QUOTE_REVISED: 'Waiting on customer',
    VISIT_CHARGE_ONLY: 'Quote declined',
    IN_PROGRESS: 'Working',
    WORK_DONE: 'Needs closing',
    COMPLETED: 'Done',
    CANCELLED: 'Cancelled',
    NO_SHOW_CUSTOMER: 'Nobody home',
    NO_SHOW_PARTNER: 'Missed',
    DISPUTED: 'Disputed',
  };
  return map[status] ?? status;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
