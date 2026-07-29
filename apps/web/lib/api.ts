/**
 * Server-side reads of the PUBLIC catalogue endpoints.
 *
 * `GET /catalog/*` needs no session, so these run on the server (good for SEO
 * and for a fast first paint on a cheap Android phone). Authenticated calls do
 * NOT belong here — they live in `lib/client-api.ts` and run in the browser
 * with the customer's access token.
 *
 * Degradation contract: this module never throws and never hangs. If the API is
 * down, slow, or returns something unexpected, it falls back to the bundled
 * sample catalogue and reports `source: 'sample'` so the page can say so out
 * loud. A reviewer must always be able to tell live data from sample data.
 */
import type { CategoryView, ServiceView } from './types';
import { SAMPLE_CATEGORIES, SAMPLE_SERVICES, sampleService } from './sample-data';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Keep this short: a dead API must not hold up the page. */
const TIMEOUT_MS = 3000;

export type DataSource = 'api' | 'sample';

export interface Loaded<T> {
  data: T;
  source: DataSource;
  /** Human-readable reason we fell back. Present only when source === 'sample'. */
  reason?: string;
}

export type ServiceResult =
  | { status: 'ok'; service: ServiceView; source: DataSource; reason?: string }
  | { status: 'not-found'; source: DataSource; reason?: string };

interface FetchOutcome {
  ok: boolean;
  status: number;
  body: unknown;
  reason?: string;
}

async function getJson(path: string): Promise<FetchOutcome> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        body: null,
        reason: `API returned HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, body: (await res.json()) as unknown };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? `no response within ${TIMEOUT_MS / 1000}s`
        : 'could not connect';
    return { ok: false, status: 0, body: null, reason };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structural check, not a full schema validation: enough to be sure we are not
 * about to render `undefined`, and cheap enough to run on every request. If the
 * API ever changes shape this fails closed into the sample fallback.
 */
function isServiceView(value: unknown): value is ServiceView {
  if (!isRecord(value)) return false;
  const price = value.price;
  if (!isRecord(price)) return false;
  return (
    typeof value.sku === 'string' &&
    typeof value.name === 'string' &&
    typeof value.categoryCode === 'string' &&
    typeof value.inspectFirst === 'boolean' &&
    typeof price.kind === 'string' &&
    typeof price.headline === 'string' &&
    typeof price.note === 'string' &&
    typeof price.visitChargeLabel === 'string'
  );
}

function isCategoryView(value: unknown): value is CategoryView {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.serviceCount === 'number'
  );
}

export async function loadCategories(): Promise<Loaded<CategoryView[]>> {
  const out = await getJson('/catalog/categories');
  if (out.ok && isRecord(out.body) && Array.isArray(out.body.categories)) {
    const categories = out.body.categories.filter(isCategoryView);
    if (categories.length > 0) return { data: categories, source: 'api' };
    // An empty live catalogue is a real answer, not a failure — say so.
    return { data: [], source: 'api' };
  }
  return {
    data: SAMPLE_CATEGORIES,
    source: 'sample',
    reason: out.reason ?? 'API sent an unexpected response',
  };
}

export async function loadServices(categoryCode?: string): Promise<Loaded<ServiceView[]>> {
  const query = categoryCode === undefined ? '' : `?category=${encodeURIComponent(categoryCode)}`;
  const out = await getJson(`/catalog/services${query}`);
  if (out.ok && isRecord(out.body) && Array.isArray(out.body.services)) {
    return { data: out.body.services.filter(isServiceView), source: 'api' };
  }
  const sample =
    categoryCode === undefined
      ? SAMPLE_SERVICES
      : SAMPLE_SERVICES.filter((s) => s.categoryCode === categoryCode);
  return {
    data: sample,
    source: 'sample',
    reason: out.reason ?? 'API sent an unexpected response',
  };
}

export async function loadService(sku: string): Promise<ServiceResult> {
  const out = await getJson(`/catalog/services/${encodeURIComponent(sku)}`);
  if (out.ok && isRecord(out.body) && isServiceView(out.body.service)) {
    return { status: 'ok', service: out.body.service, source: 'api' };
  }
  // A live 404 is authoritative: the SKU really is not in this city's catalogue.
  if (out.status === 404) return { status: 'not-found', source: 'api' };

  const fallback = sampleService(sku);
  const reason = out.reason ?? 'API sent an unexpected response';
  if (fallback === undefined) return { status: 'not-found', source: 'sample', reason };
  return { status: 'ok', service: fallback, source: 'sample', reason };
}
