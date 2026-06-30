# Roadmap: Seshat

## Phase 1 — Portable Bibliographic Spine ✓

Build and test `@seshat/core` plus the Zotero provider. Produce normalized records,
stable identities, health reports, and storage-neutral document links.

Completed 2026-06-30 with tested `@seshat/core` and `@seshat/zotero` packages.

## Phase 2 — Structured Document Ingestion

Add the Docling service, ephemeral R2 downloads, structured derivatives, provenance,
and safe upload of generated artifacts back to R2.

## Phase 3 — First Curatorial Surface

Build the web application for browsing records, health issues, originals, and parsed
documents. Deploy it at `seshat.zztt.org` from `/opt/packages/seshat`.

The first intake slice now includes ecosystem authentication, page-wide file drop,
mixed-batch routing, and a parsed BibTeX inspection surface. R2-backed document jobs
remain part of Phase 2 before intake can be considered durable.

Document enrichment proceeds through four persisted stages: structure/text extraction,
identifier discovery (ISBN string first, Google Books fallback from title/author), initial
summary, then corpus-relative tags. Local Ollama agents may execute stages, but never own
the catalog or overwrite provenance.

Libraries are first-class corpora above references. A document keeps one stable identity
and may belong to several libraries; summaries describe the document, while relational
tags and similarity are evaluated within a selected library.

## Phase 4 — Application Adapters

Integrate the versioned packages into Musiki AR, then validate the same contract from
Musiki CH and SO PhD without sharing data.
