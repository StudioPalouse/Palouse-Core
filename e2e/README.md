# @palouse/e2e

End-to-end smoke tests (Playwright) that drive the real app through a browser.
This is the deploy gate: CI brings up the full stack and runs these before any
staging or production deploy.

## What it covers

- `tests/smoke.spec.ts` — sign up, sign in, create the first workspace, land on
  the dashboard. One flow through web + API + auth + Postgres.

More flows (connect a source, create an agent + key, hand off, accept an invite)
get layered on top as the roadmap fills in.

## Run it locally

The suite talks to a running stack; it does not start one for you. Bring the
stack up first, then run the tests.

```sh
# 1. Infra + app (from the repo root)
docker compose up -d              # postgres, redis, minio, api, web, worker
pnpm db:migrate                   # apply migrations if the api didn't

# ...or run the app from source:
#   docker compose up -d postgres redis minio
#   pnpm db:migrate
#   pnpm -F @palouse/api start &
#   pnpm -F @palouse/web build && pnpm -F @palouse/web start &

# 2. Install the browser once
pnpm -F @palouse/e2e install:browser

# 3. Run
pnpm -F @palouse/e2e e2e
```

Point the suite at any origin (for example deployed staging) with `E2E_BASE_URL`:

```sh
E2E_BASE_URL=https://palouse-staging-web.fly.dev pnpm -F @palouse/e2e e2e
```

## Notes

- The smoke test signs in immediately after signing up. That only works when
  `RESEND_API_KEY` is unset (email verification is not enforced), which is how
  CI runs. Against a mail-configured environment the flow needs a verification
  step first.
