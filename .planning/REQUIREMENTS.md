# Requirements: Seshat

**Defined:** 2026-06-30
**Core Value:** Keep references, documents, parsed meaning, and citation health connected.

## v1 Requirements

### Bibliographic Core

- [x] **CORE-01**: A consumer can represent a bibliographic item without Zotero-specific fields.
- [x] **CORE-02**: A record preserves source identity, citekey, DOI/ISBN fingerprints, and provenance.
- [x] **CORE-03**: A deterministic health check reports missing or malformed metadata.
- [x] **CORE-04**: A record can link original and derived documents through storage-neutral descriptors.

### Zotero Import

- [x] **ZOT-01**: A consumer can import top-level items from one selected Zotero collection.
- [x] **ZOT-02**: Zotero creators, dates, identifiers, and attachments normalize into core records.
- [x] **ZOT-03**: Incremental synchronization preserves Zotero item keys and library versions.

### Document Ingestion

- [ ] **ING-01**: An authorized caller can submit an R2 document reference for Docling ingestion.
- [x] **ING-02**: Ingestion produces structured JSON and Markdown derivatives with provenance.
- [ ] **ING-03**: PDF and EPUB inputs never require permanent local VPS storage.

### Web Surface

- [x] **WEB-01**: A user can inspect bibliographic records and their health status.
- [ ] **WEB-02**: A user can inspect attached originals and parsed derivatives.
- [ ] **WEB-03**: The application is deployable at `seshat.zztt.org` from `/opt/packages/seshat`.

## v2 Requirements

### Native Curation

- **CUR-01**: User can correct authors, titles, dates, DOI, and ISBN inside Seshat.
- **CUR-02**: Seshat proposes metadata from identifiers and document evidence.
- **CUR-03**: User can merge duplicate references without breaking citekeys.

### Retrieval

- **RAG-01**: Structured chunks can be embedded and retrieved with page-level citations.
- **RAG-02**: Local agents can crawl authorized collections and propose relationships.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shared production database across apps | Data isolation is explicit |
| Full Zotero clone in v1 | First validate the portable core and ingestion spine |
| Permanent document storage on VPS | R2 is the established blob authority |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01..04 | Phase 1 | Complete |
| ZOT-01..03 | Phase 1 | Complete |
| ING-01, ING-03 | Phase 2 | Pending |
| ING-02 | Phase 2 | Complete |
| WEB-01 | Phase 3 | Complete |
| WEB-02..03 | Phase 3 | Pending |

**Coverage:** 13 v1 requirements; 13 mapped; 0 unmapped. 9 verified complete.

---
*Requirements defined: 2026-06-30*
