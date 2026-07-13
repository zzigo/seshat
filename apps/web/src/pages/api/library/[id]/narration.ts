import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { chirpAccessAllowed } from '../../../../lib/chirp-access';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';

const exec = promisify(execFile);
const safePart = (value: string, fallback: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
const offsetPart = (value: string | null) => Math.max(0, Math.min(999_999_999, Math.floor(Number(value) || 0)));

export const GET: APIRoute = async ({ request, locals, params, url }) => {
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();
  if(!email)return Response.json({error:'authentication_required'},{status:401});
  const provider=url.searchParams.get('provider')==='chirp'?'chirp':'kokoro';
  if(provider==='chirp'&&!chirpAccessAllowed(email))return Response.json({error:'chirp_access_denied'},{status:403});
  const reference=await getCatalog().get(ownerKeyFor(email),params.id||'');
  if(!reference)return Response.json({error:'not_found'},{status:404});
  const kind=provider==='chirp'?'chirp-audio':'kokoro-audio';
  const bucket=getWasabiBucket();
  const artifacts=reference.artifacts.filter((item)=>item.kind===kind&&item.bucket===bucket).sort((a,b)=>a.objectKey.localeCompare(b.objectKey));
  if(!artifacts.length)return Response.json({error:'narration_not_found'},{status:404});
  const segmentMetadata=(objectKey:string,index:number)=>{const name=objectKey.split('/').at(-1)||'';const match=name.match(/^(\d+)(?:-(\d+)-(\d+))?\.ogg$/);return{index:match?Number(match[1]):index,startOffset:match?.[2]?Number(match[2]):null,endOffset:match?.[3]?Number(match[3]):null};};
  if(url.searchParams.get('manifest')==='1')return Response.json({provider,segments:artifacts.map((artifact,index)=>({...segmentMetadata(artifact.objectKey,index),sizeBytes:artifact.sizeBytes,url:`/api/library/${encodeURIComponent(reference.id)}/narration?provider=${provider}&segment=${index}`}))},{headers:{'Cache-Control':'private, no-store'}});
  const requested=Math.max(0,Math.min(artifacts.length-1,Math.floor(Number(url.searchParams.get('segment')||0))));
  const artifact=artifacts[requested];
  const range=request.headers.get('range')||undefined;
  const object=await getWasabiClient().send(new GetObjectCommand({Bucket:bucket,Key:artifact.objectKey,Range:range}));
  if(!object.Body)return new Response('Not found',{status:404});
  const headers=new Headers({'Content-Type':object.ContentType||artifact.mimeType||'audio/ogg; codecs=opus','Cache-Control':'private, max-age=3600','Accept-Ranges':'bytes'});
  if(object.ContentLength!==undefined)headers.set('Content-Length',String(object.ContentLength));
  if(object.ContentRange)headers.set('Content-Range',object.ContentRange);
  return new Response(object.Body.transformToWebStream(),{status:range?206:200,headers});
};

export const POST: APIRoute = async ({ request, locals, params, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email); const catalog = getCatalog(); const reference = await catalog.get(ownerKey, params.id || '');
  if (!reference || reference.access !== 'owner') return Response.json({ error: 'not_found' }, { status: 404 });
  const voice = safePart(url.searchParams.get('voice') || '', 'voice');
  const language = safePart(url.searchParams.get('language') || reference.language || '', 'und');
  const provider = url.searchParams.get('provider') === 'chirp' ? 'chirp' : 'kokoro';
  if (provider === 'chirp' && !chirpAccessAllowed(email)) return Response.json({ error:'chirp_access_denied' }, { status:403 });
  const artifactKind = provider === 'chirp' ? 'chirp-audio' : 'kokoro-audio';
  const segment = Math.max(0, Math.min(9999, Number(url.searchParams.get('segment') || 0)));
  const startOffset=offsetPart(url.searchParams.get('startOffset'));const endOffset=Math.max(startOffset,offsetPart(url.searchParams.get('endOffset')));
  const input = new Uint8Array(await request.arrayBuffer());
  if (input.length < (provider === 'chirp' ? 16 : 44) || input.length > 32 * 1024 * 1024) return Response.json({ error: 'invalid_audio_segment' }, { status: 400 });
  const root = await mkdtemp(join(tmpdir(), 'seshat-narration-'));
  try {
    let bytes:Uint8Array = input;
    if (provider === 'kokoro') {
      const wav = join(root, 'input.wav'); const ogg = join(root, 'output.ogg'); await writeFile(wav, input);
      await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',wav,'-vn','-c:a','libopus','-b:a','40k','-vbr','on',ogg]);
      bytes = await readFile(ogg);
    } else if (!String(request.headers.get('content-type') || '').includes('audio/ogg')) {
      return Response.json({ error:'chirp_audio_must_be_ogg' }, { status:400 });
    }
    const bucket = getWasabiBucket();
    const storageRoot = String((reference.source as any)?.wasabiStorageRoot || `${process.env.WASABI_KEY_PREFIX || 'zzttuntref'}/seshat-derived/${ownerKey}`).replace(/\/+$/g, '');
    const offsets=endOffset>startOffset?`-${startOffset}-${endOffset}`:'';
    const objectKey = `${storageRoot}/.seshat/${reference.id}/narration/${provider}/${language}-${voice}/${String(segment).padStart(4,'0')}${offsets}.ogg`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await getWasabiClient().send(new PutObjectCommand({ Bucket:bucket,Key:objectKey,Body:bytes,ContentType:'audio/ogg; codecs=opus',CacheControl:'private, no-store' }));
    await catalog.pool.query(
      `INSERT INTO catalog_artifacts (id,reference_id,kind,provider,object_key,bucket,mime_type,size_bytes,sha256,etag)
       VALUES($1,$2,$3,'wasabi',$4,$5,'audio/ogg; codecs=opus',$6,$7,$8)
       ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes,sha256=excluded.sha256,etag=excluded.etag,created_at=now()`,
      [randomUUID(),reference.id,artifactKind,objectKey,bucket,bytes.length,sha256,stored.ETag?.replaceAll('"','') || null],
    );
    return Response.json({ ok:true,segment,objectKey,sizeBytes:bytes.length });
  } catch (error) {
    console.error('[seshat:narration]', error);
    return Response.json({ error:'Narration segment could not be stored.' }, { status:502 });
  } finally { await rm(root,{recursive:true,force:true}); }
};

export const DELETE: APIRoute = async ({ locals, params, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error:'authentication_required' }, { status:401 });
  const ownerKey=ownerKeyFor(email);const catalog=getCatalog();const reference=await catalog.get(ownerKey,params.id||'');
  if(!reference||reference.access!=='owner')return Response.json({error:'not_found'},{status:404});
  const artifactKind=url.searchParams.get('provider')==='chirp'?'chirp-audio':'kokoro-audio';
  if(artifactKind==='chirp-audio'&&!chirpAccessAllowed(email))return Response.json({error:'chirp_access_denied'},{status:403});
  const bucket=getWasabiBucket();const artifacts=reference.artifacts.filter((item)=>item.kind===artifactKind&&item.bucket===bucket);
  for(let offset=0;offset<artifacts.length;offset+=1000){const batch=artifacts.slice(offset,offset+1000);const result=await getWasabiClient().send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Quiet:true,Objects:batch.map((item)=>({Key:item.objectKey}))}}));const failures=(result.Errors||[]).filter((error)=>!['NoSuchBucket','NoSuchKey','NotFound'].includes(String(error.Code||'')));if(failures.length)return Response.json({error:'Narration files could not be deleted.'},{status:502});}
  await catalog.pool.query(`DELETE FROM catalog_artifacts artifact USING catalog_references reference WHERE artifact.reference_id=reference.id AND reference.id=$1 AND reference.owner_key=$2 AND artifact.kind=$3`,[reference.id,ownerKey,artifactKind]);
  return Response.json({ok:true,deleted:artifacts.length});
};
