FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./
COPY turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS runtime
COPY apps/web apps/web
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "dev"]
