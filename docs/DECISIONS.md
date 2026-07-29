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
