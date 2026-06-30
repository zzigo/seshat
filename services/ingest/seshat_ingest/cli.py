from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .pipeline import IngestRequest, ingest_document


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Parse a PDF or EPUB into Seshat artifacts.")
    command.add_argument("source", type=Path)
    command.add_argument("--reference-id", required=True)
    command.add_argument("--artifact-id", required=True)
    command.add_argument("--output", required=True, type=Path)
    command.add_argument("--parser-version")
    command.add_argument("--ocr", action="store_true", help="Enable OCR for scanned PDFs.")
    return command


def main() -> None:
    arguments = parser().parse_args()
    result = ingest_document(IngestRequest(
        reference_id=arguments.reference_id,
        original_artifact_id=arguments.artifact_id,
        source_path=arguments.source,
        output_dir=arguments.output,
        parser_version=arguments.parser_version,
        ocr=arguments.ocr,
    ))
    print(json.dumps(asdict(result), ensure_ascii=False))


if __name__ == "__main__":
    main()
