import assert from 'node:assert/strict';
import test from 'node:test';
import { belongsToLibraryBranch, collectLibraryBranchIds } from '../src/lib/library-scope';

const libraries = [
  { id: 'root' },
  { id: 'chapter', parentId: 'root' },
  { id: 'section', parentId: 'chapter' },
  { id: 'other' },
];

test('collects every nested level below the selected library', () => {
  assert.deepEqual([...collectLibraryBranchIds(libraries, 'root')], ['root', 'chapter', 'section']);
});

test('includes references filed only in deep descendants', () => {
  const branch = collectLibraryBranchIds(libraries, 'root');
  assert.equal(belongsToLibraryBranch(['section'], branch), true);
  assert.equal(belongsToLibraryBranch(['other'], branch), false);
});
