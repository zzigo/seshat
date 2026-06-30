import assert from 'node:assert/strict';
import test from 'node:test';
import { mapZoteroItem, ZoteroProvider } from '../src/index.js';

const rawBook = {
  key: 'ABCD1234',
  version: 7,
  data: {
    key: 'ABCD1234',
    version: 7,
    itemType: 'book',
    title: 'Ways of Listening',
    creators: [{ creatorType: 'author', firstName: 'Eric', lastName: 'Clarke' }],
    date: '2005',
    publisher: 'Oxford University Press',
    ISBN: '978-0-19-515194-7',
    extra: 'Citation Key: clarke2005ways',
    tags: [{ tag: 'listening' }],
    dateAdded: '2020-01-01T00:00:00Z',
    dateModified: '2026-01-01T00:00:00Z',
  },
};

test('maps Zotero data without leaking its schema into the core model', () => {
  const item = mapZoteroItem({
    item: rawBook,
    libraryType: 'users',
    libraryId: '42',
    importedAt: '2026-06-30T00:00:00Z',
  });
  assert.equal(item.id, 'zotero:users:42:ABCD1234');
  assert.equal(item.citeKey, 'clarke2005ways');
  assert.deepEqual(item.identifiers.isbn, ['9780195151947']);
  assert.equal(item.source.version, 7);
});

test('paginates a selected Zotero collection', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify([rawBook]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Total-Results': '2',
        'Last-Modified-Version': '17',
      },
    });
  };
  const provider = new ZoteroProvider({
    libraryType: 'users',
    libraryId: '42',
    apiKey: 'not-exposed',
    collectionId: 'MUSIKI',
    fetch: fetcher,
    now: () => '2026-06-30T00:00:00Z',
  });
  const page = await provider.list({ limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, '1');
  assert.equal(page.libraryVersion, 17);
  assert.match(calls[0], /collections\/MUSIKI\/items\/top/);
  assert.doesNotMatch(calls[0], /not-exposed/);
});

test('maps Zotero attachment children as source references', async () => {
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes('/children')) {
      return Response.json([{
        key: 'PDF00001',
        data: {
          key: 'PDF00001',
          itemType: 'attachment',
          parentItem: 'ABCD1234',
          contentType: 'application/pdf',
          filename: 'Clarke2005.pdf',
          linkMode: 'imported_file',
        },
        links: { enclosure: { href: 'https://api.zotero.org/file/PDF00001' } },
      }]);
    }
    return Response.json(rawBook);
  };
  const provider = new ZoteroProvider({
    libraryType: 'users',
    libraryId: '42',
    includeAttachments: true,
    fetch: fetcher,
    now: () => '2026-06-30T00:00:00Z',
  });
  const item = await provider.get('ABCD1234');
  assert.equal(item?.artifacts[0].storage.provider, 'zotero');
  assert.equal(item?.artifacts[0].storage.objectKey, 'PDF00001');
});

