import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCollectionDestinationTree, referenceIdsFromDragData, REFERENCE_MOVE_DRAG_MIME, REFERENCE_OPEN_DRAG_MIME } from '../src/lib/workspace-move';

test('builds the complete collection hierarchy for the Move to submenu', () => {
  const tree=buildCollectionDestinationTree([
    {id:'scores',name:'Scores'},
    {id:'research',name:'Research'},
    {id:'phd',name:'PhD',parentId:'research'},
    {id:'chapter',name:'Chapter 1',parentId:'phd'},
  ]);
  assert.deepEqual(tree.map((item)=>item.name),['Research','Scores']);
  assert.equal(tree[0]?.children[0]?.name,'PhD');
  assert.equal(tree[0]?.children[0]?.children[0]?.name,'Chapter 1');
});

test('reads both Catalog and legacy sidebar reference drag payloads', () => {
  const catalog=new Map([[REFERENCE_MOVE_DRAG_MIME,JSON.stringify(['one','two','one'])]]);
  assert.deepEqual(referenceIdsFromDragData((mime)=>catalog.get(mime)||''),['one','two']);
  const legacy=new Map([[REFERENCE_OPEN_DRAG_MIME,JSON.stringify(['three'])]]);
  assert.deepEqual(referenceIdsFromDragData((mime)=>legacy.get(mime)||''),['three']);
});
