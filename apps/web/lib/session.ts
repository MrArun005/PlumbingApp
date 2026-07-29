/**
 * Where the customer's access token lives, in the browser only.
 *
 * In memory first, mirrored into `sessionStorage` so a page refresh or a
 * hard navigation does not log you out mid-booking. It is cleared when the tab
 * closes, which is the behaviour we want for a shared family phone.
 *
 * NOTE FOR PRODUCTION: a real deployment should not keep a bearer token in
 * web storage at all — it should be an httpOnly, Secure, SameSite=Lax cookie
 * set by a server route, so a successful XSS cannot read it. That needs a
 * session route on this app plus a CSRF story, which is out of scope for this
 * first customer UI. This module is the single place that would change.
 */
import type { CustomerSession } from './types';

const STORAGE_KEY = 'pipefix.session.v1';
const CHANGE_EVENT = 'pipefix:session-change';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; phone: string; name: string };
}

let memory: StoredSession | null = null;
let hydrated = false;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const user = v.user;
  if (typeof user !== 'object' || user === null) return false;
  const u = user as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof u.id === 'string' &&
    typeof u.phone === 'string' &&
    typeof u.name === 'string'
  );
}

export function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  if (!hydrated) {
    hydrated = true;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isStoredSession(parsed)) memory = parsed;
      }
    } catch {
      // Private-mode Safari and some Android WebViews throw on storage access.
      // A missing session is recoverable — the customer just logs in again.
      memory = null;
    }
  }
  return memory;
}

export function saveSession(session: CustomerSession): StoredSession {
  const stored: StoredSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user,
  };
  memory = stored;
  hydrated = true;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Memory-only session: still usable for this page view.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return stored;
}

export function clearSession(): void {
  memory = null;
  hydrated = true;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory copy is already gone.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** Lets the header re-render when the customer logs in or out. */
export function onSessionChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
