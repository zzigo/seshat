import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

const sessionContext = async (locals: App.Locals, referenceId: string) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  const reference = await catalog.get(ownerKey, referenceId);
  return reference ? { catalog, ownerKey } : null;
};

export const GET: APIRoute = async ({ locals, params }) => {
  const context = await sessionContext(locals, params.id || '');
  if (!context) return Response.json({ error: 'not_found' }, { status: 404 });
  await context.catalog.ensureSchema();
  const result = await context.catalog.pool.query(
    'SELECT location,preferences,updated_at FROM catalog_reading_state WHERE owner_key=$1 AND reference_id=$2',
    [context.ownerKey, params.id],
  );
  const row = result.rows[0];
  return Response.json({
    location: row?.location || {}, preferences: row?.preferences || {},
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  });
};

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const context = await sessionContext(locals, params.id || '');
  if (!context) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { location?: unknown; preferences?: unknown } | null;
  const location = body?.location && typeof body.location === 'object' && !Array.isArray(body.location) ? body.location : {};
  const preferences = body?.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences) ? body.preferences : {};
  if (JSON.stringify(location).length > 4_000 || JSON.stringify(preferences).length > 4_000) {
    return Response.json({ error: 'reading_state_too_large' }, { status: 413 });
  }
  await context.catalog.ensureSchema();
  await context.catalog.pool.query(
    `INSERT INTO catalog_reading_state(owner_key,reference_id,location,preferences)
     VALUES($1,$2,$3::jsonb,$4::jsonb)
     ON CONFLICT(owner_key,reference_id) DO UPDATE SET
       location=excluded.location,preferences=excluded.preferences,updated_at=now()`,
    [context.ownerKey, params.id, JSON.stringify(location), JSON.stringify(preferences)],
  );
  return Response.json({ ok: true });
};

export const PATCH: APIRoute = async ({ locals, params }) => {
  const context = await sessionContext(locals, params.id || '');
  if (!context) return Response.json({ error: 'not_found' }, { status: 404 });
  await context.catalog.ensureSchema();
  await context.catalog.pool.query(
    `INSERT INTO catalog_reading_state(owner_key,reference_id) VALUES($1,$2)
     ON CONFLICT(owner_key,reference_id) DO UPDATE SET updated_at=now()`,
    [context.ownerKey, params.id],
  );
  return Response.json({ ok: true });
};
