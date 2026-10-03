import type {
  BibliographyPage,
  BibliographyProvider,
  BibliographyQuery,
  BibliographicItem,
} from '@seshat/core';
import { mapZoteroItem } from './map.js';
import type {
  ZoteroApiCollection,
  ZoteroApiItem,
  ZoteroKeyInfo,
  ZoteroLibraryChange,
  ZoteroObjectPage,
  ZoteroProviderOptions,
} from './types.js';

export class ZoteroApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'ZoteroApiError';
  }
}

export class ZoteroProvider implements BibliographyProvider {
  readonly name = 'zotero';
  private readonly fetcher: typeof globalThis.fetch;
  private readonly apiBaseUrl: string;
  private readonly now: () => string;

  constructor(private readonly options: ZoteroProviderOptions) {
    this.fetcher = options.fetch || globalThis.fetch;
    this.apiBaseUrl = (options.apiBaseUrl || 'https://api.zotero.org').replace(/\/$/, '');
    this.now = options.now || (() => new Date().toISOString());
  }

  private libraryPath(): string {
    return `${this.apiBaseUrl}/${this.options.libraryType}/${encodeURIComponent(this.options.libraryId)}`;
  }

  private headers(): HeadersInit {
    return {
      Accept: 'application/json',
      'Zotero-API-Version': '3',
      ...(this.options.apiKey ? { 'Zotero-API-Key': this.options.apiKey } : {}),
    };
  }

  private async request(path: string, params?: URLSearchParams, init: RequestInit = {}): Promise<Response> {
    const url = `${this.libraryPath()}${path}${params?.size ? `?${params}` : ''}`;
    const response = await this.fetcher(url, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new ZoteroApiError(`Zotero request failed with ${response.status}.`, response.status, body.slice(0, 500));
    }
    return response;
  }

  async keyInfo(): Promise<ZoteroKeyInfo> {
    const response = await this.fetcher(`${this.apiBaseUrl}/keys/current`, { headers: this.headers() });
    if (!response.ok) {
      const body = await response.text();
      throw new ZoteroApiError(`Zotero key verification failed with ${response.status}.`, response.status, body.slice(0, 500));
    }
    return response.json() as Promise<ZoteroKeyInfo>;
  }

  async itemTemplate(itemType: string): Promise<Record<string, unknown>> {
    const url = new URL(`${this.apiBaseUrl}/items/new`);
    url.searchParams.set('itemType', itemType);
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) {
      const body = await response.text();
      throw new ZoteroApiError(`Zotero item template failed with ${response.status}.`, response.status, body.slice(0, 500));
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  private async objectPage<T>(path: string, start = 0, limit = 100, params?: Record<string, string>): Promise<ZoteroObjectPage<T>> {
    const searchParams = new URLSearchParams({
      format: 'json', start: String(Math.max(0, start)), limit: String(Math.min(100, Math.max(1, limit))),
      sort: 'dateModified', direction: 'asc',
      ...(params || {}),
    });
    const response = await this.request(path, searchParams);
    const objects = await response.json() as T[];
    const total = Number(response.headers.get('Total-Results') || objects.length);
    const nextStart = start + objects.length;
    return {
      objects,
      total,
      nextStart: nextStart < total ? nextStart : undefined,
      libraryVersion: Number(response.headers.get('Last-Modified-Version')) || undefined,
    };
  }

  collectionPage(start = 0, limit = 100): Promise<ZoteroObjectPage<ZoteroApiCollection>> {
    return this.objectPage('/collections', start, limit);
  }

  itemPage(start = 0, limit = 100, topOnly = true): Promise<ZoteroObjectPage<ZoteroApiItem>> {
    return this.objectPage(topOnly ? '/items/top' : '/items', start, limit);
  }

  annotationPage(start = 0, limit = 100, sinceVersion?: number): Promise<ZoteroObjectPage<ZoteroApiItem>> {
    const params: Record<string, string> = { itemType: 'annotation' };
    if (sinceVersion) params.since = String(sinceVersion);
    return this.objectPage('/items', start, limit, params);
  }

  notePage(start = 0, limit = 100, sinceVersion?: number): Promise<ZoteroObjectPage<ZoteroApiItem>> {
    const params: Record<string, string> = { itemType: 'note' };
    if (sinceVersion) params.since = String(sinceVersion);
    return this.objectPage('/items', start, limit, params);
  }

  attachmentPage(start = 0, limit = 100): Promise<ZoteroObjectPage<ZoteroApiItem>> {
    return this.objectPage('/items', start, limit, { itemType: 'attachment' });
  }

  async itemsByKeys(keys: string[]): Promise<ZoteroApiItem[]> {
    if (!keys.length) return [];
    const results: ZoteroApiItem[] = [];
    const unique = [...new Set(keys.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      const response = await this.request('/items', new URLSearchParams({
        format: 'json', itemKey: chunk.join(','),
      }));
      const items = await response.json() as ZoteroApiItem[];
      results.push(...items);
    }
    return results;
  }

  async deleteItem(key: string, version?: number): Promise<void> {
    const headers: HeadersInit = {};
    if (version !== undefined) headers['If-Unmodified-Since-Version'] = String(version);
    await this.request(`/items/${encodeURIComponent(key)}`, undefined, {
      method: 'DELETE',
      headers,
    });
  }

  async libraryChangedSince(libraryVersion: number): Promise<ZoteroLibraryChange> {
    const version = Math.max(0, Math.floor(libraryVersion || 0));
    const response = await this.fetcher(`${this.libraryPath()}/items/top?format=json&limit=1`, {
      headers: { ...this.headers(), 'If-Modified-Since-Version': String(version) },
    });
    if (response.status === 304) return { changed: false, libraryVersion: version };
    if (!response.ok) {
      const body = await response.text();
      throw new ZoteroApiError(`Zotero version check failed with ${response.status}.`, response.status, body.slice(0, 500));
    }
    return {
      changed: true,
      libraryVersion: Number(response.headers.get('Last-Modified-Version')) || version,
    };
  }

  async createCollection(data: { name: string; parentCollection?: string | false }): Promise<ZoteroApiCollection> {
    const response = await this.request('/collections', undefined, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': crypto.randomUUID().replaceAll('-', '') }, body: JSON.stringify([data]),
    });
    const result = await response.json() as { successful?: Record<string, ZoteroApiCollection | string>; failed?: Record<string, unknown> };
    const saved = Object.values(result.successful || {})[0];
    if (!saved) throw new ZoteroApiError('Zotero did not create the collection.', response.status, JSON.stringify(result.failed || {}).slice(0, 500));
    if (typeof saved !== 'string') return saved;
    const version = Number(response.headers.get('Last-Modified-Version')) || 0;
    return { key: saved, version, data: { key: saved, version, name: data.name, parentCollection: data.parentCollection || false } };
  }

  async updateCollection(key: string, version: number, data: { name: string; parentCollection?: string | false }): Promise<number> {
    const response = await this.request(`/collections/${encodeURIComponent(key)}`, undefined, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Unmodified-Since-Version': String(version) },
      body: JSON.stringify({ key, version, ...data }),
    });
    return Number(response.headers.get('Last-Modified-Version')) || version;
  }

  async createItem(data: Record<string, unknown>): Promise<ZoteroApiItem> {
    const response = await this.request('/items', undefined, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': crypto.randomUUID().replaceAll('-', '') }, body: JSON.stringify([data]),
    });
    const result = await response.json() as { successful?: Record<string, ZoteroApiItem | string>; failed?: Record<string, unknown> };
    const saved = Object.values(result.successful || {})[0];
    if (!saved) throw new ZoteroApiError('Zotero did not create the item.', response.status, JSON.stringify(result.failed || {}).slice(0, 500));
    if (typeof saved !== 'string') return saved;
    const version = Number(response.headers.get('Last-Modified-Version')) || 0;
    return { key: saved, version, data: { key: saved, version, ...data } } as ZoteroApiItem;
  }

  async updateItem(key: string, version: number, data: Record<string, unknown>): Promise<number> {
    const response = await this.request(`/items/${encodeURIComponent(key)}`, undefined, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Unmodified-Since-Version': String(version) },
      body: JSON.stringify(data),
    });
    return Number(response.headers.get('Last-Modified-Version')) || version;
  }

  async itemChildren(itemKey: string, itemType = 'attachment'): Promise<ZoteroApiItem[]> {
    const params = new URLSearchParams({ format: 'json', limit: '100' });
    if (itemType) params.set('itemType', itemType);
    const response = await this.request(`/items/${encodeURIComponent(itemKey)}/children`, params);
    if (response.status === 404) return [];
    return response.json() as Promise<ZoteroApiItem[]>;
  }

  private async children(itemKey: string): Promise<ZoteroApiItem[]> {
    if (!this.options.includeAttachments) return [];
    return this.itemChildren(itemKey, 'attachment');
  }

  async list(query: BibliographyQuery = {}): Promise<BibliographyPage> {
    const collectionId = query.collectionId || this.options.collectionId;
    const path = collectionId
      ? `/collections/${encodeURIComponent(collectionId)}/items/top`
      : '/items/top';
    const start = Number(query.cursor || 0);
    const limit = Math.min(Math.max(query.limit || 100, 1), 100);
    const params = new URLSearchParams({
      format: 'json',
      start: String(Number.isFinite(start) ? start : 0),
      limit: String(limit),
      sort: 'dateModified',
      direction: 'asc',
    });
    if (query.sinceVersion !== undefined) params.set('since', String(query.sinceVersion));

    const response = await this.request(path, params);
    const rawItems = await response.json() as ZoteroApiItem[];
    const importedAt = this.now();
    const attachments = await Promise.all(rawItems.map((item) => this.children(item.key)));
    const items = rawItems.map((item, index) => mapZoteroItem({
      item,
      libraryType: this.options.libraryType,
      libraryId: this.options.libraryId,
      importedAt,
      attachments: attachments[index],
    }));
    const total = Number(response.headers.get('Total-Results') || rawItems.length);
    const nextStart = start + rawItems.length;

    return {
      items,
      nextCursor: nextStart < total ? String(nextStart) : undefined,
      libraryVersion: Number(response.headers.get('Last-Modified-Version')) || undefined,
    };
  }

  async get(itemKey: string): Promise<BibliographicItem | null> {
    const response = await this.request(`/items/${encodeURIComponent(itemKey)}`, new URLSearchParams({ format: 'json' }));
    if (response.status === 404) return null;
    const item = await response.json() as ZoteroApiItem;
    return mapZoteroItem({
      item,
      libraryType: this.options.libraryType,
      libraryId: this.options.libraryId,
      importedAt: this.now(),
      attachments: await this.children(item.key),
    });
  }
}
