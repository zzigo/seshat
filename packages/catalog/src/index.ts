import { Pool, type PoolClient } from 'pg';

export * from './scholarly.js';

export type EnrichmentStage = 'extract' | 'scholarly' | 'identify' | 'summarize' | 'relate';
export type JobStatus = 'queued' | 'blocked' | 'running' | 'complete' | 'failed';

export interface CatalogArtifact {
  id: string;
  kind: string;
  provider: string;
  objectKey: string;
  bucket?: string;
  mimeType?: string;
  sizeBytes: number;
  sha256: string;
  etag?: string;
  createdAt: string;
}

export interface CatalogJob {
  id: string;
  stage: EnrichmentStage;
  status: JobStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogReference {
  id: string;
  ownerKey: string;
  citeKey: string;
  type: string;
  title: string;
  contributors: unknown[];
  issued?: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  tags: string[];
  abstract?: string;
  language?: string;
  publisher?: string;
  publisherPlace?: string;
  url?: string;
  source: Record<string, unknown>;
  originalSha256: string;
  wordCount: number;
  artifacts: CatalogArtifact[];
  jobs: CatalogJob[];
  createdAt: string;
  updatedAt: string;
  libraryIds: string[];
  access: 'owner' | 'viewer';
}

export interface CatalogLibrary {
  id: string;
  ownerKey: string;
  name: string;
  description?: string;
  parentId?: string;
  itemCount: number;
  createdAt: string;
  access: 'owner' | 'viewer';
  sharedByEmail?: string;
}

export interface CatalogLibraryShare {
  libraryId: string;
  email: string;
  createdAt: string;
}

export interface CatalogAnnotation {
  id: string;
  referenceId: string;
  ownerKey: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  sourceKind: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  page?: number;
  locator?: string;
  color: string;
  category: string;
  noteType?: string;
  note?: string;
  tags: string[];
  targets: string[];
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogAnnotationInput {
  quote: string;
  prefix?: string;
  suffix?: string;
  startOffset: number;
  endOffset: number;
  sourceKind?: string;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
  page?: number;
  locator?: string;
  color: string;
  category: string;
  noteType?: string;
  note?: string;
  tags?: string[];
  targets?: string[];
  reviewStatus?: string;
}

export interface CatalogDashboardStats {
  totals: { items: number; words: number; libraries: number; annotations: number; concepts: number };
  topAuthors: Array<{ name: string; count: number }>;
  publicationYears: Array<{ year: number; count: number }>;
  topTags: Array<{ name: string; count: number }>;
  topConcepts: Array<{ name: string; count: number }>;
}

export interface CatalogDocumentInput {
  id: string;
  ownerKey: string;
  citeKey: string;
  title: string;
  source: Record<string, unknown>;
  originalSha256: string;
  artifact: Omit<CatalogArtifact, 'createdAt'>;
  libraryId?: string;
}

export interface CatalogOriginalReplacement {
  originalFilename: string;
  originalSha256: string;
  artifact: Omit<CatalogArtifact, 'createdAt'>;
}

export interface CatalogMetadataUpdate {
  title: string;
  citeKey: string;
  type: string;
  contributors: unknown[];
  issued?: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  tags: string[];
  abstract?: string;
  language?: string;
  publisher?: string;
  publisherPlace?: string;
  url?: string;
  bibliographicFields?: Record<string, string>;
  manualFields: string[];
}

export interface CatalogBibliographyInput {
  id: string;
  citeKey: string;
  type: string;
  title: string;
  contributors: unknown[];
  issued?: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  tags?: string[];
  abstract?: string;
  language?: string;
  publisher?: string;
  publisherPlace?: string;
  url?: string;
  source: Record<string, unknown>;
  originalSha256: string;
  createdAt?: string;
  originalFilename?: string;
  artifact?: Omit<CatalogArtifact, 'createdAt'>;
}

export interface CitationSearchResult {
  id: string;
  citeKey: string;
  type: string;
  title: string;
  contributors: unknown[];
  issued?: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  tags: string[];
  language?: string;
  publisher?: string;
  publisherPlace?: string;
  url?: string;
  libraryIds: string[];
  updatedAt: string;
}

export interface CatalogChunkInput {
  id: string;
  ordinal: number;
  content: string;
  contentSha256: string;
  page?: number;
  locator?: string;
  section?: string;
  metadata?: Record<string, unknown>;
}

export interface CatalogChunkSearchResult {
  chunkId: string;
  referenceId: string;
  title: string;
  citeKey: string;
  content: string;
  snippet: string;
  page?: number;
  locator?: string;
  section?: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface CatalogVectorChunk extends CatalogChunkInput {
  referenceId: string;
  ownerKey: string;
  title: string;
  citeKey: string;
  tags: string[];
  language?: string;
}

export interface CatalogGraphNodeInput {
  key: string;
  kind: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface CatalogGraphEdgeInput {
  key: string;
  from: string;
  relation: string;
  to: string;
  chunkId?: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface CatalogPaperRecord {
  referenceId:string; ownerKey:string; documentId:string; fileHash:string; title:string; normalizedTitle:string;
  extractedMetadata:Record<string,unknown>; extractedReferences:unknown[]; doi?:string; openAlexId?:string;
  resolutionStatus:'resolved'|'ambiguous'|'unresolved'; resolutionMethod:string; resolutionConfidence:number;
  candidates:unknown[]; openAlexWork?:Record<string,unknown>; expansion:Record<string,unknown>; provenance:Record<string,unknown>;
  createdAt:string; updatedAt:string;
}

export function buildInitialJobs(_referenceId: string, id: () => string = () => crypto.randomUUID()): CatalogJob[] {
  const timestamp = new Date().toISOString();
  return (['extract', 'scholarly', 'identify', 'summarize', 'relate'] as const).map((stage, index) => ({
    id: id(),
    stage,
    status: index === 0 ? 'queued' : 'blocked',
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

const schema = `
  CREATE TABLE IF NOT EXISTS catalog_references (
    id text PRIMARY KEY,
    owner_key text NOT NULL,
    cite_key text NOT NULL,
    type text NOT NULL DEFAULT 'misc',
    title text NOT NULL,
    contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
    issued jsonb,
    identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    abstract text,
    language text,
    publisher text,
    publisher_place text,
    url text,
    source jsonb NOT NULL DEFAULT '{}'::jsonb,
    original_sha256 text NOT NULL,
    word_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_key, original_sha256)
  );
  CREATE INDEX IF NOT EXISTS catalog_references_owner_updated_idx
    ON catalog_references (owner_key, updated_at DESC);
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS publisher text;
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS publisher_place text;
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS url text;
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS word_count integer NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS catalog_keyword_styles (
    owner_key text NOT NULL,
    keyword text NOT NULL,
    color text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_key,keyword)
  );

  CREATE TABLE IF NOT EXISTS catalog_chunks (
    id text PRIMARY KEY,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    owner_key text NOT NULL,
    ordinal integer NOT NULL,
    content text NOT NULL,
    content_sha256 text NOT NULL,
    page integer,
    locator text,
    section text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    vector_status text NOT NULL DEFAULT 'pending' CHECK (vector_status IN ('pending','running','complete','failed')),
    vector_attempts integer NOT NULL DEFAULT 0,
    vector_model text,
    vector_error text,
    indexed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(reference_id, ordinal, content_sha256)
  );
  CREATE INDEX IF NOT EXISTS catalog_chunks_search_idx ON catalog_chunks USING GIN(search_vector);
  CREATE INDEX IF NOT EXISTS catalog_chunks_reference_idx ON catalog_chunks(reference_id, ordinal);
  CREATE INDEX IF NOT EXISTS catalog_chunks_vector_queue_idx ON catalog_chunks(vector_status, updated_at);
  ALTER TABLE catalog_chunks ADD COLUMN IF NOT EXISTS vector_attempts integer NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS catalog_vector_deletions (
    chunk_id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS catalog_graph_nodes (
    owner_key text NOT NULL,
    node_key text NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_key, node_key)
  );
  CREATE INDEX IF NOT EXISTS catalog_graph_nodes_label_idx ON catalog_graph_nodes(owner_key, lower(label));
  CREATE TABLE IF NOT EXISTS catalog_graph_edges (
    edge_key text NOT NULL,
    owner_key text NOT NULL,
    evidence_reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    from_key text NOT NULL,
    relation text NOT NULL,
    to_key text NOT NULL,
    evidence_chunk_id text REFERENCES catalog_chunks(id) ON DELETE SET NULL,
    weight real NOT NULL DEFAULT 1,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_key, edge_key)
  );
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_graph_edges_pkey' AND pg_get_constraintdef(oid) NOT LIKE '%owner_key%') THEN
      ALTER TABLE catalog_graph_edges DROP CONSTRAINT catalog_graph_edges_pkey;
      ALTER TABLE catalog_graph_edges ADD CONSTRAINT catalog_graph_edges_pkey PRIMARY KEY(owner_key,edge_key);
    END IF;
  END $$;
  CREATE INDEX IF NOT EXISTS catalog_graph_edges_owner_from_idx ON catalog_graph_edges(owner_key, from_key);
  CREATE INDEX IF NOT EXISTS catalog_graph_edges_owner_to_idx ON catalog_graph_edges(owner_key, to_key);

  CREATE TABLE IF NOT EXISTS catalog_papers (
    reference_id text PRIMARY KEY REFERENCES catalog_references(id) ON DELETE CASCADE,
    owner_key text NOT NULL,
    document_id text NOT NULL,
    file_hash text NOT NULL,
    normalized_title text NOT NULL DEFAULT '',
    extracted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    extracted_references jsonb NOT NULL DEFAULT '[]'::jsonb,
    doi text,
    openalex_id text,
    resolution_status text NOT NULL DEFAULT 'unresolved' CHECK (resolution_status IN ('resolved','ambiguous','unresolved')),
    resolution_method text NOT NULL DEFAULT 'none',
    resolution_confidence real NOT NULL DEFAULT 0,
    candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    openalex_work jsonb,
    expansion jsonb NOT NULL DEFAULT '{}'::jsonb,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_key,file_hash)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS catalog_papers_owner_openalex_idx ON catalog_papers(owner_key,openalex_id) WHERE openalex_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS catalog_papers_owner_status_idx ON catalog_papers(owner_key,resolution_status,updated_at DESC);
  CREATE TABLE IF NOT EXISTS catalog_openalex_cache (
    cache_key text PRIMARY KEY,
    response jsonb NOT NULL,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS catalog_openalex_cache_expiry_idx ON catalog_openalex_cache(expires_at);

  CREATE TABLE IF NOT EXISTS catalog_artifacts (
    id text PRIMARY KEY,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    kind text NOT NULL,
    provider text NOT NULL,
    object_key text NOT NULL UNIQUE,
    bucket text,
    mime_type text,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    etag text,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS catalog_jobs (
    id text PRIMARY KEY,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('extract', 'scholarly', 'identify', 'summarize', 'relate')),
    status text NOT NULL CHECK (status IN ('queued', 'blocked', 'running', 'complete', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    error text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reference_id, stage)
  );
  CREATE INDEX IF NOT EXISTS catalog_jobs_queue_idx ON catalog_jobs (status, created_at);
  DO $schema_migration$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_jobs_stage_check' AND pg_get_constraintdef(oid) NOT LIKE '%scholarly%') THEN
      ALTER TABLE catalog_jobs DROP CONSTRAINT catalog_jobs_stage_check;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_jobs_stage_check') THEN
      ALTER TABLE catalog_jobs ADD CONSTRAINT catalog_jobs_stage_check CHECK (stage IN ('extract','scholarly','identify','summarize','relate'));
    END IF;
  END $schema_migration$;

  CREATE TABLE IF NOT EXISTS catalog_libraries (
    id text PRIMARY KEY,
    owner_key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_key, name)
  );
  CREATE TABLE IF NOT EXISTS catalog_library_items (
    library_id text NOT NULL REFERENCES catalog_libraries(id) ON DELETE CASCADE,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (library_id, reference_id)
  );
  ALTER TABLE catalog_libraries
    ADD COLUMN IF NOT EXISTS parent_id text REFERENCES catalog_libraries(id) ON DELETE CASCADE;
  ALTER TABLE catalog_libraries DROP CONSTRAINT IF EXISTS catalog_libraries_owner_key_name_key;
  CREATE UNIQUE INDEX IF NOT EXISTS catalog_libraries_owner_parent_name_unique_idx
    ON catalog_libraries (owner_key, COALESCE(parent_id, ''), name);
  CREATE TABLE IF NOT EXISTS catalog_library_shares (
    library_id text NOT NULL REFERENCES catalog_libraries(id) ON DELETE CASCADE,
    grantee_owner_key text NOT NULL,
    grantee_email text NOT NULL,
    shared_by_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (library_id, grantee_owner_key)
  );
  CREATE INDEX IF NOT EXISTS catalog_library_shares_grantee_idx
    ON catalog_library_shares (grantee_owner_key);
  CREATE TABLE IF NOT EXISTS catalog_annotations (
    id text PRIMARY KEY,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    owner_key text NOT NULL,
    quote text NOT NULL,
    prefix text NOT NULL DEFAULT '',
    suffix text NOT NULL DEFAULT '',
    start_offset integer NOT NULL,
    end_offset integer NOT NULL,
    source_kind text NOT NULL DEFAULT 'markdown',
    rects jsonb NOT NULL DEFAULT '[]'::jsonb,
    page integer,
    locator text,
    color text NOT NULL,
    category text NOT NULL,
    note_type text,
    note text,
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    targets text[] NOT NULL DEFAULT ARRAY[]::text[],
    review_status text NOT NULL DEFAULT 'captured',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (start_offset >= 0 AND end_offset > start_offset)
  );
  CREATE INDEX IF NOT EXISTS catalog_annotations_reference_owner_idx
    ON catalog_annotations (reference_id, owner_key, start_offset);
  ALTER TABLE catalog_annotations ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'markdown';
  ALTER TABLE catalog_annotations ADD COLUMN IF NOT EXISTS rects jsonb NOT NULL DEFAULT '[]'::jsonb;
  CREATE TABLE IF NOT EXISTS catalog_reading_state (
    owner_key text NOT NULL,
    reference_id text NOT NULL REFERENCES catalog_references(id) ON DELETE CASCADE,
    location jsonb NOT NULL DEFAULT '{}'::jsonb,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_key,reference_id)
  );
  CREATE TABLE IF NOT EXISTS catalog_identities (
    identity_key text PRIMARY KEY,
    owner_key text NOT NULL,
    provider text NOT NULL,
    subject text NOT NULL,
    current_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS catalog_identities_owner_idx ON catalog_identities (owner_key);
  INSERT INTO catalog_libraries (id, owner_key, name, description)
    SELECT 'inbox:' || owner_key, owner_key, 'Inbox', 'Documents awaiting cultivation'
    FROM catalog_references
    ON CONFLICT (id) DO NOTHING;
  DELETE FROM catalog_library_items inbox_item
    USING catalog_references r
    WHERE inbox_item.reference_id=r.id
      AND inbox_item.library_id='inbox:' || r.owner_key
      AND EXISTS (
        SELECT 1 FROM catalog_library_items filed_item
        WHERE filed_item.reference_id=r.id
          AND filed_item.library_id<>inbox_item.library_id
      );
`;

const mapReference = (row: any, artifacts: CatalogArtifact[] = [], jobs: CatalogJob[] = []): CatalogReference => ({
  id: row.id,
  ownerKey: row.owner_key,
  citeKey: row.cite_key,
  type: row.type,
  title: row.title,
  contributors: row.contributors ?? [],
  issued: row.issued ?? undefined,
  identifiers: row.identifiers ?? {},
  tags: row.tags ?? [],
  abstract: row.abstract ?? undefined,
  language: row.language ?? undefined,
  publisher: row.publisher ?? undefined,
  publisherPlace: row.publisher_place ?? undefined,
  url: row.url ?? undefined,
  source: row.source ?? {},
  originalSha256: row.original_sha256,
  wordCount: Number(row.word_count || 0),
  artifacts,
  jobs,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  libraryIds: row.library_ids ?? [],
  access: row.access === 'viewer' ? 'viewer' : 'owner',
});

const mapPaper=(row:any):CatalogPaperRecord => ({referenceId:row.reference_id,ownerKey:row.owner_key,documentId:row.document_id,fileHash:row.file_hash,title:row.title||'',normalizedTitle:row.normalized_title||'',extractedMetadata:row.extracted_metadata||{},extractedReferences:row.extracted_references||[],doi:row.doi||undefined,openAlexId:row.openalex_id||undefined,resolutionStatus:row.resolution_status||'unresolved',resolutionMethod:row.resolution_method||'none',resolutionConfidence:Number(row.resolution_confidence||0),candidates:row.candidates||[],openAlexWork:row.openalex_work||undefined,expansion:row.expansion||{},provenance:row.provenance||{},createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});

export class PostgresCatalog {
  readonly pool: Pool;
  #ready?: Promise<void>;

  constructor(connectionString: string) {
    if (!connectionString) throw new Error('DATABASE_URL_NOT_CONFIGURED');
    this.pool = new Pool({ connectionString, max: 6 });
  }

  ensureSchema(): Promise<void> {
    this.#ready ??= this.pool.query(schema).then(() => undefined);
    return this.#ready;
  }

  async findBySha256(ownerKey: string, sha256: string): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT * FROM catalog_references WHERE owner_key = $1 AND original_sha256 = $2',
      [ownerKey, sha256],
    );
    return result.rows[0] ? this.hydrate(result.rows[0], ownerKey) : null;
  }

  async bindIdentity(input: { identityKey: string; provider: string; subject: string; email: string; proposedOwnerKey: string }): Promise<string> {
    await this.ensureSchema();
    const existing = await this.pool.query('SELECT owner_key FROM catalog_identities WHERE identity_key=$1', [input.identityKey]);
    if (existing.rows[0]) {
      await this.pool.query('UPDATE catalog_identities SET current_email=$2,updated_at=now() WHERE identity_key=$1', [input.identityKey, input.email]);
      return existing.rows[0].owner_key;
    }
    const emailMatch = await this.pool.query('SELECT owner_key FROM catalog_identities WHERE lower(current_email)=lower($1) ORDER BY updated_at DESC LIMIT 1', [input.email]);
    const ownerKey = emailMatch.rows[0]?.owner_key || input.proposedOwnerKey;
    const result = await this.pool.query(
      `INSERT INTO catalog_identities(identity_key,owner_key,provider,subject,current_email)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(identity_key) DO UPDATE SET current_email=excluded.current_email,updated_at=now()
       RETURNING owner_key`,
      [input.identityKey, ownerKey, input.provider, input.subject, input.email],
    );
    return result.rows[0].owner_key;
  }

  async identityOwnerForEmail(email: string): Promise<string | null> {
    await this.ensureSchema();
    const result = await this.pool.query('SELECT owner_key FROM catalog_identities WHERE lower(current_email)=lower($1) ORDER BY updated_at DESC LIMIT 1', [email]);
    return result.rows[0]?.owner_key || null;
  }

  async recoverIdentity(identityKey: string, currentOwnerKey: string, targetOwnerKey: string, currentEmail: string): Promise<{ ok: boolean; reason?: string }> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const occupied = await client.query('SELECT identity_key FROM catalog_identities WHERE owner_key=$1 AND identity_key<>$2 LIMIT 1', [targetOwnerKey, identityKey]);
      if (occupied.rows[0]) { await client.query('ROLLBACK'); return { ok: false, reason: 'catalog_already_linked' }; }
      const target = await client.query(
        `SELECT ((SELECT count(*) FROM catalog_references WHERE owner_key=$1) +
                 (SELECT count(*) FROM catalog_libraries WHERE owner_key=$1))::int AS records`, [targetOwnerKey],
      );
      if (Number(target.rows[0]?.records) === 0) { await client.query('ROLLBACK'); return { ok: false, reason: 'previous_catalog_not_found' }; }
      const duplicate = await client.query(
        `SELECT 1 FROM catalog_references current JOIN catalog_references target
         ON target.owner_key=$2 AND target.original_sha256=current.original_sha256
         WHERE current.owner_key=$1 LIMIT 1`, [currentOwnerKey, targetOwnerKey],
      );
      if (duplicate.rows[0]) { await client.query('ROLLBACK'); return { ok: false, reason: 'duplicate_items_require_review' }; }
      const libraryConflict = await client.query(
        `SELECT 1 FROM catalog_libraries current JOIN catalog_libraries target
         ON target.owner_key=$2 AND lower(target.name)=lower(current.name)
         WHERE current.owner_key=$1 AND current.id<>$3 AND target.id<>$4 LIMIT 1`,
        [currentOwnerKey, targetOwnerKey, `inbox:${currentOwnerKey}`, `inbox:${targetOwnerKey}`],
      );
      if (libraryConflict.rows[0]) { await client.query('ROLLBACK'); return { ok: false, reason: 'library_names_require_review' }; }
      const currentInbox = `inbox:${currentOwnerKey}`; const targetInbox = `inbox:${targetOwnerKey}`;
      await client.query(`INSERT INTO catalog_libraries(id,owner_key,name,description) VALUES($1,$2,'Inbox','Documents awaiting cultivation') ON CONFLICT(id) DO NOTHING`, [targetInbox, targetOwnerKey]);
      await client.query('UPDATE catalog_libraries SET parent_id=$2 WHERE parent_id=$1', [currentInbox, targetInbox]);
      await client.query(`INSERT INTO catalog_library_items(library_id,reference_id)
        SELECT $2,reference_id FROM catalog_library_items WHERE library_id=$1 ON CONFLICT DO NOTHING`, [currentInbox, targetInbox]);
      await client.query('DELETE FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [currentInbox, currentOwnerKey]);
      await client.query('UPDATE catalog_libraries SET owner_key=$2 WHERE owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_references SET owner_key=$2,updated_at=now() WHERE owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_annotations SET owner_key=$2,updated_at=now() WHERE owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_chunks SET owner_key=$2,updated_at=now() WHERE owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query(`DELETE FROM catalog_graph_edges current USING catalog_graph_edges target
        WHERE current.owner_key=$1 AND target.owner_key=$2 AND current.edge_key=target.edge_key`, [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_graph_edges SET owner_key=$2,updated_at=now() WHERE owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query(`INSERT INTO catalog_graph_nodes(owner_key,node_key,kind,label,properties)
        SELECT $2,node_key,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1
        ON CONFLICT(owner_key,node_key) DO UPDATE SET properties=catalog_graph_nodes.properties || excluded.properties,updated_at=now()`, [currentOwnerKey, targetOwnerKey]);
      await client.query('DELETE FROM catalog_graph_nodes WHERE owner_key=$1', [currentOwnerKey]);
      await client.query(`DELETE FROM catalog_library_shares current USING catalog_library_shares target
        WHERE current.grantee_owner_key=$1 AND target.grantee_owner_key=$2 AND current.library_id=target.library_id`, [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_library_shares SET grantee_owner_key=$2 WHERE grantee_owner_key=$1', [currentOwnerKey, targetOwnerKey]);
      await client.query('UPDATE catalog_identities SET owner_key=$2,current_email=$3,updated_at=now() WHERE identity_key=$1', [identityKey, targetOwnerKey, currentEmail]);
      await client.query('COMMIT'); return { ok: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async dashboardStats(ownerKey: string): Promise<CatalogDashboardStats> {
    await this.ensureSchema();
    const [totals, authors, years, tags, concepts] = await Promise.all([
      this.pool.query(
        `SELECT (SELECT count(*) FROM catalog_references WHERE owner_key=$1)::int AS items,
                (SELECT COALESCE(sum(word_count),0) FROM catalog_references WHERE owner_key=$1)::bigint AS words,
                (SELECT count(*) FROM catalog_libraries WHERE owner_key=$1)::int AS libraries,
                (SELECT count(*) FROM catalog_annotations WHERE owner_key=$1)::int AS annotations,
                (SELECT count(*) FROM catalog_graph_nodes WHERE owner_key=$1 AND lower(kind) IN ('topic','concept'))::int AS concepts`, [ownerKey],
      ),
      this.pool.query(
        `SELECT COALESCE(NULLIF(trim(person->>'family'),''),NULLIF(trim(person->>'literal'),''),NULLIF(trim(person->>'given'),'')) AS name,
                count(DISTINCT r.id)::int AS count
         FROM catalog_references r CROSS JOIN LATERAL jsonb_array_elements(r.contributors) person
         WHERE r.owner_key=$1 AND COALESCE(person->>'role','author')='author'
         GROUP BY name HAVING COALESCE(NULLIF(trim(person->>'family'),''),NULLIF(trim(person->>'literal'),''),NULLIF(trim(person->>'given'),'')) IS NOT NULL
         ORDER BY count DESC,name LIMIT 10`, [ownerKey],
      ),
      this.pool.query(
        `SELECT (issued->>'year')::int AS year,count(*)::int AS count FROM catalog_references
         WHERE owner_key=$1 AND (issued->>'year') ~ '^[0-9]{4}$'
         GROUP BY year ORDER BY year`, [ownerKey],
      ),
      this.pool.query(
        `SELECT tag AS name,count(*)::int AS count FROM catalog_references CROSS JOIN LATERAL unnest(tags) tag
         WHERE owner_key=$1 AND trim(tag)<>'' GROUP BY tag ORDER BY count DESC,name LIMIT 20`, [ownerKey],
      ),
      this.pool.query(
        `SELECT concept.label AS name,count(DISTINCT paper.node_key)::int AS count
         FROM catalog_graph_nodes concept
         JOIN catalog_graph_edges edge ON edge.owner_key=concept.owner_key AND (edge.from_key=concept.node_key OR edge.to_key=concept.node_key)
         JOIN catalog_graph_nodes paper ON paper.owner_key=concept.owner_key AND paper.node_key=CASE WHEN edge.from_key=concept.node_key THEN edge.to_key ELSE edge.from_key END
         WHERE concept.owner_key=$1 AND lower(concept.kind) IN ('topic','concept') AND lower(paper.kind) IN ('paper','work','document','publication','article')
         GROUP BY concept.node_key,concept.label ORDER BY count DESC,name LIMIT 30`, [ownerKey],
      ),
    ]);
    const row = totals.rows[0] || {};
    return {
      totals: { items: Number(row.items || 0), words: Number(row.words || 0), libraries: Number(row.libraries || 0), annotations: Number(row.annotations || 0), concepts: Number(row.concepts || 0) },
      topAuthors: authors.rows.map((item) => ({ name: item.name, count: Number(item.count) })),
      publicationYears: years.rows.map((item) => ({ year: Number(item.year), count: Number(item.count) })),
      topTags: tags.rows.map((item) => ({ name: item.name, count: Number(item.count) })),
      topConcepts: concepts.rows.map((item) => ({ name: item.name, count: Number(item.count) })),
    };
  }

  private mapAnnotation(row: any): CatalogAnnotation {
    return {
      id: row.id,
      referenceId: row.reference_id,
      ownerKey: row.owner_key,
      quote: row.quote,
      prefix: row.prefix || '',
      suffix: row.suffix || '',
      startOffset: Number(row.start_offset),
      endOffset: Number(row.end_offset),
      sourceKind: row.source_kind || 'markdown',
      rects: Array.isArray(row.rects) ? row.rects : [],
      page: row.page ?? undefined,
      locator: row.locator ?? undefined,
      color: row.color,
      category: row.category,
      noteType: row.note_type ?? undefined,
      note: row.note ?? undefined,
      tags: row.tags || [],
      targets: row.targets || [],
      reviewStatus: row.review_status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async listAnnotations(ownerKey: string, referenceId: string): Promise<CatalogAnnotation[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT * FROM catalog_annotations WHERE owner_key=$1 AND reference_id=$2 ORDER BY start_offset, created_at',
      [ownerKey, referenceId],
    );
    return result.rows.map((row) => this.mapAnnotation(row));
  }

  async createAnnotation(ownerKey: string, referenceId: string, input: CatalogAnnotationInput): Promise<CatalogAnnotation> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO catalog_annotations
        (id,reference_id,owner_key,quote,prefix,suffix,start_offset,end_offset,source_kind,rects,page,locator,color,category,note_type,note,tags,targets,review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::text[],$18::text[],$19)
       RETURNING *`,
      [crypto.randomUUID(), referenceId, ownerKey, input.quote, input.prefix || '', input.suffix || '',
        input.startOffset, input.endOffset, input.sourceKind || 'markdown', JSON.stringify(input.rects || []),
        input.page || null, input.locator || null, input.color, input.category,
        input.noteType || null, input.note || null, input.tags || [], input.targets || [],
        input.reviewStatus || 'captured'],
    );
    return this.mapAnnotation(result.rows[0]);
  }

  async updateAnnotation(ownerKey: string, referenceId: string, id: string, input: Partial<CatalogAnnotationInput>): Promise<CatalogAnnotation | null> {
    await this.ensureSchema();
    const current = await this.pool.query(
      'SELECT * FROM catalog_annotations WHERE id=$1 AND owner_key=$2 AND reference_id=$3', [id, ownerKey, referenceId],
    );
    if (!current.rows[0]) return null;
    const row = this.mapAnnotation(current.rows[0]);
    const next = { ...row, ...input };
    const result = await this.pool.query(
      `UPDATE catalog_annotations SET quote=$4,prefix=$5,suffix=$6,start_offset=$7,end_offset=$8,source_kind=$9,
         rects=$10::jsonb,page=$11,locator=$12,color=$13,category=$14,note_type=$15,note=$16,
         tags=$17::text[],targets=$18::text[],review_status=$19,updated_at=now()
       WHERE id=$1 AND owner_key=$2 AND reference_id=$3 RETURNING *`,
      [id, ownerKey, referenceId, next.quote, next.prefix, next.suffix, next.startOffset, next.endOffset,
        next.sourceKind || 'markdown', JSON.stringify(next.rects || []), next.page || null, next.locator || null,
        next.color, next.category, next.noteType || null, next.note || null, next.tags || [], next.targets || [],
        next.reviewStatus || 'captured'],
    );
    return result.rows[0] ? this.mapAnnotation(result.rows[0]) : null;
  }

  async deleteAnnotation(ownerKey: string, referenceId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'DELETE FROM catalog_annotations WHERE id=$1 AND owner_key=$2 AND reference_id=$3', [id, ownerKey, referenceId],
    );
    return result.rowCount === 1;
  }

  async get(ownerKey: string, id: string): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `WITH RECURSIVE shared_libraries AS (
         SELECT l.id FROM catalog_library_shares s JOIN catalog_libraries l ON l.id=s.library_id
         WHERE s.grantee_owner_key=$1
         UNION SELECT child.id FROM catalog_libraries child JOIN shared_libraries parent ON child.parent_id=parent.id
       )
       SELECT r.*, CASE WHEN r.owner_key=$1 THEN 'owner' ELSE 'viewer' END AS access
       FROM catalog_references r WHERE r.id=$2 AND (
         r.owner_key=$1 OR EXISTS (
           SELECT 1 FROM catalog_library_items li JOIN shared_libraries sl ON sl.id=li.library_id
           WHERE li.reference_id=r.id
         )
       )`,
      [ownerKey, id],
    );
    return result.rows[0] ? this.hydrate(result.rows[0], ownerKey) : null;
  }

  async list(ownerKey: string, limit = 50): Promise<CatalogReference[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `WITH RECURSIVE shared_libraries AS (
         SELECT l.id FROM catalog_library_shares s JOIN catalog_libraries l ON l.id=s.library_id
         WHERE s.grantee_owner_key=$1
         UNION SELECT child.id FROM catalog_libraries child JOIN shared_libraries parent ON child.parent_id=parent.id
       ), accessible_libraries AS (
         SELECT id FROM catalog_libraries WHERE owner_key=$1 UNION SELECT id FROM shared_libraries
       )
       SELECT r.*, CASE WHEN r.owner_key=$1 THEN 'owner' ELSE 'viewer' END AS access,
         COALESCE(array_agg(li.library_id) FILTER (WHERE li.library_id IS NOT NULL), ARRAY[]::text[]) AS library_ids
       FROM catalog_references r
       LEFT JOIN catalog_library_items li ON li.reference_id=r.id AND li.library_id IN (SELECT id FROM accessible_libraries)
       WHERE r.owner_key=$1 OR EXISTS (
         SELECT 1 FROM catalog_library_items visible JOIN shared_libraries sl ON sl.id=visible.library_id
         WHERE visible.reference_id=r.id
       )
       GROUP BY r.id ORDER BY r.updated_at DESC LIMIT $2`,
      [ownerKey, Math.max(1, Math.min(200, limit))],
    );
    return Promise.all(result.rows.map((row) => this.hydrate(row, ownerKey)));
  }

  async replaceChunks(referenceId: string, ownerKey: string, chunks: CatalogChunkInput[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reference = await client.query(
        'SELECT id FROM catalog_references WHERE id=$1 AND owner_key=$2 FOR UPDATE',
        [referenceId, ownerKey],
      );
      if (!reference.rows[0]) throw new Error('REFERENCE_NOT_FOUND');
      await client.query(
        `INSERT INTO catalog_vector_deletions(chunk_id)
         SELECT id FROM catalog_chunks WHERE reference_id=$1
         ON CONFLICT(chunk_id) DO NOTHING`,
        [referenceId],
      );
      await client.query('DELETE FROM catalog_chunks WHERE reference_id=$1', [referenceId]);
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO catalog_chunks
            (id,reference_id,owner_key,ordinal,content,content_sha256,page,locator,section,metadata)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [chunk.id, referenceId, ownerKey, chunk.ordinal, chunk.content, chunk.contentSha256,
            chunk.page ?? null, chunk.locator ?? null, chunk.section ?? null, JSON.stringify(chunk.metadata || {})],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async claimVectorChunks(limit = 12): Promise<CatalogVectorChunk[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `WITH candidates AS (
         SELECT id FROM catalog_chunks WHERE vector_status IN ('pending','failed') AND vector_attempts < 3
         ORDER BY updated_at, ordinal FOR UPDATE SKIP LOCKED LIMIT $1
       ), claimed AS (
         UPDATE catalog_chunks chunk SET vector_status='running',vector_attempts=vector_attempts+1,vector_error=NULL,updated_at=now()
         FROM candidates WHERE chunk.id=candidates.id RETURNING chunk.*
       )
       SELECT claimed.*,reference.title,reference.cite_key,reference.tags,reference.language
       FROM claimed JOIN catalog_references reference ON reference.id=claimed.reference_id
       ORDER BY claimed.updated_at,claimed.ordinal`,
      [Math.max(1, Math.min(64, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id, referenceId: row.reference_id, ownerKey: row.owner_key, ordinal: row.ordinal,
      content: row.content, contentSha256: row.content_sha256, page: row.page ?? undefined,
      locator: row.locator ?? undefined, section: row.section ?? undefined, metadata: row.metadata || {},
      title: row.title, citeKey: row.cite_key, tags: row.tags || [], language: row.language ?? undefined,
    }));
  }

  async pendingVectorDeletions(limit = 200): Promise<string[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT chunk_id FROM catalog_vector_deletions ORDER BY created_at LIMIT $1',
      [Math.max(1, Math.min(1000, limit))],
    );
    return result.rows.map((row) => String(row.chunk_id));
  }

  async completeVectorDeletions(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.ensureSchema();
    await this.pool.query('DELETE FROM catalog_vector_deletions WHERE chunk_id=ANY($1::text[])', [ids]);
  }

  async markVectorChunks(ids: string[], status: 'pending' | 'complete' | 'failed', model?: string, error?: string): Promise<void> {
    if (!ids.length) return;
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE catalog_chunks SET vector_status=$2,vector_model=$3,vector_error=$4,
         indexed_at=CASE WHEN $2='complete' THEN now() ELSE indexed_at END,updated_at=now()
       WHERE id=ANY($1::text[])`,
      [ids, status, model || null, error?.slice(0, 1000) || null],
    );
  }

  private mapChunkSearchRow(row: any): CatalogChunkSearchResult {
    return {
      chunkId: row.id, referenceId: row.reference_id, title: row.title, citeKey: row.cite_key,
      content: row.content, snippet: row.snippet || row.content.slice(0, 320),
      page: row.page ?? undefined, locator: row.locator ?? undefined, section: row.section ?? undefined,
      metadata: row.metadata || {}, score: Number(row.score || 0),
    };
  }

  async lexicalSearch(ownerKey: string, query: string, limit = 40, libraryId?: string): Promise<CatalogChunkSearchResult[]> {
    await this.ensureSchema();
    const normalized = query.trim().slice(0, 300);
    if (!normalized) return [];
    const result = await this.pool.query(
      `WITH RECURSIVE shared_libraries AS (
         SELECT library.id FROM catalog_library_shares share JOIN catalog_libraries library ON library.id=share.library_id
         WHERE share.grantee_owner_key=$1
         UNION SELECT child.id FROM catalog_libraries child JOIN shared_libraries parent ON child.parent_id=parent.id
       ), search_query AS (SELECT websearch_to_tsquery('simple',$2) AS value)
       SELECT chunk.*,reference.title,reference.cite_key,
         ts_rank_cd(chunk.search_vector,search_query.value,32) AS score,
         ts_headline('simple',chunk.content,search_query.value,
           'MaxWords=38,MinWords=12,ShortWord=2,StartSel=‹,StopSel=›,FragmentDelimiter= … ') AS snippet
       FROM catalog_chunks chunk
       JOIN catalog_references reference ON reference.id=chunk.reference_id
       CROSS JOIN search_query
       WHERE (chunk.search_vector @@ search_query.value OR chunk.content ILIKE ('%' || $2 || '%'))
         AND (reference.owner_key=$1 OR EXISTS (
           SELECT 1 FROM catalog_library_items visible JOIN shared_libraries shared ON shared.id=visible.library_id
           WHERE visible.reference_id=reference.id
         ))
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM catalog_library_items scoped WHERE scoped.reference_id=reference.id AND scoped.library_id=$4
         ))
       ORDER BY score DESC,reference.updated_at DESC,chunk.ordinal
       LIMIT $3`,
      [ownerKey, normalized, Math.max(1, Math.min(200, limit)), libraryId || null],
    );
    return result.rows.map((row) => this.mapChunkSearchRow(row));
  }

  async accessibleChunks(ownerKey: string, chunkIds: string[], libraryId?: string): Promise<CatalogChunkSearchResult[]> {
    await this.ensureSchema();
    const ids = [...new Set(chunkIds)].slice(0, 500);
    if (!ids.length) return [];
    const result = await this.pool.query(
      `WITH RECURSIVE shared_libraries AS (
         SELECT library.id FROM catalog_library_shares share JOIN catalog_libraries library ON library.id=share.library_id
         WHERE share.grantee_owner_key=$1
         UNION SELECT child.id FROM catalog_libraries child JOIN shared_libraries parent ON child.parent_id=parent.id
       )
       SELECT chunk.*,reference.title,reference.cite_key,''::text AS snippet,0::real AS score
       FROM catalog_chunks chunk JOIN catalog_references reference ON reference.id=chunk.reference_id
       WHERE chunk.id=ANY($2::text[])
         AND (reference.owner_key=$1 OR EXISTS (
           SELECT 1 FROM catalog_library_items visible JOIN shared_libraries shared ON shared.id=visible.library_id
           WHERE visible.reference_id=reference.id
         ))
         AND ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM catalog_library_items scoped WHERE scoped.reference_id=reference.id AND scoped.library_id=$3
         ))`,
      [ownerKey, ids, libraryId || null],
    );
    return result.rows.map((row) => this.mapChunkSearchRow(row));
  }

  async accessibleOwnerKeys(ownerKey: string): Promise<string[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT $1::text AS owner_key
       UNION SELECT DISTINCT library.owner_key
       FROM catalog_library_shares share JOIN catalog_libraries library ON library.id=share.library_id
       WHERE share.grantee_owner_key=$1`,
      [ownerKey],
    );
    return result.rows.map((row) => String(row.owner_key)).filter(Boolean);
  }

  async replaceGraphForReference(
    ownerKey: string,
    referenceId: string,
    nodes: CatalogGraphNodeInput[],
    edges: CatalogGraphEdgeInput[],
  ): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM catalog_graph_edges WHERE owner_key=$1 AND evidence_reference_id=$2', [ownerKey, referenceId]);
      for (const node of nodes) {
        await client.query(
          `INSERT INTO catalog_graph_nodes(owner_key,node_key,kind,label,properties)
           VALUES($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT(owner_key,node_key) DO UPDATE SET kind=excluded.kind,label=excluded.label,
             properties=catalog_graph_nodes.properties || excluded.properties,updated_at=now()`,
          [ownerKey, node.key, node.kind, node.label, JSON.stringify(node.properties || {})],
        );
      }
      for (const edge of edges) {
        await client.query(
          `INSERT INTO catalog_graph_edges
            (edge_key,owner_key,evidence_reference_id,from_key,relation,to_key,evidence_chunk_id,weight,properties)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT(owner_key,edge_key) DO UPDATE SET weight=excluded.weight,properties=excluded.properties,updated_at=now()`,
          [edge.key, ownerKey, referenceId, edge.from, edge.relation, edge.to, edge.chunkId || null,
            edge.weight ?? 1, JSON.stringify(edge.properties || {})],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async replaceGraphForReferencePipeline(ownerKey:string,referenceId:string,pipeline:string,nodes:CatalogGraphNodeInput[],edges:CatalogGraphEdgeInput[]):Promise<void> {
    await this.ensureSchema(); const client=await this.pool.connect();
    try { await client.query('BEGIN'); await client.query(`DELETE FROM catalog_graph_edges WHERE owner_key=$1 AND evidence_reference_id=$2 AND properties->'provenance'->>'pipeline'=$3`,[ownerKey,referenceId,pipeline]);
      for(const node of nodes) await client.query(`INSERT INTO catalog_graph_nodes(owner_key,node_key,kind,label,properties) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(owner_key,node_key) DO UPDATE SET kind=excluded.kind,label=excluded.label,properties=catalog_graph_nodes.properties||excluded.properties,updated_at=now()`,[ownerKey,node.key,node.kind,node.label,JSON.stringify(node.properties||{})]);
      for(const edge of edges) { const properties={...(edge.properties||{}),provenance:{...((edge.properties as any)?.provenance||{}),pipeline}}; await client.query(`INSERT INTO catalog_graph_edges(edge_key,owner_key,evidence_reference_id,from_key,relation,to_key,evidence_chunk_id,weight,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(owner_key,edge_key) DO UPDATE SET evidence_reference_id=excluded.evidence_reference_id,weight=excluded.weight,properties=excluded.properties,updated_at=now()`,[edge.key,ownerKey,referenceId,edge.from,edge.relation,edge.to,edge.chunkId||null,edge.weight??1,JSON.stringify(properties)]); }
      await client.query(`DELETE FROM catalog_graph_nodes node WHERE node.owner_key=$1 AND node.properties->>'pipeline'=$2 AND NOT EXISTS (SELECT 1 FROM catalog_graph_edges edge WHERE edge.owner_key=node.owner_key AND (edge.from_key=node.node_key OR edge.to_key=node.node_key))`,[ownerKey,pipeline]);
      await client.query('COMMIT');
    } catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;} finally{client.release();}
  }

  async upsertPaperExtraction(ownerKey:string,referenceId:string,input:{fileHash:string;normalizedTitle:string;metadata:Record<string,unknown>;references:unknown[];doi?:string;provenance?:Record<string,unknown>}):Promise<CatalogPaperRecord> {
    await this.ensureSchema(); const result=await this.pool.query(`INSERT INTO catalog_papers(reference_id,owner_key,document_id,file_hash,normalized_title,extracted_metadata,extracted_references,doi,provenance) SELECT id,owner_key,id,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb FROM catalog_references WHERE id=$2 AND owner_key=$1 ON CONFLICT(reference_id) DO UPDATE SET file_hash=excluded.file_hash,normalized_title=excluded.normalized_title,extracted_metadata=excluded.extracted_metadata,extracted_references=excluded.extracted_references,doi=COALESCE(excluded.doi,catalog_papers.doi),provenance=catalog_papers.provenance||excluded.provenance,updated_at=now() RETURNING *`,[ownerKey,referenceId,input.fileHash,input.normalizedTitle,JSON.stringify(input.metadata),JSON.stringify(input.references),input.doi||null,JSON.stringify(input.provenance||{})]); const row=result.rows[0]; if(!row)throw new Error('REFERENCE_NOT_FOUND'); const reference=await this.pool.query('SELECT title FROM catalog_references WHERE id=$1',[referenceId]);return mapPaper({...row,title:reference.rows[0]?.title||''});
  }

  async getPaper(ownerKey:string,referenceId:string):Promise<CatalogPaperRecord|null>{await this.ensureSchema();const result=await this.pool.query(`SELECT paper.*,reference.title FROM catalog_papers paper JOIN catalog_references reference ON reference.id=paper.reference_id WHERE paper.owner_key=$1 AND paper.reference_id=$2`,[ownerKey,referenceId]);return result.rows[0]?mapPaper(result.rows[0]):null;}
  async listPapers(ownerKey:string):Promise<CatalogPaperRecord[]>{await this.ensureSchema();const result=await this.pool.query(`SELECT paper.*,reference.title FROM catalog_papers paper JOIN catalog_references reference ON reference.id=paper.reference_id WHERE paper.owner_key=$1 ORDER BY paper.updated_at DESC`,[ownerKey]);return result.rows.map(mapPaper);}
  async savePaperResolution(ownerKey:string,referenceId:string,input:{status:'resolved'|'ambiguous'|'unresolved';method:string;confidence:number;candidates?:unknown[];work?:Record<string,unknown>;expansion?:Record<string,unknown>;provenance?:Record<string,unknown>;metadata?:{title?:string;contributors?:unknown[];issued?:Record<string,unknown>;doi?:string;abstract?:string;publisher?:string;url?:string}}):Promise<CatalogPaperRecord|null>{await this.ensureSchema();const client=await this.pool.connect();try{await client.query('BEGIN');const current=await client.query(`SELECT paper.*,reference.title,reference.source,reference.contributors,reference.issued,reference.identifiers,reference.abstract,reference.publisher,reference.url FROM catalog_papers paper JOIN catalog_references reference ON reference.id=paper.reference_id WHERE paper.owner_key=$1 AND paper.reference_id=$2 FOR UPDATE`,[ownerKey,referenceId]);if(!current.rows[0]){await client.query('ROLLBACK');return null;}const row=current.rows[0],manual=new Set<string>(row.source?.curation?.manualFields||[]),metadata=input.metadata||{};const identifiers={...(row.identifiers||{}),...(!manual.has('identifiers')&&metadata.doi?{doi:metadata.doi}:{})};await client.query(`UPDATE catalog_references SET title=$3,contributors=$4::jsonb,issued=$5::jsonb,identifiers=$6::jsonb,abstract=$7,publisher=$8,url=$9,source=source||$10::jsonb,updated_at=now() WHERE owner_key=$1 AND id=$2`,[ownerKey,referenceId,manual.has('title')?row.title:metadata.title||row.title,JSON.stringify(manual.has('contributors')?row.contributors:metadata.contributors||row.contributors),JSON.stringify(manual.has('issued')?row.issued:metadata.issued||row.issued),JSON.stringify(identifiers),manual.has('abstract')?row.abstract:metadata.abstract||row.abstract,manual.has('publisher')?row.publisher:metadata.publisher||row.publisher,manual.has('url')?row.url:metadata.url||row.url,JSON.stringify({scholarly:{resolutionStatus:input.status,method:input.method,confidence:input.confidence,updatedAt:new Date().toISOString()}})]);const saved=await client.query(`UPDATE catalog_papers SET doi=COALESCE($3,doi),openalex_id=$4,resolution_status=$5,resolution_method=$6,resolution_confidence=$7,candidates=$8::jsonb,openalex_work=$9::jsonb,expansion=expansion||$10::jsonb,provenance=provenance||$11::jsonb,updated_at=now() WHERE owner_key=$1 AND reference_id=$2 RETURNING *`,[ownerKey,referenceId,metadata.doi||null,(input.work as any)?.id||null,input.status,input.method,Math.max(0,Math.min(1,input.confidence)),JSON.stringify(input.candidates||[]),input.work?JSON.stringify(input.work):null,JSON.stringify(input.expansion||{}),JSON.stringify(input.provenance||{})]);await client.query('COMMIT');return mapPaper({...saved.rows[0],title:manual.has('title')?row.title:metadata.title||row.title});}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}
  async getOpenAlexCache(key:string):Promise<unknown|null>{await this.ensureSchema();const result=await this.pool.query('SELECT response FROM catalog_openalex_cache WHERE cache_key=$1 AND expires_at>now()',[key]);return result.rows[0]?.response||null;}
  async setOpenAlexCache(key:string,value:unknown,expiresAt:string):Promise<void>{await this.ensureSchema();await this.pool.query(`INSERT INTO catalog_openalex_cache(cache_key,response,expires_at) VALUES($1,$2::jsonb,$3::timestamptz) ON CONFLICT(cache_key) DO UPDATE SET response=excluded.response,retrieved_at=now(),expires_at=excluded.expires_at`,[key,JSON.stringify(value),expiresAt]);}

  async graphSearch(ownerKeys: string | string[], query: string, limit = 30): Promise<Array<{ chunkId: string; score: number }>> {
    await this.ensureSchema();
    const normalized = query.trim().slice(0, 300);
    if (!normalized) return [];
    const owners = Array.isArray(ownerKeys) ? ownerKeys : [ownerKeys];
    const result = await this.pool.query(
      `WITH matched_nodes AS (
         SELECT owner_key,node_key,CASE WHEN lower(label)=lower($2) THEN 3 ELSE 1 END::real AS match_score
         FROM catalog_graph_nodes
         WHERE owner_key=ANY($1::text[]) AND (label ILIKE ('%' || $2 || '%') OR properties::text ILIKE ('%' || $2 || '%'))
         LIMIT 40
       ), evidence AS (
         SELECT edge.evidence_chunk_id AS chunk_id,max(node.match_score * edge.weight)::real AS score
         FROM catalog_graph_edges edge JOIN matched_nodes node
           ON edge.owner_key=node.owner_key AND (node.node_key=edge.from_key OR node.node_key=edge.to_key)
         WHERE edge.owner_key=ANY($1::text[]) AND edge.evidence_chunk_id IS NOT NULL
         GROUP BY edge.evidence_chunk_id
       ) SELECT chunk_id,score FROM evidence ORDER BY score DESC LIMIT $3`,
      [owners, normalized, Math.max(1, Math.min(100, limit))],
    );
    return result.rows.map((row) => ({ chunkId: row.chunk_id, score: Number(row.score || 0) }));
  }

  async searchCitations(
    ownerKey: string,
    query: string,
    limit = 20,
    libraryId?: string,
  ): Promise<CitationSearchResult[]> {
    await this.ensureSchema();
    const normalizedQuery = query.trim();
    const pattern = `%${normalizedQuery.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await this.pool.query(
      `SELECT r.id, r.cite_key, r.type, r.title, r.contributors, r.issued,
              r.identifiers, r.tags, r.language, r.publisher, r.publisher_place, r.url, r.updated_at,
              COALESCE(array_agg(li.library_id) FILTER (WHERE li.library_id IS NOT NULL), ARRAY[]::text[]) AS library_ids
       FROM catalog_references r
       LEFT JOIN catalog_library_items li ON li.reference_id = r.id
       WHERE r.owner_key = $1
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM catalog_library_items scoped
           WHERE scoped.reference_id = r.id AND scoped.library_id = $4
         ))
         AND ($2 = '' OR r.cite_key ILIKE $3 ESCAPE '\\'
           OR r.title ILIKE $3 ESCAPE '\\'
           OR r.contributors::text ILIKE $3 ESCAPE '\\'
           OR array_to_string(r.tags, ' ') ILIKE $3 ESCAPE '\\')
       GROUP BY r.id
       ORDER BY
         CASE
           WHEN $2 = '' THEN 3
           WHEN lower(r.cite_key) = lower($2) THEN 0
           WHEN r.cite_key ILIKE ($2 || '%') THEN 1
           WHEN r.title ILIKE ($2 || '%') THEN 2
           ELSE 3
         END,
         r.updated_at DESC
       LIMIT $5`,
      [ownerKey, normalizedQuery, pattern, libraryId || null, Math.max(1, Math.min(50, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      citeKey: row.cite_key,
      type: row.type,
      title: row.title,
      contributors: row.contributors ?? [],
      issued: row.issued ?? undefined,
      identifiers: row.identifiers ?? {},
      tags: row.tags ?? [],
      language: row.language ?? undefined,
      publisher: row.publisher ?? undefined,
      publisherPlace: row.publisher_place ?? undefined,
      url: row.url ?? undefined,
      libraryIds: row.library_ids ?? [],
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async resolveCitationKeys(ownerKey: string, citeKeys: string[]): Promise<CitationSearchResult[]> {
    await this.ensureSchema();
    const keys = [...new Set(citeKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 100);
    if (!keys.length) return [];
    const result = await this.pool.query(
      `SELECT r.id, r.cite_key, r.type, r.title, r.contributors, r.issued,
              r.identifiers, r.tags, r.language, r.publisher, r.publisher_place, r.url, r.updated_at,
              COALESCE(array_agg(li.library_id) FILTER (WHERE li.library_id IS NOT NULL), ARRAY[]::text[]) AS library_ids
       FROM catalog_references r
       LEFT JOIN catalog_library_items li ON li.reference_id = r.id
       WHERE r.owner_key = $1 AND r.cite_key = ANY($2::text[])
       GROUP BY r.id
       ORDER BY array_position($2::text[], r.cite_key)`,
      [ownerKey, keys],
    );
    return result.rows.map((row) => ({
      id: row.id,
      citeKey: row.cite_key,
      type: row.type,
      title: row.title,
      contributors: row.contributors ?? [],
      issued: row.issued ?? undefined,
      identifiers: row.identifiers ?? {},
      tags: row.tags ?? [],
      language: row.language ?? undefined,
      publisher: row.publisher ?? undefined,
      publisherPlace: row.publisher_place ?? undefined,
      url: row.url ?? undefined,
      libraryIds: row.library_ids ?? [],
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async listLibraries(ownerKey: string): Promise<CatalogLibrary[]> {
    await this.ensureSchema();
    await this.ensureInbox(ownerKey);
    const result = await this.pool.query(
      `WITH RECURSIVE shared_libraries AS (
         SELECT l.id, s.shared_by_email FROM catalog_library_shares s JOIN catalog_libraries l ON l.id=s.library_id
         WHERE s.grantee_owner_key=$1
         UNION SELECT child.id, parent.shared_by_email FROM catalog_libraries child
           JOIN shared_libraries parent ON child.parent_id=parent.id
       )
       SELECT l.*,
         CASE WHEN l.owner_key=$1 OR l.parent_id IN (SELECT id FROM shared_libraries) THEN l.parent_id ELSE NULL END AS visible_parent_id,
         CASE WHEN l.id='inbox:' || $1 THEN (
           SELECT count(*)::int FROM catalog_references r
           WHERE r.owner_key=$1 AND NOT EXISTS (
             SELECT 1 FROM catalog_library_items filed_item
             JOIN catalog_libraries filed_library ON filed_library.id=filed_item.library_id
             WHERE filed_item.reference_id=r.id
               AND filed_library.owner_key=$1
               AND filed_library.id<>'inbox:' || $1
           )
         ) ELSE count(li.reference_id)::int END AS item_count,
         CASE WHEN l.owner_key=$1 THEN 'owner' ELSE 'viewer' END AS access,
         max(sl.shared_by_email) AS shared_by_email
       FROM catalog_libraries l LEFT JOIN catalog_library_items li ON li.library_id=l.id
       LEFT JOIN shared_libraries sl ON sl.id=l.id
       WHERE l.owner_key=$1 OR sl.id IS NOT NULL
       GROUP BY l.id ORDER BY l.created_at`, [ownerKey],
    );
    return result.rows.map((row) => ({ id: row.id, ownerKey: row.owner_key, name: row.name,
      description: row.description ?? undefined, parentId: row.visible_parent_id ?? undefined, itemCount: row.item_count,
      createdAt: new Date(row.created_at).toISOString(), access: row.access,
      sharedByEmail: row.shared_by_email ?? undefined }));
  }

  async createLibrary(ownerKey: string, name: string, parentId?: string): Promise<CatalogLibrary> {
    await this.ensureSchema();
    const id = crypto.randomUUID();
    const result = await this.pool.query(
      `INSERT INTO catalog_libraries (id, owner_key, name, parent_id)
       SELECT $1,$2,$3,p.id FROM catalog_libraries p WHERE p.id=$4 AND p.owner_key=$2
       UNION ALL SELECT $1,$2,$3,NULL WHERE $4 IS NULL
       RETURNING *`,
      [id, ownerKey, name, parentId || null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('PARENT_LIBRARY_NOT_FOUND');
    return { id: row.id, ownerKey: row.owner_key, name: row.name,
      parentId: row.parent_id ?? undefined, itemCount: 0, createdAt: new Date(row.created_at).toISOString(), access: 'owner' };
  }

  async ensureLibraryPath(ownerKey: string, names: string[]): Promise<CatalogLibrary | null> {
    await this.ensureSchema();
    const path = names.map((name) => name.trim().replace(/\s+/g, ' ').slice(0, 160)).filter(Boolean);
    if (!path.length) return null;
    const client = await this.pool.connect();
    let parentId: string | null = null;
    let row: any;
    try {
      await client.query('BEGIN');
      for (const name of path) {
        let found = await client.query(
          'SELECT * FROM catalog_libraries WHERE owner_key=$1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name)=lower($3) LIMIT 1',
          [ownerKey, parentId, name],
        );
        if (!found.rows[0]) {
          try {
            found = await client.query(
              'INSERT INTO catalog_libraries(id,owner_key,name,parent_id) VALUES($1,$2,$3,$4) RETURNING *',
              [crypto.randomUUID(), ownerKey, name, parentId],
            );
          } catch (error: any) {
            if (String(error?.code || '') !== '23505') throw error;
            found = await client.query(
              'SELECT * FROM catalog_libraries WHERE owner_key=$1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name)=lower($3) LIMIT 1',
              [ownerKey, parentId, name],
            );
          }
        }
        row = found.rows[0];
        if (!row) throw new Error('LIBRARY_PATH_CREATE_FAILED');
        parentId = row.id;
      }
      await client.query('COMMIT');
      return { id: row.id, ownerKey: row.owner_key, name: row.name, description: row.description ?? undefined,
        parentId: row.parent_id ?? undefined, itemCount: 0, createdAt: new Date(row.created_at).toISOString(), access: 'owner' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async updateLibrary(ownerKey: string, id: string, input: { name?: string; parentId?: string | null }): Promise<CatalogLibrary | null> {
    await this.ensureSchema();
    if (id.startsWith('inbox:')) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM catalog_libraries WHERE id=$1 AND owner_key=$2 FOR UPDATE', [id, ownerKey]);
      if (!current.rows[0]) { await client.query('ROLLBACK'); return null; }
      const name = input.name === undefined ? current.rows[0].name : input.name;
      let parentId = input.parentId === undefined ? current.rows[0].parent_id : input.parentId;
      if (parentId === id) throw new Error('LIBRARY_CYCLE');
      if (parentId) {
        const parent = await client.query('SELECT id FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [parentId, ownerKey]);
        if (!parent.rows[0]) throw new Error('PARENT_LIBRARY_NOT_FOUND');
        const descendants = await client.query(
          `WITH RECURSIVE branch AS (
             SELECT id FROM catalog_libraries WHERE id=$1
             UNION ALL SELECT l.id FROM catalog_libraries l JOIN branch b ON l.parent_id=b.id
           ) SELECT 1 FROM branch WHERE id=$2`, [id, parentId],
        );
        if (descendants.rowCount) throw new Error('LIBRARY_CYCLE');
      } else parentId = null;
      const result = await client.query(
        'UPDATE catalog_libraries SET name=$3,parent_id=$4 WHERE id=$1 AND owner_key=$2 RETURNING *',
        [id, ownerKey, name, parentId],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      return { id: row.id, ownerKey: row.owner_key, name: row.name, description: row.description ?? undefined,
        parentId: row.parent_id ?? undefined, itemCount: 0, createdAt: new Date(row.created_at).toISOString(), access: 'owner' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async deleteLibrary(ownerKey: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    if (id.startsWith('inbox:')) return false;
    const result = await this.pool.query('DELETE FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [id, ownerKey]);
    return result.rowCount === 1;
  }

  async shareLibrary(ownerKey: string, libraryId: string, granteeOwnerKey: string, granteeEmail: string, sharedByEmail: string): Promise<CatalogLibraryShare | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO catalog_library_shares (library_id,grantee_owner_key,grantee_email,shared_by_email)
       SELECT id,$3,$4,$5 FROM catalog_libraries WHERE id=$1 AND owner_key=$2
       ON CONFLICT (library_id,grantee_owner_key) DO UPDATE SET grantee_email=excluded.grantee_email,shared_by_email=excluded.shared_by_email
       RETURNING library_id,grantee_email,created_at`,
      [libraryId, ownerKey, granteeOwnerKey, granteeEmail, sharedByEmail],
    );
    const row = result.rows[0];
    return row ? { libraryId: row.library_id, email: row.grantee_email, createdAt: new Date(row.created_at).toISOString() } : null;
  }

  async listLibraryShares(ownerKey: string, libraryId: string): Promise<CatalogLibraryShare[] | null> {
    await this.ensureSchema();
    const owned = await this.pool.query('SELECT 1 FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [libraryId, ownerKey]);
    if (!owned.rows[0]) return null;
    const result = await this.pool.query(
      'SELECT library_id,grantee_email,created_at FROM catalog_library_shares WHERE library_id=$1 ORDER BY created_at', [libraryId],
    );
    return result.rows.map((row) => ({ libraryId: row.library_id, email: row.grantee_email, createdAt: new Date(row.created_at).toISOString() }));
  }

  async revokeLibraryShare(ownerKey: string, libraryId: string, granteeOwnerKey: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `DELETE FROM catalog_library_shares s USING catalog_libraries l
       WHERE s.library_id=l.id AND l.owner_key=$1 AND s.library_id=$2 AND s.grantee_owner_key=$3`,
      [ownerKey, libraryId, granteeOwnerKey],
    );
    return result.rowCount === 1;
  }

  async ensureInbox(ownerKey: string): Promise<string> {
    const id = `inbox:${ownerKey}`;
    await this.pool.query(
      `INSERT INTO catalog_libraries (id, owner_key, name, description) VALUES ($1,$2,'Inbox','Documents awaiting cultivation') ON CONFLICT (id) DO NOTHING`,
      [id, ownerKey],
    );
    return id;
  }

  async addToLibrary(ownerKey: string, referenceId: string, libraryId?: string): Promise<void> {
    await this.ensureSchema();
    const target = libraryId || await this.ensureInbox(ownerKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (!target.startsWith('inbox:')) {
        await client.query('DELETE FROM catalog_library_items WHERE library_id=$1 AND reference_id=$2', [`inbox:${ownerKey}`, referenceId]);
      }
      await client.query(
        `INSERT INTO catalog_library_items (library_id, reference_id)
         SELECT l.id, r.id FROM catalog_libraries l, catalog_references r
         WHERE l.id=$1 AND l.owner_key=$2 AND r.id=$3 AND r.owner_key=$2 ON CONFLICT DO NOTHING`,
        [target, ownerKey, referenceId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async setReferenceLibraries(ownerKey: string, referenceId: string, libraryIds: string[]): Promise<string[]> {
    await this.ensureSchema();
    const unique = [...new Set(libraryIds.filter((id) => Boolean(id) && !id.startsWith('inbox:')))];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reference = await client.query('SELECT id FROM catalog_references WHERE id=$1 AND owner_key=$2', [referenceId, ownerKey]);
      if (!reference.rows[0]) throw new Error('REFERENCE_NOT_FOUND');
      if (unique.length) {
        const valid = await client.query('SELECT id FROM catalog_libraries WHERE owner_key=$1 AND id=ANY($2::text[])', [ownerKey, unique]);
        if (valid.rowCount !== unique.length) throw new Error('LIBRARY_NOT_FOUND');
      }
      await client.query('DELETE FROM catalog_library_items WHERE reference_id=$1', [referenceId]);
      for (const libraryId of unique) {
        await client.query('INSERT INTO catalog_library_items (library_id,reference_id) VALUES ($1,$2)', [libraryId, referenceId]);
      }
      await client.query('COMMIT');
      return unique;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async removeFromLibrary(ownerKey: string, referenceId: string, libraryId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `DELETE FROM catalog_library_items item
       USING catalog_libraries library
       WHERE item.library_id=library.id AND library.owner_key=$1
         AND item.library_id=$2 AND item.reference_id=$3`,
      [ownerKey, libraryId, referenceId],
    );
    return result.rowCount === 1;
  }

  async importBibliography(ownerKey: string, libraryId: string, entries: CatalogBibliographyInput[]): Promise<CatalogReference[]> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    const importedIds: string[] = [];
    try {
      await client.query('BEGIN');
      const library = await client.query('SELECT id FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [libraryId, ownerKey]);
      if (!library.rows[0]) throw new Error('LIBRARY_NOT_FOUND');
      for (const entry of entries.slice(0, 5000)) {
        if(entry.artifact){
          const linked=await client.query(`SELECT reference.id FROM catalog_artifacts artifact JOIN catalog_references reference ON reference.id=artifact.reference_id WHERE reference.owner_key=$1 AND artifact.object_key=$2 LIMIT 1`,[ownerKey,entry.artifact.objectKey]);
          if(linked.rows[0]){
            const referenceId=String(linked.rows[0].id);importedIds.push(referenceId);
            await client.query(`UPDATE catalog_references SET
              title=CASE WHEN trim(title)='' OR lower(title)='untitled reference' THEN $3 ELSE title END,
              type=CASE WHEN type IN ('','misc','document') AND $4<>'misc' THEN $4 ELSE type END,
              contributors=CASE WHEN jsonb_array_length(contributors)=0 THEN $5::jsonb ELSE contributors END,
              issued=COALESCE(issued,$6::jsonb),identifiers=$7::jsonb||identifiers,
              tags=ARRAY(SELECT DISTINCT value FROM unnest(tags||$8::text[]) value WHERE trim(value)<>''),
              abstract=COALESCE(NULLIF(abstract,''),$9),language=COALESCE(NULLIF(language,''),$10),
              publisher=COALESCE(NULLIF(publisher,''),$11),publisher_place=COALESCE(NULLIF(publisher_place,''),$12),url=COALESCE(NULLIF(url,''),$13),
              source=jsonb_set(source||($14::jsonb-'provider'-'originalFilename'-'wasabiObjectKey'-'wasabiStorageRoot'),'{biblatexFields}',COALESCE(source->'biblatexFields','{}'::jsonb)||COALESCE($14::jsonb->'biblatexFields','{}'::jsonb),true),updated_at=now()
              WHERE owner_key=$1 AND id=$2`,[ownerKey,referenceId,entry.title,entry.type,JSON.stringify(entry.contributors),JSON.stringify(entry.issued??null),JSON.stringify(entry.identifiers),entry.tags??[],entry.abstract||null,entry.language||null,entry.publisher||null,entry.publisherPlace||null,entry.url||null,JSON.stringify(entry.source)]);
            await client.query('INSERT INTO catalog_library_items (library_id,reference_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[libraryId,referenceId]);
            await client.query('DELETE FROM catalog_library_items WHERE library_id=$1 AND reference_id=$2',[`inbox:${ownerKey}`,referenceId]);
            continue;
          }
        }
        const result = await client.query(
          `INSERT INTO catalog_references
             (id,owner_key,cite_key,type,title,contributors,issued,identifiers,tags,abstract,language,publisher,publisher_place,url,source,original_sha256,created_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::text[],$10,$11,$12,$13,$14,$15::jsonb,$16,COALESCE($17::timestamptz,now()))
           ON CONFLICT (owner_key,original_sha256) DO UPDATE
             SET source=catalog_references.source || excluded.source, updated_at=now()
           RETURNING id`,
          [entry.id, ownerKey, entry.citeKey, entry.type, entry.title, JSON.stringify(entry.contributors),
            JSON.stringify(entry.issued ?? null), JSON.stringify(entry.identifiers), entry.tags ?? [],
            entry.abstract || null, entry.language || null, entry.publisher || null, entry.publisherPlace || null,
            entry.url || null, JSON.stringify(entry.source), entry.originalSha256, entry.createdAt || null],
        );
        const referenceId = result.rows[0].id;
        importedIds.push(referenceId);
        await client.query(
          'INSERT INTO catalog_library_items (library_id,reference_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [libraryId, referenceId],
        );
        await client.query(
          'DELETE FROM catalog_library_items WHERE library_id=$1 AND reference_id=$2',
          [`inbox:${ownerKey}`, referenceId],
        );
        if (entry.artifact) {
          const artifactResult = await client.query(
            `INSERT INTO catalog_artifacts
              (id,reference_id,kind,provider,object_key,bucket,mime_type,size_bytes,sha256,etag)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT(object_key) DO UPDATE SET object_key=excluded.object_key
               WHERE catalog_artifacts.reference_id=excluded.reference_id
             RETURNING reference_id`,
            [entry.artifact.id, referenceId, entry.artifact.kind, entry.artifact.provider,
              entry.artifact.objectKey, entry.artifact.bucket, entry.artifact.mimeType,
              entry.artifact.sizeBytes, entry.artifact.sha256, entry.artifact.etag],
          );
          if (!artifactResult.rows[0]) throw new Error('WASABI_OBJECT_ALREADY_LINKED');
          for (const job of buildInitialJobs(referenceId)) {
            await client.query(
              `INSERT INTO catalog_jobs(id,reference_id,stage,status,attempts,created_at,updated_at)
               VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(reference_id,stage) DO NOTHING`,
              [job.id, referenceId, job.stage, job.status, job.attempts, job.createdAt, job.updatedAt],
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    const results: CatalogReference[] = [];
    for (const id of importedIds) {
      const reference = await this.get(ownerKey, id);
      if (reference) results.push(reference);
    }
    return results;
  }

  async updateMetadata(ownerKey: string, id: string, input: CatalogMetadataUpdate): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const curation = {
      manualFields: input.manualFields,
      updatedAt: new Date().toISOString(),
    };
    const result = await this.pool.query(
      `UPDATE catalog_references
       SET title=$3, cite_key=$4, type=$5, contributors=$6::jsonb, issued=$7::jsonb,
           identifiers=$8::jsonb, tags=$9::text[], abstract=$10, language=$11,
           publisher=$12, publisher_place=$13, url=$14,
           source=jsonb_set(
             jsonb_set(source, '{biblatexFields}', $16::jsonb, true),
             '{curation}', COALESCE(source->'curation', '{}'::jsonb) || $15::jsonb, true
           ),
           updated_at=now()
       WHERE owner_key=$1 AND id=$2
       RETURNING *`,
      [ownerKey, id, input.title, input.citeKey, input.type, JSON.stringify(input.contributors),
        JSON.stringify(input.issued ?? null), JSON.stringify(input.identifiers), input.tags,
        input.abstract || null, input.language || null, input.publisher || null, input.publisherPlace || null,
        input.url || null, JSON.stringify(curation), JSON.stringify(input.bibliographicFields || {})],
    );
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
  }

  async renameArtifact(ownerKey: string, referenceId: string, artifactId: string, objectKey: string, originalFilename: string, etag?: string): Promise<boolean> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE catalog_artifacts a
         SET object_key=$4, etag=COALESCE($5,etag)
         FROM catalog_references r
         WHERE a.id=$3 AND a.reference_id=$2 AND r.id=a.reference_id AND r.owner_key=$1`,
        [ownerKey, referenceId, artifactId, objectKey, etag || null],
      );
      if (result.rowCount !== 1) { await client.query('ROLLBACK'); return false; }
      await client.query(
        `UPDATE catalog_references SET
           source=jsonb_set(
             jsonb_set(source, '{originalFilename}', to_jsonb($3::text), true),
             '{wasabiObjectKey}', to_jsonb($4::text), true
           ), updated_at=now()
         WHERE owner_key=$1 AND id=$2`,
        [ownerKey, referenceId, originalFilename, objectKey],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async cancelJobsForDeletion(ownerKey: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `UPDATE catalog_jobs j SET status='failed', error='deleted by curator', updated_at=now()
       FROM catalog_references r WHERE j.reference_id=r.id AND r.owner_key=$1 AND r.id=$2`,
      [ownerKey, id],
    );
    return (result.rowCount || 0) > 0;
  }

  async deleteReference(ownerKey: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'DELETE FROM catalog_references WHERE owner_key=$1 AND id=$2',
      [ownerKey, id],
    );
    return result.rowCount === 1;
  }

  async queueEnrichment(ownerKey: string, id: string, stage: EnrichmentStage): Promise<boolean> {
    await this.ensureSchema();
    const downstream: EnrichmentStage[] =
      stage === 'extract' ? ['scholarly', 'identify', 'summarize', 'relate']
      : stage === 'scholarly' ? ['identify', 'summarize', 'relate']
      : stage === 'identify' ? ['summarize', 'relate']
      : stage === 'summarize' ? ['relate']
      : [];
    // Older references may predate a stage (e.g. scholarly); create the
    // missing job rows so re-queueing is never a silent no-op.
    await this.pool.query(
      `INSERT INTO catalog_jobs (id, reference_id, stage, status, attempts, payload, created_at, updated_at)
       SELECT r.id || ':' || s.stage, r.id, s.stage, 'blocked', 0, '{}'::jsonb, now(), now()
       FROM catalog_references r, unnest($3::text[]) AS s(stage)
       WHERE r.owner_key=$1 AND r.id=$2
       ON CONFLICT (reference_id, stage) DO NOTHING`,
      [ownerKey, id, [stage, ...downstream]],
    );
    const result = await this.pool.query(
      `UPDATE catalog_jobs j
       SET status = CASE
            WHEN j.stage=$3 THEN 'queued'
            WHEN j.stage=ANY($4::text[]) THEN 'blocked'
            ELSE j.status
          END,
          attempts = CASE WHEN j.stage=$3 THEN 0 ELSE j.attempts END,
          error = CASE WHEN j.stage=$3 OR j.stage=ANY($4::text[]) THEN NULL ELSE j.error END,
          payload = CASE WHEN j.stage=$3 THEN '{}'::jsonb ELSE j.payload END,
          updated_at = now()
       FROM catalog_references r
       WHERE j.reference_id=r.id AND r.owner_key=$1 AND r.id=$2
         AND (j.stage=$3 OR j.stage=ANY($4::text[]))`,
      [ownerKey, id, stage, downstream],
    );
    return (result.rowCount || 0) > 0;
  }

  async replaceOriginal(ownerKey: string, id: string, input: CatalogOriginalReplacement): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE catalog_references
         SET original_sha256=$3,
             source=jsonb_set(source, '{originalFilename}', to_jsonb($4::text), true),
             updated_at=now()
         WHERE owner_key=$1 AND id=$2
         RETURNING id`,
        [ownerKey, id, input.originalSha256, input.originalFilename],
      );
      if (!updated.rows[0]) { await client.query('ROLLBACK'); return null; }
      await client.query('DELETE FROM catalog_artifacts WHERE reference_id=$1', [id]);
      await client.query(
        `INSERT INTO catalog_artifacts
          (id, reference_id, kind, provider, object_key, bucket, mime_type, size_bytes, sha256, etag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [input.artifact.id, id, input.artifact.kind, input.artifact.provider,
          input.artifact.objectKey, input.artifact.bucket, input.artifact.mimeType,
          input.artifact.sizeBytes, input.artifact.sha256, input.artifact.etag],
      );
      await client.query(
        `UPDATE catalog_jobs SET
           status=CASE WHEN stage='extract' THEN 'queued' ELSE 'blocked' END,
           attempts=0, error=NULL, payload='{}'::jsonb, updated_at=now()
         WHERE reference_id=$1`,
        [id],
      );
      await client.query('COMMIT');
      return this.get(ownerKey, id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async catalogDocument(input: CatalogDocumentInput): Promise<CatalogReference> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO catalog_references
          (id, owner_key, cite_key, type, title, source, original_sha256)
         VALUES ($1, $2, $3, 'misc', $4, $5::jsonb, $6)`,
        [input.id, input.ownerKey, input.citeKey, input.title, JSON.stringify(input.source), input.originalSha256],
      );
      await client.query(
        `INSERT INTO catalog_artifacts
          (id, reference_id, kind, provider, object_key, bucket, mime_type, size_bytes, sha256, etag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.artifact.id, input.id, input.artifact.kind, input.artifact.provider,
          input.artifact.objectKey, input.artifact.bucket, input.artifact.mimeType,
          input.artifact.sizeBytes, input.artifact.sha256, input.artifact.etag],
      );
      for (const job of buildInitialJobs(input.id)) await this.insertJob(client, input.id, job);
      const libraryId = input.libraryId || `inbox:${input.ownerKey}`;
      await client.query(`INSERT INTO catalog_libraries (id, owner_key, name, description) VALUES ($1,$2,'Inbox','Documents awaiting cultivation') ON CONFLICT (id) DO NOTHING`, [libraryId, input.ownerKey]);
      await client.query('INSERT INTO catalog_library_items (library_id, reference_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [libraryId, input.id]);
      await client.query('COMMIT');
      return (await this.get(input.ownerKey, input.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertJob(client: PoolClient, referenceId: string, job: CatalogJob): Promise<void> {
    await client.query(
      `INSERT INTO catalog_jobs (id, reference_id, stage, status, attempts)
       VALUES ($1, $2, $3, $4, $5)`,
      [job.id, referenceId, job.stage, job.status, job.attempts],
    );
  }

  private async hydrate(row: any, viewerOwnerKey?: string): Promise<CatalogReference> {
    const [artifactRows, jobRows, libraryRows] = await Promise.all([
      this.pool.query('SELECT * FROM catalog_artifacts WHERE reference_id = $1 ORDER BY created_at', [row.id]),
      this.pool.query('SELECT * FROM catalog_jobs WHERE reference_id = $1 ORDER BY created_at', [row.id]),
      viewerOwnerKey ? this.pool.query(
        `WITH RECURSIVE shared_libraries AS (
           SELECT l.id FROM catalog_library_shares s JOIN catalog_libraries l ON l.id=s.library_id WHERE s.grantee_owner_key=$2
           UNION SELECT child.id FROM catalog_libraries child JOIN shared_libraries parent ON child.parent_id=parent.id
         ) SELECT li.library_id FROM catalog_library_items li JOIN catalog_libraries l ON l.id=li.library_id
         WHERE li.reference_id=$1 AND (l.owner_key=$2 OR l.id IN (SELECT id FROM shared_libraries)) ORDER BY li.added_at`,
        [row.id, viewerOwnerKey],
      ) : this.pool.query('SELECT library_id FROM catalog_library_items WHERE reference_id = $1 ORDER BY added_at', [row.id]),
    ]);
    const artifacts = artifactRows.rows.map((artifact): CatalogArtifact => ({
      id: artifact.id,
      kind: artifact.kind,
      provider: artifact.provider,
      objectKey: artifact.object_key,
      bucket: artifact.bucket ?? undefined,
      mimeType: artifact.mime_type ?? undefined,
      sizeBytes: Number(artifact.size_bytes),
      sha256: artifact.sha256,
      etag: artifact.etag ?? undefined,
      createdAt: new Date(artifact.created_at).toISOString(),
    }));
    const jobs = jobRows.rows.map((job): CatalogJob => ({
      id: job.id,
      stage: job.stage,
      status: job.status,
      attempts: job.attempts,
      error: job.error ?? undefined,
      createdAt: new Date(job.created_at).toISOString(),
      updatedAt: new Date(job.updated_at).toISOString(),
    }));
    return mapReference({ ...row, library_ids: libraryRows.rows.map((item) => item.library_id) }, artifacts, jobs);
  }
}
