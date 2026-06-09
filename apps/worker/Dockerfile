FROM node:22-alpine AS base
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
CMD ["pnpm", "dev"]
