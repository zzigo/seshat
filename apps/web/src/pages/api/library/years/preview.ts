import { parsePublicationYear } from '@seshat/core';
import type { APIRoute } from 'astro';
import { chooseYearCandidate, crossrefPublicationYear, needsExternalYearEvidence, storedYearCandidate, type BibliographicYearCandidate } from '../../../../lib/bibliographic-year';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

const normalized = (value: unknown): string => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const titleScore = (left: unknown, right: unknown): number => {
  const a = new Set(normalized(left).split(' ').filter(Boolean)); const b = new Set(normalized(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
};
const contributorNames = (value: unknown): string[] => (Array.isArray(value) ? value : []).map((person:any) => String(person?.literal || [person?.given,person?.family].filter(Boolean).join(' '))).filter(Boolean);
const validYear = (value: unknown): number | undefined => { const year=parsePublicationYear(value);return year !== undefined && year <= new Date().getUTCFullYear()+1 ? year : undefined; };

const crossrefCandidate = async (row:any): Promise<BibliographicYearCandidate|null> => {
  const doi=String(row.identifiers?.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').trim();if(!doi)return null;
  const url=new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);if(process.env.CROSSREF_MAILTO)url.searchParams.set('mailto',process.env.CROSSREF_MAILTO);
  try{const response=await fetch(url,{headers:{'User-Agent':'Seshat/0.1 (https://seshat.zztt.org)'},signal:AbortSignal.timeout(9000)});if(!response.ok)return null;const message=(await response.json())?.message||{};const year=crossrefPublicationYear(message);if(!year)return null;return{year,provider:'crossref',label:'Crossref DOI record',evidence:`${doi} · ${message.title?.[0]||row.title}`,confidence:.99,originalWorkYear:true,url:`https://doi.org/${doi}`};}catch{return null;}
};

const openLibraryCandidate = async (row:any): Promise<BibliographicYearCandidate|null> => {
  const isbns=(Array.isArray(row.identifiers?.isbn)?row.identifiers.isbn:[]).map(String).filter(Boolean);const authors=contributorNames(row.contributors);const url=new URL('https://openlibrary.org/search.json');
  if(isbns[0])url.searchParams.set('isbn',isbns[0]);else{url.searchParams.set('title',String(row.title||''));if(authors[0])url.searchParams.set('author',authors[0]);}
  url.searchParams.set('limit','5');url.searchParams.set('fields','key,title,author_name,first_publish_year,isbn');
  try{const response=await fetch(url,{headers:{'User-Agent':'Seshat/0.1 (https://seshat.zztt.org)'},signal:AbortSignal.timeout(9000)});if(!response.ok)return null;const docs=(await response.json())?.docs||[];const ranked=docs.map((doc:any)=>({doc,score:isbns.some((isbn:string)=>doc.isbn?.includes(isbn))?1:titleScore(row.title,doc.title)})).sort((a:any,b:any)=>b.score-a.score);const best=ranked[0];const year=validYear(best?.doc?.first_publish_year);if(!year||best.score<.58)return null;return{year,provider:'open-library',label:'Open Library first publication',evidence:`${best.doc.title}${best.doc.author_name?.[0]?` · ${best.doc.author_name[0]}`:''}`,confidence:best.score===1?.98:.84,originalWorkYear:true,url:best.doc.key?`https://openlibrary.org${best.doc.key}`:undefined};}catch{return null;}
};

const googleBooksCandidate = async (row:any): Promise<BibliographicYearCandidate|null> => {
  const key=String(process.env.GOOGLE_BOOKS_API_KEY||process.env.GOOGLE_API_KEY||'').trim();const isbns=(Array.isArray(row.identifiers?.isbn)?row.identifiers.isbn:[]).map(String).filter(Boolean);const authors=contributorNames(row.contributors);const url=new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q',isbns[0]?`isbn:${isbns[0]}`:[`intitle:${row.title}`,authors[0]?`inauthor:${authors[0]}`:''].filter(Boolean).join(' '));url.searchParams.set('maxResults','5');url.searchParams.set('printType','books');if(key)url.searchParams.set('key',key);
  try{let response=await fetch(url,{signal:AbortSignal.timeout(9000)});if(response.status===403&&url.searchParams.has('key')){url.searchParams.delete('key');response=await fetch(url,{signal:AbortSignal.timeout(9000)});}if(!response.ok)return null;const items=(await response.json())?.items||[];const ranked=items.map((item:any)=>({item,score:titleScore(row.title,item.volumeInfo?.title)})).sort((a:any,b:any)=>b.score-a.score);const best=ranked[0];const year=validYear(best?.item?.volumeInfo?.publishedDate);if(!year||best.score<.58)return null;return{year,provider:'google-books',label:'Google Books edition date',evidence:`${best.item.volumeInfo.title}${best.item.volumeInfo.publisher?` · ${best.item.volumeInfo.publisher}`:''}`,confidence:.72,originalWorkYear:false,url:best.item.volumeInfo.infoLink};}catch{return null;}
};

const suggestionsFor = async (row:any) => {
  const currentYear=parsePublicationYear(row.issued?.year);const local=storedYearCandidate(row);const candidates:BibliographicYearCandidate[]=[];
  if(local)candidates.push(local);
  if(!local&&needsExternalYearEvidence(row)){
    const openAlexYear=validYear(row.openalex_work?.publicationYear);if(openAlexYear)candidates.push({year:openAlexYear,provider:'openalex',label:'OpenAlex work',evidence:String(row.openalex_work?.title||row.title),confidence:.96,originalWorkYear:true,url:row.openalex_work?.id?`https://openalex.org/${row.openalex_work.id}`:undefined});
    const crossref=await crossrefCandidate(row);if(crossref)candidates.push(crossref);
    if(!crossref&&(['book','inbook','incollection','collection','misc'].includes(String(row.type))||row.identifiers?.isbn?.length)){
      const openLibrary=await openLibraryCandidate(row);if(openLibrary)candidates.push(openLibrary);
      if(!openLibrary){const google=await googleBooksCandidate(row);if(google)candidates.push(google);}
    }
  }
  const suggestion=chooseYearCandidate(currentYear,candidates);
  return{id:String(row.id),title:String(row.title),currentYear:currentYear??null,suggestion,applyByDefault:Boolean(suggestion&&suggestion.confidence>=.95&&suggestion.originalWorkYear),searchedExternal:!local&&needsExternalYearEvidence(row)};
};

export const POST: APIRoute = async ({request,locals}) => {
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();if(!email)return Response.json({error:'authentication_required'},{status:401});
  const body=await request.json().catch(()=>null) as {ids?:unknown}|null;const ids=Array.isArray(body?.ids)?[...new Set(body.ids.map(String).filter(Boolean))].slice(0,200):[];if(!ids.length)return Response.json({error:'missing_ids'},{status:400});
  const catalog=getCatalog();await catalog.ensureSchema();const rows=await catalog.pool.query(`SELECT reference.id,reference.title,reference.type,reference.contributors,reference.issued,reference.identifiers,reference.source,paper.openalex_work FROM catalog_references reference LEFT JOIN catalog_papers paper ON paper.owner_key=reference.owner_key AND paper.reference_id=reference.id WHERE reference.owner_key=$1 AND reference.id=ANY($2::text[])`,[ownerKeyFor(email),ids]);
  const items:any[]=[];for(let offset=0;offset<rows.rows.length;offset+=6)items.push(...await Promise.all(rows.rows.slice(offset,offset+6).map(suggestionsFor)));
  const byId=new Map(items.map((item)=>[item.id,item]));return Response.json({ok:true,items:ids.map((id)=>byId.get(id)).filter(Boolean)});
};
