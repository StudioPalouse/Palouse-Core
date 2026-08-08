# node:22-alpine, digest-pinned for reproducible builds. Bump via Dependabot.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
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
