import type {
  BibliographyPage,
  BibliographyProvider,
  BibliographyQuery,
  BibliographicItem,
} from '@seshat/core';
import { mapZoteroItem } from './map.js';
import type { ZoteroApiItem, ZoteroProviderOptions } from './types.js';

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

  private async request(path: string, params?: URLSearchParams): Promise<Response> {
    const url = `${this.libraryPath()}${path}${params?.size ? `?${params}` : ''}`;
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new ZoteroApiError(`Zotero request failed with ${response.status}.`, response.status, body.slice(0, 500));
    }
    return response;
  }

  private async children(itemKey: string): Promise<ZoteroApiItem[]> {
    if (!this.options.includeAttachments) return [];
    const response = await this.request(`/items/${encodeURIComponent(itemKey)}/children`, new URLSearchParams({
      format: 'json',
      itemType: 'attachment',
      limit: '100',
    }));
    if (response.status === 404) return [];
    return response.json() as Promise<ZoteroApiItem[]>;
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

