import { detectEmergence } from './emergence';

export type CorpusGraphSourceItem = {
  id:string;
  title:string;
  type:string;
  year:number|null;
  authors:string[];
  concepts:string[];
};

export type CorpusGraphNode = {
  id:string;
  kind:'concept'|'item'|'author'|'emergence';
  label:string;
  count:number;
  itemIds:string[];
  properties:Record<string,unknown>;
};

export type CorpusGraphEdge = {
  id:string;
  source:string;
  target:string;
  kind:'concept-related'|'has-concept'|'concept-author'|'concept-emergence';
  weight:number;
  itemIds:string[];
};

export type CorpusKnowledgeGraph = {
  concepts:CorpusGraphNode[];
  items:CorpusGraphNode[];
  authors:CorpusGraphNode[];
  emergence:CorpusGraphNode[];
  conceptEdges:CorpusGraphEdge[];
  itemEdges:CorpusGraphEdge[];
  authorEdges:CorpusGraphEdge[];
  emergenceEdges:CorpusGraphEdge[];
  totals:{concepts:number;items:number;authors:number;emergence:number};
};

const normalized=(value:unknown)=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'')
  .trim().toLocaleLowerCase().replace(/\s+/g,' ');
const stable=(value:string)=>encodeURIComponent(normalized(value)).replace(/%/g,'').slice(0,180);
const unique=(values:string[])=>[...new Set(values.map((value)=>String(value||'').trim()).filter(Boolean))];
const push=(map:Map<string,Set<string>>,key:string,value:string)=>{
  const values=map.get(key)||new Set<string>();values.add(value);map.set(key,values);
};
const edge=(kind:CorpusGraphEdge['kind'],source:string,target:string,itemIds:Set<string>):CorpusGraphEdge=>({
  id:`${kind}:${source}:${target}`,source,target,kind,weight:itemIds.size,itemIds:[...itemIds],
});

export const corpusAuthorNames=(contributors:unknown):string[]=>{
  const people=Array.isArray(contributors)?contributors as Array<Record<string,unknown>>:[];
  const name=(person:Record<string,unknown>)=>String(person.literal||[person.given,person.family].filter(Boolean).join(' ')||person.family||person.given||'').trim();
  const primary=new Set(['author','composer','creator']);
  const preferred=people.filter((person)=>primary.has(String(person.role||'author').toLowerCase())).map(name).filter(Boolean);
  return unique(preferred.length?preferred:people.map(name).filter(Boolean));
};

export const corpusKeywordLabels=(source:unknown,tags:unknown):string[]=>{
  const value=(source||{}) as Record<string,any>;
  const raw=value.keywords??value.bibtex?.keywords??[];
  const keywords=(Array.isArray(raw)?raw:String(raw||'').split(/[,;\n]+/)).map(String);
  return unique([...keywords,...(Array.isArray(tags)?tags.map(String):[])]);
};

export const buildCorpusKnowledgeGraph=(sources:CorpusGraphSourceItem[],options:{maximumConcepts?:number;maximumItems?:number;maximumAuthors?:number;maximumEmergence?:number}={}):CorpusKnowledgeGraph=>{
  const maximumConcepts=Math.max(10,options.maximumConcepts||80);
  const maximumItems=Math.max(40,options.maximumItems||500);
  const maximumAuthors=Math.max(10,options.maximumAuthors||60);
  const maximumEmergence=Math.max(3,options.maximumEmergence||10);
  const conceptLabels=new Map<string,string>(),conceptItems=new Map<string,Set<string>>();
  const sourceById=new Map(sources.map((item)=>[item.id,item]));
  for(const item of sources)for(const label of unique(item.concepts)){const key=normalized(label);if(!key)continue;conceptLabels.set(key,conceptLabels.get(key)||label);push(conceptItems,key,item.id);}
  const rankedConcepts=[...conceptItems].sort((left,right)=>right[1].size-left[1].size||String(conceptLabels.get(left[0])).localeCompare(String(conceptLabels.get(right[0]))));
  const repeated=rankedConcepts.filter(([,items])=>items.size>1);
  const selectedConcepts=(repeated.length>=8?repeated:rankedConcepts).slice(0,maximumConcepts);
  const selectedKeys=new Set(selectedConcepts.map(([key])=>key));
  const conceptId=(key:string)=>`concept:${stable(key)}`;
  const concepts:CorpusGraphNode[]=selectedConcepts.map(([key,itemIds])=>({
    id:conceptId(key),kind:'concept',label:conceptLabels.get(key)||key,count:itemIds.size,itemIds:[...itemIds],
    properties:{source:'corpus',normalizedLabel:key},
  }));

  const conceptPairs=new Map<string,Set<string>>();
  const relevantItemScores=new Map<string,number>();
  for(const item of sources){
    const keys=unique(item.concepts).map(normalized).filter((key)=>selectedKeys.has(key)).sort();
    if(keys.length)relevantItemScores.set(item.id,keys.length);
    for(let left=0;left<keys.length;left+=1)for(let right=left+1;right<keys.length;right+=1)push(conceptPairs,`${keys[left]}\u0000${keys[right]}`,item.id);
  }
  const rawConceptEdges=[...conceptPairs].map(([pair,itemIds])=>{const [left,right]=pair.split('\u0000');return edge('concept-related',conceptId(left),conceptId(right),itemIds);});
  const stronger=rawConceptEdges.filter((item)=>item.weight>1);
  const conceptEdges=(stronger.length>=Math.min(12,concepts.length)?stronger:rawConceptEdges)
    .sort((left,right)=>right.weight-left.weight).slice(0,Math.max(60,maximumConcepts*4));

  const signals=detectEmergence(sources.flatMap((item)=>Number.isFinite(item.year)?[{id:item.id,title:item.title,year:Number(item.year)}]:[]),maximumEmergence);
  const signalItemIds=new Set(signals.flatMap((signal)=>signal.itemIds));
  const rankedItems=[...sources].filter((item)=>relevantItemScores.has(item.id)||signalItemIds.has(item.id))
    .sort((left,right)=>(relevantItemScores.get(right.id)||0)-(relevantItemScores.get(left.id)||0)||(right.year||0)-(left.year||0)||left.title.localeCompare(right.title))
    .slice(0,maximumItems);
  const items:CorpusGraphNode[]=rankedItems.map((item)=>({
    id:`item:${item.id}`,kind:'item',label:item.title,count:relevantItemScores.get(item.id)||0,itemIds:[item.id],
    properties:{referenceId:item.id,type:item.type,year:item.year,authors:item.authors},
  }));
  const itemEdges:CorpusGraphEdge[]=[];
  for(const item of rankedItems)for(const key of unique(item.concepts).map(normalized).filter((candidate)=>selectedKeys.has(candidate))){
    itemEdges.push(edge('has-concept',conceptId(key),`item:${item.id}`,new Set([item.id])));
  }

  const authorLabels=new Map<string,string>(),authorItems=new Map<string,Set<string>>();
  for(const item of sources)for(const label of unique(item.authors)){const key=normalized(label);if(!key)continue;authorLabels.set(key,authorLabels.get(key)||label);push(authorItems,key,item.id);}
  const selectedAuthors=[...authorItems].filter(([,ids])=>ids.size>1).sort((left,right)=>right[1].size-left[1].size||String(authorLabels.get(left[0])).localeCompare(String(authorLabels.get(right[0])))).slice(0,maximumAuthors);
  const authorId=(key:string)=>`author:${stable(key)}`;
  const authors:CorpusGraphNode[]=selectedAuthors.map(([key,itemIds])=>({
    id:authorId(key),kind:'author',label:authorLabels.get(key)||key,count:itemIds.size,itemIds:[...itemIds].filter((id)=>sourceById.has(id)),
    properties:{source:'catalog'},
  }));
  const authorEdges:CorpusGraphEdge[]=[];
  for(const [authorKey,authorItemIds] of selectedAuthors)for(const [conceptKey,conceptItemIds] of selectedConcepts){
    const shared=new Set([...authorItemIds].filter((id)=>conceptItemIds.has(id)));if(shared.size)authorEdges.push(edge('concept-author',conceptId(conceptKey),authorId(authorKey),shared));
  }

  const emergence:CorpusGraphNode[]=signals.map((signal)=>({
    id:`emergence:${stable(signal.phrase)}`,kind:'emergence',label:signal.phrase,count:signal.count,itemIds:signal.itemIds.filter((id)=>sourceById.has(id)),
    properties:{firstYear:signal.firstYear,peakYear:signal.peakYear,strength:signal.strength,bins:signal.bins},
  }));
  const emergenceEdges:CorpusGraphEdge[]=[];
  for(const signal of emergence)for(const [conceptKey,conceptItemIds] of selectedConcepts){
    const shared=new Set(signal.itemIds.filter((id)=>conceptItemIds.has(id)));if(shared.size)emergenceEdges.push(edge('concept-emergence',conceptId(conceptKey),signal.id,shared));
  }

  return {
    concepts,items,authors,emergence,conceptEdges,itemEdges,authorEdges,emergenceEdges,
    totals:{concepts:conceptLabels.size,items:sources.length,authors:authorItems.size,emergence:signals.length},
  };
};
