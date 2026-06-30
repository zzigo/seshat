import type { APIRoute } from 'astro';

export const GET: APIRoute = () => new Response(JSON.stringify({
  name: 'seshat',
  status: 'ok',
  version: '0.1.0',
  capabilities: ['bibliography-core', 'zotero-provider', 'docling-ingest'],
}), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

