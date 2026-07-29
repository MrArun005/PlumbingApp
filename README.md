# PipeFix 🔧

**On-demand plumbing services marketplace for Indian metros.** Customers book
plumbing services; vetted independent plumbers ("Partners") fulfil them. The
differentiator is a **30-minute emergency SOS tier** with a hard SLA and an
automatic money-back guarantee. Launch city: Bengaluru.

> New here? Read in this order:
>
> 1. This README (5 min) — what and why
> 2. [`docs/STATE.md`](docs/STATE.md) — what's actually built right now
> 3. [`docs/PLAN.md`](docs/PLAN.md) — the full product & engineering plan
> 4. [`docs/BUILD-PROMPT.md`](docs/BUILD-PROMPT.md) — the engineering rules we build under

## The product in one diagram

```mermaid
flowchart LR
    C[Customer app] -->|books a service| B[Booking]
    B -->|payment confirmed| D[Dispatch engine]
    D -->|ranked offers, ring by ring| P[Partner app]
    P -->|accepts, OTP-verified arrival| J[Job on site]
    J -->|quote approved → work done| I[Invoice + GST]
    I -->|UPI / card / cash| M[Payment]
    M -->|take rate split| PO[Partner payout]
```

Four urgency tiers drive everything: **E0 SOS (≤30 min)** · **E1 Urgent (≤2 h)**
· **E2 Same-day** · **E3 Scheduled**. Emergency jobs pay a fee and can surge
(capped 2.0×); scheduled jobs pay the bills.

## How the repo is organised

```
packages/
  shared/     Money (bigint paise), env validation, error taxonomy, zod helpers
  db/         Prisma schema + migrations + seed          (WO-02)
  pricing/    PURE pricing engine — no DB, no clock      (WO-03)
  dispatch/   PURE partner ranking + ring logic          (WO-09)
apps/
  api/        NestJS backend                             (from WO-04)
  web/        Next.js marketing + booking                (later)
  admin/      Next.js ops console                        (later)
  customer-app/ partner-app/  React Native               (later)
docs/
  STATE.md          what is real today  ← always current
  WORK-ORDERS.md    the build queue and each WO's status
  DECISIONS.md      why non-obvious choices were made
  RUNBOOK.md        how to run and un-break things
```

**Why `pricing/` and `dispatch/` are "pure":** they take every input explicitly
(including the current time) and touch no database or network. That means the
exact production code path can be unit-tested and simulated offline —
you can replay a year of dispatch decisions on your laptop.

## Ground rules (the short version)

1. **Money is `bigint` paise.** Floats never touch currency. See `packages/shared/src/money.ts`.
2. **Status changes go through state machines.** Illegal jumps throw `InvalidTransitionError`.
3. **`JobTimelineEvent` is append-only** — it's the audit trail SLAs and disputes are judged from.
4. **Zod validates every boundary** (requests, webhooks, queue payloads). Types come from schemas.
5. **Idempotency keys on every mutating public endpoint.**
6. **All business time is IST** (`Asia/Kolkata`), stored as UTC.
7. **Structured logs only** — `no-console` is a lint _error_.

The full, binding list is in [`docs/BUILD-PROMPT.md`](docs/BUILD-PROMPT.md).

## Quickstart

```bash
pnpm install
pnpm infra:up        # Postgres 16 + PostGIS, Redis 7 (Docker)
pnpm build && pnpm test
```

More in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
