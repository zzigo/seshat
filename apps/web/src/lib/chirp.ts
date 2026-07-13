export const CHIRP_PROVIDER = 'google-chirp-3-hd';
export const DEFAULT_CHIRP_LIMIT = 900_000;
export const DEFAULT_CHIRP_WARNING = 700_000;

export type ChirpVoice = { id:string; label:string; language:string };
export const CHIRP_VOICES:ChirpVoice[] = [
  { id:'es-ES-Chirp3-HD-Aoede', label:'Aoede · español · Google Chirp HD', language:'es' },
  { id:'es-ES-Chirp3-HD-Charon', label:'Charon · español · Google Chirp HD', language:'es' },
  { id:'es-ES-Chirp3-HD-Leda', label:'Leda · español · Google Chirp HD', language:'es' },
  { id:'en-US-Chirp3-HD-Aoede', label:'Aoede · English · Google Chirp HD', language:'en' },
  { id:'en-US-Chirp3-HD-Charon', label:'Charon · English · Google Chirp HD', language:'en' },
  { id:'en-US-Chirp3-HD-Leda', label:'Leda · English · Google Chirp HD', language:'en' },
];

export const billableCharacterCount = (text:string):number => Array.from(String(text || '')).length;
export const chirpMonth = (date=new Date()):string => date.toISOString().slice(0,7);
export const nextChirpRenewal = (date=new Date()):string => new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)).toISOString();
export const chirpVoice = (id:string):ChirpVoice|undefined => CHIRP_VOICES.find((voice)=>voice.id===id);
