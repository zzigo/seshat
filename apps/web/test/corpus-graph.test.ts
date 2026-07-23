import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorpusKnowledgeGraph, corpusAuthorNames, corpusKeywordLabels } from '../src/lib/corpus-graph';

test('builds a concept-first corpus projection with weighted co-occurrence',()=>{
  const graph=buildCorpusKnowledgeGraph([
    {id:'1',title:'Acoustic ecology and public space',type:'article',year:2000,authors:['Ada One'],concepts:['Acoustics','Ecology']},
    {id:'2',title:'Acoustic ecology in urban space',type:'book',year:2010,authors:['Ada One'],concepts:['Acoustics','Ecology']},
    {id:'3',title:'Digital ecology in public space',type:'article',year:2020,authors:['Ben Two'],concepts:['Digital','Ecology']},
  ],{maximumConcepts:20,maximumItems:40,maximumAuthors:10,maximumEmergence:4});
  const relation=graph.conceptEdges.find((item)=>item.source.includes('acoustics')&&item.target.includes('ecology'));
  assert.deepEqual(graph.concepts.map((item)=>item.label),['Ecology','Acoustics','Digital']);
  assert.equal(relation?.weight,2);
  assert.equal(graph.items.length,3);
});

test('connects functioning author and emerging-language layers through concepts',()=>{
  const graph=buildCorpusKnowledgeGraph([
    {id:'1',title:'Spectral music practice',type:'article',year:2000,authors:['Ada One'],concepts:['Music']},
    {id:'2',title:'Spectral music methods',type:'article',year:2010,authors:['Ada One'],concepts:['Music']},
    {id:'3',title:'Spectral music systems',type:'article',year:2020,authors:['Ben Two'],concepts:['Music']},
  ],{maximumConcepts:20,maximumItems:40,maximumAuthors:10,maximumEmergence:4});
  assert.equal(graph.authors[0]?.label,'Ada One');
  assert.ok(graph.authorEdges.some((item)=>item.target===graph.authors[0]?.id&&item.weight===2));
  assert.ok(graph.emergence.some((item)=>item.label==='spectral music'));
  assert.ok(graph.emergenceEdges.some((item)=>item.kind==='concept-emergence'));
});

test('extracts catalog authors and combines tags with bibliographic keywords',()=>{
  assert.deepEqual(corpusAuthorNames([{role:'editor',family:'Editor'},{role:'composer',given:'Kaija',family:'Saariaho'}]),['Kaija Saariaho']);
  assert.deepEqual(corpusKeywordLabels({bibtex:{keywords:'sound; space'}},['fieldwork','sound']),['sound','space','fieldwork']);
});
