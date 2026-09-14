// Read-only operational evidence. Never crawl, ingest, approve, or dispatch.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { collectionEvidence } from './critical-coverage-status.mjs';
const site = 'https://job-pulse-realtime.autodev61.chatgpt.site';
const workflow = await readFile(new URL('../.github/workflows/production-crawl.yml', import.meta.url), 'utf8');
const ids = [...new Set(workflow.match(/REQUEST_FALLBACK_FORCE_SOURCE_IDS: ([^\n]+)/)?.[1].trim().split(',') ?? [])];
if (!ids.length || ids.length > 64) throw Error('Critical source inventory missing or exceeds API limit');
const output = process.argv[2];
if (!output) throw Error('Pass a fresh evidence output path');
const recovery = JSON.parse(await readFile(join(dirname(output), 'results.json'), 'utf8'));
const report = { capturedAt: new Date().toISOString(), sources: [] };
async function get(params) {
  const response = await fetch(site + '/api/pulse?' + new URLSearchParams(params), { signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw Error('DB HTTP ' + response.status);
  return response.json();
}
const sources = await get({ resource: 'sources', ids: ids.join(',') });
if (!Array.isArray(sources) || ids.some(id => !sources.some(s => s.id === id))) throw Error('Critical employer missing from production source inventory');
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < sources.length) {
    const source = sources[cursor++];
    try {
      const params = new URLSearchParams({ resource: 'jobs', company: source.company, pageSize: '100', page: '1', resumeMatch: 'chanyoung-resume' });
      params.append('program', 'internship'); params.append('program', 'coop');
      const data = await get(params);
      if (!Array.isArray(data.items) || !data.snapshotAt) throw Error('Raw DB view omitted rows or snapshotAt');
      const rows = data.items.map(j => ({ id: j.id, title: j.title, officialUrl: j.officialUrl,
        location: j.location, country: j.locationCountry, publishedAt: j.publishedAt, sourceUpdatedAt: j.sourceUpdatedAt,
        firstSeenAt: j.firstSeenAt, descriptionLength: (j.description ?? '').length,
        review: j.resumeReviewDecision, notifiedAt: j.resumeNotifiedAt, score: j.resumeMatchScore }));
      const result = { ...source, programTotal: data.total, sampled: rows.length, snapshotAt: data.snapshotAt,
        ...collectionEvidence(source.id, recovery),
        sampleOnly: data.total > rows.length,
        missingDate: rows.filter(j => !j.publishedAt && !j.sourceUpdatedAt).length,
        missingLocation: rows.filter(j => !j.location || j.location === 'Location not specified').length,
        rows };
      report.sources.push(result);
      if (result.collectionStatus !== 'succeeded') process.exitCode = 1;
      console.log(JSON.stringify({ company: source.company, health: source.health, programTotal: data.total,
        collectionStatus: result.collectionStatus, collectionError: result.collectionError,
        sampled: rows.length, missingDate: result.missingDate, missingLocation: result.missingLocation }));
    } catch (error) { report.sources.push({ ...source, error: String(error) }); process.exitCode = 1; }
  }
}));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
