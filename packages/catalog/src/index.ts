import { Pool, type PoolClient } from 'pg';

export type EnrichmentStage = 'extract' | 'identify' | 'summarize' | 'relate';
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

export function buildInitialJobs(_referenceId: string, id: () => string = () => crypto.randomUUID()): CatalogJob[] {
  const timestamp = new Date().toISOString();
  return (['extract', 'identify', 'summarize', 'relate'] as const).map((stage, index) => ({
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
    type text NOT NULL DEFAULT 'document',
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
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_key, original_sha256)
  );
  CREATE INDEX IF NOT EXISTS catalog_references_owner_updated_idx
    ON catalog_references (owner_key, updated_at DESC);
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS publisher text;
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS publisher_place text;
  ALTER TABLE catalog_references ADD COLUMN IF NOT EXISTS url text;

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
    stage text NOT NULL CHECK (stage IN ('extract', 'identify', 'summarize', 'relate')),
    status text NOT NULL CHECK (status IN ('queued', 'blocked', 'running', 'complete', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    error text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reference_id, stage)
  );
  CREATE INDEX IF NOT EXISTS catalog_jobs_queue_idx ON catalog_jobs (status, created_at);

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
  INSERT INTO catalog_libraries (id, owner_key, name, description)
    SELECT 'inbox:' || owner_key, owner_key, 'Inbox', 'Documents awaiting cultivation'
    FROM catalog_references
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO catalog_library_items (library_id, reference_id)
    SELECT 'inbox:' || owner_key, id FROM catalog_references
    ON CONFLICT DO NOTHING;
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
  artifacts,
  jobs,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  libraryIds: row.library_ids ?? [],
  access: row.access === 'viewer' ? 'viewer' : 'owner',
});

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
        (id,reference_id,owner_key,quote,prefix,suffix,start_offset,end_offset,page,locator,color,category,note_type,note,tags,targets,review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16::text[],$17)
       RETURNING *`,
      [crypto.randomUUID(), referenceId, ownerKey, input.quote, input.prefix || '', input.suffix || '',
        input.startOffset, input.endOffset, input.page || null, input.locator || null, input.color,
        input.category, input.noteType || null, input.note || null, input.tags || [], input.targets || [],
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
      `UPDATE catalog_annotations SET quote=$4,prefix=$5,suffix=$6,start_offset=$7,end_offset=$8,page=$9,
         locator=$10,color=$11,category=$12,note_type=$13,note=$14,tags=$15::text[],targets=$16::text[],
         review_status=$17,updated_at=now()
       WHERE id=$1 AND owner_key=$2 AND reference_id=$3 RETURNING *`,
      [id, ownerKey, referenceId, next.quote, next.prefix, next.suffix, next.startOffset, next.endOffset,
        next.page || null, next.locator || null, next.color, next.category, next.noteType || null,
        next.note || null, next.tags || [], next.targets || [], next.reviewStatus || 'captured'],
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
         count(li.reference_id)::int AS item_count,
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
    await this.pool.query(
      `INSERT INTO catalog_library_items (library_id, reference_id)
       SELECT l.id, r.id FROM catalog_libraries l, catalog_references r
       WHERE l.id=$1 AND l.owner_key=$2 AND r.id=$3 AND r.owner_key=$2 ON CONFLICT DO NOTHING`,
      [target, ownerKey, referenceId],
    );
  }

  async setReferenceLibraries(ownerKey: string, referenceId: string, libraryIds: string[]): Promise<string[]> {
    await this.ensureSchema();
    const unique = [...new Set(libraryIds.filter(Boolean))];
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

  async importBibliography(ownerKey: string, libraryId: string, entries: CatalogBibliographyInput[]): Promise<CatalogReference[]> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    const importedIds: string[] = [];
    try {
      await client.query('BEGIN');
      const library = await client.query('SELECT id FROM catalog_libraries WHERE id=$1 AND owner_key=$2', [libraryId, ownerKey]);
      if (!library.rows[0]) throw new Error('LIBRARY_NOT_FOUND');
      for (const entry of entries.slice(0, 5000)) {
        const result = await client.query(
          `INSERT INTO catalog_references
             (id,owner_key,cite_key,type,title,contributors,issued,identifiers,tags,abstract,language,publisher,publisher_place,url,source,original_sha256)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::text[],$10,$11,$12,$13,$14,$15::jsonb,$16)
           ON CONFLICT (owner_key,original_sha256) DO UPDATE SET updated_at=now()
           RETURNING id`,
          [entry.id, ownerKey, entry.citeKey, entry.type, entry.title, JSON.stringify(entry.contributors),
            JSON.stringify(entry.issued ?? null), JSON.stringify(entry.identifiers), entry.tags ?? [],
            entry.abstract || null, entry.language || null, entry.publisher || null, entry.publisherPlace || null,
            entry.url || null, JSON.stringify(entry.source), entry.originalSha256],
        );
        const referenceId = result.rows[0].id;
        importedIds.push(referenceId);
        await client.query(
          'INSERT INTO catalog_library_items (library_id,reference_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [libraryId, referenceId],
        );
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
           source=jsonb_set(source, '{curation}', COALESCE(source->'curation', '{}'::jsonb) || $15::jsonb, true),
           updated_at=now()
       WHERE owner_key=$1 AND id=$2
       RETURNING *`,
      [ownerKey, id, input.title, input.citeKey, input.type, JSON.stringify(input.contributors),
        JSON.stringify(input.issued ?? null), JSON.stringify(input.identifiers), input.tags,
        input.abstract || null, input.language || null, input.publisher || null, input.publisherPlace || null,
        input.url || null, JSON.stringify(curation)],
    );
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
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
    const downstream: EnrichmentStage[] = stage === 'identify' ? ['summarize', 'relate']
      : stage === 'summarize' ? ['relate'] : [];
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
         VALUES ($1, $2, $3, 'document', $4, $5::jsonb, $6)`,
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
