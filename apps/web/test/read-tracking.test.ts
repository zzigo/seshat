import assert from 'node:assert/strict';
import test from 'node:test';
import { bestReadingSpanRun, readingPartIndexAtProgress } from '../src/lib/read-tracking';

test('selects one contiguous PDF span run instead of every shared word',()=>{
  const spans=['A repeated introduction','The method begins here','with spectral counterpoint','and closes the sentence','Another repeated method'];
  assert.deepEqual(bestReadingSpanRun(spans,'The method begins here with spectral counterpoint and closes the sentence.'),{start:1,end:3,score:127,hits:7});
});

test('rejects weak matches made only from common words',()=>{
  assert.equal(bestReadingSpanRun(['the and with','other unrelated text'],'the work and the form'),null);
});

test('tracks sentence parts monotonically through synthesized audio',()=>{
  assert.equal(readingPartIndexAtProgress([10,20,10],0),0);
  assert.equal(readingPartIndexAtProgress([10,20,10],.3),1);
  assert.equal(readingPartIndexAtProgress([10,20,10],.9),2);
});
