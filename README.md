# Seshat

Seshat is an intelligent, source-aware bibliography system. It keeps bibliographic
identity, document storage, parsed text, citation health, and future agent retrieval
connected without coupling applications to Zotero or any single storage provider.

The repository is a modular monolith. Applications consume framework-neutral packages;
each deployment owns its own data and credentials.

## Workspace

- `packages/core`: canonical bibliography model, identifiers, health checks.
- `packages/zotero`: Zotero Web API adapter and CSL normalization.
- `services/ingest`: Docling-based document ingestion service.
- `apps/web`: the Seshat web surface for `seshat.zztt.org`.

Production convention: `/opt/packages/seshat`.
