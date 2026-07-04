import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

export const GET: APIRoute = async ({ locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);

  try {
    const nodesResult = await catalog.pool.query(
      `SELECT node_key as id, kind, label, properties
       FROM catalog_graph_nodes
       WHERE owner_key = $1`,
      [ownerKey]
    );
    const edgesResult = await catalog.pool.query(
      `SELECT from_key as source, relation, to_key as target, weight
       FROM catalog_graph_edges
       WHERE owner_key = $1`,
      [ownerKey]
    );

    return Response.json({
      nodes: nodesResult.rows,
      edges: edgesResult.rows
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    console.error('[seshat:global-graph-api]', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
};
