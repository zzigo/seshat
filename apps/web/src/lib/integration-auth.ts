import { timingSafeEqual } from 'node:crypto';

const bearerToken = (request: Request): string => {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

const equalSecret = (received: string, expected: string): boolean => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export type IntegrationIdentity = { ownerKey?: string; email?: string };

export const authenticateIntegration = (request: Request): IntegrationIdentity | null => {
  const expected = String(process.env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!expected || !equalSecret(bearerToken(request), expected)) return null;

  const ownerKey = String(process.env.SESHAT_INTEGRATION_OWNER_KEY || '').trim().toLowerCase();
  if (ownerKey) return /^[a-f0-9]{32}$/.test(ownerKey) ? { ownerKey } : null;

  const email = String(request.headers.get('x-seshat-owner') || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return null;
  return { email };
};
