import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseConfidentWasabiMatch, scoreWasabiMatch } from '../src/lib/wasabi-candidate-match';

const object=(filename:string)=>({key:`root/history/${filename}`,filename,path:`history/${filename}`,sizeBytes:100});

test('accepts one strong title, creator and year match',()=>{
  const match=scoreWasabiMatch({title:'The Republic',contributors:[{family:'Plato'}],year:-375},object('Plato_-0375_The Republic.pdf'))!;
  assert.equal(chooseConfidentWasabiMatch([match]).match?.key,match.key);
});

test('leaves close candidates ambiguous instead of bulk-linking one',()=>{
  const reference={title:'Physics and Philosophy',contributors:[{family:'Heisenberg'}],year:1958};
  const matches=['Heisenberg_1958_Physics and Philosophy.pdf','Heisenberg_1958_Physics and Philosophy copy.pdf'].map((name)=>scoreWasabiMatch(reference,object(name))!);
  assert.equal(chooseConfidentWasabiMatch(matches).ambiguous,true);
});

test('an exact Zotero filename is safe even for a short title',()=>{
  const candidate=scoreWasabiMatch({title:'Ion'},object('Plato_Ion.pdf'),'Plato_Ion.pdf')!;
  assert.equal(chooseConfidentWasabiMatch([candidate]).match?.exact,true);
});
