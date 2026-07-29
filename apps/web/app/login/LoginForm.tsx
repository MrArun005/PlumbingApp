'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { requestOtp, verifyOtp } from '../../lib/client-api';
import { saveSession } from '../../lib/session';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';

/** The API wants E.164 (+91…). Accept what people actually type and normalise. */
function toE164(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  const local = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

type Step = 'phone' | 'code';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');

  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onRequest(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    const e164 = toE164(phoneInput);
    if (e164 === null) {
      setFieldError('Enter a 10-digit Indian mobile number, starting 6, 7, 8 or 9.');
      return;
    }

    setBusy(true);
    const result = await requestOtp(e164);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPhone(e164);
    setDevCode(result.data.devCode ?? null);
    setStep('code');
  }

  async function onVerify(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    if (!/^\d{6}$/.test(code)) {
      setFieldError('The code is 6 digits.');
      return;
    }

    setBusy(true);
    const result = await verifyOtp(phone, code, name.trim().length > 0 ? name.trim() : undefined);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    saveSession(result.data);
    router.push(next !== null && next.startsWith('/') ? next : '/bookings');
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <Notice tone="problem" title="We could not do that">
          {error}
        </Notice>
      ) : null}

      {step === 'phone' ? (
        <form onSubmit={onRequest} className="flex flex-col gap-4" noValidate>
          <TextField
            id="phone"
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            hint="Indian mobile numbers only, for now. We will text you a 6-digit code."
            {...(fieldError === null ? {} : { error: fieldError })}
          />
          <Button type="submit" size="lg" fullWidth disabled={busy}>
            {busy ? 'Sending the code…' : 'Send me a code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">
            We sent a code to <span className="font-semibold text-ink">{phone}</span>.{' '}
            <button
              type="button"
              className="font-semibold text-primary underline"
              onClick={() => {
                setStep('phone');
                setCode('');
                setDevCode(null);
                setError(null);
              }}
            >
              Change number
            </button>
          </p>

          {devCode !== null ? (
            <Notice tone="dev" title="Development only — no SMS was sent">
              The API is running outside production, so it returned the code instead of texting it:{' '}
              <span className="font-mono text-base font-bold text-ink">{devCode}</span>. This box
              cannot appear in production — the API omits <code>devCode</code> there.
            </Notice>
          ) : null}

          <TextField
            id="code"
            label="6-digit code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...(fieldError === null ? {} : { error: fieldError })}
          />

          <TextField
            id="name"
            label="Your name"
            optional
            autoComplete="name"
            placeholder="So the plumber knows who to ask for"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="Only needed the first time you sign in."
          />

          <Button type="submit" size="lg" fullWidth disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
        </form>
      )}

      <p className="text-xs text-ink-faint">
        By signing in you agree to PipeFix&rsquo;s terms. Your session is kept in this tab only and
        ends when you close it.
      </p>
    </div>
  );
}
