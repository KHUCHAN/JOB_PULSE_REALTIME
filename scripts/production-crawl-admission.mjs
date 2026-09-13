import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const INTERVAL_MS = 2 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const DRAIN_STEP = 'Drain due production sources';

// Workflow conclusion is not crawl health: a failed recovery can follow a
// successful drain. Skipped watchdog runs and short push smoke runs are not
// evidence of a full collection and must never advance the two-hour clock.
export function decideAdmission(history, { now, event = 'schedule' }) {
  if (!Number.isFinite(now)) throw new Error('Invalid admission clock');
  if (history.some(r => r.status === 'in_progress'))
    return { run: false, reason: 'another-owner-active' };
  if (event === 'push') return { run: true, reason: 'repair-push-smoke' };
  const attempts = history.filter(r => r.event !== 'push').flatMap(r =>
    r.jobs.filter(j => j.name === 'crawl').flatMap(j => {
      const step = j.steps?.find(s => s.name === DRAIN_STEP && s.started_at && s.conclusion !== 'skipped');
      if (!step) return [];
      const at = Date.parse(step.started_at);
      if (!Number.isFinite(at) || at > now) throw new Error('Invalid/future crawl timestamp');
      return [{ id: r.id, at, success: step.conclusion === 'success' }];
    })).sort((a, b) => b.at - a.at);
  const last = attempts[0];
  if (!last) return { run: true, reason: 'no-prior-drain' };
  const interval = last.success ? INTERVAL_MS : RETRY_MS;
  return { run: now - last.at >= interval, reason: now - last.at >= interval
    ? (last.success ? 'collection-due' : 'failed-drain-retry-due')
    : (last.success ? 'recent-full-drain' : 'failed-drain-backoff'),
  previousRunId: last.id, previousStartedAt: new Date(last.at).toISOString(),
  nextDueAt: new Date(last.at + interval).toISOString() };
}

export async function loadHistory({ request, repository, currentRunId, now }) {
  const history = [];
  // Bounded read-only history; fail closed if pagination cannot establish a
  // recent owner. Inactive/cancelled/skipped watchdog runs are not anchors.
  for (let page = 1; page <= 3; page++) {
    const data = await request(`/repos/${repository}/actions/workflows/production-crawl.yml/runs?per_page=100&page=${page}&branch=main`);
    if (!Array.isArray(data.workflow_runs)) throw new Error('Invalid workflow history');
    for (const r of data.workflow_runs) {
      if (String(r.id) === String(currentRunId)) continue;
      if (!Number.isFinite(Date.parse(r.created_at))) throw new Error('Invalid run timestamp');
      // GitHub serializes the owner workflow. Queued runs are future owners,
      // not a reason for the currently admitted owner to deadlock itself.
      if (r.status === 'queued' || r.status === 'waiting' || r.status === 'pending') continue;
      const jobs = await request(`/repos/${repository}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`);
      if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) throw new Error('Incomplete job history');
      history.push({ ...r, jobs: jobs.jobs });
      // Also inspect delayed older runs within six hours before stopping.
      if (Date.parse(r.created_at) < now - 6 * 60 * 60 * 1000 &&
          history.some(x => x.jobs.some(j => j.name === 'crawl' && j.steps?.some(s =>
            s.name === DRAIN_STEP && s.started_at && s.conclusion !== 'skipped')))) return history;
    }
    if (data.workflow_runs.length < 100) return history;
  }
  throw new Error('Admission history bound exceeded; refusing unverified duplicate');
}

export async function main(env = process.env) {
  const repository = env.GITHUB_REPOSITORY;
  if (repository !== 'KHUCHAN/JOB_PULSE_REALTIME' || !env.GH_TOKEN || !env.GITHUB_RUN_ID)
    throw new Error('Missing or unexpected admission context');
  const now = Date.now();
  const request = async path => {
    const r = await fetch('https://api.github.com' + path, { headers: {
      authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Admission history HTTP ${r.status}`);
    return r.json();
  };
  const history = await loadHistory({ request, repository, currentRunId: env.GITHUB_RUN_ID, now });
  const decision = decideAdmission(history, { now, event: env.GITHUB_EVENT_NAME });
  console.log(JSON.stringify(decision));
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `run=${decision.run}\nreason=${decision.reason}\n`);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `### Collection admission\n\n\`\`\`json\n${JSON.stringify(decision, null, 2)}\n\`\`\`\n`);
  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
