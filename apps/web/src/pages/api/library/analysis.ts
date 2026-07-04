import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const stopWords = new Set([
  'the','of','to','and','a','in','is','it','you','that','he','was','for','on','are','as','with','his','they','i',
  'at','be','this','have','from','or','one','had','by','word','but','not','what','all','were','we','when','your','can',
  'said','there','use','an','each','which','she','do','how','their','if','will','up','other','about','out','many','then',
  'them','these','so','some','her','would','make','like','him','into','time','has','look','two','more','write','go','see',
  'number','no','way','could','people','my','than','first','water','been','call','who','oil','its','now','find','long',
  'down','day','did','get','come','made','may','part',
  'el','la','los','las','un','una','unos','unas','y','o','pero','de','del','a','en','con','para','por','si','no','se','lo',
  'que','como','su','sus','al','este','esta','estos','estas','es','son','era','eran','uno','tiene','tienen','habia','hay',
  'este','esto','esta','esa','eso','un','una','este','como','para','por','que','del','con','los'
]);

function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

export const GET: APIRoute = async ({ locals, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  const referenceId = url.searchParams.get('id');
  const query = url.searchParams.get('q');

  try {
    // 1. Fetch text chunks
    let chunksQuery = referenceId
      ? await catalog.pool.query('SELECT content FROM catalog_chunks WHERE owner_key = $1 AND reference_id = $2', [ownerKey, referenceId])
      : await catalog.pool.query('SELECT content FROM catalog_chunks WHERE owner_key = $1', [ownerKey]);

    const chunks = chunksQuery.rows;
    const fullText = chunks.map((c: any) => c.content).join('\n\n');

    // KWIC Search fallback
    if (query) {
      const cleanQ = query.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(?:[^\\s]+\\s+){0,6}(${cleanQ})(?:\\s+[^\\s]+){0,6}`, 'gi');
      const matches: Array<{ left: string; key: string; right: string }> = [];
      let match;
      while ((match = regex.exec(fullText)) !== null) {
        const matchedText = match[0];
        const keyword = match[1];
        const index = matchedText.toLowerCase().indexOf(keyword.toLowerCase());
        matches.push({
          left: matchedText.slice(0, index),
          key: matchedText.slice(index, index + keyword.length),
          right: matchedText.slice(index + keyword.length)
        });
        if (matches.length >= 100) break;
      }
      return Response.json({ matches });
    }

    const tokens = tokenize(fullText);

    // 2. Compute classic frequencies
    const freqMap = new Map<string, number>();
    for (const t of tokens) {
      freqMap.set(t, (freqMap.get(t) || 0) + 1);
    }

    const totalTokens = tokens.length;
    const totalTypes = freqMap.size;
    const ttr = totalTokens > 0 ? (totalTypes / totalTokens) : 0;

    let hapaxCount = 0;
    for (const count of freqMap.values()) {
      if (count === 1) hapaxCount++;
    }

    // Zipf sorting
    const sortedFreqs = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);
    const zipf = sortedFreqs.slice(0, 100).map(([word, count], index) => ({
      word,
      rank: index + 1,
      freq: count,
      alphaFreq: sortedFreqs[0] ? (sortedFreqs[0][1] / (index + 1)) : 0
    }));

    // Filtered vocabulary (without stop words)
    const vocabulary = sortedFreqs
      .filter(([word]) => !stopWords.has(word))
      .slice(0, 100)
      .map(([word, count]) => ({ word, count }));

    // 3. N-grams (Bigrams and Trigrams)
    const bigramsMap = new Map<string, number>();
    const trigramsMap = new Map<string, number>();

    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i+1]}`;
      bigramsMap.set(bigram, (bigramsMap.get(bigram) || 0) + 1);
      if (i < tokens.length - 2) {
        const trigram = `${tokens[i]} ${tokens[i+1]} ${tokens[i+2]}`;
        trigramsMap.set(trigram, (trigramsMap.get(trigram) || 0) + 1);
      }
    }

    const bigrams = [...bigramsMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([ngram, count]) => ({ ngram, count }));

    const trigrams = [...trigramsMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([ngram, count]) => ({ ngram, count }));

    // 4. Rhetorics Operation Counts
    const rhetoricRules = [
      { name: 'definition', regex: /\b(is|definimos|se define como|constituye|es decir)\b/gi },
      { name: 'contrast', regex: /\b(however|nevertheless|sin embargo|no obstante|por el contrario)\b/gi },
      { name: 'causality', regex: /\b(therefore|because|por lo tanto|porque|debido a|en consecuencia)\b/gi },
      { name: 'hypothesis', regex: /\b(if|may|could|si |quizas|es posible|podria)\b/gi },
      { name: 'analogy', regex: /\b(as if|like|como si|se asemeja|analogamente)\b/gi },
      { name: 'criticism', regex: /\b(fails to|neglects|falla en|carece de|insuficiente)\b/gi },
      { name: 'genealogy', regex: /\b(from \w+ to \w+|desde \w+ hasta \w+|origen|desarrollo)\b/gi },
      { name: 'programmatic', regex: /\b(toward|beyond|after|hacia|mas alla|despues de)\b/gi }
    ];

    const rhetorics = rhetoricRules.map(rule => {
      const matches = fullText.match(rule.regex);
      return { name: rule.name, count: matches ? matches.length : 0 };
    });

    // 5. Narrative Voice / Modality estimation
    const narratives = [
      { name: 'first-person', count: (fullText.match(/\b(i|we|yo|nosotros|nuestro|nuestra|my|our)\b/gi) || []).length },
      { name: 'possibility', count: (fullText.match(/\b(possible|maybe|perhaps|puede|posible|quizas)\b/gi) || []).length },
      { name: 'necessity', count: (fullText.match(/\b(must|necessary|debe|deberia|necesario)\b/gi) || []).length },
      { name: 'impossibility', count: (fullText.match(/\b(impossible|cannot|imposible|no se puede)\b/gi) || []).length }
    ];

    // 6. Citations & Bibliographics
    const citationsQuery = referenceId
      ? await catalog.pool.query('SELECT contributors, issued, publisher FROM catalog_references WHERE owner_key = $1 AND id = $2', [ownerKey, referenceId])
      : await catalog.pool.query('SELECT contributors, issued, publisher FROM catalog_references WHERE owner_key = $1', [ownerKey]);

    const citations = citationsQuery.rows;

    // 7. Graph entities linked to the document
    const entitiesQuery = referenceId
      ? await catalog.pool.query(
          `SELECT label, kind, count(*) as count 
           FROM catalog_graph_nodes 
           WHERE owner_key = $1 AND node_key IN (
             SELECT DISTINCT from_key FROM catalog_graph_edges WHERE owner_key = $1 AND evidence_reference_id = $2
             UNION
             SELECT DISTINCT to_key FROM catalog_graph_edges WHERE owner_key = $1 AND evidence_reference_id = $2
           ) GROUP BY label, kind ORDER BY count DESC LIMIT 50`,
          [ownerKey, referenceId]
        )
      : await catalog.pool.query(
          `SELECT label, kind, count(*) as count 
           FROM catalog_graph_nodes 
           WHERE owner_key = $1 GROUP BY label, kind ORDER BY count DESC LIMIT 50`,
          [ownerKey]
        );

    const entities = entitiesQuery.rows;

    return Response.json({
      summary: {
        totalTokens,
        totalTypes,
        ttr: Number(ttr.toFixed(4)),
        hapaxCount,
      },
      zipf,
      vocabulary,
      bigrams,
      trigrams,
      rhetorics,
      narratives,
      entities,
      citationsCount: citations.length
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });

  } catch (error) {
    console.error('[seshat:analysis-api]', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
};
