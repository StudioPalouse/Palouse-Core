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
# Empty = same-origin: browser API calls ride the Next rewrite proxy.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Where the Next server forwards proxied API paths (baked into the route manifest).
ARG API_PROXY_TARGET=http://localhost:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
