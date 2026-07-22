import assert from 'node:assert/strict';
import test from 'node:test';
import { openAlexReferenceNeighborhood, referencesSharingKeyword } from '../src/lib/graph-discovery';
import type { OpenAlexWork } from '@seshat/core';

const work=(id:string,title:string,references:string[]=[]):OpenAlexWork=>({id,title,citedByCount:4,authors:[],topics:[],institutions:[],referencedWorkIds:references,relatedWorkIds:[]});

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
});

