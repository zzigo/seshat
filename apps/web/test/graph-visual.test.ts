import assert from 'node:assert/strict';
import test from 'node:test';
import { GRAPH_LAYOUT_DEFAULTS, citationHierarchyDepths, compactGraphAuthor, conceptKikiBoubaIndex, graphLabelCollisionRadius, graphLabelPlacement, shortGraphPaperTitle, wrapGraphLabel } from '../src/lib/graph-visual';

test('uses the readable graph layout defaults', () => {
  assert.equal(GRAPH_LAYOUT_DEFAULTS.repulsion, 1000);
  assert.equal(GRAPH_LAYOUT_DEFAULTS.distance, 204);
  assert.ok(GRAPH_LAYOUT_DEFAULTS.maximumRepulsion > GRAPH_LAYOUT_DEFAULTS.repulsion);
});

test('keeps paper labels compact and moves them away from link traffic', () => {
  assert.equal(shortGraphPaperTitle('one two three four five six seven'), 'one two three four five…');
  assert.deepEqual(wrapGraphLabel('a concise graph label', 12), ['a concise', 'graph label']);
  assert.deepEqual(wrapGraphLabel('one two three four five six', 7, 2), ['one two', 'three…']);
  assert.equal(graphLabelPlacement(8, 1), 'left');
  assert.equal(graphLabelPlacement(0, 8), 'above');
  assert.equal(graphLabelPlacement(0, 0), 'below');
  assert.ok(graphLabelCollisionRadius(['long containment label'], 7) > 50);
});

test('uses compact author and year labels for papers', () => {
  assert.equal(compactGraphAuthor(['Hannah Arendt']), 'Arendt');
  assert.equal(compactGraphAuthor(['Luciano Azzigotti','Ada Lovelace']), 'Azzigotti et al.');
  assert.equal(compactGraphAuthor('De la Cruz, Juan'), 'De la Cruz');
  assert.equal(compactGraphAuthor([]), 'Unknown author');
});

test('places citing papers above and references below the active paper', () => {
  const depths=citationHierarchyDepths('paper:root',[
    {source:'paper:citing',target:'paper:root',relation:'cites'},
    {source:'paper:root',target:'paper:reference',relation:'cites'},
    {source:'paper:reference',target:'paper:older',relation:'cites'},
  ]);
  assert.equal(depths.get('paper:citing'),-1);
  assert.equal(depths.get('paper:reference'),1);
  assert.equal(depths.get('paper:older'),2);
});

test('maps concepts onto a bounded kiki-bouba visual index', () => {
  assert.ok(conceptKikiBoubaIndex('quantitative acoustic physics') > .5);
  assert.ok(conceptKikiBoubaIndex('cultural history and aesthetics') < .5);
  assert.equal(conceptKikiBoubaIndex('neutral concept'),.5);
  assert.equal(conceptKikiBoubaIndex('anything',{kikiBoubaIndex:2}),1);
});
