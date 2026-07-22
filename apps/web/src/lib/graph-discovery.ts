import { stableKnowledgeEdgeId, stableKnowledgeNodeId, type OpenAlexWork } from '@seshat/core';

export type DiscoveryGraphNode = { id:string; kind:string; label:string; properties:Record<string,unknown> };
export type DiscoveryGraphEdge = { id:string; source:string; target:string; relation:string; weight:number; properties:Record<string,unknown> };

export const normalizeGraphKeyword = (value:unknown):string => String(value || '').normalize('NFKD')
  .replace(/\p{M}/gu,'').trim().toLocaleLowerCase().replace(/\s+/g,' ');

export const referencesSharingKeyword = <T extends {keywords:string[]}>(references:T[],keyword:unknown):T[] => {
  const normalized=normalizeGraphKeyword(keyword);
  if(!normalized)return[];
  return references.filter((reference)=>reference.keywords.some((value)=>normalizeGraphKeyword(value)===normalized));
};

const paperProperties=(work:OpenAlexWork)=>({openAlexId:work.id,doi:work.doi,year:work.publicationYear,authors:work.authors.map((author)=>author.name),abstract:work.abstract,citedByCount:work.citedByCount,referenceCount:work.referencedWorkIds.length,external:true});

export const openAlexReferenceNeighborhood = (work:OpenAlexWork,referenceWorks:OpenAlexWork[]) => {
  const rootId=stableKnowledgeNodeId('paper',work.id);
  const byId=new Map(referenceWorks.map((reference)=>[reference.id,reference]));
  const nodes:DiscoveryGraphNode[]=[{
    id:rootId,kind:'paper',label:work.title,
    properties:paperProperties(work),
  }];
  const edges:DiscoveryGraphEdge[]=[];
  for(const referenceId of work.referencedWorkIds){const reference=byId.get(referenceId);if(!reference)continue;const target=stableKnowledgeNodeId('paper',reference.id);nodes.push({id:target,kind:'paper',label:reference.title,properties:paperProperties(reference)});edges.push({id:stableKnowledgeEdgeId('cites',rootId,target,true),source:rootId,target,relation:'cites',weight:1,properties:{directed:true,evidence:{method:'openalex-referenced-works',count:1},provenance:{source:'openalex-live'}}});}
  return {rootId,total:work.referencedWorkIds.length,nodes,edges};
};

export const openAlexCitationNeighborhood = (work:OpenAlexWork,citingWorks:OpenAlexWork[]) => {
  const rootId=stableKnowledgeNodeId('paper',work.id);
  const nodes:DiscoveryGraphNode[]=[{
    id:rootId,kind:'paper',label:work.title,
    properties:paperProperties(work),
  }];
  const edges:DiscoveryGraphEdge[]=[];
  for(const citing of citingWorks){const source=stableKnowledgeNodeId('paper',citing.id);nodes.push({id:source,kind:'paper',label:citing.title,properties:paperProperties(citing)});edges.push({id:stableKnowledgeEdgeId('cites',source,rootId,true),source,target:rootId,relation:'cites',weight:1,properties:{directed:true,evidence:{method:'openalex-citing-works',count:1},provenance:{source:'openalex-live'}}});}
  return {rootId,total:work.citedByCount,nodes,edges};
};

export const openAlexSimilarNeighborhood = (work:OpenAlexWork,relatedWorks:OpenAlexWork[]) => {
  const rootId=stableKnowledgeNodeId('paper',work.id);
  const nodes:DiscoveryGraphNode[]=[{
    id:rootId,kind:'paper',label:work.title,
    properties:paperProperties(work),
  }];
  const edges:DiscoveryGraphEdge[]=[];
  for(const related of relatedWorks){const target=stableKnowledgeNodeId('paper',related.id);nodes.push({id:target,kind:'paper',label:related.title,properties:paperProperties(related)});edges.push({id:stableKnowledgeEdgeId('related-to',rootId,target),source:rootId,target,relation:'related-to',weight:1,properties:{directed:false,evidence:{method:'openalex-related-works',count:1},provenance:{source:'openalex-live'}}});}
  return {rootId,total:work.relatedWorkIds.length,nodes,edges};
};
