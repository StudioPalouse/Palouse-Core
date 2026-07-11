# node:22-alpine, digest-pinned for reproducible builds. Bump via Dependabot.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./
COPY turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages packages
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS runtime
COPY apps/worker apps/worker
WORKDIR /repo/apps/worker
# Drop root: run the service as the unprivileged node user (uid 1000).
RUN chown -R node:node /repo
USER node
CMD ["pnpm", "start"]
