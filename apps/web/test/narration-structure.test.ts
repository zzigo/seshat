import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyNarrationStructure,
  deterministicEarconProfile,
  narrationSsml,
  narrationPauseBefore,
  normalizeNarrationStructureSettings,
  synthesizeEarconSamples,
} from '../src/lib/narration-structure';

test('preserves titles, paragraph boundaries, and chapter identities',()=>{
  const source='# Book title\n\nFirst paragraph. Second sentence.\n\n# Chapter two\n\nNext paragraph.';
  const sentences=[
    {raw:'# Book title',text:'Book title',start:0,end:12},
    {raw:'First paragraph.',text:'First paragraph.',start:14,end:30},
    {raw:'Second sentence.',text:'Second sentence.',start:31,end:47},
    {raw:'# Chapter two',text:'Chapter two',start:49,end:62},
    {raw:'Next paragraph.',text:'Next paragraph.',start:64,end:79},
  ];
  const semantic=applyNarrationStructure(source,sentences);
  assert.equal(semantic[0].kind,'document-title');
  assert.equal(semantic[1].boundaryBefore,'paragraph');
  assert.equal(semantic[2].boundaryBefore,'none');
  assert.equal(semantic[3].kind,'chapter-title');
  assert.equal(semantic[3].sectionId,'markdown-heading:49');
});

test('uses the structural pause hierarchy and gently scales it with speed',()=>{
  const source='# Title\n\nParagraph.\n\n## Section\n\nText.';
  const semantic=applyNarrationStructure(source,[
    {raw:'# Title',text:'Title',start:0,end:7},
    {raw:'Paragraph.',text:'Paragraph.',start:9,end:19},
    {raw:'## Section',text:'Section',start:21,end:31},
    {raw:'Text.',text:'Text.',start:33,end:38},
  ]);
  const settings=normalizeNarrationStructureSettings({});
  assert.equal(narrationPauseBefore(semantic,0,1,settings),1400);
  assert.equal(narrationPauseBefore(semantic,1,1,settings),400);
  assert.equal(narrationPauseBefore(semantic,2,1,settings),900);
  assert.ok(narrationPauseBefore(semantic,2,3,settings)>=585);
});

test('honors chapter semantics supplied by an extracted document structure',()=>{
  const source='Prelude.\n\nA new movement\n\nThe argument begins.';
  const semantic=applyNarrationStructure(source,[
    {raw:'Prelude.',text:'Prelude.',start:0,end:8},
    {raw:'A new movement',text:'A new movement',start:10,end:24},
    {raw:'The argument begins.',text:'The argument begins.',start:26,end:46},
  ],[
    {id:'structure:movement',title:'A new movement',level:2,kind:'chapter'},
  ]);
  assert.equal(semantic[1].kind,'chapter-title');
  assert.equal(semantic[1].sectionId,'structure:movement');
});

test('generates fixed repeatable FM earcons within configured ranges',()=>{
  const sentence={kind:'chapter-title' as const,sectionId:'chapter-2',start:500};
  const first=deterministicEarconProfile('reference-a',sentence,{earconDurationMs:1700,earconGainDb:-20});
  const repeated=deterministicEarconProfile('reference-a',sentence,{earconDurationMs:1700,earconGainDb:-20});
  const other=deterministicEarconProfile('reference-a',{...sentence,sectionId:'chapter-3'},{earconDurationMs:1700,earconGainDb:-20});
  assert.deepEqual(first,repeated);
  assert.notEqual(first.id,other.id);
  assert.equal(first.durationMs,1700);
  assert.ok(first.gain<.11);
  const samples=synthesizeEarconSamples(first,24000);
  assert.equal(samples.length,40800);
  assert.ok(Math.max(...samples)<.11);
  assert.ok(Math.abs(samples[0])<1e-6);
  assert.ok(Math.abs(samples.at(-1)!)<1e-6);
});

test('clamps narration controls to the designed safe ranges',()=>{
  const settings=normalizeNarrationStructureSettings({
    paragraphPauseMs:900,
    titlePauseMs:200,
    chapterPauseMs:5000,
    earconDurationMs:400,
    earconFadeInMs:900,
    earconFadeOutMs:100,
    earconGainDb:-2,
  });
  assert.deepEqual({
    paragraph:settings.paragraphPauseMs,
    title:settings.titlePauseMs,
    chapter:settings.chapterPauseMs,
    duration:settings.earconDurationMs,
    fadeIn:settings.earconFadeInMs,
    fadeOut:settings.earconFadeOutMs,
    gain:settings.earconGainDb,
  },{paragraph:550,title:750,chapter:1600,duration:1200,fadeIn:550,fadeOut:450,gain:-14});
});

test('renders provider-neutral semantic pauses as safe SSML',()=>{
  const sentences=[
    {text:'Title & method',kind:'document-title' as const,boundaryBefore:'chapter' as const},
    {text:'First paragraph.',kind:'paragraph' as const,boundaryBefore:'paragraph' as const},
  ];
  const ssml=narrationSsml(sentences,1,{chapterPauseMs:1400,paragraphPauseMs:500});
  assert.equal(ssml,'<speak><break time="1400ms"/><s>Title &amp; method</s><break time="400ms"/><s>First paragraph.</s></speak>');
});
