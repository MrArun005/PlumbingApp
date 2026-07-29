# STATE — living snapshot of what is real

> Read this first, every session. Rules of the road are in `docs/BUILD-PROMPT.md`,
> the product plan is `docs/PLAN.md`, the work-order queue is `docs/WORK-ORDERS.md`.

_Last updated: 2026-07-29_

## Current work order

**WO-06/07 · Partner + customer apps** — customer web UI in progress.

## What is DONE

- **WO-08 · On-site quotes + materials** ✅ — the inspect-first price loop
  - Partner job flow: start → arrive → diagnose → quote → begin-work →
    finish-work → complete, every hop through `jobMachine`. Arrival needs the
    customer's code **and** a real PostGIS distance check.
  - Quotes: itemised labour + material lines priced by the pure engine, bill
    photo required on materials over ₹500, **ADMIN_REVIEW_FLAG** event when a
    quote exceeds an up-front estimate by >30%, approve makes the quoted total
    the booking's real total, decline charges only the visit charge.
  - Sewer/manhole PPE block verified through the real API: refused → upload
    proof → allowed.
  - Only a PENDING quote is actionable (D-012) — a superseded quote cannot be
    approved.
  - 20 integration tests. **Known gap:** file uploads take a `fileKey` string;
    real S3/R2 presigned upload is not wired yet.

- **WO-05 · Booking flow (E2/E3)** ✅
  - **State machines** in `packages/shared/state-machines`: booking + job
    lifecycles declared explicitly, illegal moves throw
    `InvalidTransitionError`. Guards are pure and executable — 100 m arrival
    geofence, start/end OTP, quote-approval-before-work, after-photo above
    ₹1,000, settled payment before completion, and the **sewer/manhole PPE hard
    block** (manual entry is illegal in India; not overridable). 42 tests.
  - **Two pricing paths.** `UPFRONT` computes a full frozen estimate and takes
    payment first. **`INSPECT_FIRST` quotes no amount at all** — estimate is
    null, unit prices are null, booking confirms with nothing to pay, and the
    price arrives as an on-site quote the customer approves. Forced on for
    INSPECTION_FIRST / QUOTE_ONLY SKUs regardless of what the client asks.
  - **Idempotency** on every mutating endpoint via claim-then-execute (D-011),
    proven by a concurrency test that counts rows.
  - Payments behind a `PaymentGateway` seam (stub today; production boot
    **refuses to start** without a real gateway), replay-safe Razorpay webhook
    with signature verification, manual ops assign creating the Job + append-only
    timeline entry.
  - 27 booking tests; 62 API tests total, repeatable with zero DB residue.
    Walked live: both pricing paths, and book → pay → webhook → ASSIGNED.

- **WO-04 · Auth + catalog API** ✅
  - `apps/api` (NestJS 10): phone-OTP auth (hashed codes in Redis, single-use,
    attempt-limited, per-phone rate limit), JWT access + **rotating single-use
    refresh tokens with replay detection** (a replayed token revokes the whole
    session family), customer self-registration, partner gating on ACTIVE +
    **device binding**.
  - Catalog: city-scoped reads honouring `CityServiceOverride`, versioned Redis
    cache, and a `priceDisplay` contract so **INSPECTION_FIRST / QUOTE_ONLY
    services expose no job price at all** — only the visit charge plus copy
    about approving the on-site quote. No client ever does price math.
  - Structured logs with per-request trace ids (AsyncLocalStorage), error
    taxonomy → HTTP filter, `/health`.
  - 35 integration tests on real Postgres + Redis. Verified by hand: server
    boots, `/health` ok, OTP → session → rotate → replay-rejected walked live.
  - **Two bugs caught by these tests and fixed** (see DECISIONS D-007/D-008):
    refresh-reuse detection never fired; a global CustomerGuard 403'd every
    partner route.

- **WO-03 · Pricing engine** ✅
  - `packages/pricing`: pure `computePrice(input, rules, now)` implementing the
    fixed 9-step sequence; per-line multipliers/discount allocation
    (largest-remainder, sums exact) so per-line GST is invoice-reproducible.
  - IST helpers (fixed +05:30, no Intl); night window wraps midnight;
    night vs Sunday/holiday takes MAX, never the product.
  - Surge frozen+capped (AMC Plus cap honoured), E1 fee waiver strictly
    `> ₹1500`, AMC discount labour-only, coupon after AMC with zero floor.
  - 54 tests, **100% statement/branch/function/line coverage** (enforced via
    vitest thresholds in `test:cov`); purity proven by Date.now/Math.random
    throw-spies. Deps: only `@pipefix/shared` + zod — no I/O imports.

- **WO-02 · Data layer** ✅
  - `packages/db`: full Prisma 5 schema — 40+ models, all money as BigInt
    paise, multipliers as `…X100` ints, `JobTimelineEvent` append-only
    (no updatedAt), PostGIS `geography` columns on Address / ZoneGeofence /
    PartnerLocationPing.
  - Migration `20260729134216_init`: PostGIS extension, GiST indexes on all
    geography columns, partial unique index `Job_one_active_per_partner`
    (widened to all on-site states — DECISIONS D-005).
  - Idempotent seed: 10 categories, **74 SKUs** (PLAN §2.2 anchors), 3
    Bengaluru zone polygons, 10 ACTIVE partners (skills/tools/Mon–Sat
    availability), 2 AMC plans, 5 versioned price rules, 5 safety-script
    drafts (reviewedAt=NULL ⇒ never servable), 2 test users with geocoded
    addresses, 1 coupon.
  - 9 integration tests against real Postgres (skip cleanly when DB is down),
    incl. ST_Covers zone containment and the DB-level active-job guard.
  - Verified: seed ran 3× with stable counts; `pnpm build && pnpm test` green.

- **WO-01 · Foundation** ✅
  - pnpm + Turborepo monorepo, TypeScript strict + `noUncheckedIndexedAccess`,
    ESLint (flat, `no-console` = error), Prettier, Husky pre-commit.
  - `packages/shared`: branded `Money` (bigint paise) with
    `add/sub/sum/mulRational/format/maxZero`, zod env validation (fail-fast),
    typed error taxonomy (incl. `InvalidTransitionError`), zod boundary helpers
    (`parseOrThrow`, Indian phone/PIN, `paiseAmount`). All unit-tested.
  - `docker-compose.yml`: Postgres 16 + PostGIS, Redis 7, healthchecks.
  - Verified: `pnpm build && pnpm test` green; `docker compose up -d --wait` healthy.

## What is MOCKED / STUBBED

- Nothing yet — no app code exists beyond `packages/shared`.

## What is NOT built yet

- `apps/api`, `apps/web`, `apps/admin`, customer/partner apps (arrive with their WOs).
- `packages/db` (WO-02), `packages/pricing` (WO-03), `packages/dispatch` (WO-09).

## Gotchas for the next session

- Local infra: `pnpm infra:up` (Docker must be running: `nohup dockerd &` in this
  cloud container).
- Money is `bigint` paise everywhere. If you find yourself writing `number` for
  currency, stop — see `packages/shared/src/money.ts`.
- App dirs are created only when their work order starts (see DECISIONS.md D-001).
