import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateStoredGraphPaperMetadata, openAlexCitationNeighborhood, openAlexReferenceNeighborhood, openAlexSimilarNeighborhood, referencesSharingKeyword } from '../src/lib/graph-discovery';
import type { OpenAlexWork } from '@seshat/core';

const work=(id:string,title:string,references:string[]=[]):OpenAlexWork=>({id,title,abstract:`Abstract for ${title}`,citedByCount:4,authors:[{id:`A-${id}`,name:`Author ${id}`,institutionIds:[]}],topics:[],institutions:[],referencedWorkIds:references,relatedWorkIds:[]});

test('matches vault keywords exactly across case and accents',()=>{
  const rows=[{id:'1',keywords:['Música electroacústica']},{id:'2',keywords:['music']},{id:'3',keywords:['MUSICA ELECTROACUSTICA']}];
  assert.deepEqual(referencesSharingKeyword(rows,'musica electroacústica').map((row)=>row.id),['1','3']);
});

test('builds a bounded OpenAlex reference neighborhood with recursive counts',()=>{
  const root=work('W1','Root',['W2','W3']);const reference=work('W2','Reference',['W4']);
  const graph=openAlexReferenceNeighborhood(root,[reference]);
  assert.equal(graph.total,2);
  assert.equal(graph.edges.length,1);
  assert.equal(graph.nodes.find((node)=>node.id==='paper:W2')?.properties.referenceCount,1);
  assert.deepEqual(graph.nodes.find((node)=>node.id==='paper:W2')?.properties.authors,['Author W2']);
  assert.equal(graph.nodes.find((node)=>node.id==='paper:W2')?.properties.abstract,'Abstract for Reference');
});

test('points citing works toward the selected paper and preserves the full count',()=>{
  const root={...work('W1','Root'),citedByCount:27};const graph=openAlexCitationNeighborhood(root,[work('W9','Citing paper',['W1'])]);
  assert.equal(graph.total,27);
  assert.equal(graph.edges[0]?.source,'paper:W9');
  assert.equal(graph.edges[0]?.target,'paper:W1');
});

test('builds related-work links for similar-paper discovery',()=>{
  const root={...work('W1','Root'),relatedWorkIds:['W8']};const graph=openAlexSimilarNeighborhood(root,[work('W8','Related')]);
  assert.equal(graph.total,1);
  assert.equal(graph.edges[0]?.relation,'related-to');
});

test('hydrates legacy stored graph nodes with OpenAlex author and year metadata',()=>{
  type StoredNode={kind:string;properties:Record<string,unknown>};
  const nodes=hydrateStoredGraphPaperMetadata<StoredNode>([{kind:'paper',properties:{referenceId:'local-1'}}],[{reference_id:'local-1',openalex_work:work('W1','Root')}]);
  assert.deepEqual(nodes[0]?.properties?.authors,['Author W1']);
  assert.equal(nodes[0]?.properties?.year,undefined);
  const dated={...work('W2','Dated'),publicationYear:1998};
  const datedNodes=hydrateStoredGraphPaperMetadata<StoredNode>([{kind:'paper',properties:{openAlexId:'W2'}}],[{openalex_id:'W2',openalex_work:dated}]);
  assert.equal(datedNodes[0]?.properties?.year,1998);
});
