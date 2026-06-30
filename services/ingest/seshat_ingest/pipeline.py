from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol


class ConvertedDocument(Protocol):
    def export_to_markdown(self) -> str: ...
    def export_to_dict(self) -> dict[str, Any]: ...


class ConversionResult(Protocol):
    document: ConvertedDocument


class Converter(Protocol):
    def convert(self, source: str | Path) -> ConversionResult: ...


class Chunk(Protocol):
    text: str
    meta: Any


@dataclass(frozen=True)
class IngestRequest:
    reference_id: str
    original_artifact_id: str
    source_path: Path
    output_dir: Path
    parser_version: str | None = None
    ocr: bool = False


@dataclass(frozen=True)
class GeneratedArtifact:
    kind: str
    filename: str
    media_type: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class IngestManifest:
    schema_version: int
    reference_id: str
    original_artifact_id: str
    source_sha256: str
    source_size_bytes: int
    parser: str
    parser_version: str | None
    created_at: str
    artifacts: tuple[GeneratedArtifact, ...]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write(path: Path, content: bytes) -> GeneratedArtifact:
    path.write_bytes(content)
    media_type = {
        ".json": "application/json",
        ".jsonl": "application/x-ndjson",
        ".md": "text/markdown",
    }.get(path.suffix, "application/octet-stream")
    return GeneratedArtifact(
        kind={
            "document.json": "docling-json",
            "document.md": "markdown",
            "chunks.jsonl": "chunks",
        }.get(path.name, "derived"),
        filename=path.name,
        media_type=media_type,
        sha256=_sha256(path),
        size_bytes=path.stat().st_size,
    )


def _default_converter(*, ocr: bool) -> Converter:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = ocr
    return DocumentConverter(format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
    })


def _default_chunks(document: ConvertedDocument) -> Iterable[dict[str, Any]]:
    from docling.chunking import HierarchicalChunker

    for index, chunk in enumerate(HierarchicalChunker().chunk(document)):
        meta = getattr(chunk, "meta", None)
        if hasattr(meta, "export_json_dict"):
            metadata = meta.export_json_dict()
        elif hasattr(meta, "model_dump"):
            metadata = meta.model_dump(mode="json")
        else:
            metadata = {}
        yield {
            "id": index,
            "text": chunk.text,
            "metadata": metadata,
        }


def ingest_document(
    request: IngestRequest,
    *,
    converter: Converter | None = None,
    chunker: Callable[[ConvertedDocument], Iterable[dict[str, Any]]] | None = None,
    now: Callable[[], str] | None = None,
) -> IngestManifest:
    source = request.source_path.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Document not found: {source}")
    if source.suffix.lower() not in {".pdf", ".epub"}:
        raise ValueError("Seshat ingestion currently accepts PDF and EPUB documents.")

    output_dir = request.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    conversion = (converter or _default_converter(ocr=request.ocr)).convert(source)
    document = conversion.document

    json_bytes = json.dumps(
        document.export_to_dict(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    markdown_bytes = document.export_to_markdown().encode("utf-8")
    chunk_rows = list((chunker or _default_chunks)(document))
    chunk_bytes = b"".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
        for row in chunk_rows
    )

    artifacts = (
        _write(output_dir / "document.json", json_bytes),
        _write(output_dir / "document.md", markdown_bytes),
        _write(output_dir / "chunks.jsonl", chunk_bytes),
    )
    timestamp = (now or (lambda: datetime.now(UTC).isoformat()))()
    manifest = IngestManifest(
        schema_version=1,
        reference_id=request.reference_id,
        original_artifact_id=request.original_artifact_id,
        source_sha256=_sha256(source),
        source_size_bytes=source.stat().st_size,
        parser="docling",
        parser_version=request.parser_version,
        created_at=timestamp,
        artifacts=artifacts,
    )
    (output_dir / "manifest.json").write_text(
        json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest
