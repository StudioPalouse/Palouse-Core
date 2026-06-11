FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./
COPY turbo.json tsconfig.base.json ./
COPY apps/mcp/package.json apps/mcp/
COPY packages packages
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS runtime
COPY apps/mcp apps/mcp
WORKDIR /repo/apps/mcp
EXPOSE 7777
CMD ["pnpm", "start"]
