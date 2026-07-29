/**
 * Browser-side calls that need the customer's token (plus the two OTP calls,
 * which do not but belong to the same login flow).
 *
 * Nothing here throws. Every call resolves to an `ApiResult`, so a page can
 * always render a sentence instead of a stack trace. Error text comes from the
 * API's error envelope when there is one, and from a friendly fallback when the
 * API cannot be reached at all.
 */
import type {
  ApiErrorBody,
  BookingView,
  CreateBookingRequest,
  CustomerSession,
  OtpRequestResult,
} from './types';

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; message: string; code?: string; unauthorized?: boolean };

/**
 * Same-origin prefix, rewritten to the real API by next.config.mjs. It has to
 * be same-origin: apps/api does not enable CORS, so a direct cross-origin fetch
 * from the browser is refused before it ever reaches the server. The token
 * still lives in the browser and is still sent by the browser — Next only
 * relays the request.
 */
const CLIENT_BASE = '/api/pipefix';

const TIMEOUT_MS = 10000;

const OFFLINE_MESSAGE =
  'We could not reach PipeFix. Check your connection and try again — nothing was submitted.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structural check on a BookingView before we render it. Fails closed: a
 * response we cannot read becomes a friendly message, never a blank screen.
 * `estimate: null` is a legitimate value (inspect-first) and must survive.
 */
function isBookingView(value: unknown): value is BookingView {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.pricingMode === 'string' &&
    typeof value.whatHappensNext === 'string' &&
    typeof value.visitChargeLabel === 'string' &&
    Array.isArray(value.items) &&
    (value.estimate === null || isRecord(value.estimate))
  );
}

const UNREADABLE = 'PipeFix sent a response we could not read. Please refresh and try again.';

function errorFrom(status: number, body: unknown): { message: string; code?: string } {
  if (isRecord(body) && typeof body.message === 'string' && body.message.length > 0) {
    const envelope = body as unknown as ApiErrorBody;
    return typeof envelope.code === 'string'
      ? { message: envelope.message, code: envelope.code }
      : { message: envelope.message };
  }
  if (status === 401) return { message: 'Please sign in again.', code: 'UNAUTHORIZED' };
  // No error envelope means we never reached the API itself — most often the
  // API process is down and the same-origin proxy failed to connect.
  if (status >= 500) {
    return {
      message: 'PipeFix is not responding right now. Nothing was submitted — please try again.',
      code: 'UPSTREAM_DOWN',
    };
  }
  return { message: `Something went wrong (HTTP ${status}).` };
}

interface CallOptions {
  method?: 'GET' | 'POST';
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', token, body, idempotencyKey } = options;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  // Required on every mutating endpoint so a retry on a flaky mobile network
  // cannot create two bookings (see apps/api BookingsController.create).
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${CLIENT_BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE, code: 'OFFLINE' };
  }

  let parsed: unknown = null;
  try {
    parsed = res.status === 204 ? null : ((await res.json()) as unknown);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const { message, code } = errorFrom(res.status, parsed);
    return {
      ok: false,
      message,
      ...(code === undefined ? {} : { code }),
      ...(res.status === 401 ? { unauthorized: true } : {}),
    };
  }
  return { ok: true, data: parsed as T };
}

/** `crypto.randomUUID` is available in every browser we support. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function requestOtp(phone: string): Promise<ApiResult<OtpRequestResult>> {
  return call<OtpRequestResult>('/auth/otp/request', { method: 'POST', body: { phone } });
}

export async function verifyOtp(
  phone: string,
  code: string,
  name?: string,
): Promise<ApiResult<CustomerSession>> {
  return call<CustomerSession>('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, ...(name === undefined || name.length === 0 ? {} : { name }) },
  });
}

export async function createBooking(
  token: string,
  request: CreateBookingRequest,
  idempotencyKey: string,
): Promise<ApiResult<BookingView>> {
  const result = await call<unknown>('/bookings', {
    method: 'POST',
    token,
    body: request,
    idempotencyKey,
  });
  if (!result.ok) return result;
  // POST /bookings returns the BookingView directly; the other routes wrap it
  // in `{ booking }`. Accept either so a controller tweak cannot break this.
  const payload =
    isRecord(result.data) && 'booking' in result.data ? result.data.booking : result.data;
  if (isBookingView(payload)) return { ok: true, data: payload };
  return { ok: false, message: UNREADABLE };
}

export async function listBookings(token: string): Promise<ApiResult<BookingView[]>> {
  const result = await call<unknown>('/bookings', { token });
  if (!result.ok) return result;
  if (isRecord(result.data) && Array.isArray(result.data.bookings)) {
    return { ok: true, data: result.data.bookings.filter(isBookingView) };
  }
  return { ok: false, message: UNREADABLE };
}

export async function getBooking(token: string, id: string): Promise<ApiResult<BookingView>> {
  const result = await call<unknown>(`/bookings/${encodeURIComponent(id)}`, { token });
  if (!result.ok) return result;
  const payload = isRecord(result.data) ? result.data.booking : null;
  if (isBookingView(payload)) return { ok: true, data: payload };
  return { ok: false, message: UNREADABLE };
}

export async function cancelBooking(
  token: string,
  id: string,
  reason?: string,
): Promise<ApiResult<BookingView>> {
  const result = await call<unknown>(`/bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    token,
    body: reason === undefined ? {} : { reason },
  });
  if (!result.ok) return result;
  const payload = isRecord(result.data) ? result.data.booking : null;
  if (isBookingView(payload)) return { ok: true, data: payload };
  return { ok: false, message: 'The booking was updated but we could not read the response.' };
}
