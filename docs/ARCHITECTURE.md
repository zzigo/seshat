<!-- generated-by: gsd-doc-writer -->
# Architecture

## System overview

Seshat is a modular monolith. A server-rendered Astro application accepts authenticated documents and bibliographies; PostgreSQL stores bibliographic records, libraries and enrichment jobs; Cloudflare R2 stores originals and generated artifacts; a single Node worker downloads an original into an ephemeral directory, calls the Python/Docling ingestion package, uploads derivatives, and performs evidence-constrained metadata identification with local Ollama plus public bibliography providers.

The reusable `@seshat/*` packages are framework-neutral. Musiki AR, Musiki CH and SO PhD can consume the same packages while keeping independent databases, R2 credentials, identity clients and languages.

## Component diagram

```mermaid
graph TD
  Browser[Authenticated browser] --> Web[Astro web application]
  Web --> Catalog[PostgresCatalog]
  Web --> R2[Cloudflare R2]
  Web --> Auth[Authentik / optional Google OAuth]
  Catalog --> PG[(PostgreSQL)]
  Worker[Node enrichment worker] --> Catalog
  Worker --> R2
  Worker --> Ingest[Python seshat-ingest]
  Ingest --> Docling[Docling]
  Worker --> Ollama[Local Ollama]
  Worker --> Books[Google Books / Open Library]
  Core[@seshat/core] --> Web
  Core --> Worker
  Zotero[@seshat/zotero] --> Core
```

## Technologies

| Area | Technology | Role |
|---|---|---|
| Runtime | Node.js 22, TypeScript 5.9, npm workspaces | Web app, worker and reusable packages |
| Web | Astro 6 with `@astrojs/node` standalone adapter | SSR pages and API routes |
| Identity | Auth.js via `auth-astro`, OIDC/PKCE, Authentik; optional Google provider | Shared ecosystem login with Seshat-specific cookies |
| Catalog UI | Handsontable 17 | Dense editable table, filters, sorting, copy/paste and autosave |
| Spatial UI | `dockview-core` 5 | Tabs, splits, panel persistence and document/tool pods |
| Database | PostgreSQL via `pg` | Catalog, library hierarchy, memberships and enrichment queue |
| Object storage | Cloudflare R2 via AWS SDK v3 S3 client | Originals and all generated derivatives |
| Parsing | Python 3.11+, Docling 2.x | PDF/EPUB/DOCX structure and text extraction |
| Local AI | Ollama with structured JSON output; production model `qwen3:1.7b` | Candidate title, authors and year |
| Bibliographic providers | Google Books API and Open Library | ISBN/title/author validation and enrichment |
| BibTeX | `@retorquere/bibtex-parser` | Parse dropped `.bib` files into an inspection pod |
| Process manager | PM2 | Production web and worker lifecycle |
| Reverse proxy | Caddy | TLS and reverse proxy to Astro on loopback |

## Repository structure

```text
apps/
  web/                 Astro pages, APIs, authentication and workspace UI
  worker/              PostgreSQL job consumer, R2 transport and metadata identification
packages/
  core/                Canonical bibliography types, identifiers, citekeys and health
  catalog/             PostgreSQL schema and catalog operations
  zotero/              Zotero Web API adapter and mapper
services/
  ingest/              Python/Docling parser and tests
docs/                   Developer, API, deployment and handoff documentation
ecosystem.config.cjs    PM2 definitions and .env loader
.env.example            Non-secret configuration contract
```

## Key abstractions

| Abstraction | Location | Responsibility |
|---|---|---|
| `BibliographicItem` | `packages/core/src/types.ts` | Storage-neutral canonical reference |
| `BibliographyProvider` | `packages/core/src/provider.ts` | Provider query/pagination contract |
| Identifier utilities | `packages/core/src/identifiers.ts` | Normalize/validate DOI and ISBN, generate citekeys and fingerprints |
| `evaluateReferenceHealth` | `packages/core/src/health.ts` | Deterministic metadata completeness/validity report |
| `ZoteroProvider` | `packages/zotero/src/provider.ts` | Paginated Zotero Web API implementation |
| `PostgresCatalog` | `packages/catalog/src/index.ts` | Schema bootstrap, records, libraries, memberships, annotations and jobs |
| `ingest_document` | `services/ingest/seshat_ingest/pipeline.py` | Reproducible structured derivative generation |
| Worker `run/tick/claim` | `apps/worker/src/index.ts` | Serialized enrichment queue consumption |
| `mountSeshatWorkspace` | `apps/web/src/scripts/workspace.ts` | Catalog table, tree, Dockview adapter, uploads and HUD |

## Data model

`PostgresCatalog.ensureSchema()` currently performs idempotent DDL at runtime. There is no separate migration system yet.

### `catalog_references`

Canonical records scoped by `owner_key`. Important fields include citekey, type, title, contributors, issued date, identifiers, tags, abstract, language, source/provenance, and the SHA-256 of the original. `(owner_key, original_sha256)` prevents duplicate uploads for one owner.

`contributors` is a canonical ordered JSON array, never a display string. A personal name stores `family`, `given` and `role`; an institution or intentionally unsplit name stores `literal` and `role`. The table exposes one compact Contributors column whose mini editor adds, removes, reorders and assigns roles without multiplying columns. CSL groups names by role, while Better BibTeX emits corresponding `author`, `editor`, `translator` and `composer` fields.

### `catalog_artifacts`

Links a reference to an R2 object. Every artifact retains kind, provider, object key, bucket, MIME type, size, SHA-256 and optional ETag.

Artifact kinds currently stored by the production pipeline:

- `original`
- `docling-json`
- `markdown`
- `chunks`
- `structure`

### `catalog_jobs`

One row per reference and stage. The ordered stages are:

1. `extract`
2. `identify`
3. `summarize`
4. `relate`

Statuses are `queued`, `blocked`, `running`, `complete` and `failed`. Only `extract` and `identify` are currently consumed by `apps/worker`; later stages remain queued/blocked for future workers.

### `catalog_libraries`, `catalog_library_items` and `catalog_library_shares`

Libraries are owner-scoped and can be nested through `parent_id`. References can belong to multiple libraries through the join table. Every owner has an `Inbox` library used as the default target.

A share grants another deterministic email-derived owner key read-only access to one library subtree. Ownership never changes and storage is not duplicated. Catalog reads calculate the accessible subtree recursively; all mutations remain scoped to the original owner.

### `catalog_annotations`

Annotations are personal layers scoped by both `reference_id` and the annotator's `owner_key`; a recipient may therefore annotate a shared reference without modifying its owner metadata. Each row stores a semantic category independently from its exact Zotero-compatible color, plus a W3C-style text quote/position selector (`quote`, `prefix`, `suffix`, start/end offsets), source kind, optional page/locator, normalized PDF rectangles, note type, tags, targets and review state.

PDF annotation is part of the document visualizer: PDF.js renders canvas and selectable text layers, while persisted normalized rectangles form the highlight layer and a collapsible right sidebar exposes the index. The separate Annotation pod contains only the index/editor for one attached reference and never duplicates the document viewer. Legacy text selectors can reanchor by exact quote and surrounding context. Colors are presentation; categories remain stable for search, accessibility and future Musiki exports.

### `catalog_identities`

Authentik email is mutable and is not a durable ownership identifier. Middleware binds the OIDC provider plus stable `sub` claim to the existing opaque `owner_key`, updates current email as profile metadata, and caches the alias for legacy routes. The account dashboard can recover a previous email-derived catalog only for configured Authentik/Seshat administrators and only when the target catalog is not linked to another identity. A non-empty current catalog is merged transactionally after checking duplicate originals and conflicting library names; R2 objects remain in place because artifact rows retain exact keys.

The username opens `/dashboard`, which aggregates items, exact extracted word counts, annotations, libraries, publication years, structured authors and tags. Word counts are recorded by the Docling worker from generated Markdown; `npm run backfill:words -- --apply` fills existing zero-count records from private R2 derivatives.

## Upload and ingestion data flow

1. The authenticated user drops PDF, EPUB, DOCX, TXT or BibTeX on `/workspace`.
2. Document files are uploaded directly to `POST /api/intake/documents`; the browser stays in the workspace and reports progress in the bottom HUD.
3. The API validates type/size, computes SHA-256, deduplicates per owner and writes the original to R2 under `seshat/{ownerKey}/{referenceId}/original/...`.
4. One reference, one original artifact, library membership and four gated job rows are committed in PostgreSQL.
5. The worker claims one queued `extract`/`identify` job using `FOR UPDATE SKIP LOCKED` and processes jobs serially.
6. For extraction, the worker downloads the original to a temporary directory, invokes `python -m seshat_ingest.cli`, uploads derivatives under `seshat/{ownerKey}/{referenceId}/derived/docling/`, records them, and removes the temporary directory in `finally`.
7. The browser polls the authenticated status endpoint and updates the same Handsontable row; it never navigates to a separate extraction screen.
8. Once structure exists, the HUD and document toolbar can open it as a Dockview pod.

## Docling outputs

`services/ingest/seshat_ingest/pipeline.py` writes:

| File | Catalog kind | Purpose |
|---|---|---|
| `document.json` | `docling-json` | Complete structured Docling model |
| `document.md` | `markdown` | Portable text representation used by UI and identification |
| `chunks.jsonl` | `chunks` | Hierarchical chunks with metadata/evidence |
| `structure.json` | `structure` | Compact heading tree with `id`, `level`, `title`, `parentId`, `sourceLine` |
| `manifest.json` | transport-only | Source hash, parser provenance and derivative inventory |

Plain text follows a lightweight path without Docling. OCR is opt-in in the Python CLI; the production worker does not yet enable OCR or implement a scanned-document retry policy.

## Metadata identification

Identification is deliberately evidence-constrained:

1. Find and checksum-validate explicit ISBN strings in extracted Markdown.
2. Query Google Books with the dedicated server key; fall back to Open Library.
3. If needed, ask local Ollama for structured `title`, `authors`, `year`, and `confidence` using the first and last document evidence.
4. Validate provider results against title/author evidence before persisting.
5. If providers cannot validate a record, persist Docling/Ollama title, author or year only when each accepted value appears in document evidence.
6. Store provider, volume ID or inference, accepted fields, confidence and status under `source.identification`.

Manual edits store `source.curation.manualFields`. The worker checks these markers and will not overwrite human-curated title, contributors, issued year or identifiers.

## Workspace architecture

The authenticated `/workspace` is a desktop-oriented shell:

- Stable left tree: search, all references, hierarchical libraries, drag/drop moves, CRUD and read-only shared subtrees.
- Handsontable catalog pod: fixed-height rows with truncated cell text, bulk scalar metadata editing, and a structured contributor mini editor opened from the Contributors cell or context menu.
- Dockview host: catalog, PDF, extracted text, structure, BibTeX inspection, analysis, annotation and agent pods.
- Bottom activity HUD: upload, extraction, identification, errors and “Open map” action.
- Dockview layout persists in browser `localStorage`; temporary parsed BibTeX payloads use `sessionStorage`.

PDFs use the authenticated original stream in an iframe. EPUB/DOCX/TXT use the Docling/Markdown derivative. `epubjs` was evaluated and removed because its dependency chain contained unsafe XML packages; visual EPUB rendering remains a future adapter.

## Deletion semantics

The leading `×` in Handsontable deletes without confirmation, by explicit product decision. The server:

1. marks jobs failed to cancel queued/running work;
2. deletes every cataloged artifact and every object under the reference R2 prefix;
3. deletes the reference, cascading artifacts, jobs and memberships in PostgreSQL;
4. the browser closes associated pods and removes the row only after the API succeeds.

The worker checks that an extraction job is still `running` before each derivative upload, reducing orphan risk during concurrent deletion.

## Security and ownership

- Every protected route derives an opaque `ownerKey` by hashing the authenticated email.
- Catalog writes include `owner_key`; catalog and R2 reads additionally honor explicit library shares. Shared records are read-only.
- Session and CSRF cookies are HTTP-only, SameSite Lax and secure in production.
- Uploads are limited to 256 MiB per document; BibTeX files are limited to 10 MiB.
- Original and derivative responses use `private, no-store`.
- Literal credentials must never enter the repository or documentation.

Known security follow-up: Astro currently has `security.checkOrigin: false`; review whether it can be re-enabled behind Caddy without breaking Auth.js callbacks.
