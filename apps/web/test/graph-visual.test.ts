import assert from 'node:assert/strict';
import test from 'node:test';
import { GRAPH_LAYOUT_DEFAULTS, graphLabelCollisionRadius, graphLabelPlacement, shortGraphPaperTitle, wrapGraphLabel } from '../src/lib/graph-visual';

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
