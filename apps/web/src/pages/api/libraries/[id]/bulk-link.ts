import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { mapBibAttachment } from '../../../../lib/bibliography-paths';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';
import { chooseConfidentWasabiMatch, scoreWasabiMatch, type WasabiMatchObject } from '../../../../lib/wasabi-candidate-match';
import { getWasabiLibraryRoot, wasabiPathIdentity, wasabiUnicodePathForms } from '../../../../lib/wasabi-settings';

const supported=/\.(pdf|epub|docx|txt|webarchive|djvu|djv)$/i;const MAX_OBJECTS=100_000;
const cleanSegment=(value:unknown):string=>String(value||'').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g,'').trim();

const resolveWasabiPrefixes=async(storage:ReturnType<typeof getWasabiClient>,bucket:string,root:string,folder:string):Promise<string[]>=>{
  let parents=wasabiUnicodePathForms(root);
  for(const segment of folder.split('/').filter(Boolean)){
    const matches:string[]=[];
    for(const parent of parents){
      let token:string|undefined;
      do{
        const page=await storage.send(new ListObjectsV2Command({Bucket:bucket,Prefix:`${parent}/`,Delimiter:'/',ContinuationToken:token,MaxKeys:1000}));
        for(const entry of page.CommonPrefixes||[]){
          const prefix=String(entry.Prefix||'').replace(/\/+$/,'');const name=prefix.split('/').at(-1)||'';
          if(wasabiPathIdentity(name)===wasabiPathIdentity(segment))matches.push(prefix);
        }
        token=page.NextContinuationToken;
      }while(token);
    }
    parents=matches.length?[...new Set(matches)]:[...new Set(parents.flatMap((parent)=>wasabiUnicodePathForms(`${parent}/${segment}`)))];
  }
  return [...new Set(parents.map((prefix)=>`${prefix.replace(/\/+$/,'')}/`))];
};

export const GET:APIRoute=async({locals,params})=>{
  const user=(locals.session as any)?.user;const email=String(user?.email||'').trim().toLowerCase();
  if(!email)return Response.json({error:'authentication_required'},{status:401});
  const ownerKey=ownerKeyFor(email),catalog=getCatalog();await catalog.ensureSchema();
  const [libraries,references]=await Promise.all([catalog.listLibraries(ownerKey),catalog.list(ownerKey,10_000)]);
  const target=libraries.find((library)=>library.id===(params.id||'')&&library.access==='owner');
  if(!target||target.id.startsWith('inbox:'))return Response.json({error:'folder_not_found'},{status:404});
  const branch=new Set<string>([target.id]);let changed=true;while(changed){changed=false;libraries.forEach((library)=>{if(library.parentId&&branch.has(library.parentId)&&!branch.has(library.id)){branch.add(library.id);changed=true;}});}
  const pathFor=(libraryId:string):string=>{const parts:string[]=[];const seen=new Set<string>();let current=libraries.find((library)=>library.id===libraryId);while(current&&!seen.has(current.id)){seen.add(current.id);parts.unshift(cleanSegment(current.name));current=current.parentId?libraries.find((library)=>library.id===current!.parentId):undefined;}if(/^zotero$/i.test(parts[0]||''))parts.shift();return parts.filter(Boolean).join('/');};
  const identity={email,name:String(user?.name||'')};const root=await getWasabiLibraryRoot(ownerKey,identity);const folder=pathFor(target.id);
  const storage=getWasabiClient(),bucket=getWasabiBucket(),prefixes=await resolveWasabiPrefixes(storage,bucket,root,folder),objects:WasabiMatchObject[]=[];const seenObjects=new Set<string>();
  for(const prefix of prefixes){let token:string|undefined;do{const page=await storage.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:token,MaxKeys:1000}));for(const object of page.Contents||[]){const key=String(object.Key||''),filename=key.split('/').at(-1)||'';if(key&&filename&&supported.test(filename)&&!key.includes('/.seshat/')&&!seenObjects.has(key)){seenObjects.add(key);objects.push({key,filename,path:key.slice(root.length+1),sizeBytes:Number(object.Size||0),lastModified:object.LastModified?.toISOString()});}if(objects.length>=MAX_OBJECTS)break;}token=objects.length>=MAX_OBJECTS?undefined:page.NextContinuationToken;}while(token);if(objects.length>=MAX_OBJECTS)break;}
  const linked=await catalog.pool.query(`SELECT a.object_key FROM catalog_artifacts a JOIN catalog_references r ON r.id=a.reference_id WHERE r.owner_key=$1 AND a.kind='original'`,[ownerKey]);const linkedKeys=new Set(linked.rows.map((row:any)=>String(row.object_key)));
  const available=objects.filter((object)=>!linkedKeys.has(object.key));const byFolder=new Map<string,WasabiMatchObject[]>();available.forEach((object)=>{const directory=object.path.includes('/')?object.path.slice(0,object.path.lastIndexOf('/')):'';const key=wasabiPathIdentity(directory);byFolder.set(key,[...(byFolder.get(key)||[]),object]);});
  const branchReferences=references.filter((reference)=>reference.access==='owner'&&reference.libraryIds.some((id)=>branch.has(id)));const eligible=branchReferences.filter((reference)=>!reference.artifacts.some((artifact)=>artifact.kind==='original'));
  const matches:Array<{referenceId:string;title:string;folder:string;candidate:WasabiMatchObject&{score:number}}> = [];const ambiguous:Array<{referenceId:string;title:string;folder:string}> = [];const unmatched:Array<{referenceId:string;title:string;folder:string}> = [];
  for(const reference of eligible){const membership=reference.libraryIds.filter((id)=>branch.has(id)).sort((left,right)=>pathFor(right).split('/').length-pathFor(left).split('/').length)[0]||target.id;const itemFolder=pathFor(membership);const mapped=mapBibAttachment((reference.source as any)?.bibtex?.file,identity,root);const candidates=byFolder.get(wasabiPathIdentity(mapped?.directories.join('/')||itemFolder))||[];const scored=candidates.flatMap((object)=>{const value=scoreWasabiMatch({title:reference.title,contributors:reference.contributors as any,year:(reference.issued as any)?.year},object,mapped?.filename);return value?[value]:[];});const choice=chooseConfidentWasabiMatch(scored);if(choice.match){matches.push({referenceId:reference.id,title:reference.title,folder:itemFolder,candidate:choice.match});const index=candidates.findIndex((object)=>object.key===choice.match!.key);if(index>=0)candidates.splice(index,1);}else if(choice.ambiguous)ambiguous.push({referenceId:reference.id,title:reference.title,folder:itemFolder});else unmatched.push({referenceId:reference.id,title:reference.title,folder:itemFolder});}
  return Response.json({folder,prefix:prefixes[0]||`${root}/`,prefixes,total:branchReferences.length,eligible:eligible.length,alreadyLinked:branchReferences.length-eligible.length,objectsInspected:objects.length,truncated:objects.length>=MAX_OBJECTS,matches,ambiguous,unmatched});
};
