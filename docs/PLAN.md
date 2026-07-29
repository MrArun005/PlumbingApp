# PipeFix — On‑Demand Plumbing Services Platform

### Master Product & Engineering Plan (v1.0)

**Assumptions used** (change these and the rest cascades):

- Market: Indian metros, launch city **Bengaluru**, Android‑first, UPI‑first.
- Model: **two‑sided marketplace** — customers ↔ vetted independent plumbers ("Partners").
- Revenue: 20–25% take rate on job value + emergency convenience fee + AMC subscriptions.
- All ₹ figures below are **indicative anchors** for the pricing table seed. Calibrate against 3 local competitors before launch.

---

## 1. Product Definition

### 1.1 The wedge

Everyone does "book a plumber." The defensible wedge is **verified emergency response with a hard SLA**: a 30‑minute SOS tier backed by a paid standby roster, a money‑back guarantee, and an in‑app safety script that fires _before_ a plumber is even assigned. Scheduled jobs pay the bills; emergency wins the install and the word‑of‑mouth.

### 1.2 Three surfaces

| Surface             | Users                                      | Platform                                                                 |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| Customer App        | Homeowners, tenants, apartment RWA admins  | React Native (Android + iOS), plus Next.js web for SEO/booking           |
| Partner App         | Plumbers, helpers, crew leads              | React Native (Android‑only, low‑end device budget: 3 GB RAM, Android 9+) |
| Admin / Ops Console | Dispatchers, catalog ops, finance, support | Next.js web                                                              |

### 1.3 Non‑goals for v1

- No in‑app materials marketplace (partner buys, bills as line item).
- No multi‑crew scheduling / project management for large renovation jobs.
- No iOS partner app.
- No open API for third parties.

---

## 2. Service Catalog

### 2.1 Catalog schema

Every SKU carries these attributes. This is the single most important table in the product — get it right and pricing, dispatch, skill‑matching and invoicing all fall out of it.

| Field                             | Type        | Purpose                                                                           |
| --------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `sku`                             | string      | `PLB-<CAT>-<NNN>`                                                                 |
| `name`, `short_desc`, `long_desc` | text        | Display + SEO                                                                     |
| `category_id`                     | FK          | Grouping                                                                          |
| `pricing_model`                   | enum        | `FIXED` \| `FROM` \| `PER_UNIT` \| `HOURLY` \| `INSPECTION_FIRST` \| `QUOTE_ONLY` |
| `base_price`                      | int (paise) | Anchor price                                                                      |
| `unit_label`                      | string      | "per point", "per tap", "per 1000 L"                                              |
| `visit_charge`                    | int         | Charged if customer declines the quote                                            |
| `est_duration_min`                | int         | Feeds slot capacity + partner ETA                                                 |
| `skill_tier`                      | enum        | `L1` helper · `L2` plumber · `L3` senior/specialist                               |
| `materials_policy`                | enum        | `INCLUDED` \| `CONSUMABLES_ONLY` \| `EXCLUDED`                                    |
| `warranty_days`                   | int         | Labour warranty (default 30)                                                      |
| `urgency_eligible`                | enum[]      | Which emergency tiers this SKU can be booked under                                |
| `required_tools`                  | string[]    | Dispatch filter (e.g. `DRAIN_MACHINE`, `JETTING_UNIT`)                            |
| `pre_visit_questions`             | jsonb       | Diagnostic questionnaire (see 2.3)                                                |
| `add_ons`                         | sku[]       | Upsell at booking or on site                                                      |
| `sac_code`                        | string      | GST classification — **verify with your CA**                                      |
| `is_active`, `city_overrides`     | —           | Per‑city price/availability overrides                                             |

### 2.2 Full SKU list (seed data)

**LEAK — Leak & Pipe Repair**

| SKU          | Service                                 | Pricing          | ₹   | Dur     | Tier | Materials                    | SOS    |
| ------------ | --------------------------------------- | ---------------- | --- | ------- | ---- | ---------------------------- | ------ |
| PLB-LEAK-001 | Tap / faucet leak repair                | FROM             | 199 | 30m     | L2   | Consumables (washer, O‑ring) | E2     |
| PLB-LEAK-002 | Tap replacement (customer's tap)        | FIXED            | 249 | 30m     | L2   | Excluded                     | E2     |
| PLB-LEAK-003 | Visible pipe leak repair (CPVC/UPVC/GI) | FROM             | 349 | 45–90m  | L2   | Consumables                  | E1     |
| PLB-LEAK-004 | Concealed leak detection (wall/floor)   | INSPECTION_FIRST | 599 | 60–120m | L3   | —                            | E1     |
| PLB-LEAK-005 | Concealed pipe repair (post‑detection)  | QUOTE_ONLY       | —   | 2–6h    | L3   | Excluded                     | E1     |
| PLB-LEAK-006 | Joint / elbow leak sealing              | FROM             | 249 | 30m     | L2   | Consumables                  | E2     |
| PLB-LEAK-007 | **Burst pipe emergency repair**         | FROM             | 899 | 1–3h    | L3   | Consumables                  | **E0** |
| PLB-LEAK-008 | Water meter / inlet valve replacement   | FROM             | 349 | 45m     | L2   | Excluded                     | E1     |
| PLB-LEAK-009 | Stopcock / main valve replacement       | FIXED            | 399 | 45m     | L2   | Excluded                     | E1     |

**DRN — Drainage & Blockage**

| SKU         | Service                                 | Pricing | ₹    | Dur    | Tier | Tools           | SOS    |
| ----------- | --------------------------------------- | ------- | ---- | ------ | ---- | --------------- | ------ |
| PLB-DRN-001 | Kitchen sink unclogging (manual)        | FIXED   | 349  | 30–45m | L2   | —               | E2     |
| PLB-DRN-002 | Kitchen sink unclogging (drain machine) | FIXED   | 699  | 60m    | L2   | `DRAIN_MACHINE` | E1     |
| PLB-DRN-003 | Bathroom floor drain unclogging         | FIXED   | 399  | 45m    | L2   | —               | E2     |
| PLB-DRN-004 | WC blockage clearing                    | FIXED   | 499  | 45m    | L2   | `CLOSET_AUGER`  | E1     |
| PLB-DRN-005 | Sewer line jetting (external)           | FROM    | 1999 | 2–4h   | L3   | `JETTING_UNIT`  | E1     |
| PLB-DRN-006 | P‑trap / bottle trap replacement        | FIXED   | 399  | 45m    | L2   | Excluded        | E2     |
| PLB-DRN-007 | Balcony / terrace drain cleaning        | FIXED   | 399  | 45m    | L1   | —               | E3     |
| PLB-DRN-008 | **Sewage backflow emergency**           | FROM    | 1499 | 2–4h   | L3   | `JETTING_UNIT`  | **E0** |
| PLB-DRN-009 | Manhole / chamber cleaning              | FROM    | 1499 | 2h     | L3   | PPE kit         | E1     |

**BTH — Bathroom Fittings**

| SKU         | Service                                 | Pricing            | ₹    | Dur  | Tier |
| ----------- | --------------------------------------- | ------------------ | ---- | ---- | ---- |
| PLB-BTH-001 | Tap installation                        | PER_UNIT (per tap) | 199  | 20m  | L2   |
| PLB-BTH-002 | Shower / rain shower installation       | FIXED              | 399  | 45m  | L2   |
| PLB-BTH-003 | Health faucet install / replace         | FIXED              | 249  | 20m  | L2   |
| PLB-BTH-004 | Wall mixer / diverter installation      | FIXED              | 499  | 60m  | L2   |
| PLB-BTH-005 | Overhead shower arm fitting             | FIXED              | 299  | 30m  | L2   |
| PLB-BTH-006 | Angle valve replacement                 | PER_UNIT           | 199  | 20m  | L2   |
| PLB-BTH-007 | Towel rod / soap dish / hook fitting    | PER_UNIT           | 149  | 15m  | L1   |
| PLB-BTH-008 | Full bathroom fittings set installation | FROM               | 1499 | 3–5h | L3   |
| PLB-BTH-009 | Wash basin installation                 | FIXED              | 699  | 90m  | L2   |
| PLB-BTH-010 | Wash basin removal / refit              | FIXED              | 499  | 60m  | L2   |

**TOI — Toilet & Sanitaryware**

| SKU         | Service                              | Pricing | ₹    | Dur  | Tier |
| ----------- | ------------------------------------ | ------- | ---- | ---- | ---- |
| PLB-TOI-001 | Western WC installation              | FIXED   | 1299 | 2–3h | L3   |
| PLB-TOI-002 | Indian WC installation               | FIXED   | 1499 | 3–4h | L3   |
| PLB-TOI-003 | Concealed flush tank repair          | FROM    | 599  | 90m  | L3   |
| PLB-TOI-004 | External flush tank repair           | FIXED   | 399  | 45m  | L2   |
| PLB-TOI-005 | WC seat cover replacement            | FIXED   | 249  | 20m  | L1   |
| PLB-TOI-006 | Jet spray installation               | FIXED   | 249  | 20m  | L2   |
| PLB-TOI-007 | WC removal & refit (for tiling work) | FIXED   | 999  | 2h   | L3   |
| PLB-TOI-008 | Urinal / bidet installation          | FIXED   | 899  | 2h   | L3   |

**KIT — Kitchen Plumbing**

| SKU         | Service                                         | Pricing | ₹   | Dur | Tier |
| ----------- | ----------------------------------------------- | ------- | --- | --- | ---- |
| PLB-KIT-001 | Kitchen sink installation                       | FIXED   | 699 | 90m | L2   |
| PLB-KIT-002 | Kitchen tap installation                        | FIXED   | 249 | 30m | L2   |
| PLB-KIT-003 | Sink waste coupling / drain pipe replacement    | FIXED   | 349 | 45m | L2   |
| PLB-KIT-004 | RO / purifier plumbing point                    | FIXED   | 499 | 60m | L2   |
| PLB-KIT-005 | Washing machine / dishwasher inlet‑outlet point | FIXED   | 599 | 60m | L2   |
| PLB-KIT-006 | Under‑sink leak repair                          | FROM    | 349 | 45m | L2   |

**TNK — Tank, Motor & Pump**

| SKU         | Service                                       | Pricing          | ₹    | Dur  | Tier | SOS       |
| ----------- | --------------------------------------------- | ---------------- | ---- | ---- | ---- | --------- |
| PLB-TNK-001 | Overhead tank cleaning (up to 1000 L)         | PER_UNIT         | 899  | 90m  | L1   | E3        |
| PLB-TNK-002 | Sump / underground tank cleaning              | FROM             | 1999 | 3–4h | L2   | E3        |
| PLB-TNK-003 | Water pump installation                       | FIXED            | 899  | 2h   | L3   | E2        |
| PLB-TNK-004 | Pump repair / servicing                       | INSPECTION_FIRST | 599  | 90m  | L3   | E1        |
| PLB-TNK-005 | Float valve / ball cock replacement           | FIXED            | 349  | 45m  | L2   | E1        |
| PLB-TNK-006 | Automatic water level controller install      | FIXED            | 1299 | 2h   | L3   | E3        |
| PLB-TNK-007 | Tank inlet / outlet pipe repair               | FROM             | 499  | 90m  | L2   | E1        |
| PLB-TNK-008 | Pressure booster pump installation            | FROM             | 1999 | 3h   | L3   | E3        |
| PLB-TNK-009 | **Tank overflow / no water supply emergency** | FROM             | 699  | 1–2h | L2   | **E0/E1** |

**GYS — Water Heater / Geyser**

| SKU         | Service                                  | Pricing          | ₹   | Dur  | Tier | SOS    |
| ----------- | ---------------------------------------- | ---------------- | --- | ---- | ---- | ------ |
| PLB-GYS-001 | Storage geyser installation              | FIXED            | 599 | 90m  | L2   | E3     |
| PLB-GYS-002 | Instant geyser installation              | FIXED            | 499 | 60m  | L2   | E3     |
| PLB-GYS-003 | Geyser uninstallation                    | FIXED            | 349 | 45m  | L2   | E3     |
| PLB-GYS-004 | Geyser repair (diagnosis)                | INSPECTION_FIRST | 299 | 60m  | L3   | E1     |
| PLB-GYS-005 | Geyser descaling / servicing             | FIXED            | 699 | 90m  | L2   | E3     |
| PLB-GYS-006 | Thermostat / heating element replacement | FROM             | 499 | 90m  | L3   | E1     |
| PLB-GYS-007 | **Geyser leaking / electrical hazard**   | FROM             | 799 | 1–2h | L3   | **E0** |

**PIP — New Installation & Pipelines**

| SKU         | Service                         | Pricing                     | ₹    | Dur      | Tier |
| ----------- | ------------------------------- | --------------------------- | ---- | -------- | ---- |
| PLB-PIP-001 | New bathroom plumbing (full)    | QUOTE_ONLY (site visit 499) | —    | 1–3 days | L3   |
| PLB-PIP-002 | CPVC pipeline laying — open     | PER_UNIT (per point)        | 499  | 60m/pt   | L3   |
| PLB-PIP-003 | Concealed piping                | PER_UNIT (per point)        | 899  | 120m/pt  | L3   |
| PLB-PIP-004 | Pipe rerouting / relocation     | FROM                        | 1499 | 3–5h     | L3   |
| PLB-PIP-005 | Borewell to tank connection     | QUOTE_ONLY                  | —    | —        | L3   |
| PLB-PIP-006 | Rainwater harvesting connection | QUOTE_ONLY                  | —    | —        | L3   |
| PLB-PIP-007 | Terrace / garden tap point      | FIXED                       | 599  | 90m      | L2   |

**PUR — Water Purifier & Softener**

| SKU         | Service                                    | Pricing | ₹    | Dur | Tier |
| ----------- | ------------------------------------------ | ------- | ---- | --- | ---- |
| PLB-PUR-001 | Water purifier installation                | FIXED   | 499  | 60m | L2   |
| PLB-PUR-002 | Purifier uninstall + reinstall (shifting)  | FIXED   | 699  | 90m | L2   |
| PLB-PUR-003 | Water softener installation                | FROM    | 1999 | 3h  | L3   |
| PLB-PUR-004 | Sediment / pre‑filter housing installation | FIXED   | 399  | 45m | L2   |

**AMC — Inspection, AMC & Audits**

| SKU         | Service                      | Pricing      | ₹       | Notes                                                       |
| ----------- | ---------------------------- | ------------ | ------- | ----------------------------------------------------------- |
| PLB-AMC-001 | Home plumbing health check   | FIXED        | 499     | Waived if any repair booked same visit                      |
| PLB-AMC-002 | Pre‑monsoon drainage check   | FIXED        | 699     | Seasonal campaign SKU (May–June)                            |
| PLB-AMC-003 | AMC Basic — 2 visits/yr      | SUBSCRIPTION | 1999/yr | Free inspections, 10% off repairs                           |
| PLB-AMC-004 | AMC Plus — 4 visits/yr       | SUBSCRIPTION | 3999/yr | 20% off repairs, **priority SOS queue**, zero emergency fee |
| PLB-AMC-005 | Apartment / B2B facility AMC | QUOTE_ONLY   | —       | Per‑tower contract, monthly invoicing                       |

### 2.3 Pre‑visit diagnostic questions

Attached per SKU as JSON. They do three things: narrow scope, set the correct `skill_tier`, and pre‑stock the partner's van. Keep to **≤4 questions**.

Example — `PLB-DRN-004` (WC blockage):

1. Is water draining slowly, or not at all? → _not at all_ bumps tier L2→L2 + adds `CLOSET_AUGER`
2. Is water overflowing onto the floor right now? → _yes_ auto‑promotes urgency to **E1**
3. Is this the only toilet in the house? → _yes_ auto‑promotes urgency to **E1**
4. Did anything get flushed that shouldn't have? (cloth / toy / sanitary item) → _yes_ adds ₹200 "foreign object retrieval" add‑on chip, shown transparently

Example — `PLB-LEAK-004` (concealed leak detection):

1. Where do you see dampness? (ceiling / wall / floor / near meter)
2. Is the floor below also affected? → _yes_ flags possible slab leak, tier L3 mandatory
3. Has the water bill jumped recently?
4. Upload a photo/video of the damp patch _(optional but boosts first‑visit resolution ~15%)_

---

## 3. Emergency Module (the differentiator)

### 3.1 Urgency tiers

| Tier   | Name         | Response SLA              | Fee                                         | Examples                                                                                                       |
| ------ | ------------ | ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **E0** | SOS / Hazard | **≤30 min** arrival       | ₹499 emergency fee + surge                  | Burst pipe flooding, sewage backflow indoors, geyser leaking with live wiring, tank overflow damaging property |
| **E1** | Urgent       | **≤2 hours**              | ₹299 emergency fee (waived if job > ₹1,500) | No water supply, sole toilet blocked, continuous heavy leak, pump dead                                         |
| **E2** | Same‑day     | Today, chosen 2‑hr window | ₹0                                          | Dripping tap, slow drain, minor leak                                                                           |
| **E3** | Scheduled    | Any slot within 14 days   | ₹0                                          | Installations, AMC, renovations                                                                                |

### 3.2 Intake flow (target: **≤20 seconds** to dispatch on E0)

```
[ SOS button — persistent, red, top-right of home screen ]
        ↓
Step 1: "What's happening?"  → 6 large tiles with icons
        Burst pipe · Flooding · Sewage backflow · No water
        · Geyser leaking · Something else
        ↓
Step 2: SAFETY CARD (blocking, must tap "Done" or "Can't do this")
        ↓  (dispatch broadcast fires IN PARALLEL — do not wait for step 3)
Step 3: Confirm saved address + optional 10s video
        ↓
Step 4: Payment pre-authorisation (₹499 hold) — required, kills fake SOS
        ↓
Live tracking screen
```

### 3.3 Safety scripts (shown _before_ any plumber is assigned)

These must be authored by, or reviewed by, a licensed plumber and a safety consultant. Ship them as versioned content with `content_version` logged per booking.

| Trigger                           | Immediate instructions                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Burst pipe / major leak           | Close the main stopcock (illustrated: usually near the meter, or on the terrace tank outlet). Switch off power to any socket near the water. Move electricals off the floor. |
| Geyser leaking                    | Switch off the geyser MCB at the distribution board first — **do not touch the unit**. Then close the inlet valve. Do not use the bathroom until the partner arrives.        |
| Sewage backflow                   | Stop all water use — no flushing, no taps, no washing machine. Keep children and pets away. Open windows. Do not pour chemicals down the drain.                              |
| Tank overflow                     | Switch off the pump at the mains. Close the inlet valve at the tank.                                                                                                         |
| Gas smell near a gas water heater | Do not switch anything on or off. Open windows, leave the flat, and call the LPG emergency helpline (**1906**) before booking.                                               |

Also render a permanent **"Where is my main valve?"** guide in the app with photos for common Indian apartment/independent‑house layouts. This alone reduces damage severity and is a genuinely good acquisition asset for SEO.

### 3.4 Dispatch algorithm

**Candidate pool filter**

```
partner.status == ONLINE
  AND partner.skill_tier >= service.skill_tier
  AND service.category IN partner.certified_categories
  AND partner.tools ⊇ service.required_tools
  AND partner.active_job_count == 0            (E0/E1 only)
  AND ST_DWithin(partner.last_location, job.location, ring_radius)
  AND partner.emergency_optin == true          (E0 only)
  AND partner NOT IN job.declined_by
  AND partner.acceptance_rate_7d >= 0.55
```

**Ranking score** (higher wins):

```
score =  0.40 * (1 - eta_minutes / ring_max_eta)
       + 0.25 * partner.rating_90d_normalised
       + 0.15 * partner.first_visit_resolution_rate
       + 0.10 * category_specific_completion_count_normalised
       + 0.10 * fairness_boost      // inverse of jobs served in last 24h
       - 0.20 * open_complaint_flag
```

**Broadcast rings** (E0):

| Ring | Radius                                                | Offered to | Window |
| ---- | ----------------------------------------------------- | ---------- | ------ |
| 1    | 3 km                                                  | Top 5      | 45 s   |
| 2    | 6 km                                                  | Top 8      | 45 s   |
| 3    | 10 km + paid standby pool                             | Top 12     | 60 s   |
| 4    | Human dispatcher desk: outbound call + WhatsApp blast | —          | 180 s  |

First accept wins (Redis `SET NX` lock on `dispatch:{jobId}` with a 5 s TTL to break ties). E1 uses the same rings with 90 s windows. E2/E3 use a batch assignment job that runs every 15 min and optimises route density rather than raw ETA.

**Guarantee:** if no partner is assigned within **10 minutes** on an E0, the emergency fee is auto‑refunded and ₹200 wallet credit is issued, no support ticket needed. Log every one of these as a `DISPATCH_SLA_BREACH` event — it is your single best supply‑planning signal.

### 3.5 Emergency supply — the part everyone skips

Emergency SLAs are a **supply** problem, not a software problem. The software just makes the supply legible.

- **Standby roster:** partners bid for night (10 PM–6 AM) and Sunday standby shifts. Pay a retainer (₹300–500/shift) _plus_ a higher payout share (80% vs standard 78%) on any job taken. Cap the roster per zone using historical E0/E1 density.
- **Zone coverage heatmap** in the admin console: rolling 7‑day emergency demand vs online standby partners per H3 hex. Red hexes = do not advertise 30‑min SLA in that pincode yet.
- **Progressive SLA promise:** the app should show the _actual_ achievable ETA per pincode, computed from live coverage — not a marketing number. Under‑promise per zone; that is what makes the guarantee affordable.
- **Accept‑then‑cancel penalty:** ₹150 debit + 24 h emergency‑roster suspension on the second offence in 7 days.

### 3.6 Emergency pricing

```
final = (base_price
         + material_lines
         + add_ons)
      * surge_multiplier          // 1.0–2.0, hard cap 2.0
      * time_multiplier           // 1.5x 22:00–06:00, 1.25x Sun/public holiday
      + emergency_fee             // ₹499 E0, ₹299 E1
      - amc_discount
      - coupon
      + gst
```

Rules that keep you out of trouble:

- Show the **full breakdown before confirm**, every line labelled. No hidden surge.
- Surge multiplier is computed per H3 hex per 15‑min bucket from `(open_emergency_requests / online_eligible_partners)`, smoothed, and is **frozen at booking time**.
- AMC Plus subscribers: `emergency_fee = 0` and surge capped at 1.25x. This is the entire pitch for AMC Plus.
- Any on‑site quote that exceeds the booking estimate by **>30%** requires: photo evidence, a written reason, customer in‑app approval, and it raises an admin review flag automatically.

---

## 4. Core Flows & State Machines

### 4.1 Booking state machine

```
DRAFT
 → PENDING_PAYMENT → (timeout 15m) → EXPIRED
 → CONFIRMED
 → DISPATCHING ⇄ (retry rings)
      → FAILED_TO_ASSIGN → (auto-refund + credit)
 → ASSIGNED
 → EN_ROUTE            [partner taps "Start"] → live location stream begins
 → ARRIVED             [geofence 100m + START_OTP verified by customer]
 → DIAGNOSING
 → QUOTE_PENDING ⇄ QUOTE_REVISED
      → QUOTE_DECLINED → VISIT_CHARGE_ONLY → COMPLETED
 → IN_PROGRESS
 → WORK_DONE           [after-photos mandatory if value > ₹1000]
 → PAYMENT_PENDING     [UPI / card / cash-collected]
 → COMPLETED           [END_OTP + rating prompt + warranty starts]

Terminal side-states: CANCELLED_BY_USER · CANCELLED_BY_PARTNER
                      · NO_SHOW_CUSTOMER · NO_SHOW_PARTNER · DISPUTED
```

### 4.2 Anti‑dispute controls (learn from every marketplace that got this wrong)

1. **START_OTP** — customer reads a 4‑digit code to the partner. Proves arrival, kills fake "arrived" taps.
2. **END_OTP** — proves completion before payment release.
3. **Before/after photos** — mandatory server‑side validation for jobs > ₹1,000. Reject completion without them.
4. **On‑site quote approval** — itemised, customer taps approve in their own app. Work cannot move to `IN_PROGRESS` without it.
5. **Masked calling** (Exotel/Knowlarity) — neither party sees the other's number; every call recorded and attached to the job.
6. **Material line items** — partner photographs the bill/part; ops spot‑audits 5% weekly.
7. **Warranty claims** — 30 days on labour. A claim auto‑routes back to the _same_ partner at zero customer cost; second failure escalates to L3 + partner scorecard hit.

### 4.3 Cancellation policy

| When                              | Customer cancels     | Partner cancels                                   |
| --------------------------------- | -------------------- | ------------------------------------------------- |
| Before assignment                 | Full refund          | —                                                 |
| After assignment, before EN_ROUTE | Full refund          | Warning; 3 in 30 d → suspension                   |
| After EN_ROUTE                    | ₹99 fee              | ₹150 debit + reassign priority                    |
| After ARRIVED                     | Visit charge applies | Escalate to dispatcher; customer gets ₹200 credit |

---

## 5. Data Model (core entities)

```
User · Address(geo, label, floor, landmark, gate_instructions)
Partner · PartnerDocument(aadhaar,pan,police_verification,bank)
        · PartnerSkill(category, tier, certified_at)
        · PartnerTool · PartnerAvailability · PartnerLocationPing
        · StandbyShift
ServiceCategory · Service · ServiceVariant · PriceRule · CityOverride
Booking · BookingItem · UrgencyTier
EmergencyRequest · SafetyScriptAcknowledgement
DispatchOffer(job, partner, ring, offered_at, responded_at, outcome)
Job · JobTimelineEvent · JobPhoto · MaterialLine
Quote · QuoteLine · QuoteApproval
Invoice · Payment · Refund · WalletLedger
PartnerEarning · PartnerPayout · PayoutBatch
Rating · Review · WarrantyClaim
AMCPlan · AMCSubscription · AMCVisit
Coupon · Referral
ZoneGeofence · SurgeWindow · SLABreachEvent
SupportTicket · Notification · AuditLog
```

**Non‑obvious modelling decisions worth locking in now:**

- Store all money as **integer paise**. Never floats. (You already know this from the payroll engine.)
- `Booking` vs `Job`: one booking can spawn multiple jobs (reattempt, warranty revisit). Keep them separate from day one — retrofitting this is painful.
- `JobTimelineEvent` is append‑only and is the source of truth for SLA measurement and dispute resolution. Never mutate.
- `PartnerLocationPing` goes to a separate hot store (Redis + periodic Postgres rollup), not the main OLTP tables.
- `PriceRule` is versioned and effective‑dated. Historical invoices must always reproduce from the rule version that applied at booking time.

---

## 6. Technical Architecture

| Layer                     | Choice                                                                                      | Why                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Backend                   | **NestJS + TypeScript**, modular monolith                                                   | Fastest path for a solo/small team; split later at clean module seams |
| ORM / DB                  | **Prisma + PostgreSQL 16 + PostGIS**                                                        | Geo queries (`ST_DWithin`) natively; you already know Prisma          |
| Cache / locks / geo index | **Redis** (+ H3 hex keys)                                                                   | Dispatch locks, surge counters, live partner positions                |
| Jobs / scheduling         | **BullMQ**                                                                                  | Ring escalation timers, payout batches, AMC reminders, SLA watchdogs  |
| Realtime                  | **Socket.IO** (WS) with Redis adapter                                                       | Live tracking, offer push to partner app, ops dashboard               |
| Mobile                    | **React Native (Expo, bare workflow for background location)**                              | One codebase, Android‑first                                           |
| Web + Admin               | **Next.js 15**                                                                              | SEO local landing pages (`/plumber-in-<locality>`) = free demand      |
| Payments                  | **Razorpay** (UPI intent, cards, netbanking) + **RazorpayX / Cashfree Payouts**             | Standard Indian stack; pre‑auth for SOS holds                         |
| Maps / ETA                | **Google Maps Platform** (or MapmyIndia/Ola Maps to cut cost at scale)                      | Distance Matrix for ETA, geocoding                                    |
| Comms                     | FCM push · MSG91 SMS · **WhatsApp Business API** (Interakt/Gupshup) · Exotel masked calling | WhatsApp is the highest‑open‑rate channel in India                    |
| Storage                   | Cloudflare R2 / S3 (ap‑south‑1)                                                             | Job photos, documents                                                 |
| Auth                      | Phone OTP (MSG91) + JWT with refresh rotation; Partner app adds device binding              |                                                                       |
| Observability             | OpenTelemetry → Grafana/Tempo, Sentry, structured JSON logs                                 | Trace every dispatch end‑to‑end                                       |
| Infra                     | Docker, AWS **ap‑south‑1 (Mumbai)**                                                         | DPDP Act data residency posture                                       |

**Repo shape (monorepo, pnpm + Turborepo):**

```
apps/
  api/            NestJS
  customer-app/   React Native
  partner-app/    React Native
  web/            Next.js (marketing + booking + SEO)
  admin/          Next.js (ops console)
packages/
  db/             Prisma schema, migrations, seed
  shared/         zod schemas, DTOs, enums, money utils
  pricing/        pure pricing engine (100% unit-tested, no I/O)
  dispatch/       pure ranking + ring logic (deterministic, no I/O)
  ui/             shared design tokens
docs/
  STATE.md  DECISIONS.md  WORK-ORDERS.md  RUNBOOK.md
```

Keeping `pricing/` and `dispatch/` as **pure, I/O‑free packages** is the highest‑leverage architectural call in this whole document. It lets you simulate a year of dispatch decisions offline and test surge behaviour without touching the DB.

---

## 7. Compliance, Legal & Trust

- **GST**: register, issue tax invoices, map each SKU to the correct SAC code (plumbing/drain installation sits in the 9954xx family — **confirm the exact code with your CA**, don't guess).
- **Partner payouts**: TDS under 194C where applicable; collect PAN at onboarding; issue payout statements.
- **DPDP Act 2023**: explicit consent screens, purpose limitation, data deletion endpoint, breach notification runbook, India data residency.
- **Partner verification**: Aadhaar‑based KYC (DigiLocker), PAN, police verification, skill assessment before `L3` certification. Display a "verified" badge with the verification date.
- **Insurance**: third‑party liability cover for property damage caused during a job. Budget for it; a single burst‑pipe‑made‑worse claim can sink an early marketplace.
- **Call recording consent**: announce recording on masked calls.
- **Worker safety**: manual scavenging is illegal in India — sewer/manhole SKUs must be machine‑based only, with mandatory PPE checklists and photo proof. Build this as a hard block in the app, not a policy PDF.

---

## 8. KPIs

| Metric                           | Target (month 6) |
| -------------------------------- | ---------------- |
| SOS acceptance time (p50 / p90)  | < 45 s / < 120 s |
| E0 on‑time arrival (≤30 min)     | > 85%            |
| First‑visit resolution rate      | > 80%            |
| Quote‑to‑approval rate           | > 75%            |
| Rework / warranty claim rate     | < 4%             |
| Cancellation (post‑assignment)   | < 6%             |
| Partner utilisation (active hrs) | > 55%            |
| Repeat customer rate (6 mo)      | > 35%            |
| AOV                              | ₹850             |
| Take rate → contribution/job     | 22% → ~₹187      |
| CAC                              | < ₹250           |
| NPS                              | > 50             |

---

## 9. Roadmap

| Phase              | Duration | Scope                                                                                                                                                | Exit criteria                                                |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **0 — Foundation** | 2 wks    | Prisma schema, catalog + pricing seed, admin CRUD, auth                                                                                              | 60 SKUs live in admin, pricing engine unit‑tested            |
| **1 — MVP**        | 6 wks    | Customer app: browse → book scheduled (E2/E3) → pay → track → rate. **Manual dispatch** via ops console. Partner app: accept, OTP, photos, complete. | 100 real jobs completed in 3 pincode clusters                |
| **2 — Automation** | 4 wks    | Auto‑dispatch engine, live tracking, masked calling, on‑site quotes, payouts                                                                         | Auto‑assignment rate > 90%, dispatcher touches < 10% of jobs |
| **3 — Emergency**  | 4 wks    | E0/E1 tiers, safety scripts, standby roster, surge, SLA guarantee, coverage heatmap                                                                  | E0 on‑time > 80% in 2 zones                                  |
| **4 — Retention**  | 4 wks    | AMC subscriptions, warranty claims portal, referrals, WhatsApp re‑engagement                                                                         | AMC attach rate > 8%                                         |
| **5 — Scale**      | ongoing  | Multi‑city, B2B/apartment contracts, partner lending, materials catalog                                                                              | —                                                            |

**Launch geography discipline:** do not open a second city until one city hits >80% E0 on‑time and >55% partner utilisation. Marketplace liquidity is local; a thin second city just burns cash and reviews.

---

## 10. Risks

| Risk                            | Mitigation                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Supply can't hit 30‑min SLA     | Per‑pincode dynamic SLA display; paid standby roster; don't advertise what the heatmap can't back |
| Partners take jobs off‑platform | Masked calling, in‑app warranty only, loyalty payout tiers, materials credit line                 |
| Price disputes                  | Locked estimate + itemised on‑site quote + >30% approval gate + photo evidence                    |
| Fake SOS bookings               | ₹499 pre‑auth on E0, phone verification, abuse scoring                                            |
| Property damage liability       | Insurance, skill certification, sewer work machine‑only + PPE proof                               |
| Seasonality (monsoon spike)     | Pre‑monsoon campaign SKUs, surge roster planning from last year's data                            |
| Cash collection leakage         | Push UPI hard (target > 85% digital), auto‑reconcile cash to partner wallet debit                 |

---

## 11. Immediate Next 5 Actions

1. Lock the SKU list and get **real** prices from 3 Bengaluru plumbers + 2 competitors. Replace every ₹ in section 2.2.
2. Write `packages/pricing` as a pure function with a test table of 40 cases (including surge, night, AMC, coupon stacking order).
3. Recruit 8 partners in 2 adjacent pincodes. Run 20 jobs on WhatsApp + a spreadsheet before writing the dispatch engine. The catalog will change.
4. Build Phase 0 + Phase 1 with the prompt in the companion file.
5. Draft the safety scripts and have a licensed plumber review them. This is the one piece of content that must not be AI‑generated and shipped unreviewed.
