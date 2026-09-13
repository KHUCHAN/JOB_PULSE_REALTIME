import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadHistory, decideAdmission } from './production-crawl-admission.mjs';

export async function checkProductionCrawl({ request, dispatch, now = Date.now(), repair = false }) {
  const repository = 'KHUCHAN/JOB_PULSE_REALTIME';
  const history = await loadHistory({ request, repository, currentRunId: '0', now });
  const decision = decideAdmission(history, { now });
  // Give the native scheduler a 30-minute grace window. No resetting clocks
  // from skipped admission jobs, review times, or email delivery timestamps.
  if (!decision.run || (decision.nextDueAt && now < Date.parse(decision.nextDueAt) + 30 * 60000))
    return { ...decision, dispatchRequested: false };
  const runs = await request(`/repos/${repository}/actions/workflows/production-crawl.yml/runs?per_page=100&branch=main`);
  if (!Array.isArray(runs.workflow_runs)) throw new Error('Invalid owner snapshot');
  if (runs.workflow_runs.some(r => r.status !== 'completed'))
    return { ...decision, dispatchRequested: false, reason: 'owner-running-or-queued' };
  if (!repair) return { ...decision, dispatchRequested: false, repairNeeded: true };
  const workflow = await request(`/repos/${repository}/contents/.github/workflows/production-crawl.yml?ref=main`);
  if (workflow.encoding !== 'base64' || !Buffer.from(workflow.content, 'base64').toString().includes('run: node scripts/production-crawl-admission.mjs'))
    throw new Error('Remote owner admission guard is not deployed');
  // One request only. The owner-side admission and workflow concurrency cover
  // a schedule arriving after the read-only preflight. Never call crawler APIs.
  await dispatch(`/repos/${repository}/actions/workflows/production-crawl.yml/dispatches`);
  return { ...decision, dispatchRequested: true };
}

export async function main() {
  const request = async path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }));
  const dispatch = async path => { execFileSync('gh', ['api', '--method', 'POST', path, '-f', 'ref=main'],
    { encoding: 'utf8', timeout: 30000 }); };
  console.log(JSON.stringify(await checkProductionCrawl({ request, dispatch, repair: process.argv.includes('--dispatch') }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
