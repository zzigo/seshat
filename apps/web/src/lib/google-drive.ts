import { createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCatalog } from './catalog';

const clientId = () => String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = () => String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
const baseUrl = () => String(process.env.AUTH_URL || process.env.SITE_URL || 'http://localhost:4331').replace(/\/$/, '');
export const googleDriveConfigured = () => Boolean(clientId() && clientSecret() && process.env.AUTH_SECRET);
export const googleDriveCallbackUrl = () => `${baseUrl()}/api/storage/google/callback`;

const secret = () => {
  const value=String(process.env.STORAGE_CREDENTIAL_SECRET || process.env.AUTH_SECRET || '');
  if(value.length<24) throw new Error('STORAGE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
  return value;
};
const encrypt = (value:string) => { const iv=randomBytes(12);const key=createHash('sha256').update(`seshat:storage:v1\0${secret()}`).digest();const cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),body.toString('base64url')].join('.'); };

export const createGoogleDriveState = (ownerKey:string, locale:string, rootName:string) => {
  const payload=Buffer.from(JSON.stringify({ownerKey,locale:locale==='es'?'es':'en',rootName:rootName.slice(0,100),expires:Date.now()+10*60_000})).toString('base64url');
  const signature=createHmac('sha256',secret()).update(payload).digest('base64url');return `${payload}.${signature}`;
};
export const readGoogleDriveState = (state:string) => { const [payload,signature]=state.split('.');if(!payload||!signature)throw new Error('INVALID_OAUTH_STATE');const expected=createHmac('sha256',secret()).update(payload).digest();const received=Buffer.from(signature,'base64url');if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error('INVALID_OAUTH_STATE');const result=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(Number(result.expires)<Date.now())throw new Error('EXPIRED_OAUTH_STATE');return result as {ownerKey:string;locale:'en'|'es';rootName:string}; };

export const googleDriveAuthorizationUrl = (state:string) => { const params=new URLSearchParams({client_id:clientId(),redirect_uri:googleDriveCallbackUrl(),response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent',include_granted_scopes:'true',state});return `https://accounts.google.com/o/oauth2/v2/auth?${params}`; };

export const finishGoogleDriveConnection = async (ownerKey:string, code:string, rootName:string) => {
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId(),client_secret:clientSecret(),code,grant_type:'authorization_code',redirect_uri:googleDriveCallbackUrl()})});
  const token=await tokenResponse.json().catch(()=>({})) as any;if(!tokenResponse.ok||!token.access_token)throw new Error(String(token.error_description||token.error||'GOOGLE_TOKEN_EXCHANGE_FAILED'));
  const headers={authorization:`Bearer ${token.access_token}`};
  const userResponse=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers});const user=await userResponse.json().catch(()=>({})) as any;
  const escaped=rootName.replace(/['\\]/g,' ');const search=new URL('https://www.googleapis.com/drive/v3/files');search.searchParams.set('q',`name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);search.searchParams.set('fields','files(id,name)');
  const foundResponse=await fetch(search,{headers});const found=await foundResponse.json().catch(()=>({files:[]})) as any;
  let folder=found.files?.[0];if(!folder){const createResponse=await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({name:rootName,mimeType:'application/vnd.google-apps.folder'})});folder=await createResponse.json().catch(()=>({}));if(!createResponse.ok||!folder.id)throw new Error('GOOGLE_DRIVE_FOLDER_CREATE_FAILED');}
  const catalog=getCatalog();await catalog.ensureSchema();await catalog.pool.query(
    `INSERT INTO catalog_storage_connections(owner_key,provider,account_label,credential_ciphertext,root_id,root_name,status,last_error)
     VALUES($1,'google-drive',$2,$3,$4,$5,'connected',NULL)
     ON CONFLICT(owner_key,provider) DO UPDATE SET account_label=excluded.account_label,credential_ciphertext=excluded.credential_ciphertext,
       root_id=excluded.root_id,root_name=excluded.root_name,status='connected',last_error=NULL,updated_at=now()`,
    [ownerKey,String(user.email||''),encrypt(JSON.stringify({refreshToken:token.refresh_token,accessToken:token.access_token,expiresIn:token.expires_in,obtainedAt:Date.now()})),String(folder.id),String(folder.name||rootName)],
  );
  await catalog.pool.query(`UPDATE catalog_user_accounts SET storage_provider='google-drive',storage_root_name=$2,updated_at=now() WHERE owner_key=$1`,[ownerKey,String(folder.name||rootName)]);
  return {account:String(user.email||''),rootId:String(folder.id),rootName:String(folder.name||rootName)};
};

export const googleDriveStatus = async (ownerKey:string) => { const catalog=getCatalog();await catalog.ensureSchema();const result=await catalog.pool.query(`SELECT account_label,root_id,root_name,status,last_error FROM catalog_storage_connections WHERE owner_key=$1 AND provider='google-drive'`,[ownerKey]);const row=result.rows[0];return row?{configured:googleDriveConfigured(),connected:row.status==='connected',account:row.account_label,rootId:row.root_id,rootName:row.root_name,error:row.last_error||undefined}:{configured:googleDriveConfigured(),connected:false}; };
