# node:22-alpine, digest-pinned for reproducible builds. Bump via Dependabot.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS base
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
# Empty = same-origin: browser API calls ride the Next rewrite proxy.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Where the Next server forwards proxied API paths (baked into the route manifest).
ARG API_PROXY_TARGET=http://localhost:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# Public MCP endpoint shown in agent onboarding snippets. Empty = self-hosted
# build with no known endpoint; the UI shows a placeholder instead.
ARG NEXT_PUBLIC_MCP_URL=
ENV NEXT_PUBLIC_MCP_URL=$NEXT_PUBLIC_MCP_URL
RUN pnpm build
EXPOSE 3000
# Drop root: run the service as the unprivileged node user (uid 1000).
RUN chown -R node:node /repo
USER node
CMD ["pnpm", "start"]
