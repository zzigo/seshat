export type LibraryHierarchyNode = { id: string; parentId?: string };

export const collectLibraryBranchIds = (
  libraries: LibraryHierarchyNode[],
  rootId: string,
): Set<string> => {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    libraries.forEach((library) => {
      if (library.parentId && ids.has(library.parentId) && !ids.has(library.id)) {
        ids.add(library.id);
        changed = true;
      }
    });
  }
  return ids;
};

export const belongsToLibraryBranch = (
  referenceLibraryIds: string[],
  branchIds: ReadonlySet<string>,
): boolean => referenceLibraryIds.some((id) => branchIds.has(id));
