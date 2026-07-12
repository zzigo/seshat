<!-- generated-by: gsd-doc-writer -->
# Seshat documentation

Seshat is a modular, source-aware bibliography system for collecting references, preserving their documents in Wasabi, extracting structure with Docling, and preparing the corpus for human and local-agent curation.

This directory is the operational source of truth for developers and agents. Start with the architecture and handoff documents, then follow the task-specific guide.

## Documentation map

| Document | Use it for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, technologies, data model, ingestion flow, workspace and key design decisions |
| [CONFIGURATION.md](CONFIGURATION.md) | Environment variables, defaults and secret-handling rules |
| [GETTING-STARTED.md](GETTING-STARTED.md) | First local installation and run |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Daily local workflow, commands and code conventions |
| [TESTING.md](TESTING.md) | Test layout, verification commands and current gaps |
| [API.md](API.md) | Authenticated HTTP endpoints and payloads |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Local-to-GitHub-to-VPS release procedure and rollback |
| [HANDOFF.md](HANDOFF.md) | Current production state, completed work, known issues and next actions |

## Current capabilities

- Framework-neutral bibliography model, DOI/ISBN normalization, citekeys, fingerprints and health reports.
- Selective Zotero adapter package without coupling the core domain to Zotero.
- Authenticated Astro workspace with hierarchical libraries and a dense Handsontable catalog.
- Dockview pods for PDF, extracted text, document structure and future analysis/annotation/agent tools.
- Inline drag-and-drop for PDF, EPUB, DOCX, TXT and BibTeX without leaving the workspace.
- Wasabi originals and derivatives; the VPS uses temporary files only during extraction.
- Docling derivatives: structured JSON, Markdown, hierarchical chunks and a compact document map.
- Local Ollama inference for title, author and year, with Google Books and Open Library validation/fallback.
- Manual metadata protected from later automatic overwrite.
- Immediate deletion of a reference, its PostgreSQL rows and all known Wasabi objects.
- Trusted, owner-scoped citation search for editors such as Musiki.

## Important boundaries

- Each consuming application or deployment owns separate data and credentials. Packages are shared; catalogs are not.
- PostgreSQL is the catalog and queue authority. Wasabi is the binary/document authority.
- Zotero is an adapter, not the canonical schema.
- Dockview is the spatial runtime, not the domain model.
- `summarize` and `relate` are represented in the queue but are not yet executed by the worker.

## Fast orientation

Local repository:

```text
/Users/zztt/projects/packages/seshat
```

Production repository:

```text
/opt/packages/seshat
```

Production process names:

```text
seshat-web
seshat-worker
```

The standard validation command is:

```bash
npm test && npm run typecheck && npm run build
```

See [HANDOFF.md](HANDOFF.md) before changing production state.
