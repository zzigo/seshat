import { OpenAlexClient } from '@seshat/core';
import { getCatalog } from './catalog';

let client:OpenAlexClient|undefined;
export const getOpenAlexClient=()=>client??=new OpenAlexClient({baseUrl:process.env.OPENALEX_API_BASE_URL,mailto:process.env.OPENALEX_MAILTO,apiKey:process.env.OPENALEX_API_KEY,timeoutMs:Number(process.env.OPENALEX_TIMEOUT_MS||12000),retries:Number(process.env.OPENALEX_RETRIES||3),cacheTtlDays:Number(process.env.OPENALEX_CACHE_TTL_DAYS||30),cache:{get:(key)=>getCatalog().getOpenAlexCache(key),set:(key,value,expiresAt)=>getCatalog().setOpenAlexCache(key,value,expiresAt)}});
