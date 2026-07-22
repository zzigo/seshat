export type KeywordFacetReference = { keywords: string[]; tagList: string[] };

export type CatalogKeywordFacet = {
  label: string;
  count: number;
  fromKeyword: boolean;
  fromTag: boolean;
};

const clean = (values: string[]) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];

export const catalogKeywordFacets = (references: KeywordFacetReference[]): CatalogKeywordFacet[] => {
  const facets = new Map<string,CatalogKeywordFacet>();
  for (const reference of references) {
    const keywords = new Set(clean(reference.keywords));
    const tags = new Set(clean(reference.tagList));
    for (const label of new Set([...keywords,...tags])) {
      const current = facets.get(label) || { label, count:0, fromKeyword:false, fromTag:false };
      current.count += 1;
      current.fromKeyword ||= keywords.has(label);
      current.fromTag ||= tags.has(label);
      facets.set(label,current);
    }
  }
  return [...facets.values()].sort((left,right)=>right.count-left.count||left.label.localeCompare(right.label));
};

export const referenceMatchesCatalogFacet = (reference: KeywordFacetReference, label: string) =>
  reference.keywords.includes(label) || reference.tagList.includes(label);
