import type { APIRoute } from 'astro';
import { buildBibliographyConnections } from '@seshat/catalog';
import { normalizeOpenAlexId } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { openAlexCitationNeighborhood, openAlexReferenceNeighborhood, openAlexSimilarNeighborhood } from '../../../lib/graph-discovery';
import { getOpenAlexClient } from '../../../lib/openalex';

type NeighborhoodMode='concept'|'references'|'citations'|'similar';
const nodeRow=(row:any)=>({id:String(row.id),kind:String(row.kind),label:String(row.label),properties:row.properties||{}});
const edgeRow=(row:any)=>({id:String(row.id),source:String(row.source),target:String(row.target),relation:String(row.relation),weight:Number(row.weight||0),properties:row.properties||{}});

export const GET:APIRoute=async({locals,url})=>{
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();
  if(!email)return Response.json({error:'authentication_required'},{status:401});
  const nodeId=String(url.searchParams.get('nodeId')||'').trim();
  if(!nodeId)return Response.json({error:'node_id_required'},{status:400});
  const requestedMode=String(url.searchParams.get('mode')||'references');
  const mode:NeighborhoodMode=requestedMode==='concept'||requestedMode==='citations'||requestedMode==='similar'?requestedMode:'references';
  const maximum=Math.max(1,Math.min(100,Math.trunc(Number(url.searchParams.get('maximum')||100))));
  const ownerKey=ownerKeyFor(email),catalog=getCatalog();await catalog.ensureSchema();
  const storedNodeResult=await catalog.pool.query(`SELECT node_key AS id,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1 AND node_key=$2 LIMIT 1`,[ownerKey,nodeId]);
  const storedNode=storedNodeResult.rows[0];
  const edgeCondition=mode==='concept'
    ? `lower(relation)='has-topic' AND (from_key=$2 OR to_key=$2)`
    : mode==='references'
      ? `lower(relation)='cites' AND from_key=$2`
      : mode==='citations'
        ? `lower(relation)='cites' AND to_key=$2`
        : `lower(relation)=ANY(ARRAY['related-to','bibliographic-coupling','co-citation','shared-topic']::text[]) AND (from_key=$2 OR to_key=$2)`;
  const edgeWhere=`owner_key=$1 AND ${edgeCondition}`;
  const neighborExpression=mode==='references'?'to_key':mode==='citations'?'from_key':`CASE WHEN from_key=$2 THEN to_key ELSE from_key END`;
  const [storedEdgeResult,storedCountResult]=await Promise.all([
    catalog.pool.query(
      `SELECT edge_key AS id,from_key AS source,to_key AS target,relation,weight,properties
       FROM catalog_graph_edges WHERE ${edgeWhere}
       ORDER BY weight DESC,updated_at DESC LIMIT $3`,[ownerKey,nodeId,maximum],
    ),
    catalog.pool.query(`SELECT count(DISTINCT ${neighborExpression})::int AS total FROM catalog_graph_edges WHERE ${edgeWhere}`,[ownerKey,nodeId]),
  ]);
  const storedEdges=storedEdgeResult.rows.map(edgeRow);const nodeIds=[...new Set([nodeId,...storedEdges.flatMap((edge)=>[edge.source,edge.target])])];
  const storedNodesResult=nodeIds.length?await catalog.pool.query(`SELECT node_key AS id,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1 AND node_key=ANY($2::text[])`,[ownerKey,nodeIds]):{rows:[]};
  const nodes=storedNodesResult.rows.map(nodeRow),edges=[...storedEdges],sources=new Set<string>();if(storedEdges.length)sources.add('catalog');
  const addNode=(node:any)=>{const index=nodes.findIndex((current)=>current.id===node.id);if(index<0)nodes.push(node);else nodes[index]={...nodes[index],...node,properties:{...(nodes[index].properties||{}),...(node.properties||{})}};};
  const addEdge=(edge:any)=>{if(!edges.some((current)=>current.id===edge.id))edges.push(edge);};
  let total=Number(storedCountResult.rows[0]?.total||0),warning:string|undefined;
  const requestedReferenceId=String(url.searchParams.get('referenceId')||storedNode?.properties?.referenceId||'').trim();
  const paper=requestedReferenceId?await catalog.getPaper(ownerKey,requestedReferenceId):null;
  if(mode==='references'&&paper){
    const bibliography=buildBibliographyConnections(paper,await catalog.listPapers(ownerKey));
    const rootId=paper.openAlexId?`paper:${paper.openAlexId}`:`paper:local:${paper.referenceId}`;
    bibliography.nodes.forEach((node)=>addNode({id:node.id,kind:node.kind,label:node.label,properties:node.properties||{}}));
    bibliography.edges.forEach((edge)=>addEdge({id:edge.id,source:edge.source===rootId?nodeId:edge.source,target:edge.target===rootId?nodeId:edge.target,relation:edge.kind,weight:edge.weight,properties:{directed:edge.directed,evidence:edge.evidence,provenance:edge.provenance}}));
    total=Math.max(total,paper.extractedReferences.length,bibliography.edges.length);if(bibliography.edges.length)sources.add('bibliography');
  }
  if(mode!=='concept'){
    const explicitOpenAlexId=String(url.searchParams.get('openAlexId')||'');
    const openAlexId=normalizeOpenAlexId(explicitOpenAlexId||paper?.openAlexId||storedNode?.properties?.openAlexId||nodeId.replace(/^paper:/,''),'W');const client=getOpenAlexClient();
    if(openAlexId&&client.configured){try{const work=await client.workById(openAlexId);if(work){
      const live=mode==='references'
        ? openAlexReferenceNeighborhood(work,await client.worksByIds(work.referencedWorkIds,maximum))
        : mode==='citations'
          ? openAlexCitationNeighborhood(work,await client.citingWorks(work.id,maximum))
          : openAlexSimilarNeighborhood(work,await client.worksByIds(work.relatedWorkIds,maximum));
      total=Math.max(total,live.total);sources.add('openalex');
      live.nodes.filter((node)=>node.id!==live.rootId||live.rootId===nodeId).forEach(addNode);
      live.edges.forEach((edge)=>addEdge({...edge,source:edge.source===live.rootId?nodeId:edge.source,target:edge.target===live.rootId?nodeId:edge.target}));
    }}catch(error){warning='openalex_unavailable';console.warn(`[knowledge-graph] OpenAlex ${mode} expansion unavailable`,error);}}
  }
  if(storedNode&&!nodes.some((node)=>node.id===nodeId))nodes.unshift(nodeRow(storedNode));
  const neighborIds=new Set(edges.map((edge)=>edge.source===nodeId?edge.target:edge.target===nodeId?edge.source:'').filter(Boolean));
  return Response.json({nodes,edges,total,shown:neighborIds.size,truncated:total>neighborIds.size,source:[...sources].join('+')||'none',mode,warning},{headers:{'Cache-Control':'private, no-store'}});
};
