<!-- generated-by: gsd-doc-writer -->
# Getting started

## Prerequisites

| Tool/service | Requirement |
|---|---|
| Node.js | `>=22` |
| npm | npm 10; the repository declares `npm@10.9.3` |
| Python | `>=3.11` for `seshat-ingest` |
| PostgreSQL | A reachable database and permission to create the Seshat tables |
| Cloudflare R2 | Bucket plus S3 endpoint/access credentials |
| Identity | Authentik OIDC client; Google OAuth is optional |
| Ollama | Required only when running the enrichment worker locally |

There is no Docker Compose or automated local infrastructure setup. PostgreSQL, R2 and identity must be supplied separately.

## Clone and install JavaScript dependencies

```bash
git clone https://github.com/zzigo/seshat.git
cd seshat
npm ci
```

For active dependency development, `npm install` is acceptable. Use `npm ci` for a reproducible clean install from `package-lock.json`.

## Configure the environment

```bash
cp .env.example .env
chmod 600 .env
```

Fill `.env` with local Auth.js/OIDC, PostgreSQL and R2 values. Do not reuse or copy the production file. See [CONFIGURATION.md](CONFIGURATION.md) for every variable.

## Install the Python ingestion service

Create an isolated environment at the repository root, which is also the worker's default location:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e services/ingest
```

For CPU-only Linux servers, installing the CPU PyTorch wheel before Docling avoids pulling an inappropriate accelerator build:

```bash
.venv/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch
.venv/bin/python -m pip install -e services/ingest
```

## Prepare Ollama for worker development

```bash
ollama pull qwen3:1.7b
ollama serve
```

The worker defaults to `http://127.0.0.1:11434` and `qwen3:1.7b`.

## Validate the checkout

```bash
npm test
npm run typecheck
npm run build
```

These commands build the packages, run Node and Python tests, check every TypeScript/Astro workspace and create production web/worker output.

## First run

Start the web application:

```bash
npm run dev --workspace @seshat/web
```

Open `http://localhost:4331`. The public landing and health route work without login. The authenticated workspace requires the configured identity provider, PostgreSQL and R2.

To run the enrichment worker after building:

```bash
npm run build:packages
npm run build --workspace @seshat/worker
node apps/worker/dist/index.js
```

The worker runs continuously and claims one `extract` or `identify` job at a time.

## Ingestion CLI smoke test

```bash
PYTHONPATH=services/ingest .venv/bin/python -m seshat_ingest.cli path/to/document.pdf \
  --reference-id smoke-reference \
  --artifact-id smoke-original \
  --output /tmp/seshat-smoke
```

Expected files in `/tmp/seshat-smoke`:

```text
document.json
document.md
chunks.jsonl
structure.json
manifest.json
```

Delete the smoke directory when finished. Production performs this cleanup automatically.

## Common setup issues

### `DATABASE_URL_NOT_CONFIGURED`

The root `.env` is missing `DATABASE_URL`, or the process was started from a directory where the env file was not loaded. Export it explicitly for direct Node runs or start through a tool that loads `.env`.

### `R2_NOT_CONFIGURED` or `R2_BUCKET_NOT_CONFIGURED`

Check all four R2 values: endpoint, access key ID, secret access key and bucket.

### OIDC callback returns to localhost or the wrong host

Set `AUTH_URL` to the browser-visible origin and make sure the same callback/origin is configured in Authentik. Behind a reverse proxy, preserve forwarded host/protocol headers.

### Google Books returns 403

A browser-referrer-restricted API key does not work from the worker. Use a server-IP-compatible key restricted to the Google Books API.

### Docling installation is very large

Docling and CPU PyTorch consume substantial disk. Keep them inside `.venv`, avoid model caches in the repository, and inspect cache usage before upgrading on a constrained VPS.

## Next steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing data flow.
- Use [DEVELOPMENT.md](DEVELOPMENT.md) for the normal coding workflow.
- Use [TESTING.md](TESTING.md) before committing.
- Read [DEPLOYMENT.md](DEPLOYMENT.md) before touching the VPS.
- Read [HANDOFF.md](HANDOFF.md) for current production state and unfinished work.
