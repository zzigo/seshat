import type { APIRoute } from 'astro';
import { normalizeOpenAlexId } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { openAlexReferenceNeighborhood } from '../../../lib/graph-discovery';
import { getOpenAlexClient } from '../../../lib/openalex';

const nodeRow=(row:any)=>({id:String(row.id),kind:String(row.kind),label:String(row.label),properties:row.properties||{}});
const edgeRow=(row:any)=>({id:String(row.id),source:String(row.source),target:String(row.target),relation:String(row.relation),weight:Number(row.weight||0),properties:row.properties||{}});

export const GET:APIRoute=async({locals,url})=>{
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();
  if(!email)return Response.json({error:'authentication_required'},{status:401});
  const nodeId=String(url.searchParams.get('nodeId')||'').trim();
  if(!nodeId)return Response.json({error:'node_id_required'},{status:400});
  const mode=url.searchParams.get('mode')==='concept'?'concept':'references';
  const maximum=Math.max(1,Math.min(100,Math.trunc(Number(url.searchParams.get('maximum')||100))));
  const ownerKey=ownerKeyFor(email),catalog=getCatalog();await catalog.ensureSchema();
  const storedNodeResult=await catalog.pool.query(`SELECT node_key AS id,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1 AND node_key=$2 LIMIT 1`,[ownerKey,nodeId]);
  const storedNode=storedNodeResult.rows[0];
  const relation=mode==='concept'?'has-topic':'cites';
  const edgeWhere=`owner_key=$1 AND lower(relation)=lower($3)
    AND ($3='has-topic' AND (from_key=$2 OR to_key=$2) OR $3='cites' AND from_key=$2)`;
  const [storedEdgeResult,storedCountResult]=await Promise.all([
    catalog.pool.query(
      `SELECT edge_key AS id,from_key AS source,to_key AS target,relation,weight,properties
       FROM catalog_graph_edges WHERE ${edgeWhere}
       ORDER BY weight DESC,updated_at DESC LIMIT $4`,[ownerKey,nodeId,relation,maximum],
    ),
    catalog.pool.query(`SELECT count(*)::int AS total FROM catalog_graph_edges WHERE ${edgeWhere}`,[ownerKey,nodeId,relation]),
  ]);
  const storedEdges=storedEdgeResult.rows.map(edgeRow);const nodeIds=[...new Set([nodeId,...storedEdges.flatMap((edge)=>[edge.source,edge.target])])];
  const storedNodesResult=nodeIds.length?await catalog.pool.query(`SELECT node_key AS id,kind,label,properties FROM catalog_graph_nodes WHERE owner_key=$1 AND node_key=ANY($2::text[])`,[ownerKey,nodeIds]):{rows:[]};
  const nodes=storedNodesResult.rows.map(nodeRow),edges=[...storedEdges];let total=Number(storedCountResult.rows[0]?.total||0),source=storedEdges.length?'catalog':'none',warning:string|undefined;
  if(mode==='references'){
    const openAlexId=normalizeOpenAlexId(storedNode?.properties?.openAlexId||nodeId.replace(/^paper:/,''),'W');const client=getOpenAlexClient();
    if(openAlexId&&client.configured){try{const work=await client.workById(openAlexId);if(work){const referenceWorks=await client.worksByIds(work.referencedWorkIds,maximum);const live=openAlexReferenceNeighborhood(work,referenceWorks);total=Math.max(total,live.total);source=storedEdges.length?'catalog+openalex':'openalex';live.nodes.filter((node)=>node.id!==live.rootId||live.rootId===nodeId).forEach((node)=>{if(!nodes.some((current)=>current.id===node.id))nodes.push(node);});live.edges.map((edge)=>live.rootId===nodeId?edge:{...edge,source:nodeId}).forEach((edge)=>{if(!edges.some((current)=>current.id===edge.id))edges.push(edge);});}}catch(error){warning='openalex_unavailable';console.warn('[knowledge-graph] OpenAlex reference expansion unavailable',error);}}
  }
  if(storedNode&&!nodes.some((node)=>node.id===nodeId))nodes.unshift(nodeRow(storedNode));
  return Response.json({nodes,edges,total,shown:edges.length,truncated:total>edges.length,source,mode,warning},{headers:{'Cache-Control':'private, no-store'}});
};
