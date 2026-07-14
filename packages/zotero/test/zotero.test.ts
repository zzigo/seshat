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

test('preserves signed and BCE dates from Zotero', () => {
  const signed = structuredClone(rawBook); signed.data.date = '-0350'; signed.data.title = 'Physics';
  const item = mapZoteroItem({ item: signed, libraryType: 'users', libraryId: '42', importedAt: '2026-06-30T00:00:00Z' });
  assert.equal(item.issued?.year, -350);
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

test('verifies a key without putting the credential in the request URL', async () => {
  let requestUrl = ''; let requestHeaders = new Headers();
  const provider = new ZoteroProvider({
    libraryType: 'users', libraryId: '42', apiKey: 'server-secret',
    fetch: async (input, init) => {
      requestUrl = String(input); requestHeaders = new Headers(init?.headers);
      return Response.json({ userID: 42, username: 'researcher', access: { user: { library: true, write: true } } });
    },
  });
  const info = await provider.keyInfo();
  assert.equal(info.userID, 42);
  assert.equal(requestHeaders.get('Zotero-API-Key'), 'server-secret');
  assert.doesNotMatch(requestUrl, /server-secret/);
});

test('pages collection metadata with parent keys and library versions', async () => {
  const provider = new ZoteroProvider({
    libraryType: 'users', libraryId: '42',
    fetch: async () => Response.json([{ key: 'CHILD001', version: 8, data: { key: 'CHILD001', version: 8, name: 'Child', parentCollection: 'ROOT0001' } }], {
      headers: { 'Total-Results': '2', 'Last-Modified-Version': '21' },
    }),
  });
  const page = await provider.collectionPage(0, 1);
  assert.equal(page.objects[0].data.parentCollection, 'ROOT0001');
  assert.equal(page.nextStart, 1);
  assert.equal(page.libraryVersion, 21);
});

test('uses version guards for remote item updates', async () => {
  let method = ''; let headers = new Headers(); let body = '';
  const provider = new ZoteroProvider({
    libraryType: 'users', libraryId: '42',
    fetch: async (_input, init) => {
      method = String(init?.method || 'GET'); headers = new Headers(init?.headers); body = String(init?.body || '');
      return new Response(null, { status: 204, headers: { 'Last-Modified-Version': '33' } });
    },
  });
  const version = await provider.updateItem('ABCD1234', 7, { title: 'Revised' });
  assert.equal(version, 33);
  assert.equal(method, 'PATCH');
  assert.equal(headers.get('If-Unmodified-Since-Version'), '7');
  assert.deepEqual(JSON.parse(body), { title: 'Revised' });
});

test('checks library versions without downloading the library', async () => {
  let headers = new Headers(); let requestUrl = '';
  const provider = new ZoteroProvider({
    libraryType: 'users', libraryId: '42',
    fetch: async (input, init) => {
      requestUrl = String(input); headers = new Headers(init?.headers);
      return new Response(null, { status: 304 });
    },
  });
  const result = await provider.libraryChangedSince(97074);
  assert.deepEqual(result, { changed: false, libraryVersion: 97074 });
  assert.match(requestUrl, /items\/top\?format=json&limit=1$/);
  assert.equal(headers.get('If-Modified-Since-Version'), '97074');
});
