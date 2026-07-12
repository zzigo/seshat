import { isValidDoi, normalizeDoi } from './identifiers.js';

const stableDigest=(value:string|Uint8Array):string=>{
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  const mask=(1n<<64n)-1n,prime=0x100000001b3n;
  return [0xcbf29ce484222325n,0x84222325cbf29ce4n,0x9e3779b185ebca87n,0x517cc1b727220a95n].map((seed,index)=>{
    let hash=seed;
    for(const byte of bytes){hash^=BigInt((byte+index*67)&255);hash=(hash*prime)&mask;hash^=hash>>32n;}
    return hash.toString(16).padStart(16,'0');
  }).join('');
};

export type PaperResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';
export type KnowledgeNodeKind = 'paper' | 'author' | 'topic' | 'venue' | 'institution' | 'collection';
export type KnowledgeEdgeKind = 'cites' | 'authored-by' | 'has-topic' | 'published-in' | 'affiliated-with'
  | 'belongs-to-collection' | 'bibliographic-coupling' | 'co-citation' | 'shared-author' | 'shared-topic';

export interface ExtractedReference { raw:string; title?:string; authors?:string[]; year?:number; doi?:string; confidence:number }
export interface FieldProvenance { source:'pdf-metadata'|'heuristic'|'openalex'|'user'; method:string; confidence:number; raw?:string; retrievedAt:string }
export interface ExtractedPaperMetadata {
  title?:string; authors?:string[]; abstract?:string; doi?:string; publicationYear?:number; journal?:string;
  rawText?:string; references:ExtractedReference[]; provenance:Record<string,FieldProvenance>;
}
export interface ScholarlyPdfExtractor { extract(file:ArrayBuffer):Promise<ExtractedPaperMetadata> }

export interface OpenAlexTopicRef { id:string; name:string; score:number; field?:string }
export interface OpenAlexAuthorRef { id:string; name:string; institutionIds:string[] }
export interface OpenAlexWork {
  id:string; doi?:string; title:string; type?:string; publicationYear?:number; abstract?:string; citedByCount:number;
  authors:OpenAlexAuthorRef[]; topics:OpenAlexTopicRef[]; venue?:{id:string;name:string};
  institutions:Array<{id:string;name:string}>; referencedWorkIds:string[]; relatedWorkIds:string[];
}
export interface OpenAlexCandidate { id:string; title:string; publicationYear?:number; firstAuthor?:string; doi?:string; score:number }
export interface OpenAlexResolution {
  status:PaperResolutionStatus; work?:OpenAlexWork; candidates?:OpenAlexCandidate[]; confidence:number;
  method:'doi'|'openalex-id'|'title-year'|'title-author'|'none';
}
export interface GraphExpansionOptions {
  citationDepth:0|1; includeReferences:boolean; includeCitingWorks:boolean; includeAuthors:boolean; includeTopics:boolean;
  includeVenues:boolean; includeInstitutions:boolean; maxReferencesPerPaper:number; maxCitingWorksPerPaper:number; maxRelatedPapers:number;
}
export const DEFAULT_GRAPH_EXPANSION:GraphExpansionOptions={citationDepth:1,includeReferences:true,includeCitingWorks:false,includeAuthors:true,
  includeTopics:true,includeVenues:true,includeInstitutions:false,maxReferencesPerPaper:100,maxCitingWorksPerPaper:50,maxRelatedPapers:100 };

export interface KnowledgeNode { id:string; kind:KnowledgeNodeKind; label:string; properties:Record<string,unknown> }
export interface KnowledgeEdge {
  id:string; source:string; target:string; kind:KnowledgeEdgeKind; directed:boolean; weight:number;
  evidence?:{method:string;count?:number;sharedIds?:string[];description?:string};
  provenance:{source:'local-extraction'|'openalex'|'derived';generatedAt:string;algorithmVersion?:string};
}
export interface ForceGraphData { nodes:Array<{id:string;kind:KnowledgeNodeKind;label:string;classification:KnowledgeNodeKind;properties:Record<string,unknown>}>; edges:Array<{id:string;source:string;target:string;relation:KnowledgeEdgeKind;weight:number;directed:boolean;properties:Record<string,unknown>}> }

export const scholarlyFileHash=(bytes:ArrayBuffer|Uint8Array):string => stableDigest(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));
export const preserveManuallyCuratedFields=<T extends Record<string,unknown>>(current:T,enrichment:Partial<T>,manualFields:Iterable<string>):T => {
  const manual=new Set(manualFields); const result={...current};
  for(const [field,value] of Object.entries(enrichment)) if(!manual.has(field)&&value!==undefined&&value!==null&&value!=='') (result as Record<string,unknown>)[field]=value;
  return result;
};

export const normalizeOpenAlexId=(value:unknown,kind='W'):string|undefined => {
  const match=String(value || '').trim().match(new RegExp(`(?:https?://(?:api\\.)?openalex\\.org/)?(${kind}\\d+)$`,'i'));
  return match ? match[1].toUpperCase() : undefined;
};
export const normalizeScholarlyTitle=(value:unknown):string => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/<[^>]+>/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
export const normalizeAuthorName=(value:unknown):string => normalizeScholarlyTitle(String(value || '').replace(/^([^,]+),\s*(.+)$/,'$2 $1'));

const now=()=>new Date().toISOString();
const plausibleYear=(value:unknown):number|undefined => { const year=Number(value); return Number.isInteger(year)&&year>=1500&&year<=new Date().getFullYear()+1?year:undefined; };
const cleanLine=(value:string)=>value.replace(/^\s*(?:\[?\d{1,4}\]?\s*[.)]?|[-•])\s*/,'').replace(/\s+/g,' ').trim();
const referenceRows=(text:string):string[] => {
  const marker=/\n\s*(?:#{1,6}\s*)?(references|bibliography|works cited|referencias|bibliograf[ií]a)\s*\n/i.exec(text);
  if (!marker) return [];
  const tail=text.slice((marker.index || 0)+marker[0].length).slice(0,120_000); const lines=tail.split(/\r?\n/).map((line)=>line.trim()).filter(Boolean); const rows:string[]=[];
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line) && rows.length) break;
    const starts=/^(?:\[?\d{1,4}\]?\s*[.)]|[-•])\s+/.test(line);
    if (starts || !rows.length) rows.push(cleanLine(line)); else if (rows.at(-1)!.length < 700) rows[rows.length-1]+=` ${cleanLine(line)}`;
    if (rows.length>=500) break;
  }
  return rows.filter((row)=>row.length>=12);
};
export const parseExtractedReference=(raw:string):ExtractedReference => {
  const normalizedDoi=normalizeDoi(raw.match(/10\.\d{4,9}\/[\w.()/:+-]+/i)?.[0]); const doi=normalizedDoi&&isValidDoi(normalizedDoi)?normalizedDoi:undefined; const year=plausibleYear(raw.match(/(?:19|20)\d{2}/)?.[0]);
  const quoted=raw.match(/[“"]([^”"]{8,240})[”"]/i)?.[1]; const afterYear=raw.match(/(?:19|20)\d{2}[a-z]?[).,;:]?\s+(.{8,240}?)(?:\.|\.\s+(?:In|Vol|Journal)|$)/i)?.[1];
  const title=cleanLine(quoted || afterYear || '').replace(/[.,;]+$/,'') || undefined; const authorPart=raw.split(/(?:19|20)\d{2}/)[0];
  const authors=authorPart ? authorPart.split(/;|\s+&\s+|\s+and\s+/i).map(cleanLine).filter((value)=>value.length>=2&&value.length<100).slice(0,20) : [];
  return {raw:raw.slice(0,2000),title,authors:authors.length?authors:undefined,year,doi,confidence:doi?0.95:title&&year?0.65:0.35};
};
export const extractScholarlyMetadataFromText=(rawText:string,embedded:Record<string,unknown>={}):ExtractedPaperMetadata => {
  const text=String(rawText || '').replace(/\u0000/g,''); const head=text.slice(0,16_000); const lines=head.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const embeddedTitle=String(embedded.title || '').trim(); const title=embeddedTitle || lines.find((line)=>line.length>=12&&line.length<=280&&!/^(abstract|doi|https?:|www\.|journal|volume|issue)\b/i.test(line));
  const normalizedDoi=normalizeDoi(String(embedded.doi || head.match(/10\.\d{4,9}\/[\w.()/:+-]+/i)?.[0] || '')); const doi=normalizedDoi&&isValidDoi(normalizedDoi)?normalizedDoi:undefined; const year=plausibleYear(embedded.publicationYear || head.match(/(?:19|20)\d{2}/)?.[0]);
  const titleIndex=title ? lines.indexOf(title) : -1; const authorLine=titleIndex>=0 ? lines.slice(titleIndex+1,titleIndex+4).find((line)=>line.length<500&&!/^(abstract|doi|received|accepted|published)\b/i.test(line)) : undefined;
  const authors=Array.isArray(embedded.authors) ? embedded.authors.map(String).filter(Boolean) : authorLine?.split(/;|,\s+(?=[A-Z][a-z]+\s+[A-Z])|\s+and\s+|\s+&\s+/).map(cleanLine).filter(Boolean).slice(0,30);
  const abstract=head.match(/(?:^|\n)\s*(?:#{1,6}\s*)?abstract\s*[:\n]\s*([\s\S]{40,4000}?)(?=\n\s*(?:#{1,6}\s*)?(?:keywords?|introduction|1[.)]\s)|$)/i)?.[1]?.replace(/\s+/g,' ').trim();
  const timestamp=now(); const provenance:Record<string,FieldProvenance>={};
  if (title) provenance.title={source:embeddedTitle?'pdf-metadata':'heuristic',method:embeddedTitle?'embedded-title':'first-plausible-line',confidence:embeddedTitle?.length?0.9:0.55,raw:title,retrievedAt:timestamp};
  if (doi) provenance.doi={source:'heuristic',method:'doi-pattern',confidence:0.98,raw:doi,retrievedAt:timestamp};
  if (year) provenance.publicationYear={source:'heuristic',method:'first-plausible-year',confidence:0.55,raw:String(year),retrievedAt:timestamp};
  if (authors?.length) provenance.authors={source:Array.isArray(embedded.authors)?'pdf-metadata':'heuristic',method:Array.isArray(embedded.authors)?'embedded-authors':'post-title-line',confidence:Array.isArray(embedded.authors)?0.85:0.4,raw:authors.join('; '),retrievedAt:timestamp};
  if (abstract) provenance.abstract={source:'heuristic',method:'labelled-section',confidence:0.8,retrievedAt:timestamp};
  return {title,authors:authors?.length?authors:undefined,abstract,doi,publicationYear:year,rawText:text,references:referenceRows(text).map(parseExtractedReference),provenance};
};

export const stableKnowledgeNodeId=(kind:KnowledgeNodeKind,externalOrLocalId:string):string => `${kind}:${normalizeOpenAlexId(externalOrLocalId,kind==='author'?'A':kind==='topic'?'T':kind==='institution'?'I':kind==='venue'?'S':'W') || stableDigest(normalizeScholarlyTitle(externalOrLocalId)).slice(0,24)}`;
export const stableKnowledgeEdgeId=(kind:KnowledgeEdgeKind,source:string,target:string,directed=false):string => {
  const pair=directed||source<target?[source,target]:[target,source]; return stableDigest([kind,...pair].join('\0'));
};
export const bibliographicCoupling=(left:string[],right:string[]) => { const a=new Set(left),b=new Set(right),shared=[...a].filter((id)=>b.has(id)).sort(); return {sharedIds:shared,sharedCount:shared.length,score:a.size&&b.size?shared.length/Math.sqrt(a.size*b.size):0}; };
export const weightedTopicOverlap=(left:Array<{id:string;score:number}>,right:Array<{id:string;score:number}>) => { const a=new Map(left.map((item)=>[item.id,Math.max(0,item.score)])),b=new Map(right.map((item)=>[item.id,Math.max(0,item.score)])); const ids=new Set([...a.keys(),...b.keys()]); let numerator=0,denominator=0; const sharedIds:string[]=[]; ids.forEach((id)=>{const av=a.get(id)||0,bv=b.get(id)||0;numerator+=Math.min(av,bv);denominator+=Math.max(av,bv);if(av&&bv)sharedIds.push(id);});return {sharedIds:sharedIds.sort(),score:denominator?numerator/denominator:0}; };
export const deduplicateKnowledgeGraph=(nodes:KnowledgeNode[],edges:KnowledgeEdge[]) => ({nodes:[...new Map(nodes.map((node)=>[node.id,node])).values()],edges:[...new Map(edges.map((edge)=>[edge.id,edge])).values()]});
export const toForceGraphData=(nodes:KnowledgeNode[],edges:KnowledgeEdge[]):ForceGraphData => { const graph=deduplicateKnowledgeGraph(nodes,edges); return {nodes:graph.nodes.map((node)=>({...node,classification:node.kind})),edges:graph.edges.map((edge)=>({id:edge.id,source:edge.source,target:edge.target,relation:edge.kind,weight:edge.weight,directed:edge.directed,properties:{evidence:edge.evidence,provenance:edge.provenance}}))}; };
export const clampGraphExpansion=(input:Partial<GraphExpansionOptions>={}):GraphExpansionOptions => ({citationDepth:input.citationDepth===0?0:1,includeReferences:input.includeReferences??true,includeCitingWorks:input.includeCitingWorks??false,includeAuthors:input.includeAuthors??true,includeTopics:input.includeTopics??true,includeVenues:input.includeVenues??true,includeInstitutions:input.includeInstitutions??false,maxReferencesPerPaper:Math.max(0,Math.min(100,Math.floor(input.maxReferencesPerPaper??100))),maxCitingWorksPerPaper:Math.max(0,Math.min(50,Math.floor(input.maxCitingWorksPerPaper??50))),maxRelatedPapers:Math.max(0,Math.min(100,Math.floor(input.maxRelatedPapers??100)))});
