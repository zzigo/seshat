import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace=readFileSync(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');

test('highlights the hovered branch without reheating the graph',()=>{
  assert.match(workspace,/\.onNodeHover\(hoverGraphNode\)/);
  assert.match(workspace,/hoveredBranchIds=new Set\(\[hoveredNodeId,/);
  const selection=workspace.match(/const selectGraphNode=([\s\S]*?)\n\s*const nodeColor/)?.[1]||'';
  assert.match(selection,/if\(structureChanged\)update\(\);else graph\?\.refresh/);
});

test('expands paper neighborhoods from the selected node into a hierarchy',()=>{
  assert.match(workspace,/seedExpansion\(nodeId,responseNodes,mode\)/);
  assert.match(workspace,/citationHierarchyDepths\(hierarchyRootId,allLinks\)/);
  assert.match(workspace,/section\('Refs',true\)/);
  assert.match(workspace,/section\('Cited by',false\)/);
});

test('uses stability damping and exposes paper abstracts separately',()=>{
  assert.match(workspace,/slider\('Stability',\.35,\.9,stability,\.05/);
  assert.doesNotMatch(workspace,/slider\('Inertia'/);
  assert.match(workspace,/section\('Abstract',false\)/);
  assert.match(workspace,/showAbstract\(work\.abstract/);
});

test('draws concept topographies and strips emphasis markup from canvas labels',()=>{
  assert.match(workspace,/\.onRenderFramePre\(drawConceptClouds\)/);
  assert.match(workspace,/toggle\('Concept clouds',true/);
  assert.match(workspace,/conceptKikiBoubaIndex\(concept\.label/);
  assert.match(workspace,/const label=plainInlineTitle\(node\.label/);
  assert.match(workspace,/setInlineTitle\(title,paper\.label/);
});

test('uses a concept-first corpus projection while preserving the individual graph controls',()=>{
  assert.match(workspace,/api\/knowledge-graph\/corpus/);
  assert.match(workspace,/paper:!globalGraph,author:!globalGraph,topic:true,emergence:false/);
  assert.match(workspace,/toggle\('Emerging language'/);
  assert.match(workspace,/renderCorpusGroupNode\(node,'Author'\)/);
  assert.match(workspace,/open\.textContent='Open document'/);
});
