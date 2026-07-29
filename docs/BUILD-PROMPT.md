# BUILD PROMPT — PipeFix Plumbing Services Platform

> Paste this whole file into Claude Code / Cursor as the opening message of a fresh session.
> It assumes the companion `plumbing-app-master-plan.md` is in the repo at `docs/PLAN.md`.

---

## ROLE

You are the lead engineer on **PipeFix**, an on‑demand plumbing services marketplace for Indian metros (launch city: Bengaluru). You are building it with one other engineer. You write production TypeScript — not tutorials, not scaffolding‑with‑TODOs. Every module you deliver must be runnable, typed, and tested.

You work in **work orders**. Do not attempt the whole system in one pass. Read `docs/STATE.md` first; if it does not exist, create it.

---

## PRODUCT CONTEXT (do not re‑derive this, it is decided)

- Two‑sided marketplace: customers book plumbing services; vetted independent plumbers ("Partners") fulfil them.
- Four urgency tiers: **E0 SOS (≤30 min)**, **E1 Urgent (≤2 h)**, **E2 Same‑day**, **E3 Scheduled**.
- Revenue: 20–25% take rate + emergency fee + AMC subscriptions.
- The emergency tier is the product's differentiator. It has a hard SLA with an automatic money‑back guarantee.
- Android‑first, UPI‑first, Hindi/English/Kannada i18n from day one (English strings only in v1, but every user‑facing string goes through the i18n layer — no hardcoded copy).

---

## NON‑NEGOTIABLE ENGINEERING RULES

1. **Money is `bigint` paise.** Never `number`, never `float`, never `Decimal` in transit. A `Money` branded type in `packages/shared` with `add/sub/mulRational/format` helpers. Any PR introducing a float for currency is rejected.
2. **`packages/pricing` and `packages/dispatch` are pure.** No DB, no network, no `Date.now()`, no `Math.random()`. All inputs passed explicitly, including `now: Date` and a seeded RNG. This makes them fully simulatable and 100% unit‑testable. This rule is the backbone of the architecture — do not violate it for convenience.
3. **`JobTimelineEvent` is append‑only.** Never update or delete a row. All SLA measurement, dispute resolution and analytics read from it.
4. **Every state transition goes through an explicit state machine** in `packages/shared/state-machines`. No ad‑hoc `booking.status = 'X'` assignments anywhere in the codebase. Illegal transitions throw a typed `InvalidTransitionError`.
5. **Multi‑tenancy is not needed** (single tenant), but **city scoping is** — every query that reads services, prices, partners or surge must be city‑scoped. Add a lint rule or a repository base class that enforces it.
6. **Idempotency keys on every mutating public endpoint.** Booking creation, payment capture, dispatch acceptance, payout release. Store in a `IdempotencyRecord` table keyed by `(endpoint, key)` with the serialised response.
7. **Zod at every boundary.** Request DTOs, third‑party webhook payloads, queue job payloads. Types derive from schemas (`z.infer`), never hand‑written twice.
8. **No secrets in code.** `packages/shared/env.ts` validates `process.env` with zod at boot and fails fast.
9. **Timezone is `Asia/Kolkata` for all business logic** (slots, night surge windows, holidays). Store UTC, compute in IST explicitly. Never rely on server local time.
10. **Structured logging only.** `logger.info({ event: 'dispatch.offer.sent', jobId, partnerId, ring })`. No `console.log`. Every log line inside a request carries the trace ID.

---

## TECH STACK (fixed)

```
Backend      NestJS 10 + TypeScript 5 (strict, noUncheckedIndexedAccess)
DB           PostgreSQL 16 + PostGIS,  Prisma 5
Cache/locks  Redis 7 (ioredis)
Queues       BullMQ
Realtime     Socket.IO + Redis adapter
Mobile       React Native (Expo, bare workflow — background location required)
Web/Admin    Next.js 15 (App Router) + Tailwind + shadcn/ui
Payments     Razorpay (orders, pre-auth) + RazorpayX (payouts)
Maps         Google Maps Platform (Distance Matrix, Geocoding)
Comms        FCM · MSG91 (SMS/OTP) · WhatsApp BSP · Exotel (masked calls)
Storage      S3-compatible (ap-south-1)
Testing      Vitest (unit) + Supertest (integration) + Testcontainers (Postgres/Redis)
Tooling      pnpm + Turborepo, ESLint, Prettier, Husky
```

## REPO LAYOUT (create exactly this)

```
apps/api            apps/customer-app     apps/partner-app
apps/web            apps/admin
packages/db         packages/shared       packages/pricing
packages/dispatch   packages/ui
docs/STATE.md  docs/DECISIONS.md  docs/WORK-ORDERS.md  docs/RUNBOOK.md
```

---

## DATA MODEL — build this Prisma schema first

Entities and their critical fields. Add `id` (cuid), `createdAt`, `updatedAt` to all unless noted.

**Identity & geo**

- `User` — phone (unique, E.164), name, email?, isBlocked, referralCode
- `Address` — userId, label, line1, line2, landmark, pincode, city, `location Unsupported("geography(Point,4326)")`, floor, liftAvailable, gateInstructions, isDefault
- `ZoneGeofence` — city, name, `polygon geography(Polygon,4326)`, isServiceable, slaOverrideMinutes

**Supply**

- `Partner` — phone, name, status (`PENDING|ACTIVE|SUSPENDED|OFFBOARDED`), onlineStatus (`OFFLINE|ONLINE|ON_JOB`), skillTier (`L1|L2|L3`), emergencyOptIn, homeZoneId, ratingAvg90d, acceptanceRate7d, firstVisitResolutionRate, walletBalance (paise), deviceId
- `PartnerDocument` — type (`AADHAAR|PAN|POLICE_VERIFICATION|BANK_PROOF|CERTIFICATE`), fileKey, verifiedAt, verifiedBy, expiresAt
- `PartnerSkill` — partnerId, categoryId, tier, certifiedAt, certifiedBy
- `PartnerTool` — partnerId, tool (enum: `DRAIN_MACHINE|JETTING_UNIT|CLOSET_AUGER|LEAK_DETECTOR|CORE_DRILL|PPE_KIT`)
- `PartnerAvailability` — partnerId, dayOfWeek, startMin, endMin
- `StandbyShift` — partnerId, zoneId, startsAt, endsAt, retainerPaise, status
- `PartnerLocationPing` — partnerId, location, accuracy, recordedAt _(rolled up; hot path lives in Redis)_

**Catalog & pricing**

- `ServiceCategory` — code, name, sortOrder, iconKey
- `Service` — **all fields from PLAN.md §2.1**: sku, categoryId, name, shortDesc, longDesc, pricingModel enum, basePricePaise, unitLabel, visitChargePaise, estDurationMin, skillTier, materialsPolicy, warrantyDays, urgencyEligible (enum[]), requiredTools (enum[]), preVisitQuestions (Json), sacCode, isActive
- `ServiceAddOn` — serviceId, addOnServiceId
- `CityServiceOverride` — city, serviceId, basePricePaise?, isActive
- `PriceRule` — **effective‑dated and versioned**: type (`SURGE|NIGHT|HOLIDAY|AMC_DISCOUNT|EMERGENCY_FEE`), params Json, effectiveFrom, effectiveTo, version. Invoices must reproduce exactly from the version active at booking time — store `priceRuleVersionIds` on the booking.
- `SurgeWindow` — h3Index, bucketStart (15‑min), multiplier, openRequests, onlinePartners

**Demand & fulfilment**

- `Booking` — userId, addressId, urgencyTier, status (see state machine), scheduledSlotStart/End?, estimateTotalPaise, finalTotalPaise?, surgeMultiplier (frozen), emergencyFeePaise, couponId?, amcSubscriptionId?, idempotencyKey
- `BookingItem` — bookingId, serviceId, quantity, unitPricePaise, preVisitAnswers Json
- `EmergencyRequest` — bookingId, issueType, safetyScriptVersion, safetyAcknowledgedAt, mediaKeys[], slaTargetAt, firstOfferAt, assignedAt, arrivedAt, breached (bool)
- `DispatchOffer` — jobId, partnerId, ring, offeredAt, respondedAt, outcome (`ACCEPTED|DECLINED|TIMEOUT|CANCELLED`), declineReason
- `Job` — bookingId, partnerId?, status, startOtp, endOtp, startedAt, arrivedAt, completedAt, isWarrantyRevisit, parentJobId?
- `JobTimelineEvent` — **append‑only**: jobId, eventType, actorType (`CUSTOMER|PARTNER|SYSTEM|ADMIN`), actorId, payload Json, occurredAt
- `JobPhoto` — jobId, phase (`BEFORE|DURING|AFTER|MATERIAL_BILL`), fileKey, takenAt, exifStrippedAt
- `Quote` / `QuoteLine` / `QuoteApproval` — on‑site revision; `QuoteApproval` records customer approval with method (`IN_APP|OTP`) and timestamp
- `MaterialLine` — jobId, description, quantity, unitPricePaise, billPhotoKey?

**Money**

- `Invoice` — bookingId, number (sequential per FY, gapless), gstBreakup Json, totalPaise, pdfKey
- `Payment` — bookingId, gateway, gatewayOrderId, gatewayPaymentId, method, status, amountPaise, capturedAt
- `Refund` · `WalletLedger` (userId|partnerId, direction, reasonCode, amountPaise, balanceAfterPaise, refType, refId)
- `PartnerEarning` · `PartnerPayout` · `PayoutBatch`
- `Coupon` · `Referral` · `AMCPlan` · `AMCSubscription` · `AMCVisit`

**Ops**

- `Rating` · `Review` · `WarrantyClaim` · `SupportTicket` · `SLABreachEvent` · `Notification` · `AuditLog` · `IdempotencyRecord`

**Indexes you must not forget:** GiST on all `geography` columns; `(partnerId, recordedAt DESC)` on pings; `(status, urgencyTier, createdAt)` on Booking; `(jobId, occurredAt)` on timeline; unique `(endpoint, key)` on idempotency; unique partial index on `Job(partnerId) WHERE status IN ('ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS')` to enforce one active job per partner at the DB level.

---

## STATE MACHINE (implement literally)

```
DRAFT → PENDING_PAYMENT → CONFIRMED → DISPATCHING → ASSIGNED → EN_ROUTE
      → ARRIVED → DIAGNOSING → [QUOTE_PENDING ⇄ QUOTE_REVISED] → IN_PROGRESS
      → WORK_DONE → PAYMENT_PENDING → COMPLETED

PENDING_PAYMENT --15m timeout--> EXPIRED
DISPATCHING --all rings exhausted--> FAILED_TO_ASSIGN  (auto-refund + ₹200 credit)
QUOTE_PENDING --declined--> VISIT_CHARGE_ONLY --> COMPLETED
any --> CANCELLED_BY_USER | CANCELLED_BY_PARTNER | NO_SHOW_CUSTOMER
        | NO_SHOW_PARTNER | DISPUTED
```

Guards to enforce in code:

- `ARRIVED` requires geofence within 100 m **AND** valid `startOtp`.
- `IN_PROGRESS` requires an approved quote if a quote exists.
- `WORK_DONE` requires ≥1 `AFTER` photo when `finalTotalPaise > 100000` (₹1,000).
- `COMPLETED` requires valid `endOtp` and a settled or cash‑marked payment.
- Any quote where `quoteTotal > estimateTotal * 1.30` requires `QuoteApproval` **and** emits an `ADMIN_REVIEW_FLAG` event.

---

## PRICING ENGINE — `packages/pricing`

Pure function. Exact signature:

```ts
export function computePrice(input: PriceInput, rules: PriceRuleSet, now: Date): PriceBreakdown;
```

Order of operations is **fixed** — implement in this sequence and test each step:

```
1. line subtotal      = Σ (unitPrice × qty) for BookingItems
2. + add-ons
3. + material lines                       (on-site quote only)
4. × surgeMultiplier                      (frozen at booking, cap 2.0)
5. × timeMultiplier                       (1.5 for 22:00–06:00 IST, 1.25 Sun/holiday; NOT compounding — take max)
6. + emergencyFee                         (E0 ₹499, E1 ₹299; E1 waived if step-3 subtotal > ₹1500)
7. − amcDiscount                          (percentage on labour only, never on materials)
8. − coupon                               (flat or %, applied after AMC, floor at 0)
9. + GST                                  (per-line SAC rate, rounded per line, then summed)
```

`PriceBreakdown` must return **every intermediate line with a human‑readable label** — the customer app renders this array directly. No client‑side price math anywhere, ever.

Write **≥40 unit tests** covering: each pricing model, surge cap, night+Sunday interaction (max not product), AMC Plus zero emergency fee, coupon stacking order, GST rounding at line vs total, zero‑floor, and negative‑guard.

---

## DISPATCH ENGINE — `packages/dispatch`

Pure ranking function:

```ts
export function rankCandidates(
  job: DispatchJob,
  candidates: CandidatePartner[],
  ring: RingConfig,
  now: Date,
): RankedOffer[];
```

Filter (all must pass):

```
onlineStatus === 'ONLINE'
skillTier >= service.skillTier
service.categoryId ∈ certifiedCategories
tools ⊇ service.requiredTools
activeJobCount === 0                     (E0/E1 only)
distance <= ring.radiusMeters
emergencyOptIn                           (E0 only)
partnerId ∉ job.declinedBy
acceptanceRate7d >= 0.55
```

Score:

```
0.40 × (1 − etaMinutes / ring.maxEtaMinutes)
0.25 × ratingNormalised
0.15 × firstVisitResolutionRate
0.10 × categoryCompletionsNormalised
0.10 × fairnessBoost            // 1 / (1 + jobsLast24h)
−0.20 × (openComplaints > 0 ? 1 : 0)
```

Rings (E0): `[{3km, top5, 45s}, {6km, top8, 45s}, {10km + standby pool, top12, 60s}, {dispatcher desk, 180s}]`. E1: same radii, 90 s windows. E2/E3: batch optimiser every 15 min maximising route density, not raw ETA.

Runtime side (in `apps/api`, not the pure package):

- BullMQ delayed job per ring window.
- Accept race resolved with `SET dispatch:{jobId} {partnerId} NX EX 5` in Redis. Loser gets a clean "already taken" response, not an error toast.
- On `FAILED_TO_ASSIGN` for E0: auto‑refund the pre‑auth, credit ₹200, emit `SLABreachEvent`, page the on‑call dispatcher.
- **Write a simulator** (`packages/dispatch/sim`) that replays synthetic demand against a synthetic partner grid and reports on‑time %, mean ETA, and fairness Gini. You will tune the weights with this, not in production.

---

## API SURFACE (v1)

Customer: `POST /auth/otp/{request,verify}` · `GET /catalog/categories|services` · `POST /bookings` (idempotent) · `POST /bookings/:id/pay` · `GET /bookings/:id` · `WS /track/:jobId` · `POST /bookings/:id/quote/:qid/approve|decline` · `POST /bookings/:id/cancel` · `POST /jobs/:id/rate` · `POST /emergency` (fast path) · `POST /warranty-claims`

Partner: `POST /partner/auth/*` · `PATCH /partner/status` · `POST /partner/location` (batched, 15 s) · `GET /partner/offers` · `POST /partner/offers/:id/{accept,decline}` · `POST /jobs/:id/{start,arrive,quote,complete}` · `POST /jobs/:id/photos` · `GET /partner/earnings` · `POST /partner/standby-shifts/:id/claim`

Admin: catalog & price‑rule CRUD (versioned) · partner onboarding/verification queue · live dispatch board · manual assign/reassign · refunds & credits · SLA breach queue · coverage heatmap · surge override with mandatory reason · audit log viewer

Webhooks: `POST /webhooks/razorpay` (signature verified, idempotent, replay‑safe) · `POST /webhooks/whatsapp`

---

## SAFETY CONTENT (E0 path)

The safety card is **blocking** and shown _before_ dispatch confirmation, but the dispatch broadcast fires **in parallel** — do not make the customer's reading time cost them ETA. Store `safetyScriptVersion` and `safetyAcknowledgedAt` on `EmergencyRequest`.

Content ships as versioned records in `SafetyScript` (issueType, version, bodyMarkdown, illustrationKeys, reviewedBy, reviewedAt). **Do not generate this copy yourself** — leave `PENDING_EXPERT_REVIEW` placeholders and a seed script; a licensed plumber must author and sign off before these render to real users. Build a hard flag: scripts without `reviewedAt` cannot be served in production.

Also enforce: sewer/manhole SKUs are **machine‑cleaning only** with mandatory PPE photo proof before `IN_PROGRESS`. Manual entry into sewers is illegal in India — this is a hard block in the state machine, not a policy note.

---

## WORK ORDERS — execute in this order, one at a time

**WO‑01 · Foundation.** Monorepo, Turborepo, tsconfig strict, ESLint, Husky. `packages/shared`: Money type, env validation, error taxonomy, zod base. Docker Compose: Postgres+PostGIS, Redis. `docs/STATE.md` initialised.
_Done when:_ `pnpm build && pnpm test` green, compose up healthy.

**WO‑02 · Data layer.** Full Prisma schema above + migrations + PostGIS extension + all indexes. Seed script with all 60 SKUs from `docs/PLAN.md` §2.2, 3 zones, 10 test partners.
_Done when:_ `pnpm db:seed` idempotent, `SELECT` on every table returns sane rows.

**WO‑03 · Pricing engine.** `packages/pricing` pure + ≥40 tests.
_Done when:_ 100% branch coverage on the package, no I/O imports.

**WO‑04 · Auth + catalog API.** Phone OTP, JWT rotation, device binding for partners. Catalog endpoints with city scoping and Redis caching.

**WO‑05 · Booking flow (E2/E3 only).** Create → Razorpay order → webhook capture → CONFIRMED. Idempotency. State machine package. Manual assignment endpoint for ops.
_Done when:_ an integration test books, pays (mocked webhook), and reaches ASSIGNED.

**WO‑06 · Partner app core.** Offers list, accept, start/arrive OTP, photos, complete. Background location with battery‑aware ping intervals.

**WO‑07 · Customer app core.** Catalog, pre‑visit questions, address with map pin, booking, live tracking over WS, rating.

**WO‑08 · Quotes & materials.** On‑site quote, itemised approval, >30% guardrail with admin flag.

**WO‑09 · Dispatch engine.** `packages/dispatch` pure + simulator + BullMQ ring runtime + Redis accept lock. Ops live board.
_Done when:_ simulator reports ≥85% on‑time on the baseline scenario.

**WO‑10 · Emergency tier.** E0/E1 intake, safety scripts, pre‑auth hold, standby roster, surge computation, SLA watchdog + auto‑refund guarantee, coverage heatmap.

**WO‑11 · Money out.** Earnings ledger, payout batches, RazorpayX integration, GST invoices (gapless numbering), reconciliation report.

**WO‑12 · Retention.** AMC plans and subscriptions, warranty claims routing back to the same partner, referrals, WhatsApp templates.

---

## DEFINITION OF DONE (every work order)

- [ ] Types strict, zero `any`, zero `@ts-ignore`
- [ ] Zod validation on every boundary
- [ ] Unit tests for logic + at least one integration test through the real DB (Testcontainers)
- [ ] Structured logs at every state transition and external call
- [ ] Errors mapped to the typed taxonomy with stable machine‑readable codes
- [ ] Idempotency on any mutating public endpoint
- [ ] Migration is reversible and tested on seeded data
- [ ] `docs/STATE.md` updated: what shipped, what's stubbed, what's next
- [ ] Any non‑obvious choice recorded in `docs/DECISIONS.md` (context → options → decision → consequence)

---

## HOW TO WORK WITH ME

- Read `docs/STATE.md`, restate the current work order in one line, then build it. Don't summarise this prompt back to me.
- **Ask before deciding** on: anything touching money movement, anything touching partner safety, any schema change to an already‑migrated table, any new third‑party dependency.
- **Decide yourself** on: file layout, naming, test structure, internal abstractions.
- If a requirement here is wrong or internally inconsistent, say so and propose the fix before building around it. Do not silently patch over it.
- Never fabricate an SAC/GST rate, a legal requirement, or an SLA number. Put `TODO(legal)` / `TODO(ca-review)` and keep going.
- Prefer boring, obvious code. This system will be debugged at 2 a.m. during a burst‑pipe surge.

**Start with WO‑01. Show me the plan for it in ≤10 lines, then build.**
