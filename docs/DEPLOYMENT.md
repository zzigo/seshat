<!-- generated-by: gsd-doc-writer -->
# Deployment and operations

Seshat is deployed manually from the `main` branch. GitHub is the transfer point between the local repository and the VPS; the VPS is not the source of truth for code or documentation.

## Production topology

| Component | Production value |
|---|---|
| Host alias from the development machine | `hetzner` |
| Public URL | `https://seshat.zztt.org` |
| Repository | `/opt/packages/seshat` |
| Web process | PM2 `seshat-web`, `127.0.0.1:4331` |
| Worker process | PM2 `seshat-worker` |
| Reverse proxy | Caddy, `/etc/caddy/Caddyfile` |
| Catalog | PostgreSQL 16 in the existing `authentik-postgresql` Docker container |
| Documents | Cloudflare R2 |
| Extraction | Python virtual environment at `/opt/packages/seshat/.venv` |
| Local inference | Ollama with `qwen3:1.7b` |

Caddy terminates TLS and proxies only to the loopback web listener:

```caddyfile
seshat.zztt.org {
  encode zstd gzip
  reverse_proxy 127.0.0.1:4331
}
```

## Standard release workflow

Start in the local repository:

```bash
cd /Users/zztt/projects/packages/seshat
git status --short
npm test
npm run typecheck
npm run build
git add <intentional-files>
git commit -m "<descriptive message>"
git push origin main
```

Then deploy exactly that commit:

```bash
ssh hetzner
cd /opt/packages/seshat
git status --short
git pull --ff-only origin main
npm ci
npm run build
pm2 reload ecosystem.config.cjs --update-env
pm2 status
curl -fsS http://127.0.0.1:4331/api/health.json
```

Use `npm ci` whenever lockfile dependencies may have changed. For a documentation-only commit, pulling the commit is sufficient; no build or restart is required.

Do not edit tracked files directly in `/opt/packages/seshat`. If an emergency server change is unavoidable, reproduce it locally immediately, verify it, commit it and restore the VPS to a clean checkout.

## Environment changes

Production secrets live only in `/opt/packages/seshat/.env`, currently mode `0600`. They are loaded by `ecosystem.config.cjs`. See [CONFIGURATION.md](CONFIGURATION.md) for the complete variable map.

After changing `.env`:

```bash
cd /opt/packages/seshat
pm2 reload ecosystem.config.cjs --update-env
```

Never commit `.env`, paste its values into documentation, or put credentials into PM2/Caddy configuration. API credentials restricted to the VPS IP will not work in local development unless a separate local credential is supplied.

## First-server bootstrap

The current VPS has already been bootstrapped. Recreating it requires:

1. Node.js 22+, npm, Python 3.12+, Git, PM2, Caddy, Docker/PostgreSQL and Ollama.
2. A clone at `/opt/packages/seshat` owned by the deployment user.
3. `npm ci` and `npm run build`.
4. A virtual environment plus `services/ingest/requirements.txt`.
5. A Seshat PostgreSQL database and the schema from `packages/catalog/sql/001_initial.sql`.
6. A private `.env` containing Authentik, PostgreSQL and R2 credentials.
7. `ollama pull qwen3:1.7b`.
8. PM2 startup from `ecosystem.config.cjs` and a saved process list.
9. The Caddy site above and DNS for `seshat.zztt.org` pointing to the VPS.

The database currently shares the Authentik PostgreSQL container but uses its own `seshat` database. Treat container upgrades as shared infrastructure changes.

## Verification after deployment

Run these checks on the VPS:

```bash
cd /opt/packages/seshat
git status --short
git rev-parse --short HEAD
pm2 status
curl -fsS http://127.0.0.1:4331/api/health.json
systemctl is-active caddy ollama docker
ss -ltn
```

Then test through the public UI:

1. Open `https://seshat.zztt.org` and authenticate through Authentik.
2. Drop a small supported document while remaining in the table workspace.
3. Observe the bottom status console advance through extraction and identification.
4. Open the original, text and structure pods.
5. Edit metadata and confirm it persists after refresh.
6. Delete a disposable reference and confirm it disappears without a confirmation dialog.

The health endpoint proves only that the web process is serving requests. A real upload is the smallest current end-to-end check of PostgreSQL, R2 and the worker.

## Logs and diagnosis

```bash
pm2 logs seshat-web --lines 200
pm2 logs seshat-worker --lines 200
journalctl -u caddy -n 200 --no-pager
journalctl -u ollama -n 200 --no-pager
docker logs --tail 200 authentik-postgresql
```

Useful capacity checks:

```bash
df -h /
du -sh /opt/packages/seshat /opt/packages/seshat/.venv /opt/packages/seshat/node_modules ~/.cache
```

The Python environment and Docling model caches are expected to dominate local VPS disk use. Originals and durable derivatives belong in R2, not on the VPS.

## Rollback

Prefer a new Git revert commit so local, GitHub and production history remain aligned:

```bash
cd /Users/zztt/projects/packages/seshat
git revert <bad-commit>
git push origin main
ssh hetzner 'cd /opt/packages/seshat && git pull --ff-only origin main && npm ci && npm run build && pm2 reload ecosystem.config.cjs --update-env'
```

Rollback may not reverse schema or data changes. Before introducing migrations, add forward and rollback procedures to this document.

## Backup and recovery gap

Cloudflare R2 preserves document objects, but that is not a backup of PostgreSQL metadata. The host currently lacks `pg_dump` in its normal PATH, and no tested scheduled database backup was found. Establish and test a database dump from inside the PostgreSQL container, store it outside the VPS, and document restoration before catalog volume becomes critical.

## Production snapshot

Verified on 2026-07-01:

- Ubuntu 24.04.2 LTS, Node 22.22.2, npm 10.9.7 and Python 3.12.3.
- Docling 2.107.0, Torch 2.12.1 CPU, Ollama 0.16.3 and PostgreSQL 16.14.
- Both PM2 processes, Caddy, Docker and Ollama were active.
- The root filesystem had approximately 39 GiB free; the repository used approximately 2.2 GiB, mostly the 1.9 GiB Python environment.

Treat this section as a dated observation, not desired-state automation.
