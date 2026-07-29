# RUNBOOK — how to run, debug, and un-break PipeFix locally

## First-time setup

```bash
pnpm install          # workspace deps
pnpm infra:up         # Postgres(+PostGIS) :5432, Redis :6379 — waits for healthy
cp .env.example .env  # then adjust if your ports differ
pnpm build            # all packages, dependency-ordered (Turborepo)
pnpm test             # all unit tests
```

> In the Claude Code cloud container Docker's daemon isn't started by init —
> run `nohup dockerd >/tmp/dockerd.log 2>&1 &` once, then `pnpm infra:up`.
> If image pulls from Docker Hub are blocked by the egress proxy, add
> `{"registry-mirrors":["https://mirror.gcr.io"]}` to `/etc/docker/daemon.json`
> and restart dockerd.

## Daily loop

```bash
pnpm infra:up && pnpm build && pnpm test   # should always be green on main
```

## Database

```bash
pnpm db:migrate   # apply Prisma migrations (packages/db)
pnpm db:seed      # idempotent — safe to run twice
docker exec -it pipefix-postgres psql -U pipefix -d pipefix   # poke around
```

## Common failures

| Symptom                              | Cause                             | Fix                                                                  |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `ECONNREFUSED :5432`                 | infra not up                      | `pnpm infra:up` (is dockerd running?)                                |
| `EnvValidationError` at boot         | missing `.env` keys               | it lists exactly which — copy from `.env.example`                    |
| `InvalidTransitionError` in logs     | code tried an illegal status jump | that's the state machine doing its job; fix the caller, never bypass |
| Type error passing `number` as Money | you tried to use float currency   | construct via `money()` / `rupees()` from `@pipefix/shared`          |
