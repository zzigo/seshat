import { createHash } from 'node:crypto';
import { PostgresCatalog } from '@seshat/catalog';

let catalog: PostgresCatalog | undefined;

export const getCatalog = (): PostgresCatalog => {
  catalog ??= new PostgresCatalog(process.env.DATABASE_URL || '');
  return catalog;
};

export const ownerKeyFor = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
