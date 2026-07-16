import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseYearCandidate, crossrefPublicationYear, needsExternalYearEvidence, storedYearCandidate } from '../src/lib/bibliographic-year';

test('recovers the four-digit year from a Zotero full date',()=>{
  assert.equal(storedYearCandidate({issued:{year:20,literal:'May 20, 2021'},source:{provider:'zotero'}})?.year,2021);
});

test('does not classify an intact ancient year as externally repairable',()=>{
  assert.equal(storedYearCandidate({issued:{year:270,literal:'270'},source:{provider:'zotero'}}),null);
  assert.equal(needsExternalYearEvidence({type:'book',issued:{year:270},identifiers:{}}),false);
});

test('requests external evidence for a modern scholarly record with a corrupted short year',()=>{
  assert.equal(needsExternalYearEvidence({type:'article',issued:{year:7},identifiers:{doi:'10.1000/test'}}),true);
});

test('Crossref year selection prefers the earliest original publication channel',()=>{
  assert.equal(crossrefPublicationYear({'published-print':{'date-parts':[[2021,2]]},'published-online':{'date-parts':[[2020,11]]}}),2020);
});

test('an edition-only date is not preferred over first-publication evidence',()=>{
  const chosen=chooseYearCandidate(undefined,[
    {year:2016,provider:'google-books',label:'edition',evidence:'edition',confidence:.72,originalWorkYear:false},
    {year:1998,provider:'open-library',label:'work',evidence:'work',confidence:.84,originalWorkYear:true},
  ]);
  assert.equal(chosen?.year,1998);
});
