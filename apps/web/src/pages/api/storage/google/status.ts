import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../../lib/catalog';
import { googleDriveStatus } from '../../../../lib/google-drive';
export const GET:APIRoute=async({locals})=>{const identity=sessionIdentity((locals as any).session);if(!identity.email)return Response.json({error:'authentication_required'},{status:401});return Response.json(await googleDriveStatus(ownerKeyFor(identity.email)));};
