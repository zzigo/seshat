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
  source: Record<string, unknown>;
  originalSha256: string;
  artifacts: CatalogArtifact[];
  jobs: CatalogJob[];
  createdAt: string;
  updatedAt: string;
  libraryIds: string[];
}

export interface CatalogLibrary {
  id: string;
  ownerKey: string;
  name: string;
  description?: string;
  itemCount: number;
  createdAt: string;
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

export interface CatalogMetadataUpdate {
  title: string;
  contributors: unknown[];
  issued?: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  manualFields: string[];
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
    source jsonb NOT NULL DEFAULT '{}'::jsonb,
    original_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_key, original_sha256)
  );
  CREATE INDEX IF NOT EXISTS catalog_references_owner_updated_idx
    ON catalog_references (owner_key, updated_at DESC);

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
  source: row.source ?? {},
  originalSha256: row.original_sha256,
  artifacts,
  jobs,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  libraryIds: row.library_ids ?? [],
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
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
  }

  async get(ownerKey: string, id: string): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT * FROM catalog_references WHERE owner_key = $1 AND id = $2',
      [ownerKey, id],
    );
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
  }

  async list(ownerKey: string, limit = 50): Promise<CatalogReference[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT r.*, COALESCE(array_agg(li.library_id) FILTER (WHERE li.library_id IS NOT NULL), ARRAY[]::text[]) AS library_ids
       FROM catalog_references r LEFT JOIN catalog_library_items li ON li.reference_id = r.id
       WHERE r.owner_key = $1 GROUP BY r.id ORDER BY r.updated_at DESC LIMIT $2`,
      [ownerKey, Math.max(1, Math.min(200, limit))],
    );
    return Promise.all(result.rows.map((row) => this.hydrate(row)));
  }

  async listLibraries(ownerKey: string): Promise<CatalogLibrary[]> {
    await this.ensureSchema();
    await this.ensureInbox(ownerKey);
    const result = await this.pool.query(
      `SELECT l.*, count(li.reference_id)::int AS item_count
       FROM catalog_libraries l LEFT JOIN catalog_library_items li ON li.library_id = l.id
       WHERE l.owner_key = $1 GROUP BY l.id ORDER BY l.created_at`, [ownerKey],
    );
    return result.rows.map((row) => ({ id: row.id, ownerKey: row.owner_key, name: row.name,
      description: row.description ?? undefined, itemCount: row.item_count,
      createdAt: new Date(row.created_at).toISOString() }));
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

  async updateMetadata(ownerKey: string, id: string, input: CatalogMetadataUpdate): Promise<CatalogReference | null> {
    await this.ensureSchema();
    const curation = {
      manualFields: input.manualFields,
      updatedAt: new Date().toISOString(),
    };
    const result = await this.pool.query(
      `UPDATE catalog_references
       SET title=$3, contributors=$4::jsonb, issued=$5::jsonb, identifiers=$6::jsonb,
           source=jsonb_set(source, '{curation}', COALESCE(source->'curation', '{}'::jsonb) || $7::jsonb, true),
           updated_at=now()
       WHERE owner_key=$1 AND id=$2
       RETURNING *`,
      [ownerKey, id, input.title, JSON.stringify(input.contributors),
        JSON.stringify(input.issued ?? null), JSON.stringify(input.identifiers), JSON.stringify(curation)],
    );
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
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

  private async hydrate(row: any): Promise<CatalogReference> {
    const [artifactRows, jobRows] = await Promise.all([
      this.pool.query('SELECT * FROM catalog_artifacts WHERE reference_id = $1 ORDER BY created_at', [row.id]),
      this.pool.query('SELECT * FROM catalog_jobs WHERE reference_id = $1 ORDER BY created_at', [row.id]),
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
    return mapReference(row, artifacts, jobs);
  }
}
