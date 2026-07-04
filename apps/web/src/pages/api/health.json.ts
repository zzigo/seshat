import type { APIRoute } from 'astro';

export const GET: APIRoute = () => new Response(JSON.stringify({
  name: 'seshat',
  status: 'ok',
  version: '0.1.0',
  capabilities: [
    'bibliography-core', 'zotero-provider', 'docling-ingest', 'postgres-gin-search', 'grounded-corpus-reasoning',
    'evidence-graph', ...(process.env.QDRANT_URL ? ['qdrant-dense-retrieval'] : []),
    ...(process.env.NEO4J_URL ? ['neo4j-graph-mirror'] : []),
  ],
}), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
