export const REFERENCE_OPEN_DRAG_MIME = 'application/x-seshat-open-references';
export const REFERENCE_MOVE_DRAG_MIME = 'application/x-seshat-references';
export const REFERENCE_SINGLE_DRAG_MIME = 'application/x-seshat-reference';

export type CollectionDestination = {
  id: string;
  name: string;
  parentId?: string | null;
};

export type CollectionDestinationNode<T extends CollectionDestination = CollectionDestination> = T & {
  children: CollectionDestinationNode<T>[];
};

export const buildCollectionDestinationTree = <T extends CollectionDestination>(libraries: T[]): CollectionDestinationNode<T>[] => {
  const byParent = new Map<string | null, T[]>();
  libraries.forEach((library) => {
    const parent = library.parentId || null;
    byParent.set(parent, [...(byParent.get(parent) || []), library]);
  });
  byParent.forEach((items) => items.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })));
  const visit = (parentId: string | null, ancestors: Set<string>): CollectionDestinationNode<T>[] => (byParent.get(parentId) || []).flatMap((library) => {
    if (ancestors.has(library.id)) return [];
    const nextAncestors = new Set(ancestors); nextAncestors.add(library.id);
    return [{ ...library, children: visit(library.id, nextAncestors) }];
  });
  return visit(null, new Set());
};

export const referenceIdsFromDragData = (read: (mime: string) => string): string[] => {
  for (const mime of [REFERENCE_MOVE_DRAG_MIME, REFERENCE_OPEN_DRAG_MIME]) {
    const value = read(mime);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && Boolean(id)))];
    } catch { /* try the next compatible representation */ }
  }
  const single = read(REFERENCE_SINGLE_DRAG_MIME);
  return single ? [single] : [];
};
