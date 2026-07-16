from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

TOOL_ROOT = Path(os.environ.get("SESHAT_DJVU_TOOL_ROOT", Path(__file__).resolve().parents[3] / ".tools" / "djvu"))


def _tool(name: str, *, required: bool = True) -> str | None:
    bundled = TOOL_ROOT / "usr" / "bin" / name
    executable = shutil.which(name) or (str(bundled) if bundled.is_file() else None)
    if required and not executable:
        raise RuntimeError(f"DjVu ingestion requires the '{name}' command from DjVuLibre.")
    return executable


def _run(command: list[str], *, timeout: int = 1800) -> subprocess.CompletedProcess[bytes]:
    try:
        library_path = TOOL_ROOT / "usr" / "lib" / "x86_64-linux-gnu"
        environment = os.environ.copy()
        if library_path.is_dir():
            environment["LD_LIBRARY_PATH"] = f"{library_path}:{environment.get('LD_LIBRARY_PATH', '')}".rstrip(":")
        return subprocess.run(command, check=True, capture_output=True, timeout=timeout, env=environment)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", errors="replace").strip()[-1200:]
        raise RuntimeError(f"DjVu conversion failed: {detail or error}") from error


def _page_count(path: Path) -> int:
    result = _run([str(_tool("djvused")), str(path), "-e", "n"])
    match = re.search(r"\d+", result.stdout.decode("utf-8", errors="replace"))
    return max(1, int(match.group(0))) if match else 1


def _extract_text(command: str | None, path: Path, *arguments: str, output_dash: bool = True) -> str:
    if not command:
        return ""
    try:
        result = _run([command, *arguments, str(path), *(["-"] if output_dash else [])])
    except RuntimeError:
        return ""
    return result.stdout.decode("utf-8", errors="replace").replace("\x00", "").strip()


def _pages(text: str, page_count: int) -> list[str]:
    values = [re.sub(r"[ \t]+\n", "\n", page).strip() for page in text.split("\f")]
    while values and not values[-1]:
        values.pop()
    values.extend([""] * max(0, page_count - len(values)))
    return values[: max(page_count, len(values))]


def _text_layer(detail: str) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    matches = list(re.finditer(r"\(page\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)", detail))
    word_pattern = re.compile(r'\(word\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+"((?:\\.|[^"\\])*)"')
    for index, match in enumerate(matches):
        block = detail[match.end(): matches[index + 1].start() if index + 1 < len(matches) else len(detail)]
        x0, y0, x1, y1 = (int(match.group(position)) for position in range(1, 5))
        words = []
        for word in word_pattern.finditer(block):
            value = word.group(5).replace(r'\"', '"')
            words.append({"x0": int(word.group(1)), "y0": int(word.group(2)), "x1": int(word.group(3)), "y1": int(word.group(4)), "text": value})
        pages.append({"width": max(1, x1 - x0), "height": max(1, y1 - y0), "words": words})
    return {"schemaVersion": 1, "pages": pages}


def extract_djvu(path: Path, reader_pdf: Path) -> dict[str, Any]:
    """Create a durable PDF reader derivative and searchable page text."""
    ddjvu = str(_tool("ddjvu"))
    djvutxt = _tool("djvutxt", required=False)
    native_text = _extract_text(djvutxt, path, output_dash=False)
    text_layer = _text_layer(_extract_text(djvutxt, path, "-detail=word", output_dash=False))
    page_count = _page_count(path)
    raw_pdf = reader_pdf.with_name(f"{reader_pdf.stem}.raw.pdf")
    _run([ddjvu, "-format=pdf", "-skip", str(path), str(raw_pdf)])
    if not raw_pdf.is_file() or raw_pdf.stat().st_size == 0:
        raise RuntimeError("DjVuLibre did not produce a readable PDF derivative.")

    ocr_applied = False
    ocrmypdf = _tool("ocrmypdf", required=False)
    if ocrmypdf:
        language = re.sub(r"[^a-zA-Z0-9_+-]", "", os.environ.get("SESHAT_DJVU_OCR_LANGUAGE", ""))
        command = [ocrmypdf, "--skip-text", "--output-type", "pdf", "--optimize", "1", "--jobs", "1", "--quiet"]
        if language:
            command.extend(["--language", language])
        try:
            _run([*command, str(raw_pdf), str(reader_pdf)])
            ocr_applied = reader_pdf.is_file() and reader_pdf.stat().st_size > 0
        except RuntimeError:
            ocr_applied = False
    if not ocr_applied:
        raw_pdf.replace(reader_pdf)
    else:
        raw_pdf.unlink(missing_ok=True)

    pdf_text = _extract_text(_tool("pdftotext", required=False), reader_pdf, "-layout")
    page_text = _pages(pdf_text or native_text, page_count)
    title = path.stem
    markdown_parts = [f"# {title}"]
    chunks: list[dict[str, Any]] = []
    sections: list[dict[str, Any]] = []
    for index, text in enumerate(page_text, start=1):
        markdown_parts.extend([f"## Page {index}", text or "[No embedded text detected on this page.]"])
        sections.append({"id": f"page-{index}", "level": 2, "title": f"Page {index}", "parentId": None, "page": index, "kind": "page"})
        for paragraph in (part.strip() for part in re.split(r"\n\s*\n", text)):
            if paragraph:
                chunks.append({"id": len(chunks), "text": re.sub(r"\s+", " ", paragraph), "metadata": {"page": index}})
    return {
        "markdown": "\n\n".join(markdown_parts).strip() + "\n",
        "metadata": {"title": title, "pageCount": page_count, "nativeText": bool(native_text), "ocrApplied": ocr_applied},
        "chunks": chunks,
        "structure": {"schemaVersion": 2, "sections": sections, "blocks": []},
        "textLayer": text_layer,
    }
