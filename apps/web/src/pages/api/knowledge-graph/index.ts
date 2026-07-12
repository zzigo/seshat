import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const list = (value: string | null) => new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));

export const GET: APIRoute = async ({ locals, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  await catalog.ensureSchema();
  const nodeKinds = list(url.searchParams.get('nodeKinds'));
  const edgeKinds = list(url.searchParams.get('edgeKinds'));
  const paperId = String(url.searchParams.get('paperId') || '').trim();
  const collectionId = String(url.searchParams.get('collectionId') || '').trim();
  const minimumWeight = Math.max(0, Number(url.searchParams.get('minimumWeight') || 0));
  const maximumNodes = Math.max(10, Math.min(1000, Number(url.searchParams.get('maximumNodes') || 400)));
  const [nodeRows, edgeRows] = await Promise.all([
    catalog.pool.query(`SELECT node_key AS id,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1`, [ownerKey]),
    catalog.pool.query(`SELECT edge_key AS id,from_key AS source,relation,to_key AS target,weight,properties,created_at AS "createdAt" FROM catalog_graph_edges WHERE owner_key=$1`, [ownerKey]),
  ]);

  let nodes = nodeRows.rows.filter((node: any) => !nodeKinds.size || nodeKinds.has(node.kind));
  let edges = edgeRows.rows.filter((edge: any) => (!edgeKinds.size || edgeKinds.has(String(edge.relation).toLowerCase())) && Number(edge.weight) >= minimumWeight);
  const allowedKinds = new Set(nodes.map((node: any) => node.id));
  edges = edges.filter((edge: any) => allowedKinds.has(edge.source) && allowedKinds.has(edge.target));

  const focusKeys = new Set<string>();
  if (paperId) {
    nodes.filter((node: any) => node.properties?.referenceId === paperId || node.id === paperId || node.properties?.openAlexId === paperId)
      .forEach((node: any) => focusKeys.add(node.id));
  }
  if (collectionId) {
    const collectionKey = `collection:${collectionId}`;
    if (nodes.some((node: any) => node.id === collectionKey)) focusKeys.add(collectionKey);
  }
  const focusRequested = Boolean(paperId || collectionId);
  const focusFound = focusKeys.size > 0;
  if (focusRequested && !focusFound) {
    nodes = [];
    edges = [];
  } else if (focusFound) {
    const seeds = new Set(focusKeys);
    if (collectionId) {
      edges.forEach((edge: any) => {
        if (focusKeys.has(edge.source)) seeds.add(edge.target);
        if (focusKeys.has(edge.target)) seeds.add(edge.source);
      });
    }
    const connected = new Set(seeds);
    edges.forEach((edge: any) => {
      if (seeds.has(edge.source)) connected.add(edge.target);
      if (seeds.has(edge.target)) connected.add(edge.source);
    });
    nodes = nodes.filter((node: any) => connected.has(node.id));
    const ids = new Set(nodes.map((node: any) => node.id));
    edges = edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target));
  }

  const kindPriority = (kind: unknown) => {
    const normalized = String(kind || '').toLowerCase().replaceAll('_', '-');
    if (['paper', 'work', 'document', 'publication', 'article', 'ebook'].includes(normalized)) return 0;
    if (normalized === 'collection') return 1;
    if (['author', 'person', 'editor', 'composer', 'performer'].includes(normalized)) return 2;
    if (['topic', 'concept', 'relatedconcept'].includes(normalized)) return 3;
    return 4;
  };
  nodes.sort((left: any, right: any) => kindPriority(left.kind) - kindPriority(right.kind) || String(left.label).localeCompare(String(right.label)));
  nodes = nodes.slice(0, maximumNodes);
  const ids = new Set(nodes.map((node: any) => node.id));
  edges = edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target));
  return Response.json({
    nodes,
    edges,
    focus: { requested: paperId || collectionId || null, found: focusFound },
    filters: { nodeKinds: [...nodeKinds], edgeKinds: [...edgeKinds], minimumWeight, maximumNodes },
    schemaVersion: 3,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
};
