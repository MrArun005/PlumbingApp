/**
 * The plumber's own side: session storage plus the calls his screen needs.
 *
 * Kept separate from the customer's `session.ts` / `client-api.ts` on purpose —
 * a shared family phone might have the customer site open in one tab, and the
 * two sessions must never overwrite each other. Different storage key,
 * different token.
 *
 * Same production caveat as the customer session: a bearer token in web storage
 * should become an httpOnly cookie before this is exposed to the internet.
 */

const STORAGE_KEY = 'pipefix.partner.v1';
const DEVICE_KEY = 'pipefix.partner.device.v1';
const CHANGE_EVENT = 'pipefix:partner-session-change';
const CLIENT_BASE = '/api/pipefix';
const TIMEOUT_MS = 10_000;

export interface PartnerSession {
  accessToken: string;
  refreshToken: string;
  partner: { id: string; phone: string; name: string; skillTier: string; onlineStatus: string };
}

export interface JobAddress {
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  floor: number | null;
  liftAvailable: boolean;
  gateInstructions: string | null;
}

export interface PartnerJob {
  jobId: string;
  bookingId: string;
  status: string;
  urgencyTier: string;
  pricingMode: string;
  customerName: string;
  customerPhone: string;
  scheduledSlotStart: string | null;
  completedAt: string | null;
  finalTotalLabel: string | null;
  address: JobAddress;
  services: { sku: string; name: string; quantity: number; requiredTools: string[] }[];
  requiresPpeProof: boolean;
  estimateLabel: string | null;
  nextAction: string;
}

export type Result<T> =
  { ok: true; data: T } | { ok: false; message: string; unauthorized?: boolean };

const OFFLINE = 'Could not reach the server. Check your connection — nothing was saved.';

// ── session ──────────────────────────────────────────────────────────────────

let memory: PartnerSession | null = null;
let hydrated = false;

function isSession(v: unknown): v is PartnerSession {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const p = s.partner;
  if (typeof p !== 'object' || p === null) return false;
  const partner = p as Record<string, unknown>;
  return (
    typeof s.accessToken === 'string' &&
    typeof s.refreshToken === 'string' &&
    typeof partner.id === 'string' &&
    typeof partner.name === 'string'
  );
}

export function getPartnerSession(): PartnerSession | null {
  if (typeof window === 'undefined') return null;
  if (!hydrated) {
    hydrated = true;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      memory = isSession(parsed) ? parsed : null;
    } catch {
      memory = null;
    }
  }
  return memory;
}

export function setPartnerSession(session: PartnerSession | null): void {
  memory = session;
  hydrated = true;
  if (typeof window === 'undefined') return;
  try {
    if (session === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private-browsing quota errors must not break the login.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onPartnerSessionChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/**
 * A stable id for this phone. The API binds a partner's session to one device,
 * so this must survive reloads — otherwise every refresh looks like signing in
 * on a new phone and kills the previous session.
 */
export function deviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing !== null && existing.length > 0) return existing;
    const fresh = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // No storage: fall back to a per-load id. Login still works, it just looks
    // like a new device each time.
    return `web-ephemeral-${Date.now()}`;
  }
}

// ── calls ────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean },
): Promise<Result<T>> {
  const session = init.auth === true ? getPartnerSession() : null;
  if (init.auth === true && session === null) {
    return { ok: false, message: 'Please sign in again.', unauthorized: true };
  }

  try {
    const res = await fetch(`${CLIENT_BASE}${path}`, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(session === null ? {} : { authorization: `Bearer ${session.accessToken}` }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    const body: unknown = text.length === 0 ? {} : safeJson(text);

    if (!res.ok) {
      const message =
        isRecord(body) && typeof body.message === 'string' && body.message.length > 0
          ? body.message
          : `Request failed (${res.status}).`;
      return { ok: false, message, unauthorized: res.status === 401 };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function requestPartnerOtp(phone: string): Promise<Result<{ devCode?: string }>> {
  return call('/partner/auth/otp/request', { method: 'POST', body: { phone } });
}

export async function verifyPartnerOtp(
  phone: string,
  code: string,
): Promise<Result<PartnerSession>> {
  const result = await call<PartnerSession>('/partner/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, deviceId: deviceId() },
  });
  if (result.ok) setPartnerSession(result.data);
  return result;
}

export async function loadJobs(
  scope: 'active' | 'history' = 'active',
): Promise<Result<PartnerJob[]>> {
  const result = await call<{ jobs: PartnerJob[] }>(`/partner/jobs?scope=${scope}`, {
    method: 'GET',
    auth: true,
  });
  if (!result.ok) return result;
  return { ok: true, data: Array.isArray(result.data.jobs) ? result.data.jobs : [] };
}

/** Past jobs for one customer — "what did I do here last time?" */
export async function loadCustomerHistory(phone: string): Promise<Result<PartnerJob[]>> {
  const result = await call<{ jobs: PartnerJob[] }>(
    `/partner/jobs?scope=history&phone=${encodeURIComponent(phone)}`,
    { method: 'GET', auth: true },
  );
  if (!result.ok) return result;
  return { ok: true, data: Array.isArray(result.data.jobs) ? result.data.jobs : [] };
}

export async function jobAction(
  jobId: string,
  action: 'start' | 'diagnose' | 'begin-work' | 'finish-work',
): Promise<Result<{ status: string }>> {
  return call(`/partner/jobs/${jobId}/${action}`, { method: 'POST', auth: true });
}

/** Arrival needs the customer's code and the phone's coordinates. */
export async function arriveAtJob(
  jobId: string,
  otp: string,
  coords: { lat: number; lng: number } | null,
): Promise<Result<{ status: string }>> {
  return call(`/partner/jobs/${jobId}/arrive`, {
    method: 'POST',
    auth: true,
    body: { otp, ...(coords === null ? {} : coords) },
  });
}

export async function completeJob(jobId: string, otp: string): Promise<Result<{ status: string }>> {
  return call(`/partner/jobs/${jobId}/complete`, { method: 'POST', auth: true, body: { otp } });
}

/** Best-effort location. Never blocks the UI: a refusal just means no coords. */
export function currentCoords(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}
