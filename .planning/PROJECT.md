# Seshat

## What This Is

Seshat is an intelligent bibliography system that understands the documents behind
references. It provides reusable packages for Musiki AR, Musiki CH, and SO PhD while
each application retains an independent database, language, credentials, and library.

## Core Value

A reference, its original document, its parsed meaning, and its citation health remain
connected through stable identities and portable interfaces.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Model bibliographic records independently from Zotero.
- [ ] Import selected Zotero collections as normalized CSL-compatible records.
- [ ] Link records to documents stored in Cloudflare R2.
- [ ] Parse PDF and EPUB documents locally with Docling while retaining structure.
- [ ] Detect incomplete or malformed bibliographic metadata.
- [ ] Expose the same capabilities to multiple applications through versioned packages.
- [ ] Provide a web surface at `seshatt.zztt.org`.

### Out of Scope

- Sharing data between consuming applications — only infrastructure is shared.
- Storing document binaries on the VPS — originals and large derivatives live in R2.
- Bidirectional Zotero editing in the first release — initial integration is selective import.
- Vector search and autonomous crawling in the first vertical slice — added after traceable ingestion.

## Context

Musiki currently embeds BibTeX blocks in notes, uses Postgres as runtime authority, and
stores binary resources in Cloudflare R2. Zotero is the short-term metadata editor but
is expected to be replaced progressively. Seshat must therefore treat Zotero as an
adapter, not as its domain model.

The development repository lives at `/Users/zztt/projects/packages/seshat`. Production
will mirror it at `/opt/packages/seshat` on the existing VPS. The public hostname is
`seshatt.zztt.org`; the doubled `t` belongs only to the hostname.

## Constraints

- **Storage**: Document binaries and large derivatives remain in Cloudflare R2.
- **Isolation**: Every consuming application owns separate data and secrets.
- **Portability**: Core packages cannot depend on Astro, Vue, Svelte, React, or a database ORM.
- **Evidence**: Parsed chunks must retain document, page, section, and parser provenance.
- **Operations**: The VPS currently has limited free disk; Docling caches and documents must not accumulate there.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Name the product Seshat | Writing, archives, measurement, and the House of Books | — Pending |
| Build a modular monolith | Reuse infrastructure without sharing application data | — Pending |
| Keep Zotero behind a provider interface | Allows Seshat-native authority later | — Pending |
| Use CSL-compatible JSON as interchange | Portable across Zotero, citeproc, Pandoc, and web apps | — Pending |
| Preserve structured Docling output | Plain text alone loses pages, tables, and evidence anchors | — Pending |

---
*Last updated: 2026-06-30 after initialization*

