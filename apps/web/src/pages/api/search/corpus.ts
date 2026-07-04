import type { APIRoute } from 'astro';
import { registerSessionIdentity } from '../../../lib/catalog';
import { reasonOverCorpus, searchCorpus, type CorpusSearchMode } from '../../../lib/corpus-search';

const modes = new Set<CorpusSearchMode>(['hybrid', 'lexical', 'semantic', 'graph']);

export const GET: APIRoute = async ({ locals, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 300);
  if (query.length < 2) return Response.json({ items: [], capabilities: { lexical: true, vector: Boolean(process.env.QDRANT_URL), graph: true } });
  const rawMode = String(url.searchParams.get('mode') || 'hybrid') as CorpusSearchMode;
  const mode = modes.has(rawMode) ? rawMode : 'hybrid';
  const libraryId = String(url.searchParams.get('libraryId') || '').trim().slice(0, 200) || undefined;
  try {
    const ownerKey = await registerSessionIdentity(locals.session);
    const result = await searchCorpus({ ownerKey, query, mode, libraryId, limit: 40 });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[seshat:corpus-search]', error);
    return Response.json({ error: 'corpus_search_failed' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { query?: unknown; libraryId?: unknown };
    const query = String(body.query || '').trim().slice(0, 300);
    if (query.length < 2) return Response.json({ error: 'query_too_short' }, { status: 400 });
    const libraryId = String(body.libraryId || '').trim().slice(0, 200) || undefined;
    const ownerKey = await registerSessionIdentity(locals.session);
    const result = await reasonOverCorpus({ ownerKey, query, libraryId });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[seshat:corpus-reason]', error);
    return Response.json({ error: 'corpus_reasoning_failed' }, { status: 500 });
  }
};
