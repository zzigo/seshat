import textToSpeech from '@google-cloud/text-to-speech';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { billableCharacterCount, chirpMonth, chirpVoice, CHIRP_PROVIDER, CHIRP_VOICES, DEFAULT_CHIRP_LIMIT, DEFAULT_CHIRP_WARNING, nextChirpRenewal } from '../../../../lib/chirp';

let client:InstanceType<typeof textToSpeech.TextToSpeechClient>|undefined;
const limits=()=>({limit:Math.max(1,Number(process.env.GOOGLE_TTS_MONTHLY_CHARACTER_LIMIT||DEFAULT_CHIRP_LIMIT)),warning:Math.max(1,Number(process.env.GOOGLE_TTS_WARNING_CHARACTERS||DEFAULT_CHIRP_WARNING))});
const configured=()=>Boolean(process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_APPLICATION_CREDENTIALS);

export const GET:APIRoute=async({locals})=>{
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();if(!email)return Response.json({error:'authentication_required'},{status:401});
  const month=chirpMonth(),{limit,warning}=limits(),used=await getCatalog().getTtsUsage(CHIRP_PROVIDER,month);
  return Response.json({configured:configured(),provider:CHIRP_PROVIDER,month,used,remaining:Math.max(0,limit-used),limit,warning,renewsAt:nextChirpRenewal(),voices:CHIRP_VOICES},{headers:{'Cache-Control':'private, no-store'}});
};

export const POST:APIRoute=async({request,locals,params})=>{
  const email=String((locals.session as any)?.user?.email||'').trim().toLowerCase();if(!email)return Response.json({error:'authentication_required'},{status:401});
  if(!configured())return Response.json({error:'Google Chirp is not configured.'},{status:503});
  const ownerKey=ownerKeyFor(email),catalog=getCatalog(),reference=await catalog.get(ownerKey,params.id||'');if(!reference)return Response.json({error:'not_found'},{status:404});
  const body=await request.json().catch(()=>null),text=String(body?.text||'').trim(),voice=chirpVoice(String(body?.voice||''));
  if(!text||billableCharacterCount(text)>4500)return Response.json({error:'Text must contain between 1 and 4,500 characters.'},{status:400});
  if(!voice)return Response.json({error:'Unsupported Chirp voice.'},{status:400});
  const rate=Math.max(.5,Math.min(2,Number(body?.rate||1))),characters=billableCharacterCount(text),month=chirpMonth(),{limit,warning}=limits();
  const used=await catalog.reserveTtsCharacters(CHIRP_PROVIDER,month,characters,limit);
  if(used===null){const current=await catalog.getTtsUsage(CHIRP_PROVIDER,month);return Response.json({error:'Google Chirp monthly limit reached.',used:current,limit,remaining:Math.max(0,limit-current),renewsAt:nextChirpRenewal()},{status:429});}
  try{
    client ||= new textToSpeech.TextToSpeechClient({projectId:process.env.GOOGLE_CLOUD_PROJECT});
    const [result]=await client.synthesizeSpeech({input:{text},voice:{languageCode:voice.id.slice(0,5),name:voice.id},audioConfig:{audioEncoding:'OGG_OPUS',speakingRate:rate}});
    const content=typeof result.audioContent==='string'?Buffer.from(result.audioContent,'base64'):Buffer.from(result.audioContent||[]);
    if(!content.length)throw new Error('EMPTY_CHIRP_AUDIO');
    return new Response(content,{headers:{'Content-Type':'audio/ogg; codecs=opus','Cache-Control':'private, no-store','X-Seshat-TTS-Characters':String(characters),'X-Seshat-TTS-Used':String(used),'X-Seshat-TTS-Remaining':String(Math.max(0,limit-used)),'X-Seshat-TTS-Warning':String(used>=warning)}});
  }catch(error){await catalog.releaseTtsCharacters(CHIRP_PROVIDER,month,characters);console.error('[seshat:chirp]',error);return Response.json({error:'Google Chirp could not synthesize this text.'},{status:502});}
};
