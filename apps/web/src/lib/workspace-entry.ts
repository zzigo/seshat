export type WorkspacePreference = 'desktop' | 'mobile' | null;

export function normalizeWorkspacePreference(value: unknown): WorkspacePreference {
  return value === 'desktop' || value === 'mobile' ? value : null;
}

export function resolveWorkspaceDestination(input: {
  preference: unknown;
  coarsePointer: boolean;
  viewportWidth: number;
}): '/workspace' | '/mobwork' {
  const preference = normalizeWorkspacePreference(input.preference);
  if (preference === 'desktop') return '/workspace';
  if (preference === 'mobile') return '/mobwork';
  return input.coarsePointer && input.viewportWidth <= 900 ? '/mobwork' : '/workspace';
}
