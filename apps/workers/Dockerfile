# Multi-stage build for the ConsoleVault collector worker.
# Build context is the REPO ROOT (pnpm/turbo monorepo):
#   docker build -f apps/workers/Dockerfile -t <image> .
# Runs as sa-collector on Cloud Run. Size is intentionally not optimized yet.

FROM node:20-slim AS builder
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Build the worker and its workspace dependencies (topological).
RUN pnpm --filter @consolevault/workers... run build

FROM node:20-slim AS runner
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /repo
COPY --from=builder /repo /repo
WORKDIR /repo/apps/workers
EXPOSE 8080
CMD ["node", "dist/index.js"]
