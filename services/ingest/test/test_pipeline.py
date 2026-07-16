from __future__ import annotations

import json
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from seshat_ingest.pipeline import IngestRequest, ingest_document


class FakeDocument:
    def export_to_markdown(self) -> str:
        return "# A cultivated text\n\nEvidence survives structure.\n"

    def export_to_dict(self) -> dict:
        return {
            "name": "A cultivated text",
            "body": {"children": [
                {"$ref": "#/texts/0"}, {"$ref": "#/texts/1"},
                {"$ref": "#/pictures/0"}, {"$ref": "#/texts/2"},
            ]},
            "texts": [
                {"label": "section_header", "level": 1, "text": "Introduction", "prov": [{"page_no": 1}]},
                {"label": "text", "text": "Evidence survives structure.", "prov": [{"page_no": 1}]},
                {"label": "section_header", "level": 2, "text": "References", "prov": [{"page_no": 3}]},
            ],
            "pictures": [{"label": "picture", "prov": [{"page_no": 2}]}],
            "pages": {"1": {"page_no": 1}},
        }


class FakeResult:
    document = FakeDocument()


class FakeConverter:
    def convert(self, source: str | Path) -> FakeResult:
        self.source = Path(source)
        return FakeResult()


class IngestPipelineTest(unittest.TestCase):
    def test_writes_reproducible_structured_derivatives(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"fake pdf source")
            output = root / "output"
            manifest = ingest_document(
                IngestRequest(
                    reference_id="ref:1",
                    original_artifact_id="artifact:original",
                    source_path=source,
                    output_dir=output,
                    parser_version="test",
                ),
                converter=FakeConverter(),
                chunker=lambda _document: [{
                    "id": 0,
                    "text": "Evidence survives structure.",
                    "metadata": {"page": 1},
                }],
                now=lambda: "2026-06-30T00:00:00+00:00",
            )

            self.assertEqual(manifest.reference_id, "ref:1")
            self.assertFalse(manifest.ocr)
            self.assertEqual([item.kind for item in manifest.artifacts], [
                "docling-json", "markdown", "chunks", "structure",
            ])
            self.assertTrue((output / "document.json").exists())
            self.assertIn("cultivated", (output / "document.md").read_text())
            chunk = json.loads((output / "chunks.jsonl").read_text())
            self.assertEqual(chunk["metadata"]["page"], 1)
            structure = json.loads((output / "structure.json").read_text())
            self.assertEqual(structure["schemaVersion"], 2)
            self.assertEqual(structure["sections"][0]["title"], "Introduction")
            self.assertEqual(structure["sections"][0]["level"], 1)
            self.assertEqual(structure["sections"][0]["kind"], "introduction")
            self.assertEqual(structure["sections"][1]["kind"], "references")
            self.assertEqual(structure["sections"][1]["parentId"], structure["sections"][0]["id"])
            self.assertEqual([block["kind"] for block in structure["blocks"]], ["paragraph", "picture"])
            self.assertEqual(structure["blocks"][1]["page"], 2)
            persisted = json.loads((output / "manifest.json").read_text())
            self.assertEqual(persisted["source_sha256"], manifest.source_sha256)

    def test_rejects_unsupported_sources_before_docling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.zip"
            source.write_bytes(b"not supported yet")
            with self.assertRaisesRegex(ValueError, "PDF, EPUB, DOCX, TXT, WebArchive, and DjVu"):
                ingest_document(IngestRequest(
                    reference_id="ref:1",
                    original_artifact_id="artifact:1",
                    source_path=source,
                    output_dir=Path(directory) / "output",
                ), converter=FakeConverter())

    def test_plain_text_ingestion_without_docling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.txt"
            source.write_text("ISBN 978-0-19-515194-7\n\nSecond paragraph.", encoding="utf-8")
            result = ingest_document(IngestRequest("ref:1", "artifact:1", source, root / "out"))
            self.assertEqual(result.parser, "plain-text")
            self.assertIn("978-0-19", (root / "out" / "document.md").read_text())

    def test_webarchive_creates_clean_reader_html_and_search_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "article.webarchive"
            page = b"""<!doctype html><html><head><title>Signal and Form</title>
              <meta name="author" content="Ada Example"><meta property="article:published_time" content="2026-07-17">
              </head><body><nav>Home Shop Subscribe Advertising</nav><main><article>
              <h1>Signal and Form</h1><p>This is the first substantial paragraph of the archived scholarly article.</p>
              <img src="https://example.org/figure.png" alt="A useful figure"><script>alert('never')</script>
              <p>This second paragraph preserves the argument while navigation and scripts disappear.</p>
              </article></main><aside>Related clickbait</aside></body></html>"""
            source.write_bytes(plistlib.dumps({
                "WebMainResource": {
                    "WebResourceData": page,
                    "WebResourceMIMEType": "text/html",
                    "WebResourceTextEncodingName": "UTF-8",
                    "WebResourceURL": "https://example.org/research/signal",
                },
                "WebSubresources": [{
                    "WebResourceData": b"fake-png",
                    "WebResourceMIMEType": "image/png",
                    "WebResourceURL": "https://example.org/figure.png",
                }],
            }, fmt=plistlib.FMT_BINARY))
            result = ingest_document(IngestRequest("ref:web", "artifact:web", source, root / "out"))
            reader = (root / "out" / "document.html").read_text()
            markdown = (root / "out" / "document.md").read_text()
            self.assertEqual(result.parser, "webarchive-reader")
            self.assertEqual([item.kind for item in result.artifacts][-1], "html")
            self.assertIn("Signal and Form", reader)
            self.assertIn("data:image/png;base64,", reader)
            self.assertNotIn("Subscribe Advertising", reader)
            self.assertNotIn("<script", reader)
            self.assertIn("first substantial paragraph", markdown)
            self.assertIn("Source: https://example.org/research/signal", markdown)

    def test_djvu_creates_pdf_reader_and_page_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "old-score.djvu"
            source.write_bytes(b"AT&TFORM fake DjVu")

            def fake_extract(_source: Path, reader_pdf: Path) -> dict:
                reader_pdf.write_bytes(b"%PDF-1.7 reader")
                return {
                    "metadata": {"title": "old-score", "pageCount": 2, "nativeText": True, "ocrApplied": False},
                    "markdown": "# old-score\n\n## Page 1\n\nFirst page.\n\n## Page 2\n\nSecond page.\n",
                    "chunks": [{"id": 0, "text": "First page.", "metadata": {"page": 1}}],
                    "structure": {"schemaVersion": 2, "sections": [{"id": "page-1", "level": 2, "title": "Page 1", "page": 1}], "blocks": []},
                }

            with patch("seshat_ingest.pipeline.extract_djvu", side_effect=fake_extract):
                result = ingest_document(IngestRequest("ref:djvu", "artifact:djvu", source, root / "out"))
            self.assertEqual(result.parser, "djvulibre")
            self.assertEqual(result.artifacts[-1].kind, "reader-pdf")
            self.assertEqual(result.artifacts[-1].media_type, "application/pdf")
            self.assertEqual((root / "out" / "document.pdf").read_bytes(), b"%PDF-1.7 reader")
            structure = json.loads((root / "out" / "structure.json").read_text())
            self.assertEqual(structure["sections"][0]["page"], 1)

    def test_ocr_is_opt_in(self) -> None:
        request = IngestRequest(
            reference_id="ref:1",
            original_artifact_id="artifact:1",
            source_path=Path("source.pdf"),
            output_dir=Path("output"),
        )
        self.assertFalse(request.ocr)


if __name__ == "__main__":
    unittest.main()
