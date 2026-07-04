import { createHash } from 'node:crypto';

export type RetrievalChannel = 'lexical' | 'vector' | 'graph';

export interface RankedCandidate {
  chunkId: string;
  score: number;
  channel: RetrievalChannel;
}

export interface FusedCandidate {
  chunkId: string;
  score: number;
  channels: RetrievalChannel[];
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface VectorPoint {
  id: string;
  vector: number[];
  sparse?: SparseVector;
  payload: Record<string, unknown>;
}

export interface VectorMatch {
  chunkId: string;
  score: number;
}

export interface GraphNodeInput {
  key: string;
  kind: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdgeInput {
  from: string;
  relation: string;
  to: string;
  chunkId?: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface NormalizedDoclingChunk {
  id: string;
  ordinal: number;
  content: string;
  contentSha256: string;
  page?: number;
  locator?: string;
  section?: string;
  metadata: Record<string, unknown>;
}

const cleanBaseUrl = (value: string): string => value.replace(/\/+$/, '');

export const stableChunkId = (referenceId: string, ordinal: number, text: string): string => {
  const hex = createHash('sha256')
    .update(referenceId)
    .update('\0')
    .update(String(ordinal))
    .update('\0')
    .update(text)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};

export const normalizeDoclingChunk = (referenceId: string, ordinal: number, row: any): NormalizedDoclingChunk | null => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
  const docItems = Array.isArray((metadata as any).doc_items) ? (metadata as any).doc_items : [];
  const provenance = docItems.flatMap((item: any) => Array.isArray(item?.prov) ? item.prov : []);
  const rawPage = provenance.find((item: any) => Number.isFinite(Number(item?.page_no)))?.page_no;
  const page = Number.isFinite(Number(rawPage)) ? Number(rawPage) : undefined;
  const headings = Array.isArray((metadata as any).headings) ? (metadata as any).headings.map(String).filter(Boolean) : [];
  const section = headings.at(-1);
  const content = String(row?.text || '').trim();
  if (!content) return null;
  return {
    id: stableChunkId(referenceId, ordinal, content), ordinal, content,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    page, locator: page ? `p. ${page}` : section, section, metadata,
  };
};

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const computeSparseVector = (text: string): SparseVector => {
  const tokens = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/\p{L}+/gu) || [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < 2) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([term, tf]) => ({ index: fnv1a(term), value: Math.log(1 + tf) }))
    .sort((a, b) => a.index - b.index);
  return {
    indices: sorted.map((t) => t.index),
    values: sorted.map((t) => t.value),
  };
};

export interface RerankedCandidate {
  chunkId: string;
  score: number;
}

export const rerankCandidates = (
  query: string,
  candidates: Array<{ chunkId: string; content: string; score: number }>,
): RerankedCandidate[] => {
  const queryTerms = query.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/\p{L}+/gu) || [];
  
  if (!queryTerms.length) {
    return candidates.map((c) => ({ chunkId: c.chunkId, score: c.score }));
  }

  const queryPhrase = queryTerms.join(' ');

  return candidates.map((candidate) => {
    const text = candidate.content.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    
    let score = candidate.score;

    if (text.includes(queryPhrase)) {
      score += 0.5;
    }

    let matches = 0;
    for (const term of queryTerms) {
      if (text.includes(term)) {
        matches += 1;
      }
    }
    const overlapFraction = matches / queryTerms.length;
    score += overlapFraction * 0.3;

    if (matches > 1) {
      const positions = queryTerms.map((term) => {
        const idx = text.indexOf(term);
        return idx >= 0 ? idx : null;
      }).filter((pos): pos is number => pos !== null)
        .sort((a, b) => a - b);
      
      if (positions.length > 1) {
        const windowSize = positions[positions.length - 1] - positions[0];
        const proximityBoost = Math.max(0, 0.2 * (1 - windowSize / text.length));
        score += proximityBoost;
      }
    }

    return { chunkId: candidate.chunkId, score };
  }).sort((a, b) => b.score - a.score);
};

export const reciprocalRankFusion = (
  rankings: RankedCandidate[][],
  options: { k?: number; channelWeights?: Partial<Record<RetrievalChannel, number>> } = {},
): FusedCandidate[] => {
  const k = Math.max(1, options.k ?? 60);
  const fused = new Map<string, FusedCandidate>();
  for (const ranking of rankings) {
    ranking.forEach((candidate, index) => {
      const weight = options.channelWeights?.[candidate.channel] ?? 1;
      const current = fused.get(candidate.chunkId) || { chunkId: candidate.chunkId, score: 0, channels: [] };
      current.score += weight / (k + index + 1);
      if (!current.channels.includes(candidate.channel)) current.channels.push(candidate.channel);
      fused.set(candidate.chunkId, current);
    });
  }
  return [...fused.values()].sort((left, right) => right.score - left.score);
};

export class OllamaEmbedder {
  constructor(
    private readonly baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    readonly model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  ) {}

  async embed(input: string[]): Promise<number[][]> {
    if (!input.length) return [];
    const safeInput = input.map((str) => String(str || '').slice(0, 6000));
    const response = await fetch(`${cleanBaseUrl(this.baseUrl)}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: this.model, input: safeInput, truncate: true }),
    });
    if (!response.ok) throw new Error(`OLLAMA_EMBED_${response.status}`);
    const payload = await response.json() as { embeddings?: number[][] };
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== input.length) {
      throw new Error('OLLAMA_EMBED_INVALID_RESPONSE');
    }
    return payload.embeddings;
  }
}

export class QdrantVectorIndex {
  readonly url: string;
  readonly collection: string;
  readonly apiKey: string;

  constructor(options: { url?: string; collection?: string; apiKey?: string } = {}) {
    this.url = cleanBaseUrl(options.url ?? process.env.QDRANT_URL ?? '');
    this.collection = options.collection ?? process.env.QDRANT_COLLECTION ?? 'seshat_chunks';
    this.apiKey = options.apiKey ?? process.env.QDRANT_API_KEY ?? '';
  }

  get enabled(): boolean { return Boolean(this.url); }

  private headers(): HeadersInit {
    return { 'content-type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) };
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.enabled) throw new Error('QDRANT_NOT_CONFIGURED');
    const response = await fetch(`${this.url}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers || {}) },
      signal: init.signal || AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`QDRANT_${response.status}:${String(payload?.status?.error || payload?.message || '').slice(0, 300)}`);
    return payload;
  }

  async ensureCollection(vectorSize: number): Promise<void> {
    const existing = await fetch(`${this.url}/collections/${encodeURIComponent(this.collection)}`, {
      headers: this.headers(), signal: AbortSignal.timeout(5_000),
    });
    if (existing.ok) return;
    if (existing.status !== 404) throw new Error(`QDRANT_COLLECTION_CHECK_${existing.status}`);
    await this.request(`/collections/${encodeURIComponent(this.collection)}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: { dense: { size: vectorSize, distance: 'Cosine', on_disk: true } },
        sparse_vectors: { sparse: { index: { on_disk: true } } },
      }),
    });
    for (const field of ['ownerKey', 'referenceId']) {
      await this.request(`/collections/${encodeURIComponent(this.collection)}/index`, {
        method: 'PUT', body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
      });
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    await this.ensureCollection(points[0].vector.length);
    await this.request(`/collections/${encodeURIComponent(this.collection)}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({
        points: points.map((point) => ({
          id: point.id,
          vector: {
            dense: point.vector,
            ...(point.sparse ? { sparse: point.sparse } : {}),
          },
          payload: point.payload,
        })),
      }),
    });
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.enabled || !ids.length) return;
    const response = await fetch(`${this.url}/collections/${encodeURIComponent(this.collection)}/points/delete?wait=true`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ points: ids }),
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`QDRANT_DELETE_${response.status}:${(await response.text()).slice(0, 300)}`);
  }

  async query(
    vector: number[],
    ownerKeys: string | string[],
    limit = 40,
    sparse?: SparseVector,
  ): Promise<VectorMatch[]> {
    if (!this.enabled) return [];
    const owners = Array.isArray(ownerKeys) ? ownerKeys : [ownerKeys];
    const filter = { must: [{ key: 'ownerKey', match: owners.length === 1 ? { value: owners[0] } : { any: owners } }] };

    if (!sparse || !sparse.indices.length) {
      const payload = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/query`, {
        method: 'POST',
        body: JSON.stringify({
          query: vector,
          using: 'dense',
          filter,
          limit: Math.max(1, Math.min(200, limit)),
          with_payload: false,
        }),
      });
      const points = payload?.result?.points || payload?.result || [];
      return points.map((point: any) => ({ chunkId: String(point.id), score: Number(point.score || 0) }));
    }

    const body = {
      prefetch: [
        {
          query: vector,
          using: 'dense',
          filter,
          limit: Math.max(1, Math.min(200, limit)),
        },
        {
          query: sparse,
          using: 'sparse',
          filter,
          limit: Math.max(1, Math.min(200, limit)),
        },
      ],
      query: { fusion: 'rrf' },
      filter,
      limit: Math.max(1, Math.min(200, limit)),
      with_payload: false,
    };

    const payload = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const points = payload?.result?.points || payload?.result || [];
    return points.map((point: any) => ({ chunkId: String(point.id), score: Number(point.score || 0) }));
  }
}

export class Neo4jGraphMirror {
  readonly url: string;
  readonly user: string;
  readonly password: string;

  constructor(options: { url?: string; user?: string; password?: string } = {}) {
    this.url = cleanBaseUrl(options.url ?? process.env.NEO4J_URL ?? '');
    this.user = options.user ?? process.env.NEO4J_USER ?? 'neo4j';
    this.password = options.password ?? process.env.NEO4J_PASSWORD ?? '';
  }

  get enabled(): boolean { return Boolean(this.url && this.password); }

  private async cypher(statement: string, parameters: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    const response = await fetch(`${this.url}/db/neo4j/query/v2`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${this.user}:${this.password}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ statement, parameters }),
    });
    if (!response.ok) throw new Error(`NEO4J_${response.status}:${(await response.text()).slice(0, 300)}`);
  }

  async sync(ownerKey: string, nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    if (!this.enabled) return;
    await this.cypher(
      `UNWIND $nodes AS input
       MERGE (node:SeshatNode {ownerKey:$ownerKey, key:input.key})
       SET node.kind=input.kind, node.label=input.label, node.properties=input.properties`,
      { ownerKey, nodes: nodes.map((node) => ({ ...node, properties: node.properties || {} })) },
    );
    await this.cypher(
      `UNWIND $edges AS input
       MATCH (source:SeshatNode {ownerKey:$ownerKey, key:input.from})
       MATCH (target:SeshatNode {ownerKey:$ownerKey, key:input.to})
       MERGE (source)-[edge:SESHAT_RELATION {relation:input.relation, chunkId:coalesce(input.chunkId,'')}]->(target)
       SET edge.weight=input.weight, edge.properties=input.properties`,
      { ownerKey, edges: edges.map((edge) => ({ ...edge, weight: edge.weight ?? 1, properties: edge.properties || {} })) },
    );
  }
}
