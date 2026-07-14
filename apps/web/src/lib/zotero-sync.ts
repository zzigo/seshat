import { createHash, randomUUID } from 'node:crypto';
import {
  mapZoteroItem,
  type ZoteroApiCollection,
  type ZoteroApiItem,
  type ZoteroItemData,
  type ZoteroProvider,
} from '@seshat/zotero';
import { parsePublicationYear } from '@seshat/core';
import { getCatalog } from './catalog';
import { getZoteroConnection, updateZoteroSyncState, zoteroProviderFor } from './zotero-connection';

export interface ZoteroSyncResult {
  mode: 'pull' | 'push' | 'bidirectional';
  remote: { collections: number; items: number; libraryVersion: number };
  pulled: { collections: number; items: number; merged: number };
  pushed: { collections: number; items: number };
  conflicts: Array<{ kind: 'collection' | 'item'; key: string; label: string }>;
  rootLibraryId: string;
}

const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableJson = (value: unknown): string => JSON.stringify(canonical(value));
const cleanObject = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const referenceHash = (value: Record<string, unknown>): string => createHash('sha256').update(stableJson(value)).digest('hex');
const sourceHash = (libraryId: string, key: string): string => createHash('sha256').update(`zotero\0${libraryId}\0${key}`).digest('hex');

const typeForZotero = (type: string): string => ({
  article: 'journalArticle', book: 'book', booklet: 'book', conference: 'conferencePaper',
  inbook: 'bookSection', incollection: 'bookSection', inproceedings: 'conferencePaper', manual: 'document',
  mastersthesis: 'thesis', phdthesis: 'thesis', proceedings: 'conferencePaper', techreport: 'report',
  unpublished: 'manuscript', audio: 'audioRecording', music: 'audioRecording', recording: 'audioRecording',
  performance: 'presentation', score: 'musicScore', misc: 'document',
}[type] || 'document');

const creatorType = (role: string, itemType: string): string => {
  if (role === 'editor' || role === 'translator') return role;
  if (role === 'composer' && ['audioRecording', 'musicScore'].includes(itemType)) return 'composer';
  if (role === 'performer' && itemType === 'audioRecording') return 'performer';
  return 'author';
};

const comparable = (row: any, collections: string[]): Record<string, unknown> => ({
  title: String(row.title || ''), type: String(row.type || 'misc'), contributors: row.contributors || [],
  issued: row.issued || null, identifiers: row.identifiers || {}, tags: row.tags || [],
  abstract: row.abstract || '', language: row.language || '', publisher: row.publisher || '',
  publisherPlace: row.publisher_place ?? row.publisherPlace ?? '', url: row.url || '',
  collections: [...collections].sort(),
});

const zoteroDataFor = (row: any, collections: string[], base: Record<string, unknown>): Record<string, unknown> => {
  const itemType = String(base.itemType || typeForZotero(String(row.type || 'misc')));
  const result: Record<string, unknown> = { itemType };
  const set = (key: string, value: unknown) => { if (key in base && value !== undefined) result[key] = value; };
  set('title', String(row.title || ''));
  set('creators', (row.contributors || []).map((person: any) => person.literal
    ? { creatorType: creatorType(person.role, itemType), name: person.literal }
    : { creatorType: creatorType(person.role, itemType), firstName: person.given || '', lastName: person.family || '' }));
  set('date', row.issued?.literal || (row.issued?.year ? String(row.issued.year) : ''));
  set('publisher', row.publisher || ''); set('place', row.publisher_place ?? row.publisherPlace ?? '');
  set('abstractNote', row.abstract || ''); set('language', row.language || ''); set('url', row.url || row.identifiers?.url || '');
  set('DOI', row.identifiers?.doi || ''); set('ISBN', (row.identifiers?.isbn || []).join(' ')); set('ISSN', (row.identifiers?.issn || []).join(' '));
  set('tags', (row.tags || []).map((tag: string) => ({ tag })));
  result.collections = [...collections];
  return result;
};

const fetchAll = async <T>(page: (start: number) => Promise<{ objects: T[]; total: number; libraryVersion?: number }>) => {
  const first = await page(0); const pages = Math.ceil(first.total / 100);
  const results = new Map<number, T[]>([[0, first.objects]]); const versions = new Set<number>();
  if (first.libraryVersion) versions.add(first.libraryVersion);
  const starts = Array.from({ length: Math.max(0, pages - 1) }, (_, index) => (index + 1) * 100);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, starts.length) }, async () => {
    while (cursor < starts.length) {
      const start = starts[cursor++]; const result = await page(start);
      results.set(start, result.objects); if (result.libraryVersion) versions.add(result.libraryVersion);
    }
  }));
  if (versions.size > 1) throw new Error('ZOTERO_CHANGED_DURING_SCAN');
  return {
    objects: [...results.entries()].sort(([left], [right]) => left - right).flatMap(([, objects]) => objects),
    libraryVersion: [...versions][0] || 0,
  };
};

const normalizedTitleYear = (title: unknown, issued: any): string => {
  const normalized = String(title || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const year = parsePublicationYear(issued?.year ?? issued?.literal) || 0;
  return normalized && year ? `${normalized}\0${year}` : '';
};

export const previewZoteroSync = async (ownerKey: string) => {
  const connection = await getZoteroConnection(ownerKey);
  if (!connection?.libraryId || !connection.syncMode) throw new Error('ZOTERO_NOT_CONNECTED');
  const provider = await zoteroProviderFor(ownerKey);
  const [collectionSnapshot, itemSnapshot, local, mapped] = await Promise.all([
    fetchAll((start) => provider.collectionPage(start, 100)),
    fetchAll((start) => provider.itemPage(start, 100, true)),
    getCatalog().pool.query('SELECT id,title,issued,identifiers FROM catalog_references WHERE owner_key=$1', [ownerKey]),
    getCatalog().pool.query('SELECT zotero_key,reference_id FROM catalog_zotero_items WHERE owner_key=$1', [ownerKey]),
  ]);
  const doi = new Map<string, Set<string>>(); const isbn = new Map<string, Set<string>>(); const titleYear = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => { if (!key) return; const ids = map.get(key) || new Set<string>(); ids.add(id); map.set(key, ids); };
  for (const row of local.rows) {
    add(doi, String(row.identifiers?.doi || '').toLowerCase(), row.id);
    for (const value of row.identifiers?.isbn || []) add(isbn, String(value).replace(/[^0-9X]/gi, '').toUpperCase(), row.id);
    add(titleYear, normalizedTitleYear(row.title, row.issued), row.id);
  }
  const mappedKeys = new Set(mapped.rows.map((row: any) => String(row.zotero_key)));
  const claimedReferences = new Set(mapped.rows.map((row: any) => String(row.reference_id)).filter(Boolean));
  let alreadyMapped = 0; let automaticMerges = 0; let possibleDuplicates = 0; let newItems = 0;
  let bibliographicItems = 0;
  for (const item of itemSnapshot.objects) {
    if (item.data.itemType === 'attachment' || item.data.itemType === 'note') continue;
    bibliographicItems += 1;
    if (mappedKeys.has(item.key)) { alreadyMapped += 1; continue; }
    const core = mapZoteroItem({ item, libraryType: 'users', libraryId: connection.libraryId, importedAt: new Date().toISOString() });
    const candidates = new Set<string>();
    const doiIds = doi.get(String(core.identifiers.doi || '').toLowerCase()); if (doiIds) doiIds.forEach((id) => candidates.add(id));
    for (const value of core.identifiers.isbn || []) isbn.get(String(value).replace(/[^0-9X]/gi, '').toUpperCase())?.forEach((id) => candidates.add(id));
    if (candidates.size === 1) {
      const candidate = [...candidates][0];
      if (claimedReferences.has(candidate)) possibleDuplicates += 1;
      else { claimedReferences.add(candidate); automaticMerges += 1; }
      continue;
    }
    const titleCandidates = titleYear.get(normalizedTitleYear(core.title, core.issued));
    if (candidates.size > 1 || titleCandidates?.size) possibleDuplicates += 1;
    else newItems += 1;
  }
  return {
    remote: {
      collections: collectionSnapshot.objects.length, items: bibliographicItems,
      libraryVersion: Math.max(collectionSnapshot.libraryVersion, itemSnapshot.libraryVersion),
    },
    local: { items: local.rowCount || 0, mapped: alreadyMapped },
    changes: { automaticMerges, possibleDuplicates, newItems },
    plan: {
      root: 'Zotero', mode: connection.syncMode, analyzeAutomatically: connection.analyzeAutomatically,
      destructiveDeletes: false, binaryStorage: 'Wasabi',
    },
  };
};

const ensureZoteroRoot = async (ownerKey: string): Promise<string> => {
  const catalog = getCatalog(); const root = await catalog.ensureLibraryPath(ownerKey, ['Zotero']);
  if (!root) throw new Error('ZOTERO_ROOT_CREATE_FAILED');
  await catalog.pool.query(
    `UPDATE catalog_libraries SET description='Metafolder synchronized with Zotero Web API; binary originals remain in Wasabi.'
     WHERE id=$1 AND owner_key=$2`, [root.id, ownerKey],
  );
  return root.id;
};

const collectionMappings = async (ownerKey: string) => {
  const result = await getCatalog().pool.query('SELECT * FROM catalog_zotero_collections WHERE owner_key=$1', [ownerKey]);
  return new Map(result.rows.map((row: any) => [String(row.zotero_key), row]));
};

const mirrorCollections = async (
  ownerKey: string,
  rootLibraryId: string,
  collections: ZoteroApiCollection[],
): Promise<{ byKey: Map<string, any>; count: number }> => {
  const catalog = getCatalog(); const client = await catalog.pool.connect(); const byKey = await collectionMappings(ownerKey);
  const pending = new Map(collections.map((collection) => [collection.key, collection])); let count = 0;
  try {
    await client.query('BEGIN');
    while (pending.size) {
      let progressed = false;
      for (const [key, collection] of [...pending]) {
        const parentKey = collection.data.parentCollection || null;
        if (parentKey && pending.has(String(parentKey))) continue;
        const parentId = parentKey ? byKey.get(String(parentKey))?.library_id : rootLibraryId;
        if (!parentId) continue;
        let libraryId = byKey.get(key)?.library_id;
        if (libraryId) {
          await client.query('UPDATE catalog_libraries SET name=$3,parent_id=$4 WHERE id=$1 AND owner_key=$2',
            [libraryId, ownerKey, collection.data.name.slice(0, 160), parentId]);
        } else {
          const existing = await client.query(
            'SELECT id FROM catalog_libraries WHERE owner_key=$1 AND parent_id=$2 AND lower(name)=lower($3) LIMIT 1',
            [ownerKey, parentId, collection.data.name.slice(0, 160)],
          );
          libraryId = existing.rows[0]?.id || randomUUID();
          if (!existing.rows[0]) await client.query(
            'INSERT INTO catalog_libraries(id,owner_key,name,parent_id) VALUES($1,$2,$3,$4)',
            [libraryId, ownerKey, collection.data.name.slice(0, 160), parentId],
          );
        }
        const row = {
          zotero_key: key, library_id: libraryId, version: Number(collection.version ?? collection.data.version ?? 0),
          parent_zotero_key: parentKey, name: collection.data.name,
        };
        await client.query(
          `INSERT INTO catalog_zotero_collections(owner_key,zotero_key,library_id,version,parent_zotero_key,name,synced_at)
           VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(owner_key,zotero_key) DO UPDATE SET
             library_id=excluded.library_id,version=excluded.version,parent_zotero_key=excluded.parent_zotero_key,
             name=excluded.name,synced_at=now()`,
          [ownerKey, key, libraryId, row.version, parentKey, collection.data.name],
        );
        byKey.set(key, row); pending.delete(key); count += 1; progressed = true;
      }
      if (!progressed) throw new Error(`ZOTERO_COLLECTION_TREE_INVALID:${[...pending.keys()].slice(0, 5).join(',')}`);
    }
    await client.query('COMMIT'); return { byKey, count };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
};

const pullItems = async (input: {
  ownerKey: string; rootLibraryId: string; libraryId: string; items: ZoteroApiItem[];
  collectionMap: Map<string, any>; analyzeAutomatically: boolean; skip: Set<string>;
  conflicts: ZoteroSyncResult['conflicts'];
}): Promise<{ count: number; merged: number }> => {
  const catalog = getCatalog(); const client = await catalog.pool.connect(); let count = 0; let merged = 0;
  const [localRows, mappedRows] = await Promise.all([
    catalog.pool.query('SELECT id,title,issued,identifiers FROM catalog_references WHERE owner_key=$1', [input.ownerKey]),
    catalog.pool.query(
      `SELECT zi.zotero_key,r.id FROM catalog_zotero_items zi LEFT JOIN catalog_references r ON r.id=zi.reference_id
       WHERE zi.owner_key=$1`, [input.ownerKey],
    ),
  ]);
  const mappedReferences = new Map(mappedRows.rows.map((row: any) => [String(row.zotero_key), row.id as string | undefined]));
  const zoteroKeyByReference = new Map(mappedRows.rows
    .filter((row: any) => row.id)
    .map((row: any) => [String(row.id), String(row.zotero_key)]));
  const doiIndex = new Map<string, Set<string>>(); const isbnIndex = new Map<string, Set<string>>(); const titleIndex = new Map<string, Set<string>>();
  const addIndex = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return; const ids = map.get(key) || new Set<string>(); ids.add(id); map.set(key, ids);
  };
  const indexReference = (id: string, title: unknown, issued: any, identifiers: any) => {
    addIndex(doiIndex, String(identifiers?.doi || '').toLowerCase(), id);
    for (const value of identifiers?.isbn || []) addIndex(isbnIndex, String(value).replace(/[^0-9X]/gi, '').toUpperCase(), id);
    addIndex(titleIndex, normalizedTitleYear(title, issued), id);
  };
  for (const row of localRows.rows) indexReference(row.id, row.title, row.issued, row.identifiers);
  try {
    await client.query('BEGIN');
    for (const item of input.items) {
      if (input.skip.has(item.key) || item.data.itemType === 'attachment' || item.data.itemType === 'note') continue;
      const mapped = mapZoteroItem({ item, libraryType: 'users', libraryId: input.libraryId, importedAt: new Date().toISOString() });
      const collectionKeys = [...new Set((item.data.collections || []).filter((key) => input.collectionMap.has(key)))];
      let referenceId = mappedReferences.get(item.key);
      let mergeCandidate = false;
      if (!referenceId) {
        const candidates = new Set<string>();
        doiIndex.get(String(mapped.identifiers.doi || '').toLowerCase())?.forEach((id) => candidates.add(id));
        for (const value of mapped.identifiers.isbn || []) isbnIndex.get(String(value).replace(/[^0-9X]/gi, '').toUpperCase())?.forEach((id) => candidates.add(id));
        if (candidates.size === 1) { referenceId = [...candidates][0]; mergeCandidate = true; }
        else if (candidates.size > 1) {
          input.conflicts.push({ kind: 'item', key: item.key, label: mapped.title || item.key }); continue;
        } else if (titleIndex.get(normalizedTitleYear(mapped.title, mapped.issued))?.size) {
          input.conflicts.push({ kind: 'item', key: item.key, label: mapped.title || item.key }); continue;
        }
      }
      const claimedBy = referenceId ? zoteroKeyByReference.get(referenceId) : undefined;
      if (claimedBy && claimedBy !== item.key) {
        input.conflicts.push({ kind: 'item', key: item.key, label: mapped.title || item.key });
        continue;
      }
      const source = cleanObject({ ...mapped.source, zoteroData: item.data });
      const identifiers = cleanObject(mapped.identifiers);
      if (referenceId) {
        await client.query(
          `UPDATE catalog_references SET cite_key=$3,type=$4,title=$5,contributors=$6::jsonb,issued=$7::jsonb,
             identifiers=$8::jsonb,tags=$9::text[],abstract=$10,language=$11,publisher=$12,publisher_place=$13,url=$14,
             source=source||$15::jsonb,updated_at=now() WHERE owner_key=$1 AND id=$2`,
          [input.ownerKey, referenceId, mapped.citeKey, mapped.type, mapped.title || 'Untitled reference', JSON.stringify(mapped.contributors),
            JSON.stringify(mapped.issued || null), JSON.stringify(identifiers), mapped.tags, mapped.abstract || null, mapped.language || null,
            mapped.publisher || null, mapped.publisherPlace || null, mapped.identifiers.url || null, JSON.stringify(source)],
        );
      } else {
        referenceId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO catalog_references
            (id,owner_key,cite_key,type,title,contributors,issued,identifiers,tags,abstract,language,publisher,publisher_place,url,source,original_sha256,created_at)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::text[],$10,$11,$12,$13,$14,$15::jsonb,$16,COALESCE($17::timestamptz,now()))
           ON CONFLICT(owner_key,original_sha256) DO UPDATE SET source=catalog_references.source||excluded.source,updated_at=now()
           RETURNING id`,
          [referenceId, input.ownerKey, mapped.citeKey, mapped.type, mapped.title || 'Untitled reference', JSON.stringify(mapped.contributors),
            JSON.stringify(mapped.issued || null), JSON.stringify(identifiers), mapped.tags, mapped.abstract || null, mapped.language || null,
            mapped.publisher || null, mapped.publisherPlace || null, mapped.identifiers.url || null, JSON.stringify(source),
            sourceHash(`users:${input.libraryId}`, item.key), mapped.createdAt],
        );
        referenceId = inserted.rows[0].id;
      }
      if (!referenceId) throw new Error(`ZOTERO_REFERENCE_UPSERT_FAILED:${item.key}`);
      await client.query(
        `DELETE FROM catalog_library_items li USING catalog_libraries l
         WHERE li.library_id=l.id AND li.reference_id=$2 AND l.owner_key=$1
           AND (l.id=$3 OR EXISTS(SELECT 1 FROM catalog_zotero_collections zc WHERE zc.owner_key=$1 AND zc.library_id=l.id))`,
        [input.ownerKey, referenceId, input.rootLibraryId],
      );
      const targetLibraries = collectionKeys.length
        ? collectionKeys.map((key) => input.collectionMap.get(key).library_id)
        : [input.rootLibraryId];
      for (const libraryId of targetLibraries) await client.query(
        'INSERT INTO catalog_library_items(library_id,reference_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [libraryId, referenceId],
      );
      await client.query('DELETE FROM catalog_library_items WHERE library_id=$1 AND reference_id=$2', [`inbox:${input.ownerKey}`, referenceId]);
      const hash = referenceHash(comparable({
        title: mapped.title, type: mapped.type, contributors: mapped.contributors, issued: mapped.issued,
        identifiers, tags: mapped.tags, abstract: mapped.abstract, language: mapped.language,
        publisher: mapped.publisher, publisherPlace: mapped.publisherPlace, url: mapped.identifiers.url,
      }, collectionKeys));
      await client.query(
        `INSERT INTO catalog_zotero_items(owner_key,zotero_key,reference_id,version,synced_hash,synced_at)
         VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(owner_key,zotero_key) DO UPDATE SET
           reference_id=excluded.reference_id,version=excluded.version,synced_hash=excluded.synced_hash,synced_at=now()`,
        [input.ownerKey, item.key, referenceId, Number(item.version ?? item.data.version ?? 0), hash],
      );
      mappedReferences.set(item.key, referenceId);
      zoteroKeyByReference.set(referenceId, item.key);
      indexReference(referenceId, mapped.title, mapped.issued, identifiers);
      if (input.analyzeAutomatically) {
        const artifact = await client.query('SELECT 1 FROM catalog_artifacts WHERE reference_id=$1 LIMIT 1', [referenceId]);
        if (artifact.rows[0]) {
          for (const [index, stage] of ['extract', 'scholarly', 'identify', 'summarize', 'relate'].entries()) await client.query(
            `INSERT INTO catalog_jobs(id,reference_id,stage,status,attempts,payload,created_at,updated_at)
             VALUES($1,$2,$3,$4,0,'{}'::jsonb,now(),now()) ON CONFLICT(reference_id,stage) DO NOTHING`,
            [`${referenceId}:${stage}`, referenceId, stage, index === 0 ? 'queued' : 'blocked'],
          );
        }
      }
      count += 1; if (mergeCandidate) merged += 1;
    }
    await client.query('COMMIT'); return { count, merged };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
};

const pushCollections = async (input: {
  ownerKey: string; rootLibraryId: string; provider: ZoteroProvider; remote: Map<string, ZoteroApiCollection>;
  conflicts: ZoteroSyncResult['conflicts'];
}): Promise<number> => {
  const catalog = getCatalog(); let pushed = 0;
  const tree = await catalog.pool.query(
    `WITH RECURSIVE branch AS (
       SELECT id,name,parent_id,0 depth FROM catalog_libraries WHERE id=$2 AND owner_key=$1
       UNION ALL SELECT l.id,l.name,l.parent_id,b.depth+1 FROM catalog_libraries l JOIN branch b ON l.parent_id=b.id WHERE l.owner_key=$1
     ) SELECT b.*,zc.zotero_key,zc.version,zc.parent_zotero_key,zc.name AS synced_name
       FROM branch b LEFT JOIN catalog_zotero_collections zc ON zc.owner_key=$1 AND zc.library_id=b.id
       WHERE b.id<>$2 ORDER BY b.depth,b.name`, [input.ownerKey, input.rootLibraryId],
  );
  const keyByLibrary = new Map<string, string>();
  for (const row of tree.rows) if (row.zotero_key) keyByLibrary.set(row.id, row.zotero_key);
  for (const row of tree.rows) {
    const parentKey = row.parent_id === input.rootLibraryId ? false : keyByLibrary.get(row.parent_id) || false;
    if (!row.zotero_key) {
      const created = await input.provider.createCollection({ name: row.name, parentCollection: parentKey });
      keyByLibrary.set(row.id, created.key);
      await catalog.pool.query(
        `INSERT INTO catalog_zotero_collections(owner_key,zotero_key,library_id,version,parent_zotero_key,name,synced_at)
         VALUES($1,$2,$3,$4,$5,$6,now())`,
        [input.ownerKey, created.key, row.id, Number(created.version ?? created.data.version ?? 0), parentKey || null, row.name],
      );
      input.remote.set(created.key, created); pushed += 1; continue;
    }
    const remote = input.remote.get(row.zotero_key);
    if (!remote) continue;
    const localChanged = row.name !== row.synced_name || (parentKey || null) !== (row.parent_zotero_key || null);
    const remoteVersion = Number(remote.version ?? remote.data.version ?? 0);
    if (!localChanged) continue;
    if (remoteVersion !== Number(row.version || 0)) {
      input.conflicts.push({ kind: 'collection', key: row.zotero_key, label: row.name }); continue;
    }
    const version = await input.provider.updateCollection(row.zotero_key, remoteVersion, { name: row.name, parentCollection: parentKey });
    remote.version = version; remote.data = { ...remote.data, version, name: row.name, parentCollection: parentKey };
    await catalog.pool.query(
      `UPDATE catalog_zotero_collections SET version=$3,parent_zotero_key=$4,name=$5,synced_at=now()
       WHERE owner_key=$1 AND zotero_key=$2`, [input.ownerKey, row.zotero_key, version, parentKey || null, row.name],
    );
    pushed += 1;
  }
  return pushed;
};

const pushItems = async (input: {
  ownerKey: string; rootLibraryId: string; provider: ZoteroProvider; remote: Map<string, ZoteroApiItem>;
  conflicts: ZoteroSyncResult['conflicts']; skipPull: Set<string>;
}): Promise<number> => {
  const catalog = getCatalog(); let pushed = 0;
  const rows = await catalog.pool.query(
    `SELECT r.*,zi.zotero_key,zi.version AS zotero_version,zi.synced_hash,
       COALESCE(array_agg(DISTINCT zc.zotero_key) FILTER(WHERE zc.zotero_key IS NOT NULL),'{}') AS zotero_collections
     FROM catalog_references r LEFT JOIN catalog_library_items li ON li.reference_id=r.id
     LEFT JOIN catalog_zotero_collections zc ON zc.owner_key=$1 AND zc.library_id=li.library_id
     LEFT JOIN catalog_zotero_items zi ON zi.owner_key=$1 AND zi.reference_id=r.id
     WHERE r.owner_key=$1 AND (zi.zotero_key IS NOT NULL OR li.library_id=$2 OR zc.zotero_key IS NOT NULL)
     GROUP BY r.id,zi.zotero_key,zi.version,zi.synced_hash ORDER BY r.updated_at`, [input.ownerKey, input.rootLibraryId],
  );
  const templates = new Map<string, Record<string, unknown>>();
  for (const row of rows.rows) {
    const collections = (row.zotero_collections || []).filter(Boolean);
    const hash = referenceHash(comparable(row, collections));
    if (row.zotero_key) {
      if (hash === row.synced_hash) continue;
      const remote = input.remote.get(row.zotero_key);
      if (!remote) { input.conflicts.push({ kind: 'item', key: row.zotero_key, label: row.title }); input.skipPull.add(row.zotero_key); continue; }
      const remoteVersion = Number(remote.version ?? remote.data.version ?? 0);
      if (remoteVersion !== Number(row.zotero_version || 0)) {
        input.conflicts.push({ kind: 'item', key: row.zotero_key, label: row.title }); input.skipPull.add(row.zotero_key); continue;
      }
      const patch = zoteroDataFor(row, collections, remote.data as unknown as Record<string, unknown>);
      delete patch.itemType;
      const version = await input.provider.updateItem(row.zotero_key, remoteVersion, patch);
      remote.version = version; remote.data = { ...remote.data, ...patch, version } as ZoteroItemData;
      await catalog.pool.query(
        `UPDATE catalog_zotero_items SET version=$3,synced_hash=$4,synced_at=now()
         WHERE owner_key=$1 AND zotero_key=$2`, [input.ownerKey, row.zotero_key, version, hash],
      );
      pushed += 1; continue;
    }
    const itemType = typeForZotero(row.type);
    let template = templates.get(itemType);
    if (!template) { template = await input.provider.itemTemplate(itemType); templates.set(itemType, template); }
    const created = await input.provider.createItem(zoteroDataFor(row, collections, template));
    const key = created.key; const version = Number(created.version ?? created.data.version ?? 0);
    await catalog.pool.query(
      `INSERT INTO catalog_zotero_items(owner_key,zotero_key,reference_id,version,synced_hash,synced_at)
       VALUES($1,$2,$3,$4,$5,now())`, [input.ownerKey, key, row.id, version, hash],
    );
    input.remote.set(key, created); pushed += 1;
  }
  return pushed;
};

export const runZoteroSync = async (ownerKey: string, confirmedLibraryVersion?: number): Promise<ZoteroSyncResult> => {
  const catalog = getCatalog(); const lockClient = await catalog.pool.connect(); const lockName = `seshat:zotero:${ownerKey}`;
  const locked = await lockClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockName]);
  if (!locked.rows[0]?.locked) { lockClient.release(); throw new Error('ZOTERO_SYNC_IN_PROGRESS'); }
  try {
    const connection = await getZoteroConnection(ownerKey);
    if (!connection?.libraryId || !connection.syncMode) throw new Error('ZOTERO_NOT_CONNECTED');
    const provider = await zoteroProviderFor(ownerKey);
    const [collectionSnapshot, itemSnapshot] = await Promise.all([
      fetchAll((start) => provider.collectionPage(start, 100)),
      fetchAll((start) => provider.itemPage(start, 100, true)),
    ]);
    const bibliographicItems = itemSnapshot.objects.filter((item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note');
    const libraryVersion = Math.max(collectionSnapshot.libraryVersion, itemSnapshot.libraryVersion);
    if (confirmedLibraryVersion !== undefined && (!Number.isFinite(confirmedLibraryVersion) || confirmedLibraryVersion !== libraryVersion)) {
      throw new Error(`ZOTERO_PREVIEW_STALE:${libraryVersion}`);
    }
    const rootLibraryId = await ensureZoteroRoot(ownerKey);
    const conflicts: ZoteroSyncResult['conflicts'] = []; const skipPull = new Set<string>();
    const result: ZoteroSyncResult = {
      mode: connection.syncMode,
      remote: { collections: collectionSnapshot.objects.length, items: bibliographicItems.length, libraryVersion },
      pulled: { collections: 0, items: 0, merged: 0 }, pushed: { collections: 0, items: 0 },
      conflicts, rootLibraryId,
    };
    const remoteCollections = new Map(collectionSnapshot.objects.map((item) => [item.key, item]));
    const remoteItems = new Map(bibliographicItems.map((item) => [item.key, item]));
    if (connection.syncMode === 'push' || connection.syncMode === 'bidirectional') {
      result.pushed.collections = await pushCollections({ ownerKey, rootLibraryId, provider, remote: remoteCollections, conflicts });
      result.pushed.items = await pushItems({ ownerKey, rootLibraryId, provider, remote: remoteItems, conflicts, skipPull });
    }
    if (connection.syncMode === 'pull' || connection.syncMode === 'bidirectional') {
      const mirrored = await mirrorCollections(ownerKey, rootLibraryId, [...remoteCollections.values()]);
      result.pulled.collections = mirrored.count;
      const pulled = await pullItems({
        ownerKey, rootLibraryId, libraryId: connection.libraryId,
        items: [...remoteItems.values()], collectionMap: mirrored.byKey,
        analyzeAutomatically: connection.analyzeAutomatically !== false, skip: skipPull, conflicts,
      });
      result.pulled.items = pulled.count; result.pulled.merged = pulled.merged;
    }
    const finalVersion = Math.max(libraryVersion,
      ...[...remoteCollections.values()].map((item) => Number(item.version ?? item.data.version ?? 0)),
      ...[...remoteItems.values()].map((item) => Number(item.version ?? item.data.version ?? 0)));
    await updateZoteroSyncState(ownerKey, { libraryVersion: finalVersion, error: null });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_SYNC_FAILED';
    await updateZoteroSyncState(ownerKey, { error: message }).catch(() => undefined);
    throw error;
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]).catch(() => undefined);
    lockClient.release();
  }
};
