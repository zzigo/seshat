export type NarrationKind =
  | 'sentence'
  | 'paragraph'
  | 'document-title'
  | 'chapter-title'
  | 'section-title';

export type NarrationBoundary = 'none' | 'paragraph' | 'section' | 'chapter';

export type NarrationHeading = {
  id?:string;
  title:string;
  level?:number;
  kind?:string;
  offset?:number;
};

export type NarrationSentence = {
  raw:string;
  text:string;
  start:number;
  end:number;
  kind:NarrationKind;
  boundaryBefore:NarrationBoundary;
  sectionId?:string;
  headingLevel?:number;
};

export type NarrationStructureSettings = {
  structuralPauses:boolean;
  paragraphPauseMs:number;
  titlePauseMs:number;
  chapterPauseMs:number;
  earcons:boolean;
  earconDurationMs:number;
  earconFadeInMs:number;
  earconFadeOutMs:number;
  earconGainDb:number;
};

export type EarconProfile = {
  id:string;
  carrierHz:number;
  modulatorHz:number;
  modulationIndex:number;
  direction:'rise'|'fall';
  durationMs:number;
  fadeInMs:number;
  fadeOutMs:number;
  gain:number;
};

export const DEFAULT_NARRATION_STRUCTURE_SETTINGS:NarrationStructureSettings={
  structuralPauses:true,
  paragraphPauseMs:500,
  titlePauseMs:900,
  chapterPauseMs:1400,
  earcons:true,
  earconDurationMs:1500,
  earconFadeInMs:450,
  earconFadeOutMs:550,
  earconGainDb:-18,
};

const clamp=(value:number,minimum:number,maximum:number)=>Math.max(minimum,Math.min(maximum,Number(value)));
const normalized=(value:unknown)=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
const hash32=(value:string)=>{let hash=2166136261;for(let index=0;index<value.length;index+=1){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619);}return hash>>>0;};

export const normalizeNarrationStructureSettings=(value:Partial<NarrationStructureSettings>|null|undefined):NarrationStructureSettings=>({
  structuralPauses:value?.structuralPauses!==false,
  paragraphPauseMs:Math.round(clamp(value?.paragraphPauseMs??500,400,550)),
  titlePauseMs:Math.round(clamp(value?.titlePauseMs??900,750,1000)),
  chapterPauseMs:Math.round(clamp(value?.chapterPauseMs??1400,1200,1600)),
  earcons:value?.earcons!==false,
  earconDurationMs:Math.round(clamp(value?.earconDurationMs??1500,1200,1800)),
  earconFadeInMs:Math.round(clamp(value?.earconFadeInMs??450,350,550)),
  earconFadeOutMs:Math.round(clamp(value?.earconFadeOutMs??550,450,700)),
  earconGainDb:Math.round(clamp(value?.earconGainDb??-18,-24,-14)),
});

export const markdownNarrationHeadings=(source:string):NarrationHeading[]=>{
  const headings:NarrationHeading[]=[];const expression=/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;let match:RegExpExecArray|null;
  while((match=expression.exec(source))){
    const level=match[1].length,title=match[2].trim();
    headings.push({id:`markdown-heading:${match.index}`,title,level,kind:level===1?'chapter':'section',offset:match.index});
  }
  return headings;
};

const resolveHeadingOffsets=(source:string,headings:NarrationHeading[])=>{
  let cursor=0;
  return headings.map((heading,index)=>{
    let offset=Number.isFinite(heading.offset)?Math.max(0,Number(heading.offset)):source.toLocaleLowerCase().indexOf(heading.title.toLocaleLowerCase(),cursor);
    if(offset<0)offset=source.toLocaleLowerCase().indexOf(heading.title.toLocaleLowerCase());
    if(offset>=0)cursor=offset+heading.title.length;
    return{...heading,offset,id:heading.id||`heading:${offset>=0?offset:index}`};
  }).filter((heading)=>Number(heading.offset)>=0);
};

const headingKind=(heading:NarrationHeading,index:number):NarrationKind=>{
  const kind=normalized(heading.kind),level=Math.max(1,Number(heading.level)||1);
  if(index===0&&Number(heading.offset)<500&&level===1)return'document-title';
  if(level===1||/(?:^|\b)(chapter|part|book|cap[ií]tulo|parte|livre|buch)(?:\b|$)/i.test(kind))return'chapter-title';
  return'section-title';
};

export const applyNarrationStructure=<T extends {raw:string;text:string;start:number;end:number}>(
  source:string,
  sentences:T[],
  externalHeadings:NarrationHeading[]=[],
):Array<T&NarrationSentence>=>{
  const headings=resolveHeadingOffsets(source,[...markdownNarrationHeadings(source),...externalHeadings])
    .sort((left,right)=>Number(left.offset)-Number(right.offset))
    .filter((heading,index,items)=>index===0||Number(heading.offset)!==Number(items[index-1].offset)||normalized(heading.title)!==normalized(items[index-1].title));
  return sentences.map((sentence,index)=>{
    const headingIndex=headings.findIndex((heading)=>{
      const start=Number(heading.offset),end=start+heading.title.length;
      return sentence.start<=end&&sentence.end>=start;
    });
    const heading=headingIndex>=0?headings[headingIndex]:null;
    const between=index?source.slice(sentences[index-1].end,sentence.start):source.slice(0,sentence.start);
    let kind:NarrationKind=index?'sentence':'paragraph',boundaryBefore:NarrationBoundary='none';
    if(heading){
      kind=headingKind(heading,headingIndex);
      boundaryBefore=kind==='chapter-title'||kind==='document-title'?'chapter':'section';
    }else if(index&&/(?:\r?\n[ \t]*){2,}|\f/.test(between)){
      kind='paragraph';boundaryBefore='paragraph';
    }
    return{...sentence,kind,boundaryBefore,sectionId:heading?.id,headingLevel:heading?.level};
  });
};

export const effectivePauseScale=(rate:number)=>clamp(1/Math.sqrt(Math.max(.25,Number(rate)||1)),.65,1.15);

export const narrationPauseBefore=(
  sentences:Array<Pick<NarrationSentence,'kind'|'boundaryBefore'>>,
  index:number,
  rate:number,
  value:Partial<NarrationStructureSettings>|null|undefined,
)=>{
  const settings=normalizeNarrationStructureSettings(value);if(!settings.structuralPauses||index<0||index>=sentences.length)return 0;
  const sentence=sentences[index],previous=index?sentences[index-1]:null;let milliseconds=0;
  if(sentence.boundaryBefore==='chapter')milliseconds=settings.chapterPauseMs;
  else if(sentence.boundaryBefore==='section')milliseconds=settings.titlePauseMs;
  else if(previous&&['document-title','chapter-title','section-title'].includes(previous.kind))milliseconds=Math.min(settings.paragraphPauseMs,400);
  else if(sentence.boundaryBefore==='paragraph')milliseconds=settings.paragraphPauseMs;
  return Math.round(milliseconds*effectivePauseScale(rate));
};

export const deterministicEarconProfile=(
  referenceId:string,
  sentence:Pick<NarrationSentence,'sectionId'|'start'|'kind'>,
  value:Partial<NarrationStructureSettings>|null|undefined,
):EarconProfile=>{
  const settings=normalizeNarrationStructureSettings(value),id=`earcon:${hash32(`${referenceId}|${sentence.sectionId||sentence.start}|${sentence.kind}`).toString(36)}`,seed=hash32(id);
  const carrierHz=220+(seed%7)*23,ratio=[1.25,1.5,1.75,2][(seed>>>3)%4],direction:EarconProfile['direction']=sentence.kind==='document-title'?'rise':((seed>>>6)&1?'rise':'fall');
  return{id,carrierHz,modulatorHz:carrierHz*ratio,modulationIndex:1.6+((seed>>>9)%7)*.16,direction,durationMs:settings.earconDurationMs,fadeInMs:settings.earconFadeInMs,fadeOutMs:settings.earconFadeOutMs,gain:10**(settings.earconGainDb/20)};
};

export const synthesizeEarconSamples=(profile:EarconProfile,sampleRate:number)=>{
  const rate=Math.max(8000,Math.floor(sampleRate||24000)),length=Math.max(1,Math.round(rate*profile.durationMs/1000)),output=new Float32Array(length);
  const fadeIn=Math.max(1,Math.round(rate*profile.fadeInMs/1000)),fadeOut=Math.max(1,Math.round(rate*profile.fadeOutMs/1000));
  let phase=0,modulationPhase=0;
  for(let index=0;index<length;index+=1){
    const progress=index/Math.max(1,length-1),curve=profile.direction==='rise'?.88+progress*.24:1.12-progress*.24,frequency=profile.carrierHz*curve;
    phase+=Math.PI*2*frequency/rate;modulationPhase+=Math.PI*2*profile.modulatorHz/rate;
    const envelope=Math.min(1,index/fadeIn,(length-1-index)/fadeOut);
    output[index]=Math.sin(phase+Math.sin(modulationPhase)*profile.modulationIndex)*Math.max(0,envelope)*profile.gain;
  }
  return output;
};

export const silenceSamples=(milliseconds:number,sampleRate:number)=>new Float32Array(Math.max(0,Math.round(Math.max(0,milliseconds)*Math.max(8000,sampleRate)/1000)));

const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

export const narrationSsml=(
  sentences:Array<Pick<NarrationSentence,'text'|'kind'|'boundaryBefore'>>,
  rate:number,
  value:Partial<NarrationStructureSettings>|null|undefined,
)=>{
  const settings=normalizeNarrationStructureSettings(value),parts=['<speak>'];
  sentences.forEach((sentence,index)=>{
    const pause=narrationPauseBefore(sentences,index,rate,settings);
    if(pause)parts.push(`<break time="${pause}ms"/>`);
    parts.push(`<s>${xml(sentence.text)}</s>`);
  });
  parts.push('</speak>');return parts.join('');
};
