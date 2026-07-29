# syntax=docker/dockerfile:1
#
# !! NOT YET PROVEN BY AN ACTUAL BUILD !!
# Authored but never built successfully: the environment it was written in blocks
# Alpine's package CDN (`apk add` gets HTTP 403 from the egress proxy), so the
# very first layer cannot complete here. The reasoning below — especially the
# Prisma musl-engine handling — is careful but unverified. Before relying on it:
#     docker build -f apps/api/Dockerfile -t pipefix-api:test .
#     docker run --rm pipefix-api:test node -e "require('@prisma/client')"
# and fix whatever it reports. Tracked in docs/STATE.md under stubs/gaps.
#
# PipeFix API image. Build from the REPO ROOT — the pnpm workspace root is the
# build context, not apps/api:
#
#   docker build -f apps/api/Dockerfile -t pipefix-api:latest .
#
# Two useful targets:
#   runtime (default) — the API server. Prod deps only, non-root, ~small.
#   migrate           — full toolchain, for `prisma migrate deploy` and seeding.
#                       docker build -f apps/api/Dockerfile --target migrate .

# ─────────────────────────────── base ───────────────────────────────────────
FROM node:22-alpine AS base
# node:22-alpine already ships libssl3/libcrypto3, but Prisma detects the
# OpenSSL version by shelling out to `openssl version` (its fallback scans
# /lib64, which alpine does not have). Without the CLI it silently guesses
# openssl-1.1.x, generates the wrong engine, and the API dies at boot with
# "Unable to require libquery_engine-linux-musl.so.node". Do not drop this.
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
# `corepack enable` only drops in a shim — the pnpm tarball named by
# package.json#packageManager is fetched on FIRST USE. Park that cache somewhere
# world-readable instead of root's $HOME so the unprivileged `node` user hits
# the copy baked in at build time. Without this the migrate container tries to
# reach registry.npmjs.org at start-up and dies: it runs as `node` on a network
# with no egress by design.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /repo

# ─────────────────────────────── deps ───────────────────────────────────────
# Manifests only, so this layer is reused until a package.json or the lockfile
# actually changes. Every workspace package needs its manifest present or
# pnpm refuses the frozen lockfile.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/pricing/package.json ./packages/pricing/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ────────────────────────────── build ───────────────────────────────────────
# Only the API's dependency closure is copied and built. Sibling apps (web,
# admin, the React Native apps) must never enter this image — they would drag in
# their own toolchains and break the build for reasons unrelated to the API.
# `--filter @pipefix/api...` is pnpm's "this package and its dependencies".
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/shared ./packages/shared
COPY packages/pricing ./packages/pricing
COPY packages/db ./packages/db
COPY apps/api ./apps/api
RUN pnpm --filter @pipefix/db db:generate
RUN pnpm --filter '@pipefix/api...' run build
# `prisma generate` writes the client to the `.prisma` directory that sits
# beside @prisma/client inside pnpm's virtual store. Park a copy at a fixed
# path so the runtime stage can COPY it without hard-coding the store's
# peer-hashed directory name, and assert the musl engine really is in there.
RUN set -eux; \
    src="$(node -e "const p=require('path');const c=p.dirname(require.resolve('@prisma/client/package.json',{paths:['/repo/packages/db']}));console.log(p.join(c,'..','..','.prisma'))")"; \
    test -d "$src"; \
    cp -R "$src" /prisma-client; \
    ls /prisma-client/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

# ───────────────────────────── prod-deps ────────────────────────────────────
# A second, independent install with devDependencies omitted. This is the
# node_modules tree that ships — no typescript, no vitest, no prisma CLI.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/pricing/package.json ./packages/pricing/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ─────────────────────────────── migrate ────────────────────────────────────
# Not the default target. Has the prisma CLI and tsx, so it can run
# `prisma migrate deploy` and the seed script. docker-compose.prod.yml uses
# this as a one-shot service that must exit 0 before the API starts.
FROM build AS migrate
ENV NODE_ENV=production
# Refuse to reach the network for a package manager at run time — the cache
# populated during the build must be enough, and a miss should fail loudly here
# rather than hang against a DNS timeout in the middle of a deploy.
ENV COREPACK_ENABLE_NETWORK=0
RUN chmod -R a+rX /opt/corepack
USER node
CMD ["pnpm", "--filter", "@pipefix/db", "db:migrate"]

# ─────────────────────────────── runtime ────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

# Prod dependency tree first (manifests + node_modules), then the compiled
# output on top. Order matters: node_modules changes far less often than dist.
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/pricing/dist ./packages/pricing/dist
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist

# The generated Prisma client lives inside the virtual store next to
# @prisma/client. Resolve that location at build time and drop the client
# (index.js + the linux-musl query engine) into it.
COPY --from=build /prisma-client /tmp/prisma-client
RUN set -eux; \
    dest="$(node -e "const p=require('path');const c=p.dirname(require.resolve('@prisma/client/package.json',{paths:['/repo/packages/db']}));console.log(p.join(c,'..','..','.prisma'))")"; \
    rm -rf "$dest"; \
    cp -R /tmp/prisma-client "$dest"; \
    rm -rf /tmp/prisma-client; \
    node -e "const {createRequire}=require('node:module');const req=createRequire('/repo/packages/db/index.js');const {PrismaClient}=req('@prisma/client');new PrismaClient({datasources:{db:{url:'postgresql://u:p@127.0.0.1:5432/x'}}});console.log('prisma client resolves ok')"

# node:22-alpine already ships an unprivileged `node` user (uid 1000).
# Nothing in the image needs to be writable at run time.
USER node
WORKDIR /repo/apps/api

EXPOSE 3000
# /health returns 200 with {"status":"degraded"} when Postgres or Redis is
# unreachable, so match on "ok" rather than on the status code.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"'

CMD ["node", "dist/main.js"]
