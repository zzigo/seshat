import { PostgresCatalog } from '@seshat/catalog';
import { normalizeContributor } from '@seshat/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const apply = process.argv.includes('--apply');
const catalog = new PostgresCatalog(process.env.DATABASE_URL || '');
await catalog.ensureSchema();
const result = await catalog.pool.query('SELECT id, contributors FROM catalog_references ORDER BY id');
let recordsChanged = 0;
let namesStructured = 0;
const changes = [];

const safelyStructured = (person) => {
  if (!person?.literal || person.family || person.given) return person;
  const literal = String(person.literal).replace(/\s+/g, ' ').trim();
  const commaForm = /^[^,]+,\s*[^,]+$/.test(literal);
  const simpleForm = literal.split(' ').length === 2 && !/^(the|les|los|las)\b/i.test(literal);
  if (!commaForm && !simpleForm) return person;
  const normalized = normalizeContributor(literal, { inferSimpleNames: simpleForm, defaultRole: person.role || 'author' });
  if (!normalized || normalized.literal) return person;
  namesStructured += 1;
  return normalized;
};

for (const row of result.rows) {
  const before = Array.isArray(row.contributors) ? row.contributors : [];
  const after = before.map(safelyStructured);
  if (JSON.stringify(before) === JSON.stringify(after)) continue;
  recordsChanged += 1;
  changes.push({ id: row.id, before, after });
}

let backup = null;
if (apply && changes.length) {
  const directory = join(process.cwd(), 'var', 'migrations'); await mkdir(directory, { recursive: true });
  backup = join(directory, `contributors-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(backup, JSON.stringify(changes.map(({ id, before }) => ({ id, contributors: before })), null, 2), { mode: 0o600 });
  const client = await catalog.pool.connect();
  try {
    await client.query('BEGIN');
    for (const change of changes) await client.query('UPDATE catalog_references SET contributors=$2::jsonb, updated_at=now() WHERE id=$1', [change.id, JSON.stringify(change.after)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', recordsScanned: result.rowCount || 0, recordsChanged, namesStructured, backup }));
await catalog.pool.end();
