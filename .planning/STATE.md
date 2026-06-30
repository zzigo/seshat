# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-30)

**Core value:** Keep references, documents, parsed meaning, and citation health connected.
**Current focus:** Phase 2 — R2 transport and structured ingestion.

## Current Status

- Repository initialized at `/Users/zztt/projects/packages/seshat`.
- VPS destination agreed as `/opt/packages/seshat`.
- `gsd-sdk` was unavailable, so initialization artifacts were created manually.
- `@seshat/core` and `@seshat/zotero` compile and pass nine package tests.
- Docling 2.107 completed a real 30-page PDF conversion into structured JSON, Markdown,
  and page-aware chunks; born-digital text quality still needs evaluation before deciding
  whether OCR should be retried.
- Phase 1 implementation is committed as `9f49fcd`; Docling ingestion is committed as
  `214f8b0`.
- The first Astro web surface executes `@seshat/core` directly and exposes a health API.
- GitHub authority: `https://github.com/zzigo/seshat`, branch `main`.
- Production web: `https://seshat.zztt.org`, deployed from `/opt/packages/seshat`
  under PM2 (`seshat-web`) and Caddy on port 4331.
- Desktop and 390px mobile layouts were verified in the in-app browser with no console errors.
- The local web surface now has isolated Auth.js sessions backed by the shared Authentik and
  Google identity providers, a page-wide drop layer, IndexedDB batch preservation across login,
  mixed document/BibTeX routing, and server-side BibTeX parsing. Production identity-provider
  callback registration and R2-backed document jobs remain pending.
