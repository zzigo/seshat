<!-- generated-by: gsd-doc-writer -->
# Configuration

Seshat uses one root `.env` file for both Astro and the worker. `.env` is ignored by Git; `.env.example` is the canonical non-secret template. `ecosystem.config.cjs` reads the root file and passes its values to both PM2 processes.

Never put literal credentials in Markdown, commits, logs or shell history.

## Environment variables

| Variable | Required | Default | Used by |
|---|---:|---|---|
| `AUTH_URL` | Production: yes | `http://localhost:4331` in example | External origin for Auth.js and Astro site |
| `AUTH_SECRET` | Yes | none | Auth.js signing/encryption secret |
| `OIDC_ISSUER_URL` | Yes for Authentik | Authentik Seshat issuer fallback in `auth.config.ts` | OIDC discovery/issuer |
| `OIDC_CLIENT_ID` | Yes for Authentik | none | Authentik OAuth client |
| `OIDC_CLIENT_SECRET` | Yes for Authentik | none | Authentik OAuth secret |
| `GOOGLE_CLIENT_ID` | Optional | none | Enables direct Google login when paired with its secret |
| `GOOGLE_CLIENT_SECRET` | Optional | none | Enables direct Google login when paired with its client ID |
| `DATABASE_URL` | Yes | none | PostgreSQL connection for web and worker |
| `R2_ENDPOINT` | Yes | none | Cloudflare R2 S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | Yes | none | R2 credential |
| `R2_SECRET_ACCESS_KEY` | Yes | none | R2 credential |
| `R2_BUCKET` | Yes | none | R2 bucket containing originals and derivatives |
| `GOOGLE_BOOKS_API_KEY` | Recommended | fallback to `GOOGLE_API_KEY` | Server-side Google Books queries |
| `GOOGLE_GENERATIVE_LANGUAGE_API_KEY` | Currently unused by worker | none | Reserved for Generative Language integration |
| `GOOGLE_API_KEY` | Legacy fallback | none | Backward-compatible Google Books key fallback |
| `SESHAT_INTEGRATION_TOKEN` | Required for external consumers | none | Long random bearer secret for trusted server-to-server citation search; never expose it to browser code |
| `SESHAT_INTEGRATION_OWNER_KEY` | Optional | owner derived from `X-Seshat-Owner` email | Fixed 32-character catalog owner key for a deployment exposing one curated bibliography to trusted consumers |
| `SITE_URL` | Optional | fallback to `AUTH_URL`, then localhost | Alternative external site/origin setting |
| `HOST` | Optional | framework default; PM2 sets `127.0.0.1` | Astro listen address |
| `PORT` | Optional | `4331` | Astro listen port |
| `NODE_ENV` | Optional locally | PM2 sets `production` | Cookie security and runtime behavior |
| `SESHAT_PYTHON` | Optional | `{repo}/.venv/bin/python` | Python executable used by worker |
| `WORKER_POLL_MS` | Optional | `4000` | Delay between worker ticks |
| `OLLAMA_URL` | Optional | `http://127.0.0.1:11434` | Local Ollama API base URL |
| `OLLAMA_MODEL` | Optional | `qwen3:1.7b` | Structured metadata extraction model |

`AUTH_TRUST_HOST` is set internally by `apps/web/auth.config.ts`; it does not need to be added to `.env`.

## Minimal local `.env`

```dotenv
AUTH_URL=http://localhost:4331
AUTH_SECRET=replace-with-a-long-random-value

OIDC_ISSUER_URL=https://your-authentik.example/application/o/seshat/
OIDC_CLIENT_ID=replace-me
OIDC_CLIENT_SECRET=replace-me

DATABASE_URL=postgresql://user:password@127.0.0.1:5432/seshat
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=replace-me
R2_SECRET_ACCESS_KEY=replace-me
R2_BUCKET=replace-me

GOOGLE_BOOKS_API_KEY=replace-me
```

For a UI-only development session, PostgreSQL, R2 and identity are still needed for authenticated workspace pages. The public landing and health endpoint can run without catalog access.

## Google credentials

Keep Books and Generative Language credentials separate:

- `GOOGLE_BOOKS_API_KEY`: restrict to the VPS public IP for server-side use and restrict API access to Google Books.
- `GOOGLE_GENERATIVE_LANGUAGE_API_KEY`: restrict separately to the Generative Language API.

A browser-referrer-restricted Books key will fail from the worker with `API_KEY_HTTP_REFERRER_BLOCKED`; server workloads require an IP-compatible restriction.

## PM2 configuration

`ecosystem.config.cjs` defines:

| Process | Script | Memory restart | Additional values |
|---|---|---:|---|
| `seshat-web` | `apps/web/dist/server/entry.mjs` | 500 MiB | `HOST=127.0.0.1`, `PORT=4331`, production `AUTH_URL` |
| `seshat-worker` | `apps/worker/dist/index.js` | 2 GiB | production Python path and `qwen3:1.7b` |

Important: use `pm2 startOrReload ecosystem.config.cjs --only ... --update-env` after changing `.env`. A plain `pm2 restart --update-env` does not necessarily re-evaluate the JavaScript config and reload newly added keys.

## Astro configuration

`apps/web/astro.config.mjs` uses:

- server output;
- standalone Node adapter;
- proxy trust enabled;
- port `4331` by default;
- manually injected Auth.js API endpoints;
- origin checking disabled at present.

## Production configuration snapshot

<!-- VERIFY: Re-check this dated production snapshot on the VPS before relying on it. -->

Observed on 2026-07-01:

- Root env file: `/opt/packages/seshat/.env`, owned by `zz`, mode `600` when configured.
- The file contains Auth.js/OIDC, PostgreSQL, R2 and separate Google API variable names.
- Production values are loaded only from the VPS and are not copied into this repository.
- The public origin is `https://seshat.zztt.org`; Caddy proxies it to `127.0.0.1:4331`.

## Per-environment practice

There are no committed `.env.development` or `.env.production` files. Use:

- local `.env` for development;
- `/opt/packages/seshat/.env` for production;
- separate identity clients, database URLs and R2 credentials for each consuming deployment.

Do not reuse production secrets for Musiki AR, Musiki CH or SO PhD merely because they share packages.
