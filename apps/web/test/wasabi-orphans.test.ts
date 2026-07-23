import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const catalog=await readFile(new URL('../../../packages/catalog/src/index.ts',import.meta.url),'utf8');
const candidateRoute=await readFile(new URL('../src/pages/api/library/[id]/candidates.ts',import.meta.url),'utf8');
const uploadRoute=await readFile(new URL('../src/pages/api/library/[id]/file.ts',import.meta.url),'utf8');
const orphanRoute=await readFile(new URL('../src/pages/api/wasabi/orphans.ts',import.meta.url),'utf8');
const orphanUi=await readFile(new URL('../src/lib/wasabi-orphan-ui.ts',import.meta.url),'utf8');
const workspace=await readFile(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');

test('replacing an original reuses existing enrichment jobs',()=>{
  const replacement=catalog.slice(catalog.indexOf('async replaceOriginal'),catalog.indexOf('async catalogDocument'));
  assert.match(replacement,/ON CONFLICT \(reference_id,stage\) DO NOTHING/);
  assert.match(replacement,/status=CASE WHEN stage='extract' THEN 'queued' ELSE 'blocked' END/);
});

test('link and upload replacements preserve old objects for explicit review',()=>{
  assert.match(candidateRoute,/replaced=value\.reference\.artifacts/);
  assert.match(candidateRoute,/sanitizePaths/);
  assert.match(uploadRoute,/replaced=reference\.artifacts/);
  assert.match(uploadRoute,/sanitizePaths/);
  assert.doesNotMatch(uploadRoute,/oldObjects\.map/);
});

test('orphan cleanup protects active links and requires explicit selected keys',()=>{
  assert.match(orphanRoute,/SELECT object_key FROM catalog_artifacts WHERE object_key=ANY/);
  assert.match(orphanRoute,/select_orphan_files/);
  assert.match(orphanRoute,/DeleteObjectsCommand/);
  assert.match(orphanUi,/Search orphan filenames or paths/);
  assert.match(orphanUi,/Confirm delete/);
});

test('Orphans is the final virtual folder in the smart-folder section',()=>{
  const audit=workspace.indexOf("smartSection.appendChild(auditButton)");
  const orphans=workspace.indexOf("orphanLabel.textContent='Orphans'");
  const append=workspace.indexOf('tree.appendChild(smartSection)',orphans);
  assert.ok(audit>=0&&orphans>audit&&append>orphans);
  assert.match(workspace,/openWasabiOrphanDialog\(\{title:'Orphan files'/);
});
