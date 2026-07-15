export const isPhoneResourceProfile = (
  userAgent: string,
  coarsePointer: boolean,
): boolean => coarsePointer && /(?:iPhone|iPod|Android.*Mobile)/i.test(userAgent);

export const currentPhoneResourceProfile = (): boolean => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  return isPhoneResourceProfile(
    navigator.userAgent,
    window.matchMedia('(pointer: coarse)').matches,
  );
};
