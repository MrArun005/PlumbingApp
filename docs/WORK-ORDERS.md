# WORK ORDERS — the queue (definitions live in BUILD-PROMPT.md)

One at a time, in order. A WO is DONE only when its "Done when" criterion is
verified by actually running the command, and STATE.md is updated.

| WO  | Title                                     | Status     | Done-when check                                             |
| --- | ----------------------------------------- | ---------- | ----------------------------------------------------------- |
| 01  | Foundation (monorepo, shared, compose)    | ✅ DONE    | `pnpm build && pnpm test` green, compose healthy            |
| 02  | Data layer (Prisma schema, PostGIS, seed) | ✅ DONE    | `pnpm db:seed` idempotent, sane rows in every table         |
| 03  | Pricing engine (pure, ≥40 tests)          | ✅ DONE    | 100% branch coverage, no I/O imports                        |
| 04  | Auth + catalog API                        | ✅ DONE    | OTP→session→rotate green; catalog hides quote-only prices   |
| 05  | Booking flow (E2/E3)                      | ✅ DONE    | integration test books → pays → ASSIGNED                    |
| 06  | Partner app core                          | ⬜ QUEUED  | API done (WO-08); native app not started                    |
| 07  | Customer web UI                           | 🔨 WIP     | routes render; inspect-first shows no amount                |
| 08  | Quotes & materials                        | ✅ DONE    | >30% flag, PPE block, approve-before-work all tested        |
| 09  | Dispatch engine + simulator               | 🟡 PARTIAL | pure engine + sim done; BullMQ ring runtime open            |
| 10  | Emergency tier (E0/E1)                    | ✅ DONE    | safety hard-block, surge freeze, auto money-back all tested |
| 11  | Money out (payouts, GST invoices)         | ⬜ QUEUED  | —                                                           |
| 12  | Retention (AMC, warranty, referrals)      | ⬜ QUEUED  | —                                                           |
