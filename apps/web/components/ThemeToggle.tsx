'use client';

import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pipefix.theme';

function apply(choice: Choice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/**
 * Cycles system → light → dark. `data-theme` on <html> overrides the
 * prefers-color-scheme default in both directions (see globals.css).
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') setChoice(saved);
    } catch {
      // Storage blocked — the system preference is a fine default.
    }
  }, []);

  function next(): void {
    const order: Choice[] = ['system', 'light', 'dark'];
    const value = order[(order.indexOf(choice) + 1) % order.length] ?? 'system';
    setChoice(value);
    apply(value);
    try {
      if (value === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Non-persistent theme choice is acceptable.
    }
  }

  const label =
    choice === 'system'
      ? 'Theme: match device'
      : choice === 'light'
        ? 'Theme: light'
        : 'Theme: dark';

  return (
    <button
      type="button"
      onClick={next}
      aria-label={`${label}. Tap to change.`}
      title={label}
      className="inline-flex size-tap items-center justify-center rounded-control border border-line text-ink-muted hover:bg-surface-2"
    >
      <span aria-hidden="true" className="text-base">
        {choice === 'system' ? '◐' : choice === 'light' ? '☀' : '☾'}
      </span>
    </button>
  );
}
