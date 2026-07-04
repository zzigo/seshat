import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  const referenceId = params.id || '';

  const reference = await catalog.get(ownerKey, referenceId);
  if (!reference) return Response.json({ error: 'not_found' }, { status: 404 });

  try {
    const nodesResult = await catalog.pool.query(
      `SELECT node_key as id, kind, label, properties
       FROM catalog_graph_nodes
       WHERE owner_key = $1 AND node_key IN (
         SELECT DISTINCT from_key FROM catalog_graph_edges WHERE owner_key = $1 AND reference_id = $2
         UNION
         SELECT DISTINCT to_key FROM catalog_graph_edges WHERE owner_key = $1 AND reference_id = $2
       )`,
      [ownerKey, referenceId]
    );
    const edgesResult = await catalog.pool.query(
      `SELECT from_key as source, relation, to_key as target, weight
       FROM catalog_graph_edges
       WHERE owner_key = $1 AND reference_id = $2`,
      [ownerKey, referenceId]
    );

    return Response.json({
      nodes: nodesResult.rows,
      edges: edgesResult.rows
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    console.error('[seshat:reference-graph-api]', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
};
