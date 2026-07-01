<!-- generated-by: gsd-doc-writer -->
# HTTP API

The Astro application exposes a small same-origin API for the Seshat workspace. Except for the health endpoint, every route requires a valid Auth.js session and scopes catalog access through the normalized email-derived `ownerKey`.

The browser normally calls these routes. They are not currently versioned as a public integration API.

## Conventions

- Base URL in production: `https://seshat.zztt.org`.
- Authenticated failures return HTTP `401` with `{ "error": "authentication_required" }`.
- JSON is used unless a route explicitly expects `multipart/form-data` or streams an artifact.
- A reference belonging to another owner is indistinguishable from a missing reference.
- There is no application-level rate limiter yet; upload limits are enforced per request.

## Public health check

### `GET /api/health.json`

Returns the application name, status, version and capability labels. This route does not test PostgreSQL, R2, Docling or Ollama connectivity.

```json
{
  "name": "seshat",
  "status": "ok",
  "version": "0.1.0",
  "capabilities": ["bibliography-core", "zotero-provider", "docling-ingest"]
}
```

## Authentication

### `GET|POST /api/auth/[...auth]`

Auth.js/Auth Astro handler. It implements provider discovery, sign-in, callback, session, CSRF and sign-out endpoints. Production uses Authentik OIDC; Google can also be enabled when its credentials are configured. Application code should use the Auth.js client flow rather than call callback routes manually.

## Trusted integrations

### `GET /api/integrations/citations/search`

Server-to-server citation search for consumers such as Musiki. It requires `Authorization: Bearer <SESHAT_INTEGRATION_TOKEN>`. By default, `X-Seshat-Owner` contains the authenticated consumer user's email. When `SESHAT_INTEGRATION_OWNER_KEY` is configured, the integration is pinned to that curated catalog instead; this avoids identity-claim differences between applications. Do not call this endpoint directly from browser JavaScript or expose its bearer token through a public environment variable.

Query parameters are `q`, optional `libraryId`, and `limit` (1–50). An empty query returns recently updated references. Results contain the citekey, title, authors, year, identifiers, tags and library membership, but never artifact storage credentials.

### `GET /api/integrations/citations/resolve`

Resolves up to 100 exact citekeys supplied as repeated `key` parameters or a comma-separated `keys` parameter. It uses the same trusted-integration authentication and returns CSL-JSON records plus a `missing` list, allowing consumers to run Pandoc/citeproc formatting without copying BibTeX into each note.

## Document intake

### `POST /api/intake/documents`

Accepts one document, stores the original in R2, inserts the catalog record and queues processing.

Request: `multipart/form-data`

| Field | Required | Meaning |
|---|---:|---|
| `file` | yes | PDF, DOCX, TXT or EPUB; 1 byte through 256 MiB |
| `libraryId` | no | Existing library to which the reference should be attached |

The server calculates SHA-256 before upload. A duplicate for the same owner is not uploaded again; it is attached to `libraryId` when provided.

Success for a new document: HTTP `201`.

```json
{
  "ok": true,
  "duplicate": false,
  "reference": {}
}
```

A duplicate returns HTTP `200` with `duplicate: true`. Relevant errors are `400` for a missing file, `415` for an unsupported extension, `413` for size, and `503` when storage or catalog configuration is absent.

### `POST /api/bibliography/parse`

Parses one or more BibTeX files without persisting them.

Request: `multipart/form-data`; repeat the `files` field for each `.bib` file. Each file must be at most 10 MiB.

```json
{
  "entries": [],
  "errors": []
}
```

Each returned entry or parse error includes its `sourceFile`.

### `POST /api/bibliography/import`

Persists one `.bib` file as metadata-only catalog references. Send `file` plus either an existing `libraryId`, or omit it to create a new top-level library named from `libraryName` or the filename. An optional `parentId` nests that new library. The response includes the destination library and imported references.

## Libraries

### `POST /api/libraries`

Creates a top-level or nested library.

```json
{
  "name": "Music cognition",
  "parentId": "optional-parent-uuid"
}
```

Names are normalized and limited to 160 characters. Duplicate sibling names return HTTP `409`.

### `POST /api/library/:id/libraries`

Adds a reference to a library.

```json
{
  "libraryId": "library-uuid"
}
```

The response contains the complete updated `libraryIds` array.

### `PUT /api/library/:id/libraries`

Replaces all memberships, enabling true moves in the tree. An empty `libraryIds` array leaves the reference outside folders while retaining it in the catalog.

### `PATCH|DELETE /api/libraries/:id`

`PATCH` renames a library and/or changes `parentId`; cycles are rejected. `DELETE` removes the library subtree but preserves its references. The protected Inbox cannot be renamed or deleted.

### `GET|POST|DELETE /api/libraries/:id/shares`

Owners can list recipients, share with a normalized Musiki-user email, or revoke a recipient using `?email=`. Shared roots include their descendant folders and references. Recipient access is read-only: originals and generated artifacts can be opened, while metadata edits, moves and deletions remain owner-only.

## Reference metadata

### `POST /api/library/:id/metadata`

Updates curated metadata. Request format is `multipart/form-data`.

| Field | Validation |
|---|---|
| `title` | required, 1–1000 characters |
| `authors` | newline- or semicolon-separated, at most 50 |
| `year` | empty or integer 1–2100 |
| `isbns` | newline-, comma- or semicolon-separated; normalized and checksum-validated |
| `citeKey` | 1–160 letters, numbers, colon, underscore or hyphen |
| `type` | `article`, `article-journal`, `book`, `chapter`, `document`, `paper-conference`, `report` or `thesis` |
| `tags` | comma-, semicolon- or newline-separated; first 100 unique tags |
| `language` | first 32 characters |
| `abstract` | first 20,000 characters |

All fields handled by this endpoint are marked as manual. Later agentic identification must preserve them.

### `GET /api/library/:id/status`

Returns the current table-ready reference projection and pipeline jobs.

```json
{
  "reference": {
    "id": "reference-uuid",
    "status": "extract",
    "hasStructure": false,
    "hasText": false
  },
  "pipeline": [],
  "ready": false,
  "failed": null
}
```

The workspace polls this endpoint while extraction or identification is active.

## Artifact streaming

### `GET /api/library/:id/original`

Streams the original R2 object inline with its original Unicode filename and private/no-store caching headers.

### `GET /api/library/:id/artifact/:kind`

Streams a generated artifact. Allowed kinds are:

- `markdown`
- `structure`
- `chunks`
- `docling-json`

Other values return HTTP `404`.

## Deletion

### `DELETE /api/library/:id`

Deletes without a confirmation round-trip, by product design. The handler:

1. marks queued/running jobs for cancellation;
2. removes catalogued R2 artifact keys;
3. removes any remaining objects below the reference prefix;
4. deletes the PostgreSQL reference and dependent records.

```json
{
  "ok": true,
  "id": "reference-uuid",
  "objectsDeleted": 5
}
```

If R2 deletion fails, database deletion is not performed and HTTP `502` is returned. The table must optimistically remove rows only while still restoring them if this request fails.
