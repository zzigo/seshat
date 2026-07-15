export type EmergenceSource = { id: string; title: string; year: number };
export type EmergenceSignal = {
  phrase: string;
  firstYear: number;
  peakYear: number;
  count: number;
  strength: number;
  itemIds: string[];
  bins: Array<{ year: number; count: number }>;
};

const STOP_WORDS = new Set(`a an and are as at be been being between by de del der des die el en et for from
  für im in into is la las le les los mit of on or para por the to un una und von with y
  approach approaches analysis based book chapter concept concepts data effect effects essay evidence
  introduction journal new paper perspective research study studies theory toward towards using volume`.split(/\s+/));

const words = (title: string): string[] => title.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/)
  .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));

const bucketFor = (year: number): number => {
  const width = year < 1800 ? 50 : year < 1950 ? 10 : 5;
  return Math.floor(year / width) * width;
};

export const detectEmergence = (sources: EmergenceSource[], maximum = 7): EmergenceSignal[] => {
  const phrases = new Map<string, { years: number[]; items: Set<string>; buckets: Map<number, number> }>();
  for (const source of sources) {
    if (!Number.isFinite(source.year) || !source.title.trim()) continue;
    const tokens = words(source.title);
    const unique = new Set<string>();
    for (let index = 0; index < tokens.length - 1; index += 1) unique.add(`${tokens[index]} ${tokens[index + 1]}`);
    for (const phrase of unique) {
      const value = phrases.get(phrase) || { years: [], items: new Set<string>(), buckets: new Map<number, number>() };
      value.years.push(source.year); value.items.add(source.id);
      const bucket = bucketFor(source.year); value.buckets.set(bucket, (value.buckets.get(bucket) || 0) + 1);
      phrases.set(phrase, value);
    }
  }
  return [...phrases].flatMap(([phrase, value]) => {
    if (value.items.size < 2) return [];
    const bins = [...value.buckets].sort((left, right) => left[0] - right[0]).map(([year, count]) => ({ year, count }));
    let peak = bins[0]; let rise = 0;
    bins.forEach((bin, index) => { const previous = bins[index - 1]?.count || 0; const delta = bin.count - previous; if (delta > rise || (delta === rise && bin.count > peak.count)) { rise = delta; peak = bin; } });
    const firstYear = Math.min(...value.years); const count = value.items.size;
    return [{ phrase, firstYear, peakYear: peak.year, count, strength: (rise + peak.count * .35) * Math.log2(count + 1), itemIds: [...value.items], bins }];
  }).sort((left, right) => right.strength - left.strength || right.count - left.count || right.peakYear - left.peakYear)
    .filter((signal, index, values) => !values.slice(0, index).some((other) => other.phrase.split(' ').some((word) => signal.phrase.includes(word)) && Math.abs(other.strength - signal.strength) < .3))
    .slice(0, Math.max(1, maximum));
};
