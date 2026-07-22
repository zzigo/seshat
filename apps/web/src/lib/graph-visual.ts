export const GRAPH_LAYOUT_DEFAULTS = {
  repulsion: 1000,
  maximumRepulsion: 3000,
  distance: 204,
  maximumDistance: 600,
} as const;

export type GraphLabelPlacement = 'above' | 'below' | 'left' | 'right';

export const shortGraphPaperTitle = (value: string): string => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : words.join(' ');
};

export const wrapGraphLabel = (value: string, maximum = 24, maximumLines = 3): string[] => {
  const lines: string[] = [];
  const words = value.trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maximum) lines.push(word.slice(0, maximum));
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= maximumLines) return lines;
  const visible = lines.slice(0, maximumLines);
  visible[maximumLines - 1] = `${visible[maximumLines - 1].replace(/…$/, '').slice(0, maximum - 1).trimEnd()}…`;
  return visible;
};

/** Places the label away from the average direction of the node's links.
 * Weak or balanced link fields keep the stable default below the node. */
export const graphLabelPlacement = (linkVectorX: number, linkVectorY: number): GraphLabelPlacement => {
  if (Math.hypot(linkVectorX, linkVectorY) < 0.25) return 'below';
  if (Math.abs(linkVectorX) > Math.abs(linkVectorY) * 1.2) return linkVectorX > 0 ? 'left' : 'right';
  return linkVectorY > 0 ? 'above' : 'below';
};

export const graphLabelCollisionRadius = (lines: string[], nodeRadius: number): number => {
  const widest = Math.max(0, ...lines.map((line) => line.length));
  const boxHalfWidth = Math.min(62, Math.max(18, widest * 3.1 + 7));
  const boxHeight = Math.max(13, lines.length * 12 + 6);
  return Math.max(24, nodeRadius + 7 + Math.hypot(boxHalfWidth, boxHeight / 2));
};

export const compactGraphAuthor = (value: unknown): string => {
  const authors = (Array.isArray(value) ? value : String(value || '').split(/\s*;\s*/))
    .map((author) => typeof author === 'object' && author ? String((author as { name?:unknown }).name || '') : String(author || ''))
    .map((author) => author.trim()).filter(Boolean);
  if (!authors.length) return 'Unknown author';
  const first = authors[0];
  const family = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).at(-1) || first;
  return authors.length > 1 ? `${family} et al.` : family;
};

const KIKI_DOMAINS = ['physics','mathematics','chemistry','biology','engineering','computer','neuroscience','medicine','acoustic','algorithm','quantitative','statistics'];
const BOUBA_DOMAINS = ['philosophy','sociology','anthropology','history','culture','cultural','literature','arts','music','aesthetic','politics','gender','society','education','humanities'];

/** A deliberately lightweight visual metaphor, not an epistemic classification.
 * 0 is rounded/bouba; 1 is angular/kiki. Explicit graph metadata wins. */
export const conceptKikiBoubaIndex = (label: unknown, properties: Record<string,unknown> = {}): number => {
  const explicit = Number(properties.kikiBoubaIndex ?? properties.hardScienceIndex);
  if (Number.isFinite(explicit)) return Math.max(0,Math.min(1,explicit));
  const haystack = [label,properties.domain,properties.field,properties.description,properties.type].filter(Boolean).join(' ').toLowerCase();
  const kiki = KIKI_DOMAINS.filter((term) => haystack.includes(term)).length;
  const bouba = BOUBA_DOMAINS.filter((term) => haystack.includes(term)).length;
  if (!kiki && !bouba) return .5;
  return Math.max(.08,Math.min(.92,.5+(kiki-bouba)*.14));
};

export const citationHierarchyDepths = (
  rootId: string,
  links: Array<{ source:unknown; target:unknown; relation?:unknown; kind?:unknown }>,
  maximumDepth = 5,
): Map<string,number> => {
  const id = (value:unknown) => String(value && typeof value === 'object' ? (value as { id?:unknown }).id || '' : value || '');
  const citations = links.filter((link) => String(link.relation || link.kind || '').toLowerCase() === 'cites');
  const depths = new Map<string,number>([[rootId,0]]); const queue=[rootId];
  while(queue.length){const current=queue.shift()!;const depth=depths.get(current)||0;if(Math.abs(depth)>=maximumDepth)continue;for(const link of citations){const source=id(link.source),target=id(link.target);let neighbor='',next=0;if(source===current){neighbor=target;next=depth+1;}else if(target===current){neighbor=source;next=depth-1;}if(!neighbor||depths.has(neighbor))continue;depths.set(neighbor,next);queue.push(neighbor);}}
  return depths;
};
