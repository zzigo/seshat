import type { Contributor } from './types.js';

export const CONTRIBUTOR_ROLES = ['author', 'editor', 'translator', 'composer', 'performer', 'contributor'] as const;

const organizationWords = /\b(university|universidad|université|institute|institut|college|committee|association|society|press|museum|orchestra|ensemble|department|ministerio|ministry|centre|center|laboratory|lab)\b/i;
const particles = new Set(['da', 'de', 'del', 'della', 'der', 'di', 'dos', 'du', 'la', 'le', 'van', 'von']);

export const contributorName = (person: Partial<Contributor>, familyFirst = false): string => {
  if (person.literal?.trim()) return person.literal.trim();
  const family = person.family?.trim() || '';
  const given = person.given?.trim() || '';
  return familyFirst ? [family, given].filter(Boolean).join(', ') : [given, family].filter(Boolean).join(' ');
};

export const contributorSummary = (contributors: Partial<Contributor>[]): string => {
  const primary = contributors.filter((person) => (person.role || 'author') === 'author');
  const names = (primary.length ? primary : contributors).slice(0, 3).map((person) => contributorName(person, true)).filter(Boolean);
  const extra = Math.max(0, (primary.length ? primary : contributors).length - names.length);
  const otherRoles = [...new Set(contributors.filter((person) => person.role && person.role !== 'author').map((person) => person.role))];
  return `${names.join('; ')}${extra ? ` +${extra}` : ''}${otherRoles.length ? ` · ${otherRoles.join(', ')}` : ''}`;
};

export const normalizeContributor = (value: unknown, options: { inferSimpleNames?: boolean; defaultRole?: Contributor['role'] } = {}): Contributor | null => {
  const role = options.defaultRole || 'author';
  if (value && typeof value === 'object') {
    const input = value as Partial<Contributor>;
    const selectedRole = CONTRIBUTOR_ROLES.includes(input.role as any) ? input.role as Contributor['role'] : role;
    const family = String(input.family || '').trim(); const given = String(input.given || '').trim(); const literal = String(input.literal || '').trim();
    if (literal) return { literal, role: selectedRole };
    if (family || given) return { ...(family ? { family } : {}), ...(given ? { given } : {}), role: selectedRole };
    return null;
  }
  const literal = String(value || '').replace(/\s+/g, ' ').trim();
  if (!literal) return null;
  if (organizationWords.test(literal)) return { literal, role };
  const comma = literal.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) return { family: comma[1].trim(), given: comma[2].trim(), role };
  if (!options.inferSimpleNames) return { literal, role };
  const parts = literal.split(' ');
  if (parts.length < 2) return { literal, role };
  let familyStart = parts.length - 1;
  while (familyStart > 1 && particles.has(parts[familyStart - 1].toLowerCase())) familyStart -= 1;
  const given = parts.slice(0, familyStart).join(' '); const family = parts.slice(familyStart).join(' ');
  return given && family ? { family, given, role } : { literal, role };
};

export const normalizeContributors = (values: unknown[], options: { inferSimpleNames?: boolean; defaultRole?: Contributor['role'] } = {}): Contributor[] =>
  values.map((value) => normalizeContributor(value, options)).filter((value): value is Contributor => Boolean(value)).slice(0, 50);
