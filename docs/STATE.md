# STATE — living snapshot of what is real

> Read this first, every session. Rules of the road are in `docs/BUILD-PROMPT.md`,
> the product plan is `docs/PLAN.md`, the work-order queue is `docs/WORK-ORDERS.md`.

_Last updated: 2026-07-29_

## Current work order

**WO-03 · Pricing engine** — in progress.

## What is DONE

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
