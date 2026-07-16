import { createHash } from 'node:crypto';
import { PostgresCatalog } from '@seshat/catalog';

let catalog: PostgresCatalog | undefined;
const ownerAliases = new Map<string, string>();
const identityOwners = new Map<string, { ownerKey: string; email: string }>();

export const getCatalog = (): PostgresCatalog => {
  catalog ??= new PostgresCatalog(process.env.DATABASE_URL || '');
  return catalog;
};

const normalizedEmail = (email: string): string => email.trim().toLowerCase();
export const hashedOwnerKeyFor = (email: string): string =>
  createHash('sha256').update(normalizedEmail(email)).digest('hex').slice(0, 32);

export const ownerKeyFor = (email: string): string => ownerAliases.get(normalizedEmail(email)) || hashedOwnerKeyFor(email);

export const sessionIdentity = (session: any) => {
  const email = normalizedEmail(String(session?.user?.email || ''));
  const subject = String(session?.user?.id || '').trim();
  const provider = String(session?.user?.provider || 'logto').trim().toLowerCase();
  return { email, subject, provider, identityKey: `${provider}:${subject || email}` };
};

export const registerSessionIdentity = async (session: any): Promise<string> => {
  const identity = sessionIdentity(session);
  if (!identity.email) return '';
  const cached = identityOwners.get(identity.identityKey);
  if (cached && cached.email === identity.email) { ownerAliases.set(identity.email, cached.ownerKey); return cached.ownerKey; }
  const ownerKey = await getCatalog().bindIdentity({ ...identity, proposedOwnerKey: hashedOwnerKeyFor(identity.email) });
  identityOwners.set(identity.identityKey, { ownerKey, email: identity.email }); ownerAliases.set(identity.email, ownerKey);
  return ownerKey;
};

export const setSessionOwnerAlias = (session: any, ownerKey: string): void => {
  const identity = sessionIdentity(session); identityOwners.set(identity.identityKey, { ownerKey, email: identity.email }); ownerAliases.set(identity.email, ownerKey);
};

export const isSessionAccountAdmin = (session: any): boolean => {
  const identity = sessionIdentity(session);
  const allowedEmails = String(process.env.SESHAT_ADMIN_EMAILS || '').split(',').map(normalizedEmail).filter(Boolean);
  const allowedGroups = String(process.env.SESHAT_ADMIN_GROUPS || 'Seshat Admins').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const groups = Array.isArray(session?.user?.groups) ? session.user.groups.map((value: unknown) => String(value).toLowerCase()) : [];
  return allowedEmails.includes(identity.email) || groups.some((group: string) => allowedGroups.includes(group));
};
