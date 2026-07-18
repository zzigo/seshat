import assert from 'node:assert/strict';
import test from 'node:test';
import { READER_VOICE_LONG_PRESS_MS } from '../src/lib/reader-controls';
import { findWasabiCandidates, linkWasabiCandidate, type WasabiCandidate } from '../src/lib/wasabi-candidate-ui';

test('the reader voice menu requires a deliberate two-second hold', () => {
  assert.equal(READER_VOICE_LONG_PRESS_MS, 2000);
});

test('mobile Wasabi actions preview candidates before linking the chosen object', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const candidate: WasabiCandidate = { key: 'library/book.pdf', filename: 'book.pdf', path: 'book.pdf', sizeBytes: 42, score: 91 };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => true } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json(init?.method === 'POST' ? { ok: true } : { candidates: [candidate] });
  }) as typeof fetch;
  try {
    const preview = await findWasabiCandidates('paper id');
    assert.equal(preview.candidates?.[0]?.key, candidate.key);
    await linkWasabiCandidate('paper id', candidate);
    assert.equal(requests[0]?.url, '/api/library/paper%20id/candidates');
    assert.equal(requests[0]?.init?.cache, 'no-store');
    assert.equal(requests[1]?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { key: candidate.key });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as typeof globalThis & { window?: unknown }).window;
  }
});
