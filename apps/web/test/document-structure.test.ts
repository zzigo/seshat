import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentStructure } from '../src/lib/document-structure';

test('builds a page-addressable semantic outline from Docling JSON', () => {
  const result = buildDocumentStructure({
    body:{children:[{$ref:'#/texts/0'},{$ref:'#/texts/1'},{$ref:'#/pictures/0'},{$ref:'#/texts/2'}]},
    texts:[
      {label:'section_header',level:1,text:'Introduction',prov:[{page_no:2}]},
      {label:'formula',text:'x = y',prov:[{page_no:3}]},
      {label:'section_header',level:1,text:'1.2 Bibliografía',prov:[{page_no:8}]},
    ],
    pictures:[{label:'picture',prov:[{page_no:4}]}],
  });
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.sections.map((item: any) => [item.kind,item.page,item.parentId]), [
    ['introduction',2,null], ['references',8,'section-1'],
  ]);
  assert.deepEqual(result.blocks.map((item: any) => [item.kind,item.page,item.sectionId]), [
    ['formula',3,'section-1'], ['picture',4,'section-1'],
  ]);
});
