# AI-SPEC — Phase 2: Structured document ingestion and identification

## 1. System Classification

**System Type:** Hybrid extraction pipeline with a bounded local agent.

Docling creates evidence-preserving derivatives. Deterministic ISBN extraction and Google
Books verification run before Ollama. Ollama may infer title/author search terms from document
evidence but cannot directly establish identifiers.

**Critical Failure Modes:** invented ISBN; overwriting user metadata without provenance;
losing page/source evidence; jobs stuck in `running`; cross-library data leakage.

## 1b. Domain Context

**Vertical:** scholarly bibliography and education. **Users:** researchers and teachers.
**Stakes:** medium: wrong identity silently corrupts citations and downstream corpus relations.

Experts accept identifiers only when checksum-valid and supported by the document or an external
bibliographic record whose title/author match. They flag editions conflated under one ISBN,
OCR-confused digits, cover/catalogue ISBNs mistaken for the work, and translated editions merged
with originals. Human curator review is the authority for ambiguous matches. No special regulatory
regime identified; copyright-protected originals remain access-controlled.

## 2. Framework Decision

**Selected:** direct Ollama HTTP API 0.16.x; no agent framework.

The flow is short, state already lives in PostgreSQL, and retries/checkpoints are catalog jobs.
LangGraph was rejected as unnecessary orchestration; LlamaIndex was rejected because retrieval is
not yet the problem. Vendor lock-in is low because the one model call uses a JSON Schema contract.

## 3. Quick Reference

```bash
curl http://127.0.0.1:11434/api/chat -d @request.json
```

```python
from ollama import chat
result = chat(model="deepseek-r1:8b", messages=messages,
              format=Candidate.model_json_schema(), options={"temperature": 0})
```

Concepts: `format` accepts JSON Schema; `stream:false` simplifies short structured extraction;
temperature zero improves repeatability. Do not use cloud models because structured outputs are
not supported there. Validate every response and cap evidence context.

## 4. Implementation Guidance

Use local `qwen3:4b`, temperature 0, at most 12k characters from the beginning/end of the
extracted text. Pipeline state and provenance remain in PostgreSQL. Tools are Docling, Google Books
Volumes API, ISBN checksum validation, R2, and Ollama. Each job is claimed with `SKIP LOCKED` and
transitions atomically.

## 4b. AI Systems Best Practices

```python
from pydantic import BaseModel, Field
class Candidate(BaseModel):
    title: str = Field(max_length=500)
    authors: list[str] = Field(max_length=12)
    year: int | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: list[str] = Field(max_length=5)
```

Validate once; retry once with the validation error, then flag for human review. Calls are async and
non-streaming. Prompts distinguish untrusted document text from instructions. Cache by derivative
SHA-256. Ollama is invoked only when deterministic ISBN extraction yields nothing.

## 5. Evaluation Strategy

| Dimension | Pass criterion | Method | Priority |
|---|---|---|---|
| ISBN precision | 100% checksum-valid; ≥99% correct edition on gold set | Code + human | Critical |
| Metadata match | title/author corresponds to document | Human rubric | High |
| Evidence | every accepted value records source | Code | Critical |
| Job recovery | crash returns job to retryable state | Integration | High |

Start with 20 labeled documents: explicit ISBN, OCR-confused ISBN, multiple editions, no ISBN,
article mistaken for book, multilingual title pages. Use Node tests plus a JSON fixture set in CI;
Phoenix tracing is deferred until generative summary/tag stages because deterministic job events
already capture this phase.

## 6. Guardrails

Reject invalid checksums; never accept an Ollama-supplied ISBN; require Google result title/author
agreement; retain old values and provenance; send ambiguous/multiple matches to curator review.
Sample all failed and low-confidence jobs offline.

## 7. Production Monitoring

Track queue age, stage latency, failure/retry rate, ISBN source, Google/Ollama call counts, and human
rejection rate. Alert when queued >30 minutes, failure >10%, or any persisted invalid ISBN appears.

## Checklist

- [x] System and failure modes classified
- [x] Domain criteria and human authority defined
- [x] Framework selected with alternative analysis
- [x] Structured output/Pydantic contract defined
- [x] Evaluation dataset and guardrails defined
- [x] Production metrics defined
