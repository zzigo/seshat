export interface SeshatUserIdentity {
  email?: string;
  name?: string;
}

export interface BibliographyAttachmentPath {
  sourcePath: string;
  relativePath: string;
  directories: string[];
  filename: string;
  objectKey: string;
  storageRoot: string;
  privilegedRoot: boolean;
}

const cleanSegment = (value: string): string => value
  .normalize('NFC')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim();

const safeStorageSegment = (value: string): string => cleanSegment(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 100) || 'user';

const identityTokens = (identity: SeshatUserIdentity): string[] => {
  const email = String(identity.email || '').trim().toLowerCase();
  return [email, email.split('@')[0], String(identity.name || '').trim().toLowerCase()].filter(Boolean);
};

export const hasLibraryRoot = (identity: SeshatUserIdentity): boolean => {
  const configured = String(process.env.SESHAT_LIBRARY_ROOT_USERS || 'zztt,zzttuntref,lucianoazzigotti@gmail.com')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const tokens = identityTokens(identity);
  return tokens.some((token) => configured.includes(token));
};

export const storageRootFor = (identity: SeshatUserIdentity): { root: string; privileged: boolean } => {
  const prefix = String(process.env.WASABI_KEY_PREFIX || 'zzttuntref').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const privileged = hasLibraryRoot(identity);
  if (privileged) return { root: `${prefix}/libros`, privileged };
  const username = safeStorageSegment(String(identity.email || identity.name || '').split('@')[0]);
  return { root: `${prefix}/lseshat/${username}`, privileged };
};

export const extractBibAttachmentPath = (raw: unknown): string | null => {
  const value = (Array.isArray(raw) ? raw : [raw]).map((item) => String(item || '').trim()).find(Boolean);
  if (!value) return null;
  const candidates = value.split(/;(?=[^/\\]*(?:file:|\/|[A-Za-z]:[\\/]))/i);
  for (const candidate of candidates) {
    let path = candidate.trim().replace(/^file:\/\//i, '');
    const absoluteStart = path.search(/(?:^|:)(?:\/(?:Users|home|Volumes)\/|[A-Za-z]:[\\/])/i);
    if (absoluteStart > 0) path = path.slice(path[absoluteStart] === ':' ? absoluteStart + 1 : absoluteStart);
    path = path.replace(/:(?:application|text)\/[a-z0-9.+-]+$/i, '');
    try { path = decodeURIComponent(path); } catch { /* preserve literal path */ }
    path = path.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
    if (/\.(?:pdf|docx|epub|txt)$/i.test(path)) return path;
  }
  return null;
};

export const mapBibAttachment = (raw: unknown, identity: SeshatUserIdentity): BibliographyAttachmentPath | null => {
  const sourcePath = extractBibAttachmentPath(raw);
  if (!sourcePath) return null;
  const normalized = sourcePath.replaceAll('\\', '/');
  const marker = normalized.toLowerCase().lastIndexOf('/libros/');
  const candidate = marker >= 0 ? normalized.slice(marker + '/libros/'.length) : normalized.split('/').filter(Boolean).at(-1) || '';
  const segments = candidate.split('/').map(cleanSegment).filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
  if (!segments.length) return null;
  const filename = segments.at(-1) || '';
  if (!filename || !/\.(?:pdf|docx|epub|txt)$/i.test(filename)) return null;
  const directories = segments.slice(0, -1);
  const { root, privileged } = storageRootFor(identity);
  const relativePath = [...directories, filename].join('/');
  return { sourcePath, relativePath, directories, filename, objectKey: `${root}/${relativePath}`, storageRoot: root, privilegedRoot: privileged };
};
