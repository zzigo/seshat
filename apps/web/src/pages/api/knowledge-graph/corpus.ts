import type { APIRoute } from 'astro';
import { buildCorpusKnowledgeGraph, corpusAuthorNames, corpusKeywordLabels, type CorpusGraphSourceItem } from '../../../lib/corpus-graph';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

export const GET:APIRoute=async({locals,url})=>{
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();
  if(!email)return Response.json({error:'authentication_required'},{status:401});
  const ownerKey=ownerKeyFor(email),collectionId=String(url.searchParams.get('collectionId')||'').trim();
  const catalog=getCatalog();await catalog.ensureSchema();
  const references=await catalog.pool.query(
    `WITH RECURSIVE branch(id) AS (
       SELECT id FROM catalog_libraries WHERE owner_key=$1 AND id=$2
       UNION ALL
       SELECT child.id FROM catalog_libraries child JOIN branch parent ON child.parent_id=parent.id
       WHERE child.owner_key=$1
     )
     SELECT reference.id,reference.title,reference.type,reference.contributors,reference.issued,reference.tags,reference.source
     FROM catalog_references reference
     WHERE reference.owner_key=$1 AND ($2='' OR EXISTS (
       SELECT 1 FROM catalog_library_items membership
       WHERE membership.reference_id=reference.id AND membership.library_id IN (SELECT id FROM branch)
     ))
     ORDER BY reference.updated_at DESC LIMIT 10000`,[ownerKey,collectionId],
  );
  const referenceIds=references.rows.map((row:any)=>String(row.id));
  const openAlexConceptRows=referenceIds.length?await catalog.pool.query(
    `SELECT concept.label,paper.properties->>'referenceId' AS reference_id
     FROM catalog_graph_nodes concept
     JOIN catalog_graph_edges edge ON edge.owner_key=concept.owner_key
       AND (edge.from_key=concept.node_key OR edge.to_key=concept.node_key)
     JOIN catalog_graph_nodes paper ON paper.owner_key=concept.owner_key
       AND paper.node_key=CASE WHEN edge.from_key=concept.node_key THEN edge.to_key ELSE edge.from_key END
     WHERE concept.owner_key=$1 AND lower(concept.kind) IN ('topic','concept')
       AND lower(paper.kind) IN ('paper','work','document','publication','article')
       AND paper.properties->>'referenceId'=ANY($2::text[])`,[ownerKey,referenceIds],
  ):{rows:[]};
  const openAlexConcepts=new Map<string,string[]>();
  for(const row of openAlexConceptRows.rows){
    const id=String(row.reference_id||''),label=String(row.label||'').trim();if(!id||!label)continue;
    openAlexConcepts.set(id,[...(openAlexConcepts.get(id)||[]),label]);
  }
  const sources:CorpusGraphSourceItem[]=references.rows.map((row:any)=>({
    id:String(row.id),title:String(row.title||'Untitled item'),type:String(row.type||'misc'),
    year:Number.isFinite(Number(row.issued?.year))?Number(row.issued.year):null,
    authors:corpusAuthorNames(row.contributors),
    concepts:[...new Set([...corpusKeywordLabels(row.source,row.tags),...(openAlexConcepts.get(String(row.id))||[])])],
  }));
  const graph=buildCorpusKnowledgeGraph(sources);
  const nodes=[
    ...graph.concepts.map((node)=>({...node,kind:'topic',properties:{...node.properties,itemIds:node.itemIds,count:node.count}})),
    ...graph.items.map((node)=>({...node,kind:'paper',properties:{...node.properties,itemIds:node.itemIds,count:node.count}})),
    ...graph.authors.map((node)=>({...node,kind:'author',properties:{...node.properties,itemIds:node.itemIds,count:node.count}})),
    ...graph.emergence.map((node)=>({...node,properties:{...node.properties,itemIds:node.itemIds,count:node.count}})),
  ];
  const edges=[
    ...graph.conceptEdges,...graph.itemEdges,...graph.authorEdges,...graph.emergenceEdges,
  ].map((item)=>({
    id:item.id,source:item.source,target:item.target,relation:item.kind,weight:item.weight,
    properties:{itemIds:item.itemIds,evidence:{method:'corpus-cooccurrence',count:item.weight},provenance:{source:'catalog'}},
  }));
  return Response.json({nodes,edges,totals:graph.totals,scope:collectionId||null,schemaVersion:1},{headers:{'Cache-Control':'private, no-store'}});
};
