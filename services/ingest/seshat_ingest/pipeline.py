from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

from .djvu import extract_djvu
from .webarchive import extract_webarchive


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
    ocr: bool
    created_at: str
    artifacts: tuple[GeneratedArtifact, ...]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _artifact(path: Path) -> GeneratedArtifact:
    media_type = {
        ".json": "application/json",
        ".jsonl": "application/x-ndjson",
        ".md": "text/markdown",
        ".html": "text/html; charset=utf-8",
        ".pdf": "application/pdf",
    }.get(path.suffix, "application/octet-stream")
    return GeneratedArtifact(
        kind={
            "document.json": "docling-json",
            "document.md": "markdown",
            "chunks.jsonl": "chunks",
            "structure.json": "structure",
            "document.html": "html",
            "document.pdf": "reader-pdf",
            "djvu-text.json": "djvu-text",
        }.get(path.name, "derived"),
        filename=path.name,
        media_type=media_type,
        sha256=_sha256(path),
        size_bytes=path.stat().st_size,
    )


def _write(path: Path, content: bytes) -> GeneratedArtifact:
    path.write_bytes(content)
    return _artifact(path)


def _markdown_structure(markdown: str) -> dict[str, Any]:
    sections: list[dict[str, Any]] = []
    parents: list[tuple[int, str]] = []
    in_fence = False
    for line_number, line in enumerate(markdown.splitlines(), start=1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if not match:
            continue
        level = len(match.group(1))
        title = re.sub(r"[*_`]+", "", match.group(2)).strip()
        if not title:
            continue
        while parents and parents[-1][0] >= level:
            parents.pop()
        section_id = f"section-{len(sections) + 1}"
        sections.append({
            "id": section_id,
            "level": level,
            "title": title,
            "parentId": parents[-1][1] if parents else None,
            "sourceLine": line_number,
        })
        parents.append((level, section_id))
    return {"schemaVersion": 1, "sections": sections}


def _semantic_section(title: str) -> str:
    normalized = re.sub(r"[^a-záéíóúüñ]+", " ", title.casefold()).strip()
    normalized = re.sub(r"^\d+(?:\s+\d+)*\s+", "", normalized)
    patterns = (
        ("toc", r"^(table of contents|contents|índice|indice|contenido)$"),
        ("introduction", r"^(introduction|introducción|introduccion)(\b|$)"),
        ("references", r"^(references|bibliography|works cited|referencias|bibliografía|bibliografia)(\b|$)"),
        ("appendix", r"^(appendix|appendices|apéndice|apendice|anexo)(\b|$)"),
    )
    return next((kind for kind, pattern in patterns if re.search(pattern, normalized)), "section")


def _section_level(title: str, explicit: Any) -> int:
    numbered = re.match(r"^\s*(\d+(?:\.\d+){0,5})(?:[.)]|\s)", title)
    if numbered:
        return min(6, numbered.group(1).count(".") + 1)
    return max(1, min(6, int(explicit) if isinstance(explicit, int) else 1))


def _docling_structure(document: dict[str, Any], markdown: str) -> dict[str, Any]:
    """Build a compact, page-addressable outline from Docling's durable model."""
    collections = {
        key: value for key, value in document.items()
        if isinstance(value, list) and key in {
            "texts", "pictures", "tables", "groups", "key_value_items", "form_items"
        }
    }

    def resolve(reference: Any) -> dict[str, Any] | None:
        path = reference.get("$ref", "") if isinstance(reference, dict) else ""
        match = re.fullmatch(r"#/(\w+)/(\d+)", path)
        if not match:
            return None
        rows = collections.get(match.group(1), [])
        index = int(match.group(2))
        return rows[index] if index < len(rows) else None

    def page_of(item: dict[str, Any]) -> int | None:
        provenance = item.get("prov")
        if not isinstance(provenance, list):
            return None
        for entry in provenance:
            page = entry.get("page_no") if isinstance(entry, dict) else None
            if isinstance(page, int) and page > 0:
                return page
        return None

    ordered: list[dict[str, Any]] = []

    def walk(reference: Any) -> None:
        item = resolve(reference)
        if not item:
            return
        if item.get("label") in {"page_header", "page_footer"} or item.get("content_layer") == "furniture":
            return
        if isinstance(item.get("children"), list) and item.get("label") in {"list", "ordered_list", "group"}:
            for child in item["children"]:
                walk(child)
            return
        ordered.append(item)

    body = document.get("body")
    for child in body.get("children", []) if isinstance(body, dict) else []:
        walk(child)

    sections: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []
    parents: list[tuple[int, str]] = []
    current_section: str | None = None
    kind_map = {
        "text": "paragraph", "paragraph": "paragraph", "formula": "formula",
        "picture": "picture", "table": "table", "list_item": "list",
        "caption": "caption", "code": "code", "checkbox_selected": "form",
        "checkbox_unselected": "form", "key_value_area": "form",
    }

    for item in ordered:
        label = str(item.get("label") or "text")
        text = str(item.get("text") or item.get("orig") or "").strip()
        page = page_of(item)
        if label in {"section_header", "title"} and text:
            level = _section_level(text, item.get("level", 1))
            while parents and parents[-1][0] >= level:
                parents.pop()
            section_id = f"section-{len(sections) + 1}"
            sections.append({
                "id": section_id,
                "level": level,
                "title": text,
                "parentId": parents[-1][1] if parents else None,
                "page": page,
                "kind": _semantic_section(text),
            })
            parents.append((level, section_id))
            current_section = section_id
            continue
        kind = kind_map.get(label, "paragraph")
        if kind == "paragraph" and not text:
            continue
        blocks.append({
            "id": f"block-{len(blocks) + 1}",
            "kind": kind,
            "label": label,
            "page": page,
            "sectionId": current_section,
            "text": text[:240] if text else None,
        })

    if not sections and not blocks:
        return _markdown_structure(markdown)
    return {"schemaVersion": 2, "sections": sections, "blocks": blocks}


def _default_converter(*, ocr: bool) -> Converter:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = ocr
    if ocr:
        from docling.datamodel.pipeline_options import RapidOcrOptions
        pdf_options.ocr_options = RapidOcrOptions()
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
    if source.suffix.lower() not in {".pdf", ".epub", ".docx", ".txt", ".webarchive", ".djvu", ".djv"}:
        raise ValueError("Seshat ingestion accepts PDF, EPUB, DOCX, TXT, WebArchive, and DjVu documents.")

    output_dir = request.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    html_bytes: bytes | None = None
    reader_pdf: Path | None = None
    djvu_text_bytes: bytes | None = None
    custom_structure: dict[str, Any] | None = None
    effective_ocr = request.ocr
    if source.suffix.lower() in {".djvu", ".djv"}:
        reader_pdf = output_dir / "document.pdf"
        extracted = extract_djvu(source, reader_pdf)
        document_dict = {"schema": "seshat-djvu-reader", **extracted["metadata"]}
        json_bytes = json.dumps(document_dict, ensure_ascii=False, indent=2).encode("utf-8")
        markdown_bytes = extracted["markdown"].encode("utf-8")
        chunk_rows = extracted["chunks"]
        custom_structure = extracted["structure"]
        djvu_text_bytes = json.dumps(extracted["textLayer"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        effective_ocr = bool(extracted["metadata"].get("ocrApplied"))
        if not chunk_rows:
            conversion = (converter or _default_converter(ocr=True)).convert(reader_pdf)
            document = conversion.document
            converted_dict = document.export_to_dict()
            document_dict["ocrDocument"] = converted_dict
            markdown_bytes = document.export_to_markdown().encode("utf-8")
            chunk_rows = list((chunker or _default_chunks)(document))
            custom_structure = _docling_structure(converted_dict, markdown_bytes.decode("utf-8"))
            effective_ocr = True
            json_bytes = json.dumps(document_dict, ensure_ascii=False, indent=2).encode("utf-8")
    elif source.suffix.lower() == ".webarchive":
        extracted = extract_webarchive(source)
        document_dict = {"schema": "seshat-webarchive-reader", **extracted["metadata"]}
        json_bytes = json.dumps(document_dict, ensure_ascii=False, indent=2).encode("utf-8")
        markdown_bytes = extracted["markdown"].encode("utf-8")
        html_bytes = extracted["html"].encode("utf-8")
        chunk_rows = extracted["chunks"]
    elif source.suffix.lower() == ".txt":
        text = source.read_text(encoding="utf-8", errors="replace")
        document_dict = {"schema": "seshat-plain-text", "text": text}
        json_bytes = json.dumps(document_dict, ensure_ascii=False, indent=2).encode("utf-8")
        markdown_bytes = text.encode("utf-8")
        paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
        chunk_rows = [{"id": index, "text": part, "metadata": {}} for index, part in enumerate(paragraphs)]
    else:
        conversion = (converter or _default_converter(ocr=request.ocr)).convert(source)
        document = conversion.document
        document_dict = document.export_to_dict()
        json_bytes = json.dumps(document_dict, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
        markdown_bytes = document.export_to_markdown().encode("utf-8")
        chunk_rows = list((chunker or _default_chunks)(document))
    chunk_bytes = b"".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
        for row in chunk_rows
    )
    structure_bytes = json.dumps(
        custom_structure if custom_structure is not None else
        _docling_structure(document_dict, markdown_bytes.decode("utf-8")) if source.suffix.lower() not in {".txt", ".webarchive"}
        else _markdown_structure(markdown_bytes.decode("utf-8")),
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8")

    artifacts = (
        _write(output_dir / "document.json", json_bytes),
        _write(output_dir / "document.md", markdown_bytes),
        _write(output_dir / "chunks.jsonl", chunk_bytes),
        _write(output_dir / "structure.json", structure_bytes),
        *(() if html_bytes is None else (_write(output_dir / "document.html", html_bytes),)),
        *(() if reader_pdf is None else (_artifact(reader_pdf),)),
        *(() if djvu_text_bytes is None else (_write(output_dir / "djvu-text.json", djvu_text_bytes),)),
    )
    timestamp = (now or (lambda: datetime.now(UTC).isoformat()))()
    manifest = IngestManifest(
        schema_version=1,
        reference_id=request.reference_id,
        original_artifact_id=request.original_artifact_id,
        source_sha256=_sha256(source),
        source_size_bytes=source.stat().st_size,
        parser="djvulibre" if source.suffix.lower() in {".djvu", ".djv"} else "webarchive-reader" if source.suffix.lower() == ".webarchive" else "plain-text" if source.suffix.lower() == ".txt" else "docling",
        parser_version=request.parser_version,
        ocr=effective_ocr,
        created_at=timestamp,
        artifacts=artifacts,
    )
    (output_dir / "manifest.json").write_text(
        json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest
