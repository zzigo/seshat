import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAlexClient,
  bibliographicCoupling,
  clampGraphExpansion,
  deduplicateKnowledgeGraph,
  extractScholarlyMetadataFromText,
  normalizeAuthorName,
  normalizeOpenAlexId,
  normalizeScholarlyTitle,
  preserveManuallyCuratedFields,
  scholarlyFileHash,
  stableKnowledgeEdgeId,
  stableKnowledgeNodeId,
  toForceGraphData,
  weightedTopicOverlap,
  type KnowledgeEdge,
  type KnowledgeNode,
} from '../src/index.js';

const rawWork=(id:string,title:string,year=2024,author='Ada Lovelace')=>({
  id:`https://openalex.org/${id}`,display_name:title,publication_year:year,cited_by_count:12,
  authorships:[{author:{id:'https://openalex.org/A1',display_name:author},institutions:[]}],
  topics:[{id:'https://openalex.org/T1',display_name:'Digital humanities',score:.8}],
  referenced_works:['https://openalex.org/W90','https://openalex.org/W91'],related_works:[],
});
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

test('normalizes OpenAlex identifiers',()=>assert.equal(normalizeOpenAlexId('https://api.openalex.org/w123'),'W123'));
test('rejects a mismatched OpenAlex identifier kind',()=>assert.equal(normalizeOpenAlexId('A123','W'),undefined));
test('normalizes titles across accents and punctuation',()=>assert.equal(normalizeScholarlyTitle('Autonomía: “Minimal” Computing'),'autonomia minimal computing'));
test('normalizes inverted author names',()=>assert.equal(normalizeAuthorName('Lovelace, Ada'),'ada lovelace'));
test('extracts DOI, title and references from local text',()=>{const result=extractScholarlyMetadataFromText('A Deterministic Paper\nAda Lovelace\nDOI 10.1234/ABC.5\n\nReferences\n[1] Hopper, G. 1952. Compilers and practice.');assert.equal(result.doi,'10.1234/abc.5');assert.equal(result.references.length,1);});
test('resolves by DOI before title search',async()=>{let calls=0;const client=new OpenAlexClient({apiKey:'test',fetch:async()=>{calls+=1;return response({results:[rawWork('W1','Resolved paper')]});}});const result=await client.resolve({doi:'10.1234/test',title:'ignored'});assert.equal(result.status,'resolved');assert.equal(result.method,'doi');assert.equal(calls,1);});
test('keeps close title matches ambiguous',async()=>{const client=new OpenAlexClient({apiKey:'test',fetch:async()=>response({results:[rawWork('W1','Shared title'),rawWork('W2','Shared title')]})});const result=await client.resolve({title:'Shared title',publicationYear:2024,authors:['Ada Lovelace']});assert.equal(result.status,'ambiguous');assert.equal(result.candidates?.length,2);});
test('hashes identical PDF bytes identically for duplicate detection',()=>{const bytes=new TextEncoder().encode('%PDF fixture');assert.equal(scholarlyFileHash(bytes),scholarlyFileHash(bytes.slice()));});
test('computes bibliographic coupling with inspectable shared IDs',()=>assert.deepEqual(bibliographicCoupling(['W1','W2','W3'],['W2','W3','W4']),{sharedIds:['W2','W3'],sharedCount:2,score:2/3}));
test('computes weighted topic overlap',()=>assert.deepEqual(weightedTopicOverlap([{id:'T1',score:.8},{id:'T2',score:.2}],[{id:'T1',score:.4},{id:'T3',score:.6}]),{sharedIds:['T1'],score:.4/1.6}));
test('creates stable graph node IDs',()=>assert.equal(stableKnowledgeNodeId('paper','https://openalex.org/W42'),'paper:W42'));
test('creates order-independent undirected edge IDs',()=>assert.equal(stableKnowledgeEdgeId('shared-topic','paper:W1','paper:W2'),stableKnowledgeEdgeId('shared-topic','paper:W2','paper:W1')));
test('deduplicates graph rows by stable ID',()=>{const node:KnowledgeNode={id:'paper:W1',kind:'paper',label:'Paper',properties:{}};const edge:KnowledgeEdge={id:'e1',source:'paper:W1',target:'topic:T1',kind:'has-topic',directed:true,weight:1,provenance:{source:'openalex',generatedAt:'2026-01-01'}};const result=deduplicateKnowledgeGraph([node,node],[edge,edge]);assert.equal(result.nodes.length,1);assert.equal(result.edges.length,1);});
test('bounds citation expansion',()=>{const result=clampGraphExpansion({citationDepth:1,maxReferencesPerPaper:999,maxCitingWorksPerPaper:999});assert.equal(result.maxReferencesPerPaper,100);assert.equal(result.maxCitingWorksPerPaper,50);});
test('preserves manually curated metadata fields',()=>assert.deepEqual(preserveManuallyCuratedFields({title:'Curated',publisher:'Old'},{title:'OpenAlex',publisher:'New'},['title']),{title:'Curated',publisher:'New'}));
test('adapts the canonical graph to ForceGraph without losing evidence',()=>{const node:KnowledgeNode={id:'paper:W1',kind:'paper',label:'Paper',properties:{}};const edge:KnowledgeEdge={id:'e1',source:'paper:W1',target:'paper:W2',kind:'cites',directed:true,weight:1,evidence:{method:'fixture'},provenance:{source:'openalex',generatedAt:'2026-01-01'}};const graph=toForceGraphData([node],[edge]);assert.equal(graph.nodes[0]?.classification,'paper');assert.equal((graph.edges[0]?.properties.evidence as any).method,'fixture');});
