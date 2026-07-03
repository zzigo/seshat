<!-- generated-by: gsd-doc-writer -->
# Agent handoff

This is the shortest path for a new developer or agent to resume Seshat safely. Read [ARCHITECTURE.md](ARCHITECTURE.md) before modifying the pipeline and [DEPLOYMENT.md](DEPLOYMENT.md) before touching the VPS.

## Project intent

Seshat is an intelligent bibliography system intended to become independent of Zotero while remaining selectively interoperable with it. Shared packages and infrastructure can be reused by Musiki Argentina, Musiki Geneva and the SO/PhD site, but each application keeps separate data, languages and credentials.

The product direction is a source-aware catalog that understands its documents by default: extraction, bibliographic identification, summaries, corpus relationships, visualizations, annotation and agent pods all belong around one canonical reference model.

## What has been implemented

- A new standalone monorepo at `/Users/zztt/projects/packages/seshat`, mirrored in production at `/opt/packages/seshat` and hosted on GitHub as `zzigo/seshat`.
- A framework-neutral bibliography core with reference types, citekeys, fingerprints, DOI/ISBN utilities and health checks.
- A Zotero adapter package kept outside the canonical domain model.
- A PostgreSQL catalog/queue package and initial schema.
- An Astro 6 server-rendered web application in English with Authentik OIDC and optional Google authentication.
- Cloudflare R2 document storage using the same general storage pattern as Musiki; the VPS does not host durable documents.
- Workspace-wide file dropping: documents remain in the main table view while status messages report processing; `.bib` files enter a parsing/organization flow.
- Multiple hierarchical libraries in a tree sidebar.
- Handsontable-based bulk-edit catalog and Dockview-based document/analysis workspace.
- Pods for originals, extracted Markdown and Docling structure, designed to accommodate later annotation and AI tools.
- A Node worker and Python Docling service producing Markdown, Docling JSON, hierarchical chunks and a compact structure map.
- Bibliographic identification that first inspects extracted content, uses local Ollama inference, validates through Google Books and falls back to Open Library.
- Automatic title, author and year updates while preserving manually curated fields.
- Immediate row deletion that cancels work, removes all known R2 objects and then deletes catalog rows, without a confirmation dialog.
- A bearer-authenticated, owner-scoped citation search endpoint for trusted editors such as Musiki; browser clients must use their application's server-side proxy.
- Production deployment behind Caddy with PM2 web/worker processes.

## Current user experience

The authenticated home page is the primary application surface. A user selects or creates a library, drops documents anywhere in the workspace, continues working in the catalog, watches a bottom console for pipeline events, and opens source or derivative artifacts in Dockview pods. Metadata is editable directly through the catalog/details interface.

The pipeline model contains `extract`, `identify`, `summarize` and `relate`. Today the worker executes the first two. Summary generation and corpus-relation tags are queued product stages, not completed capabilities.

## Canonical locations

| Purpose | Location |
|---|---|
| Local repository | `/Users/zztt/projects/packages/seshat` |
| Production repository | `/opt/packages/seshat` |
| Web application | `apps/web` |
| Node worker | `apps/worker` |
| Docling service | `services/ingest` |
| Domain packages | `packages/core`, `packages/catalog`, `packages/zotero` |
| Database schema | `packages/catalog/sql/001_initial.sql` |
| Process definition | `ecosystem.config.cjs` |
| Documentation | `docs` |

The conversation may begin from the Musiki repository, but Seshat changes belong in the standalone Seshat repository above.

## Local-to-production rule

The authoritative path is:

```text
local Seshat repo -> tests/build -> commit -> GitHub main -> VPS git pull --ff-only -> build/reload
```

Do not use the VPS as a development branch or document host. Production `.env` remains server-only. See [DEPLOYMENT.md](DEPLOYMENT.md) for commands.

## Live state observed on 2026-07-01

- Production was on clean `main` at application commit `33ea093` before this documentation update.
- `seshat-web` and `seshat-worker` were online in PM2.
- Caddy served `seshat.zztt.org` and reverse-proxied to `127.0.0.1:4331`.
- PostgreSQL ran in the existing `authentik-postgresql` Docker container and listened on loopback.
- R2 contained originals and Docling derivatives; the VPS retained only temporary extraction files and caches.
- The catalog contained 4 references, 20 artifacts, 16 jobs and 2 libraries.
- All 4 extraction and identification jobs were complete; 4 summaries were queued and 4 relation jobs were blocked behind them.
- Stored artifact totals were approximately 14.8 MiB across originals, Markdown, structure, chunks and Docling JSON.

These counts are a diagnostic snapshot and will naturally become stale.

## Server work already performed

- Created and populated `/opt/packages/seshat` from the standalone GitHub repository.
- Installed production Node dependencies and built packages, web and worker applications.
- Created the Python virtual environment and installed Docling plus CPU Torch dependencies.
- Configured the Seshat database/schema in the shared PostgreSQL service.
- Added the production `.env` with Authentik, database, R2 and restricted Google Books credentials.
- Installed/configured the local Ollama model used by identification.
- Added PM2 definitions for the web server and worker.
- Added the Caddy virtual host for `seshat.zztt.org` and verified HTTPS routing.
- Exercised document upload, Docling extraction, metadata identification and artifact display against production.

## Design decisions to preserve

- PostgreSQL owns metadata, membership and jobs; R2 owns durable binaries and generated document artifacts.
- Uploaded files are tied to a reference through cataloged artifact records and deterministic R2 prefixes.
- The shared package boundary is code and infrastructure, not user data.
- Zotero remains an import/export adapter. Do not leak Zotero-specific fields into every consumer.
- Automatic curation must retain field provenance and never overwrite values marked manual.
- File drop should not navigate away from the main workspace.
- Document structure is a pod, not a separate extraction page.
- Deletion is intentionally immediate. Error handling must preserve recoverability if R2 deletion fails.

## Known gaps and risks

1. `summarize` and `relate` jobs have no worker handlers yet, so queued records cannot progress through the complete roadmap.
2. There is no tested automated PostgreSQL backup/restore procedure.
3. There is no CI pipeline, browser end-to-end suite, coverage threshold or deployment automation.
4. Schema evolution currently has one initial SQL file and no migration runner.
5. The health endpoint does not check database, R2, worker backlog, Docling or Ollama.
6. Application-level upload rate limiting and quotas are absent.
7. `security.checkOrigin` is disabled in Astro and should be reviewed with the Auth.js/API deployment model.
8. Handsontable is configured under a non-commercial/evaluation license; confirm the appropriate long-term license.
9. Ollama was observed listening on all interfaces at port 11434. Restrict it to loopback and/or verify the VPS firewall before treating the service as private.
10. The Ollama inventory contained an unexpected third-party test model in addition to `qwen3:1.7b`. Audit and remove unused models; Seshat requires only the configured model.
11. The worker relies on polling and one-process operational assumptions. Concurrency, leases and retries need load testing before scaling horizontally.
12. BibTeX parsing exists, but a complete review/deduplication/persistence workflow does not yet exist.

Do not place secrets, API keys or database URLs in issues, logs or these documents. One credential was shared during early development; production now uses the VPS-IP-restricted Books API credential and values remain only in `.env`.

Contributor names are stored structurally. `npm run migrate:contributors` previews the conservative legacy-literal conversion; add `-- --apply` only after reviewing aggregate counts. The migration automatically handles `Family, Given` and simple two-token personal names, preserves institutions and leaves ambiguous multi-token literals for the UI editor.

## Recommended next sequence

1. Extend the page-aware PDF.js annotation layer with export/grouping views for Musiki Lecturas and robust multi-page selections.
2. Implement corpus-aware `relate`: embeddings or local semantic search, suggested tags and explicit evidence/provenance.
3. Add an agent-friendly document/query API over chunks, annotations and structure, with owner/library scoping.
4. Add Zotero selective synchronization with stable external IDs and conflict policy.
5. Add migration, backup, health and CI foundations before catalog volume grows.
6. Localize UI strings into Spanish, English and French through a shared message catalog; do not fork the application per language.

For AI stages, define an evaluation corpus and record model, prompt, source chunks, confidence and output version. A plausible answer is not sufficient bibliographic provenance.

## Resume checklist

```bash
cd /Users/zztt/projects/packages/seshat
git status --short
git log -5 --oneline
npm test
npm run typecheck
npm run build
```

Then inspect:

- [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and pipeline flow.
- [CONFIGURATION.md](CONFIGURATION.md) before running services.
- [TESTING.md](TESTING.md) for test coverage and manual checks.
- [DEPLOYMENT.md](DEPLOYMENT.md) before any server mutation.

Before implementation, verify whether the live database already contains jobs created by the feature being changed. Avoid replaying or deleting production work merely to make a new handler convenient.

## Scope note

The earlier SOOG disk-cleanup and Git-history discussion concerns a separate project and is not part of the Seshat repository. Do not perform destructive cleanup there while resuming Seshat work unless the user explicitly brings it back into scope.
