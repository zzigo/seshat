export const DEFAULT_ZOTERO_BEACON_IDLE_LIMIT = 3;

export const nextZoteroBeaconIdleState = (
  currentIdleChecks: number,
  changed: boolean,
  limit = DEFAULT_ZOTERO_BEACON_IDLE_LIMIT,
): { idleChecks: number; autoDisable: boolean } => {
  if (changed) return { idleChecks: 0, autoDisable: false };
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || DEFAULT_ZOTERO_BEACON_IDLE_LIMIT)));
  const idleChecks = Math.max(0, Math.floor(Number(currentIdleChecks) || 0)) + 1;
  return { idleChecks, autoDisable: idleChecks >= safeLimit };
};
