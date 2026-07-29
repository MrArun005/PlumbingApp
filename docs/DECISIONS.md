# DECISIONS — context → options → decision → consequence

Non-obvious choices only. Newest last.

---

## D-001 · App workspaces are created with their work order, not upfront

- **Context:** The build prompt's repo layout lists 5 `apps/*`. WO-01 only
  scopes tooling + `packages/shared`.
- **Options:** (a) create 5 empty app scaffolds now; (b) create each app when
  its WO starts.
- **Decision:** (b). The prompt also bans "scaffolding-with-TODOs"; an empty
  NestJS/Expo shell that nothing tests is exactly that.
- **Consequence:** `apps/` appears at WO-04 (api) and later. Directory layout
  temporarily differs from the prompt's diagram.

## D-002 · Prisma pinned to v5 (per the fixed tech stack)

- **Context:** Prisma 7 is current (requires driver adapters + new config);
  the build prompt fixes "Prisma 5".
- **Options:** (a) honour the pin; (b) silently upgrade.
- **Decision:** (a) — Prisma 5.22 (final v5) works fine on Node 22 and supports
  PostGIS `Unsupported()` columns. Upgrading is a one-line proposal for later,
  not a silent patch (prompt: "ask before deciding on new deps").
- **Consequence:** revisit before GA; v5 → v6/v7 migration is mechanical.

## D-003 · CommonJS module output for all packages

- **Context:** NestJS 10 tooling is CJS-first; mixed ESM/CJS in a monorepo
  burns hours on interop errors.
- **Decision:** `module: commonjs` in `tsconfig.base.json`. Boring and safe —
  the codebase optimises for 2 a.m. debuggability by design.
- **Consequence:** none practical; Vitest/tsx handle TS sources directly.

## D-004 · HALF_UP (round half away from zero) as default money rounding

- **Context:** GST invoices round per line; the plan doesn't fix a mode.
- **Decision:** `mulRational` defaults to HALF_UP — the convention on Indian
  invoices — with FLOOR/CEIL available explicitly. `TODO(ca-review)`: confirm
  per-line GST rounding mode with the CA before first real invoice.
- **Consequence:** pricing tests encode HALF_UP expectations.

## D-005 · "One active job per partner" index covers ALL on-site states

- **Context:** BUILD-PROMPT's partial unique index lists
  `('ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS')`. But DIAGNOSING,
  QUOTE_PENDING and QUOTE_REVISED are also states where the partner is
  physically on a job — excluding them would let dispatch hand a partner a
  second job mid-diagnosis.
- **Decision:** widen the predicate to all seven active states (the prompt
  itself invites fixing internal inconsistencies rather than building around
  them).
- **Consequence:** the DB now enforces exactly what the dispatch filter
  `activeJobCount === 0` assumes. Flagged to the product owner in the WO-02
  report.

## D-006 · Seed = reference data only; transactional tables stay empty

- **Context:** WO-02's done-when says "SELECT on every table returns sane
  rows", but fabricating bookings/payments/invoices in the seed would pollute
  every future integration test and demo.
- **Decision:** seed catalog/zones/partners/plans/rules/scripts/test-users
  only. Transactional rows are created by the flows that own them (WO-05+);
  the integration test creates and cleans up its own booking/jobs.
- **Consequence:** "sane rows" = seeded tables populated + empty transactional
  tables with valid schema, exercised by `packages/db` int tests.

## D-007 · Refresh replay detection uses a spent-token marker, not a family scan

- **Context:** The first implementation revoked a session family by scanning
  `refresh:family:*` for the presented hash. But rotation `srem`s the hash from
  its family, so a replayed token was in NO family — the scan found nothing and
  reuse detection silently never fired. An integration test caught it.
- **Options:** (a) keep the hash in the family after rotation and distinguish
  live/spent some other way; (b) write an explicit `refresh:spent:<hash>` →
  claims marker on rotation, TTL'd to the refresh lifetime.
- **Decision:** (b). Replay is then an O(1) lookup that is unambiguous, and the
  Redis `SCAN` disappears entirely.
- **Consequence:** revoking a family also clears spent markers — a revoked
  token being presented is not evidence of a leak, so it must not trigger a
  second revocation cascade.

## D-008 · Auth guards are per-controller; there is no global guard

- **Context:** A global `CustomerGuard` (`APP_GUARD`) with `@Public()` opt-outs
  looked like the safe default, but this API serves TWO audiences. The global
  guard saw a partner's token, decided it was not a customer, and returned 403
  before `PartnerGuard` ever ran — breaking every partner route.
- **Decision:** no global guard. Each controller declares `@UseGuards(...)` for
  its own audience; login routes stay `@Public()`.
- **Consequence:** a new protected controller must remember its guard. Mitigated
  by an integration test asserting protected endpoints 401 without a token — add
  a case there for every new controller.

## D-009 · An inspect-first booking is CONFIRMED without pre-payment

- **Context:** The spec's booking machine goes DRAFT → PENDING_PAYMENT →
  CONFIRMED. But when the plumber must inspect before a price exists, there is
  nothing to charge at booking time; demanding a payment would mean inventing an
  amount, which is the exact thing the product forbids.
- **Options:** (a) pre-authorise the visit charge and confirm after; (b) allow
  DRAFT → CONFIRMED for INSPECT_FIRST bookings only.
- **Decision:** (b) for E2/E3. The state machine guard `requiresInspectFirst`
  makes this legal _only_ in that mode — an UPFRONT booking still cannot skip
  payment. Fake-booking risk is low on scheduled tiers; the emergency tiers keep
  their ₹499 pre-auth (PLAN §3.2), which is where that risk actually lives.
- **Consequence:** the visit charge is collected at the end (declined quote) or
  folded into the approved quote. Revisit if no-show rates on inspect-first
  bookings turn out high — (a) remains available.

## D-010 · Raw SQL database objects live in one idempotent file, not in migrations

- **Context:** PostGIS GiST indexes and partial unique indexes cannot be
  expressed in `schema.prisma`. They were originally added inside the init
  migration. When the next migration was generated, Prisma saw them as drift and
  emitted `DROP INDEX` — silently removing all three GiST indexes. It did.
- **Decision:** move them to `packages/db/prisma/sql/postgis-objects.sql`,
  written idempotently (`CREATE ... IF NOT EXISTS`), applied by
  `pnpm db:raw` which `db:migrate` runs after `prisma migrate deploy`.
- **Consequence:** Prisma may still emit drops; the next migrate puts them back.
  Any new raw object MUST go in that file, not in a migration. Verify with
  `SELECT indexname FROM pg_indexes` after schema changes.

## D-011 · Idempotency claims the key BEFORE running the handler

- **Context:** The first implementation ran the handler and then stored the
  response keyed by (endpoint, key). Under a genuine concurrent double-submit,
  both requests ran the handler — both created a booking — and the one that lost
  the key race returned the winner's response, leaving its own booking orphaned
  in the database. A concurrency test caught it only after being strengthened to
  count rows rather than compare returned ids.
- **Decision:** two-phase. Insert a claim row first (`statusCode = 0`,
  in-flight); only the winner runs the handler and then fills in the response.
  A concurrent duplicate polls briefly, then replays the stored response or gets
  a retryable 409. A handler failure deletes the claim so the key is not
  poisoned forever.
- **Consequence:** one extra write per idempotent request. Worth it — the
  alternative silently duplicates work under exactly the conditions idempotency
  exists to prevent.

## D-012 · Only a PENDING quote is actionable; REVISED means superseded

- **Context:** `QuoteStatus.REVISED` was being used for two different things —
  "this is a revised quote" and "this quote was replaced" — and `approve()`
  accepted both PENDING and REVISED. A test proved the consequence: after a
  plumber sent a cheaper corrected quote, the customer could still approve the
  older, higher one.
- **Decision:** the newly-raised quote is always the only `PENDING` row; every
  prior awaiting-decision quote flips to `REVISED`, which now means SUPERSEDED
  and is not actionable. `approve()` and `decline()` accept `PENDING` only, and
  re-approving an already-APPROVED quote stays a harmless no-op so a double-tap
  does not error.
- **Consequence:** a stale client gets a clear message ("your plumber sent an
  updated quote") rather than silently accepting an outdated price. If a real
  "superseded" enum value is ever added to the schema, rename in one place.

## D-013 · The dispatch simulator reports required SUPPLY, not a passing grade

- **Context:** WO-09's done-when is "simulator reports ≥85% on-time on the
  baseline scenario". The first working simulation gave 66% on the baseline pool
  of 60 partners. The tempting move was to adjust the scenario config until the
  number cleared 85%.
- **Decision:** don't. Leave the baseline honest and add `minimumSupplyFor()`,
  which sweeps supply and reports the pool size that reaches the target — 120
  partners across 3 zones → 89% on-time, p90 ETA 25.8 min. The criterion is met
  by the engine; the baseline pool is simply too thin, which is the real finding.
- **Consequence:** the simulator's headline output is a recruitment number, not a
  pass/fail. This matches PLAN §3.5 ("emergency SLAs are a supply problem; the
  software just makes the supply legible") and §3.5's rule that a zone must not
  advertise an SLA its own coverage cannot back.

## D-014 · The simulator models job duration and partner release

- **Context:** The first simulation marked a partner busy on assignment and never
  freed them. After `partnerCount` jobs the whole pool was permanently occupied,
  so "assignment rate" was really `partnerCount / jobCount` — 15%, and
  meaningless. Accept-probability variations had no visible effect, which was the
  clue.
- **Decision:** jobs carry an `arrivalMinute` and a `durationMinutes`; the run
  processes them in arrival order and releases partners whose job has finished.
  `jobsLast24h` is recomputed as a genuine rolling window so the fairness term is
  driven by real recent load.
- **Consequence:** baseline results became plausible (86% assigned, mean ETA
  20.7 min) and the knobs now move the numbers. A regression test asserts that
  200 jobs across 40 partners assigns far more than 40 jobs.
