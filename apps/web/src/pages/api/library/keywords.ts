import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const list = (source: any): string[] => {
  const raw = source?.keywords ?? source?.bibtex?.keywords ?? [];
  const values = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]+/);
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, 200);
};
const context = (locals: App.Locals) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  return email ? { catalog:getCatalog(), ownerKey:ownerKeyFor(email) } : null;
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const value = context(locals); if (!value) return Response.json({ error:'authentication_required' }, { status:401 });
  const body = await request.json().catch(() => null) as { action?:unknown; keyword?:unknown; value?:unknown; color?:unknown } | null;
  const action = String(body?.action || ''); const keyword = String(body?.keyword || '').trim();
  if (!keyword) return Response.json({ error:'missing_keyword' }, { status:400 });
  await value.catalog.ensureSchema();
  if (action === 'color') {
    const color = String(body?.color || '').trim();
    if (!/^#[a-f0-9]{6}$/i.test(color)) return Response.json({ error:'invalid_color' }, { status:400 });
    await value.catalog.pool.query(`INSERT INTO catalog_keyword_styles(owner_key,keyword,color) VALUES($1,$2,$3)
      ON CONFLICT(owner_key,keyword) DO UPDATE SET color=excluded.color,updated_at=now()`, [value.ownerKey,keyword,color]);
    return Response.json({ ok:true, keyword, color });
  }
  if (!['rename','delete'].includes(action)) return Response.json({ error:'unsupported_action' }, { status:400 });
  const replacement = action === 'rename' ? String(body?.value || '').trim() : '';
  if (action === 'rename' && !replacement) return Response.json({ error:'missing_replacement' }, { status:400 });
  const rows = await value.catalog.pool.query('SELECT id,source FROM catalog_references WHERE owner_key=$1', [value.ownerKey]);
  for (const row of rows.rows) {
    const current = list(row.source); if (!current.includes(keyword)) continue;
    const next = [...new Set(current.flatMap((item) => item === keyword ? (replacement ? [replacement] : []) : [item]))];
    await value.catalog.pool.query(`UPDATE catalog_references SET source=jsonb_set(source,'{keywords}',$2::jsonb,true),updated_at=now() WHERE owner_key=$1 AND id=$3`, [value.ownerKey,JSON.stringify(next),row.id]);
  }
  if (action === 'rename') {
    await value.catalog.pool.query(`INSERT INTO catalog_keyword_styles(owner_key,keyword,color)
      SELECT owner_key,$3,color FROM catalog_keyword_styles WHERE owner_key=$1 AND keyword=$2
      ON CONFLICT(owner_key,keyword) DO UPDATE SET color=excluded.color,updated_at=now()`, [value.ownerKey,keyword,replacement]);
  }
  await value.catalog.pool.query('DELETE FROM catalog_keyword_styles WHERE owner_key=$1 AND keyword=$2', [value.ownerKey,keyword]);
  return Response.json({ ok:true, keyword, replacement:replacement || null });
};
