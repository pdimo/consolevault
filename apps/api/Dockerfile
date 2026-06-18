# Multi-stage build for the ConsoleVault control-plane API.
# Build context is the REPO ROOT (this is a pnpm/turbo monorepo), e.g.:
#   docker build -f apps/api/Dockerfile -t <image> .
# Stage 0: image only serves GET /health. Size is intentionally not optimized yet.

FROM node:20-slim AS builder
RUN corepack enable
WORKDIR /repo

# Install with the full workspace so workspace deps resolve.
COPY . .
RUN pnpm install --frozen-lockfile
# Build the whole workspace so the api AND the web SPA (apps/web/dist, which the api serves)
# are present in the image.
RUN pnpm run build

FROM node:20-slim AS runner
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /repo
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
EXPOSE 8080
CMD ["node", "dist/index.js"]
