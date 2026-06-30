<!-- generated-by: gsd-doc-writer -->
# Development

## Local setup

The active local checkout convention is:

```text
/Users/zztt/projects/packages/seshat
```

Install with `npm install` for dependency development and create a root `.env` plus `.venv` as described in [GETTING-STARTED.md](GETTING-STARTED.md).

The repository is an npm workspace monorepo. Internal package dependencies use `*`; build packages before directly running compiled applications.

## Commands

### Root commands

| Command | Description |
|---|---|
| `npm run build:packages` | Build `@seshat/core`, `@seshat/zotero` and `@seshat/catalog` in dependency order |
| `npm run build` | Build packages, Astro server and Node worker |
| `npm test` | Build packages, run all workspace tests and Python unit tests |
| `npm run test:packages` | Run every workspace test script that exists |
| `npm run test:python` | Run Python ingestion tests with the correct `PYTHONPATH` |
| `npm run typecheck` | Build packages, then typecheck all workspaces |

### Web application

| Command | Description |
|---|---|
| `npm run dev --workspace @seshat/web` | Astro development server on port 4331 by default |
| `npm run build --workspace @seshat/web` | Build standalone Astro server output |
| `npm run preview --workspace @seshat/web` | Preview the built web application |
| `npm run typecheck --workspace @seshat/web` | Run `astro check` |

### Worker and packages

```bash
npm run build --workspace @seshat/worker
npm run typecheck --workspace @seshat/worker
npm run test --workspace @seshat/core
npm run test --workspace @seshat/catalog
npm run test --workspace @seshat/zotero
```

## Typical change workflow

1. Confirm the checkout is clean with `git status --short`.
2. Read the relevant implementation and tests before editing.
3. Preserve unrelated user changes in a dirty worktree.
4. Change source files; do not hand-edit generated `dist/` output.
5. Run the narrowest relevant test/typecheck while iterating.
6. Before commit, run:

   ```bash
   npm test && npm run typecheck && npm run build
   ```

7. Inspect `git diff --check` and `git diff`.
8. Commit intentionally and push `main` only when the change is production-ready.
9. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the VPS.

## Adding or changing database fields

The schema lives as idempotent SQL in `packages/catalog/src/index.ts` and runs through `ensureSchema()`.

Current practice:

- Add new tables/indexes with `CREATE ... IF NOT EXISTS`.
- Add compatible columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Update TypeScript interfaces and row mapping in the same commit.
- Test against an existing database, not only an empty database.

There is no migration ledger or down migration. Complex/destructive schema changes should introduce a real migration system before proceeding.

## Adding an API route

Routes live under `apps/web/src/pages/api/`.

Required pattern for protected routes:

1. Read the session from `locals.session`.
2. Return `401 {"error":"authentication_required"}` when no email exists.
3. Derive `ownerKeyFor(email)`.
4. Scope catalog queries by owner key.
5. Validate file sizes, content types and input lengths before mutation.
6. Return structured JSON errors with an appropriate HTTP status.

Update [API.md](API.md) whenever a route or payload changes.

## Extending the enrichment pipeline

The job stages already include `summarize` and `relate`, but the current worker claim query only accepts `extract` and `identify`.

When implementing a new stage:

- preserve the gate: complete one stage and queue the next in one database transaction;
- keep provider/model evidence in the job payload or reference provenance;
- never let an LLM become catalog authority;
- check `source.curation.manualFields` before writing metadata;
- bound model time, context and output;
- ensure retries are idempotent;
- keep binaries in R2 and temporary local files under a removable temp directory.

## Workspace conventions

- `apps/web/src/pages/workspace.astro` owns the authenticated shell and serialized initial payload.
- `apps/web/src/scripts/workspace.ts` owns the client controller.
- Handsontable is the catalog surface; use `loadData` sources carefully to avoid autosave loops.
- Dockview is accessed through semantic controller methods such as `openDocument`, `openDerivative` and `openTool` rather than from arbitrary page code.
- The left library tree remains stable outside Dockview.
- Expensive future pods should lazy-load their UI/runtime and release resources when disposed.

Handsontable currently uses the `non-commercial-and-evaluation` license key, matching the academic prototype. Resolve licensing before commercial use.

## Code style

No ESLint, Prettier, Biome or EditorConfig project configuration is committed. TypeScript uses strict workspace configs; Astro uses `astro check`; Python follows typed, small pure-function patterns tested with `unittest`.

Until explicit formatting tooling is added:

- match the surrounding file;
- use two spaces in TypeScript/JSON;
- keep SQL parameterized;
- keep Python at four spaces;
- prefer small source patches over generated-file edits;
- run `git diff --check` to catch whitespace errors.

## Branch and commit conventions

The default branch is `main`. No branch naming policy or PR template is committed. Recent work uses concise Conventional Commit-style prefixes such as `feat:`, `fix:`, `chore:` and `docs:`.

This repository is currently maintained directly by its owner with agent assistance. If outside contributions begin, add branch protection, CI and a contribution guide before scaling the workflow.

## Generated and ignored files

Do not commit:

- `.env` or `.env.*` except `.env.example`;
- `node_modules/`;
- `.venv/`;
- `.astro/`;
- `dist/`;
- logs, caches or `__pycache__/`.

The committed source of truth is `src/`, `services/ingest/seshat_ingest/`, package metadata, configuration and documentation.
