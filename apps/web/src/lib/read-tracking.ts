const stopWords=new Set('about after again also and are because been before being between both but can como con del desde donde durante een elle entre este esta for from had has have into its les los mais more muy para pero por que qui sans sobre than that the their them then there these they this those through una uno unos was were what when where which while with you your'.split(' '));

const readingTokens=(value:string)=>value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]{2,}/gu)||[];

export type ReadingSpanRun={start:number;end:number;score:number;hits:number};

export const bestReadingSpanRun=(spans:string[],phrase:string,maxRun=4):ReadingSpanRun|null=>{
  const all=[...new Set(readingTokens(phrase))];
  const targets=all.filter((token)=>token.length>=4&&!stopWords.has(token));
  const useful=targets.length?targets:all.filter((token)=>token.length>=3);
  if(!useful.length)return null;
  let best:ReadingSpanRun|null=null;
  for(let start=0;start<spans.length;start+=1){let candidate='';for(let end=start;end<Math.min(spans.length,start+Math.max(1,maxRun));end+=1){candidate+=` ${spans[end]}`;const candidateTokens=new Set(readingTokens(candidate));const matched=useful.filter((token)=>candidateTokens.has(token));const distinctive=matched.filter((token)=>token.length>=8).length;const score=matched.reduce((sum,token)=>sum+token.length,0)+matched.length*8+distinctive*7;const shorter=best&&score===best.score&&end-start<best.end-best.start;if(!best||score>best.score||shorter)best={start,end,score,hits:matched.length};}}
  if(!best)return null;
  const selected=spans.slice(best.start,best.end+1).join(' ');const hasDistinctive=readingTokens(selected).some((token)=>token.length>=8&&useful.includes(token));
  return best.hits>=2||hasDistinctive?best:null;
};

export const readingPartIndexAtProgress=(lengths:number[],progress:number):number=>{
  if(!lengths.length)return 0;const weights=lengths.map((value)=>Math.max(1,Number(value)||0));const total=weights.reduce((sum,value)=>sum+value,0),target=Math.max(0,Math.min(1,Number(progress)||0))*total;let cursor=0;
  for(let index=0;index<weights.length;index+=1){cursor+=weights[index];if(target<cursor||index===weights.length-1)return index;}
  return weights.length-1;
};
