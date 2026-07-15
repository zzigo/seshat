export const CHIRP_PROVIDER = 'google-chirp-3-hd';
export const DEFAULT_CHIRP_LIMIT = 900_000;
export const DEFAULT_CHIRP_WARNING = 700_000;

export type ChirpVoice = { id:string; label:string; language:string; locale:string };
const CHIRP_STYLES = ['Aoede','Callirrhoe','Kore','Leda','Charon','Orus','Puck'] as const;
const CHIRP_LANGUAGES = [
  { language:'es', locale:'es-ES', label:'Español' },
  { language:'en', locale:'en-US', label:'English' },
  { language:'de', locale:'de-DE', label:'Deutsch' },
  { language:'nb', locale:'nb-NO', label:'Norsk bokmål' },
  { language:'fr', locale:'fr-FR', label:'Français' },
  { language:'it', locale:'it-IT', label:'Italiano' },
] as const;
export const CHIRP_VOICES:ChirpVoice[] = CHIRP_LANGUAGES.flatMap((language) => CHIRP_STYLES.map((style) => ({
  id:`${language.locale}-Chirp3-HD-${style}`,
  label:`${style} · ${language.label} · Google Chirp HD`,
  language:language.language,
  locale:language.locale,
})));

export const billableCharacterCount = (text:string):number => Array.from(String(text || '')).length;
export const chirpMonth = (date=new Date()):string => date.toISOString().slice(0,7);
export const nextChirpRenewal = (date=new Date()):string => new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)).toISOString();
export const chirpVoice = (id:string):ChirpVoice|undefined => CHIRP_VOICES.find((voice)=>voice.id===id);
export const chirpVoicesForLanguage = (value:string):ChirpVoice[] => {
  const normalized=String(value||'').trim().toLowerCase().replace('_','-');
  const language=normalized==='no'||normalized.startsWith('no-')||normalized==='nb'||normalized.startsWith('nb-')?'nb':normalized.split('-')[0];
  return CHIRP_VOICES.filter((voice)=>voice.language===language);
};
