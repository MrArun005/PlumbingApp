import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to PipeFix with your mobile number and a one-time code.',
};

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-ink">Sign in</h1>
        <p className="text-sm text-ink-muted">
          Your mobile number is your account. We send a 6-digit code — no password to remember.
        </p>
      </header>
      {/* LoginForm reads the ?next= param, so it needs a boundary to prerender. */}
      <Suspense
        fallback={
          <div
            className="h-56 animate-pulse rounded-card border border-line bg-surface-2"
            aria-hidden="true"
          />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
