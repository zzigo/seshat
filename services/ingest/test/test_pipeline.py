from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from seshat_ingest.pipeline import IngestRequest, ingest_document


class FakeDocument:
    def export_to_markdown(self) -> str:
        return "# A cultivated text\n\nEvidence survives structure.\n"

    def export_to_dict(self) -> dict:
        return {"name": "A cultivated text", "pages": [{"number": 1}]}


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
            self.assertEqual([item.kind for item in manifest.artifacts], [
                "docling-json", "markdown", "chunks",
            ])
            self.assertTrue((output / "document.json").exists())
            self.assertIn("cultivated", (output / "document.md").read_text())
            chunk = json.loads((output / "chunks.jsonl").read_text())
            self.assertEqual(chunk["metadata"]["page"], 1)
            persisted = json.loads((output / "manifest.json").read_text())
            self.assertEqual(persisted["source_sha256"], manifest.source_sha256)

    def test_rejects_unsupported_sources_before_docling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.zip"
            source.write_bytes(b"not supported yet")
            with self.assertRaisesRegex(ValueError, "PDF, EPUB, DOCX, and TXT"):
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
