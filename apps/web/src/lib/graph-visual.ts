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
