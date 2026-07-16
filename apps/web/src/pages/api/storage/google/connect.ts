import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../../lib/catalog';
import { createGoogleDriveState, googleDriveAuthorizationUrl, googleDriveConfigured } from '../../../../lib/google-drive';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const identity=sessionIdentity((locals as any).session);if(!identity.email)return Response.json({error:'authentication_required'},{status:401});
  if(!googleDriveConfigured())return Response.json({error:'google_drive_oauth_not_configured'},{status:503});
  const locale=url.searchParams.get('locale')==='es'?'es':'en';const root=String(url.searchParams.get('root')||'Seshat').trim().slice(0,100)||'Seshat';
  return redirect(googleDriveAuthorizationUrl(createGoogleDriveState(ownerKeyFor(identity.email),locale,root)));
};
