# Seshat ingest

The ingestion package converts an ephemeral local PDF, EPUB, document, WebArchive, or DjVu source into durable derivatives:

- `document.json`: Docling's structured document model;
- `document.md`: portable human-readable representation;
- `chunks.jsonl`: structure-aware chunks with evidence metadata;
- `manifest.json`: hashes, provenance, parser version, and artifact inventory.

Safari WebArchives additionally produce a sanitized `document.html` reader. DjVu files
keep the original untouched and produce a `document.pdf` reader derivative with a text
layer when OCRmyPDF is available. DjVuLibre supplies the page conversion and native text.

Wasabi transport is deliberately outside the parser. A deployment downloads an object into
a temporary directory, runs this package, uploads derivatives, records their object keys
in the bibliography database, and removes the temporary directory.

This keeps Docling independently testable and prevents local/VPS storage from becoming
an accidental document authority.

OCR is opt-in (`--ocr`). Born-digital PDFs retain their text layer and avoid loading an
OCR engine; scanned documents can be routed explicitly after detection or user choice.

The first smoke test also demonstrated why extraction quality must be measured: a PDF
can contain a text layer and still contain poor legacy OCR. Seshat will preserve that
result and flag it for an OCR retry instead of silently treating it as authoritative.
