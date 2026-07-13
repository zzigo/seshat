<!-- generated-by: gsd-doc-writer -->
# Configuration

Seshat uses one root `.env` file for both Astro and the worker. `.env` is ignored by Git; `.env.example` is the canonical non-secret template. `ecosystem.config.cjs` reads the root file and passes its values to both PM2 processes.

Never put literal credentials in Markdown, commits, logs or shell history.

## Environment variables

| Variable | Required | Default | Used by |
|---|---:|---|---|
| `AUTH_URL` | Production: yes | `http://localhost:4331` in example | External origin for Auth.js and Astro site |
| `AUTH_SECRET` | Yes | none | Auth.js signing/encryption secret |
| `LOGTO_ISSUER_URL` | Production: yes | none | Primary Logto OIDC discovery/issuer |
| `LOGTO_CLIENT_ID` | Production: yes | none | Logto application client ID |
| `LOGTO_CLIENT_SECRET` | Production: yes | none | Logto application client secret |
| `OIDC_ISSUER_URL` | Migration fallback | Authentik Seshat issuer fallback in `auth.config.ts` | Legacy generic OIDC discovery/issuer |
| `OIDC_CLIENT_ID` | Migration fallback | none | Legacy generic OIDC client |
| `OIDC_CLIENT_SECRET` | Migration fallback | none | Legacy generic OIDC secret |
| `SESHAT_ADMIN_EMAILS` | No | empty | Comma-separated account-recovery administrators |
| `SESHAT_ADMIN_GROUPS` | No | `authentik Admins,Seshat Admins` | Authentik groups allowed to recover a previous catalog identity |
| `GOOGLE_CLIENT_ID` | Optional | none | Enables direct Google login when paired with its secret |
| `GOOGLE_CLIENT_SECRET` | Optional | none | Enables direct Google login when paired with its client ID |
| `DATABASE_URL` | Yes | none | PostgreSQL connection for web and worker |
| `WASABI_ENDPOINT` | Yes | `https://s3.us-east-2.wasabisys.com` | Wasabi S3-compatible endpoint used exclusively by Seshat |
| `WASABI_REGION` | Yes | `us-east-2` | Wasabi region |
| `WASABI_ACCESS_KEY_ID` | Yes | none | Server-side Wasabi credential |
| `WASABI_SECRET_ACCESS_KEY` | Yes | none | Server-side Wasabi credential |
| `WASABI_BUCKET` | Yes | `untref-licmusica` | Bucket containing originals and derivatives |
| `WASABI_KEY_PREFIX` | No | `zzttuntref` | Key prefix above Seshat user roots |
| `SESHAT_LIBRARY_ROOT_USERS` | No | `zztt,zzttuntref,lucianoazzigotti@gmail.com` | Users for whom `libros/` is an invisible storage root; other users use `lseshat/<user>/` |
| `GOOGLE_BOOKS_API_KEY` | Recommended | fallback to `GOOGLE_API_KEY` | Server-side Google Books queries |
| `GOOGLE_GENERATIVE_LANGUAGE_API_KEY` | Currently unused by worker | none | Reserved for Generative Language integration |
| `GOOGLE_API_KEY` | Legacy fallback | none | Backward-compatible Google Books key fallback |
| `GOOGLE_CLOUD_PROJECT` | Required for Chirp | none | Google Cloud project containing the enabled Text-to-Speech API |
| `GOOGLE_APPLICATION_CREDENTIALS` | Required for Chirp | none | Absolute server path to the service-account JSON; keep it outside the repository |
| `GOOGLE_TTS_MONTHLY_CHARACTER_LIMIT` | No | `900000` | Hard application-wide Chirp character limit per UTC calendar month |
| `GOOGLE_TTS_WARNING_CHARACTERS` | No | `700000` | Usage level at which Chirp responses expose a warning state |
| `SESHAT_INTEGRATION_TOKEN` | Required for external consumers | none | Long random bearer secret for trusted server-to-server citation search; never expose it to browser code |
| `SESHAT_INTEGRATION_OWNER_KEY` | Optional | owner derived from `X-Seshat-Owner` email | Fixed 32-character catalog owner key for a deployment exposing one curated bibliography to trusted consumers |
| `MUSIKI_API_URL` | No | `https://musiki.org.ar` | Musiki server used to list registered users and course groups in Share Library |
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

LOGTO_ISSUER_URL=https://your-logto.example/oidc
LOGTO_CLIENT_ID=replace-me
LOGTO_CLIENT_SECRET=replace-me

DATABASE_URL=postgresql://user:password@127.0.0.1:5432/seshat
WASABI_ENDPOINT=https://s3.us-east-2.wasabisys.com
WASABI_REGION=us-east-2
WASABI_ACCESS_KEY_ID=replace-me
WASABI_SECRET_ACCESS_KEY=replace-me
WASABI_BUCKET=untref-licmusica
WASABI_KEY_PREFIX=zzttuntref
SESHAT_LIBRARY_ROOT_USERS=zztt,zzttuntref,lucianoazzigotti@gmail.com

GOOGLE_BOOKS_API_KEY=replace-me
```

For a UI-only development session, PostgreSQL, Wasabi and identity are still needed for authenticated workspace pages. The public landing and health endpoint can run without catalog access. Cloudflare R2 is not read by Seshat; it remains a Musiki-only service.

## Google credentials

Keep Books and Generative Language credentials separate:

- `GOOGLE_BOOKS_API_KEY`: restrict to the VPS public IP for server-side use and restrict API access to Google Books.
- `GOOGLE_GENERATIVE_LANGUAGE_API_KEY`: restrict separately to the Generative Language API.

A browser-referrer-restricted Books key will fail from the worker with `API_KEY_HTTP_REFERRER_BLOCKED`; server workloads require an IP-compatible restriction.

Google Chirp uses Application Default Credentials on the server. Its usage table is keyed by provider and UTC `YYYY-MM`, so the application allowance renews automatically at the start of every month. Both immediate reading and persistent OGG narration reserve from the same atomic 900,000-character allowance; failed synthesis requests release their reservation.

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
- The file contains Auth.js/OIDC, PostgreSQL, Wasabi and separate Google API variable names.
- Production values are loaded only from the VPS and are not copied into this repository.
- The public origin is `https://seshat.zztt.org`; Caddy proxies it to `127.0.0.1:4331`.

## Per-environment practice

There are no committed `.env.development` or `.env.production` files. Use:

- local `.env` for development;
- `/opt/packages/seshat/.env` for production;
- separate identity clients, database URLs and Wasabi credentials for each consuming deployment.

Do not reuse production secrets for Musiki AR, Musiki CH or SO PhD merely because they share packages.
# OpenAlex

`OPENALEX_API_KEY` enables scholarly resolution. Keep it only in deployment secrets or `.env`; never commit it. Optional controls are `OPENALEX_API_BASE_URL`, `OPENALEX_MAILTO`, `OPENALEX_TIMEOUT_MS`, `OPENALEX_RETRIES`, `OPENALEX_CACHE_TTL_DAYS`, and `OPENALEX_SHARED_TOPIC_THRESHOLD`.

OpenAlex is used only by Seshat's scholarly pipeline. Seshat document objects remain exclusively in Wasabi, while Musiki's Cloudflare configuration is unchanged.
