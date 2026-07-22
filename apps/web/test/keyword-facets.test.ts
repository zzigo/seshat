import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogKeywordFacets, referenceMatchesCatalogFacet } from '../src/lib/keyword-facets';

test('combines bibliographic keywords and Zotero tags without double-counting an item', () => {
  const references = [
    { keywords:['acoustics','shared'], tagList:['fieldwork','shared'] },
    { keywords:[], tagList:['fieldwork'] },
  ];
  assert.deepEqual(catalogKeywordFacets(references),[
    { label:'fieldwork',count:2,fromKeyword:false,fromTag:true },
    { label:'acoustics',count:1,fromKeyword:true,fromTag:false },
    { label:'shared',count:1,fromKeyword:true,fromTag:true },
  ]);
  assert.equal(referenceMatchesCatalogFacet(references[1],'fieldwork'),true);
  assert.equal(referenceMatchesCatalogFacet(references[1],'acoustics'),false);
});
