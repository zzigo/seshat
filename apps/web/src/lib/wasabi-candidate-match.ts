export type WasabiMatchObject = {
  key:string;
  filename:string;
  path:string;
  sizeBytes:number;
  lastModified?:string;
};

export type WasabiMatchReference = {
  title:string;
  contributors?:Array<{ family?:string; literal?:string }>;
  year?:string | number;
};

export type ScoredWasabiMatch = WasabiMatchObject & { score:number; exact:boolean };

const normalized = (value:unknown):string => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const stopwords = new Set(['and','the','for','from','with','como','para','las','los','una','uno','del','por','con','y']);
const tokens = (value:unknown):Set<string> => new Set(normalized(value).split(' ').filter((token)=>token.length>2&&!stopwords.has(token)));

export const scoreWasabiMatch = (
  reference:WasabiMatchReference,
  object:WasabiMatchObject,
  expectedFilename?:string,
):ScoredWasabiMatch|null => {
  const titleTokens=tokens(reference.title);const creatorTokens=tokens((reference.contributors||[]).map((person)=>person.family||person.literal||'').join(' '));
  const filename=normalized(object.filename);const filenameTokens=tokens(object.filename);const exact=Boolean(expectedFilename&&filename===normalized(expectedFilename));
  let score=exact?100:0,titleHits=0,creatorHits=0;
  for(const token of titleTokens)if(filenameTokens.has(token)){score+=5;titleHits+=1;}
  for(const token of creatorTokens)if(filenameTokens.has(token)){score+=7;creatorHits+=1;}
  const titleCoverage=titleTokens.size?titleHits/titleTokens.size:0;const creatorCoverage=creatorTokens.size?creatorHits/creatorTokens.size:0;
  score+=Math.round(titleCoverage*60+creatorCoverage*20);
  if(!exact&&titleCoverage<.28&&!(titleHits>=1&&creatorHits>=1))return null;
  const year=String(reference.year||'');if(year&&filename.includes(year))score+=12;
  return score?{...object,score,exact}:null;
};

export const chooseConfidentWasabiMatch = (matches:ScoredWasabiMatch[]):{ match?:ScoredWasabiMatch; ambiguous:boolean } => {
  const sorted=[...matches].sort((left,right)=>right.score-left.score||left.filename.localeCompare(right.filename));const first=sorted[0],second=sorted[1];
  if(!first)return {ambiguous:false};
  if(first.exact)return {match:first,ambiguous:false};
  if(first.score<70)return {ambiguous:true};
  if(second&&first.score-second.score<12)return {ambiguous:true};
  return {match:first,ambiguous:false};
};
