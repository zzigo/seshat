import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script=readFileSync(new URL('../src/scripts/read-aloud.ts',import.meta.url),'utf8');
const styles=readFileSync(new URL('../src/styles/workspace.css',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');
const dashboardReader=readFileSync(new URL('../src/pages/dashboard-reader/[id].astro',import.meta.url),'utf8');
const readerModal=readFileSync(new URL('../src/components/ReaderModal.astro',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/pages/dashboard.astro',import.meta.url),'utf8');
const mobwork=readFileSync(new URL('../src/pages/mobwork.astro',import.meta.url),'utf8');

test('keeps the reading toolbar compact and exposes voice settings directly',()=>{
  assert.match(script,/comment\.innerHTML=readerIcon\('bookmark'\)/);
  assert.doesNotMatch(script,/readerIcon\('bookmark'\).*<small>Mark<\/small>/);
  assert.match(script,/voices\.className='caption-voices'/);
  assert.match(script,/voices\.onclick=\(\)=>this\.openVoices\(\)/);
  assert.match(script,/controls\.append\(comment,previousSection,nextSection,slower,speed,faster,transport,voices\)/);
});

test('uses flat section and speed controls with circular transport and voices',()=>{
  assert.match(styles,/\.caption-comment,\.read-aloud-caption-controls \.caption-section,\.read-aloud-caption-controls \.caption-speed\s*\{\s*border-color:transparent;\s*background:transparent;/);
  assert.match(styles,/\.caption-transport\s*\{[^}]*border-radius:50%/);
  assert.match(styles,/\.caption-voices\s*\{[^}]*border-radius:50%/);
});

test('shares one read-aloud toolbar across Workspace, Dashboard, and Mobwork',()=>{
  assert.match(workspace,/readAloud\.attach\(/);
  assert.match(dashboardReader,/import '\.\.\/\.\.\/styles\/workspace\.css'/);
  assert.match(dashboardReader,/readAloud\.attach\(/);
  assert.match(readerModal,/dashboard-reader\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(dashboard,/import ReaderModal from '\.\.\/components\/ReaderModal\.astro'/);
  assert.match(mobwork,/import ReaderModal from '\.\.\/components\/ReaderModal\.astro'/);
});

test('changes speed without tearing down and restarting the reader',()=>{
  const adjustment=script.match(/adjustRate\(delta:number\)\{([\s\S]*?)\}\n  captionTransport/)?.[1]||'';
  assert.match(adjustment,/this\.paintButton\(\)/);
  assert.doesNotMatch(adjustment,/this\.stop\(|this\.start\(/);
  assert.match(script,/rate:readSettings\(\)\.rate/);
  assert.match(adjustment,/activeEngine==='chirp'\?next\/Math\.max\(\.25,this\.audioSourceRate\):next/);
  assert.match(script,/audio\.preservesPitch=true/);
  assert.match(script,/rate\.max='3'/);
});

test('starts Chirp with one phrase while prefetching normal reading blocks',()=>{
  assert.match(script,/chunk=this\.cloudChunk\(cursor,true\)/);
  assert.match(script,/const next=this\.cloudChunk\(cursor\)/);
  assert.match(script,/preparing first phrase/);
});
