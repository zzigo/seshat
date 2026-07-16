import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../../lib/catalog';
import { finishGoogleDriveConnection, readGoogleDriveState } from '../../../../lib/google-drive';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const identity=sessionIdentity((locals as any).session);if(!identity.email)return redirect(`/login?redirect=${encodeURIComponent(url.pathname+url.search)}`);
  try{const state=readGoogleDriveState(String(url.searchParams.get('state')||''));if(state.ownerKey!==ownerKeyFor(identity.email))throw new Error('OAUTH_ACCOUNT_MISMATCH');const code=String(url.searchParams.get('code')||'');if(!code)throw new Error(String(url.searchParams.get('error')||'GOOGLE_AUTHORIZATION_CANCELLED'));await finishGoogleDriveConnection(state.ownerKey,code,state.rootName);return redirect(`/${state.locale}/welcome?drive=connected#storage`);}catch(error){const message=error instanceof Error?error.message:'GOOGLE_DRIVE_CONNECTION_FAILED';return redirect(`/en/welcome?drive=${encodeURIComponent(message)}#storage`);}
};
