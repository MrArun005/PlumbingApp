# WORK ORDERS — the queue (definitions live in BUILD-PROMPT.md)

One at a time, in order. A WO is DONE only when its "Done when" criterion is
verified by actually running the command, and STATE.md is updated.

| WO  | Title                                     | Status         | Done-when check                                     |
| --- | ----------------------------------------- | -------------- | --------------------------------------------------- |
| 01  | Foundation (monorepo, shared, compose)    | ✅ DONE        | `pnpm build && pnpm test` green, compose healthy    |
| 02  | Data layer (Prisma schema, PostGIS, seed) | ✅ DONE        | `pnpm db:seed` idempotent, sane rows in every table |
| 03  | Pricing engine (pure, ≥40 tests)          | 🔨 IN PROGRESS | 100% branch coverage, no I/O imports                |
| 04  | Auth + catalog API                        | ⬜ QUEUED      | —                                                   |
| 05  | Booking flow (E2/E3)                      | ⬜ QUEUED      | integration test books → pays → ASSIGNED            |
| 06  | Partner app core                          | ⬜ QUEUED      | —                                                   |
| 07  | Customer app core                         | ⬜ QUEUED      | —                                                   |
| 08  | Quotes & materials                        | ⬜ QUEUED      | —                                                   |
| 09  | Dispatch engine + simulator               | ⬜ QUEUED      | simulator ≥85% on-time baseline                     |
| 10  | Emergency tier (E0/E1)                    | ⬜ QUEUED      | —                                                   |
| 11  | Money out (payouts, GST invoices)         | ⬜ QUEUED      | —                                                   |
| 12  | Retention (AMC, warranty, referrals)      | ⬜ QUEUED      | —                                                   |
