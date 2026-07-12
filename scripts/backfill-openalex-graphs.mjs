import { OpenAlexClient, clampGraphExpansion } from '@seshat/core';
import { PostgresCatalog, metadataFromOpenAlex, rebuildScholarlyGraph } from '@seshat/catalog';

const databaseUrl = process.env.DATABASE_URL || process.env.SESHAT_DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const catalog = new PostgresCatalog(databaseUrl);
const client = new OpenAlexClient({
  baseUrl: process.env.OPENALEX_API_BASE_URL,
  mailto: process.env.OPENALEX_MAILTO,
  apiKey: process.env.OPENALEX_API_KEY,
  timeoutMs: Number(process.env.OPENALEX_TIMEOUT_MS || 12000),
  retries: Number(process.env.OPENALEX_RETRIES || 3),
  cacheTtlDays: Number(process.env.OPENALEX_CACHE_TTL_DAYS || 30),
  cache: {
    get: (key) => catalog.getOpenAlexCache(key),
    set: (key, value, expiresAt) => catalog.setOpenAlexCache(key, value, expiresAt),
  },
});

if (!client.configured) throw new Error('OPENALEX_API_KEY_REQUIRED');

let refreshed = 0;
let failed = 0;
try {
  const owners = await catalog.pool.query(`SELECT DISTINCT owner_key FROM catalog_papers WHERE resolution_status='resolved' AND openalex_id IS NOT NULL`);
  for (const { owner_key: ownerKey } of owners.rows) {
    const papers = (await catalog.listPapers(ownerKey)).filter((paper) => paper.resolutionStatus === 'resolved' && paper.openAlexWork);
    for (const paper of papers) {
      try {
        const work = await client.workById(paper.openAlexId || paper.openAlexWork.id);
        if (!work) continue;
        const previous = paper.expansion || {};
        const options = clampGraphExpansion(previous.options || {});
        const [referenceWorks, relatedWorks] = await Promise.all([
          options.includeReferences ? client.worksByIds(work.referencedWorkIds, options.maxReferencesPerPaper) : Promise.resolve([]),
          client.worksByIds(work.relatedWorkIds, options.maxRelatedPapers),
        ]);
        await catalog.savePaperResolution(ownerKey, paper.referenceId, {
          status: 'resolved', method: paper.resolutionMethod || 'openalex-id', confidence: paper.resolutionConfidence || 1,
          candidates: paper.candidates, work, metadata: metadataFromOpenAlex(work),
          expansion: { ...previous, options, referenceWorks, relatedWorks },
          provenance: { ...paper.provenance, graphBackfilledAt: new Date().toISOString() },
        });
        refreshed += 1;
        console.log(`refreshed ${ownerKey.slice(0, 8)} ${paper.referenceId} ${work.title}`);
      } catch (error) {
        failed += 1;
        console.error(`failed ${paper.referenceId}:`, error instanceof Error ? error.message : error);
      }
    }
    await rebuildScholarlyGraph(catalog, ownerKey);
  }
  console.log(JSON.stringify({ refreshed, failed }));
  if (failed) process.exitCode = 1;
} finally {
  await catalog.pool.end();
}
