import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decideAdmission, loadHistory } from '../scripts/production-crawl-admission.mjs';
import { checkProductionCrawl } from '../scripts/check-production-crawl.mjs';
const now = Date.parse('2026-09-13T22:17:00Z');
const run = (age, extra = {}) => ({ id: 1, status: 'completed', event: 'schedule',
  conclusion: 'failure', created_at: new Date(now - age * 60000).toISOString(),
  jobs: [{ name: 'crawl', steps: [{ name: 'Drain due production sources',
    started_at: new Date(now - age * 60000).toISOString(), conclusion: 'success' }] }], ...extra });
test('missed tick admits the next check; exact two-hour boundary', () => {
  assert.equal(decideAdmission([run(120)], { now }).run, true);
  assert.equal(decideAdmission([run(119)], { now }).run, false);
});
test('recovery failure does not repeat a successful main drain', () => {
  assert.equal(decideAdmission([run(40)], { now }).reason, 'recent-full-drain');
});
test('skipped checks and short push smoke runs never reset the clock', () => {
  assert.equal(decideAdmission([run(2, { jobs: [] }), run(4, { event: 'push' }), run(150)], { now }).run, true);
});
test('actual step time, not delayed event creation, controls freshness', () => {
  assert.equal(decideAdmission([run(3, { created_at: '2026-09-13T10:00:00Z' })], { now }).run, false);
});
test('failed main drain has a bounded retry backoff', () => {
  const failed = age => run(age, { jobs: [{ name: 'crawl', steps: [{
    name: 'Drain due production sources', started_at: new Date(now - age * 60000).toISOString(), conclusion: 'failure' }] }] });
  assert.equal(decideAdmission([failed(29)], { now }).run, false);
  assert.equal(decideAdmission([failed(30)], { now }).run, true);
});
test('active owner blocks even a repair push', () => {
  assert.equal(decideAdmission([run(4, { status: 'in_progress' })], { now, event: 'push' }).run, false);
});
test('no history admits; invalid future times fail closed', () => {
  assert.equal(decideAdmission([], { now }).run, true);
  assert.throws(() => decideAdmission([run(-1)], { now }));
});
test('history ignores self and queued owners, reads actual jobs', async () => {
  let calls = [];
  const old = run(150);
  const history = await loadHistory({ repository: 'x/y', currentRunId: 9, now,
    request: async path => { calls.push(path); return path.includes('/jobs?')
      ? { jobs: old.jobs, total_count: 1 }
      : { workflow_runs: [run(0, { id: 9 }), run(1, { id: 8, status: 'queued' }), old] }; } });
  assert.equal(history.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(decideAdmission(history, { now }).run, true);
});
test('API errors and incomplete job pagination fail closed', async () => {
  await assert.rejects(loadHistory({ repository: 'x/y', now, request: async () => { throw Error('HTTP 403'); } }));
  await assert.rejects(loadHistory({ repository: 'x/y', now, request: async p => p.includes('/jobs?')
    ? { jobs: [], total_count: 101 } : { workflow_runs: [run(1)] } }));
});
test('workflow serializes every mutating lane behind admission', async () => {
  const text = await readFile(new URL('../.github/workflows/production-crawl.yml', import.meta.url), 'utf8');
  assert.match(text, /cron: "2,17,32,47 \* \* \* \*"/);
  assert.match(text, /cancel-in-progress: false/);
  assert.equal((text.match(/needs\.admission\.outputs\.run == 'true'/g) || []).length, 3);
  assert.match(text, /actions: read/);
  assert.match(text, /  crawl:\n    needs: \[admission, request-recovery\]/);
  const recovery = text.slice(text.indexOf('  request-recovery:'), text.indexOf('  browser-recovery:'));
  assert.match(recovery, /needs: \[admission\]/);
  assert.doesNotMatch(recovery, /needs: \[admission, crawl\]/);
});
test('watchdog never dispatches within grace or when an owner is queued', async () => {
  for (const [age, queued] of [[140, false], [180, true]]) {
    const r = run(age); let calls = 0;
    const request = async p => p.includes('/jobs?') ? { jobs: r.jobs, total_count: 1 }
      : { workflow_runs: [r, ...(queued ? [run(0, { id: 8, status: 'queued' })] : [])] };
    const result = await checkProductionCrawl({ request, dispatch: async () => calls++, now, repair: true });
    assert.equal(result.dispatchRequested, false); assert.equal(calls, 0);
  }
});
test('watchdog dry-run is read-only and repair sends exactly one guarded dispatch', async () => {
  const r = run(180); let calls = 0;
  const request = async p => p.includes('/jobs?') ? { jobs: r.jobs, total_count: 1 }
    : p.includes('/contents/') ? { encoding: 'base64', content: Buffer.from('run: node scripts/production-crawl-admission.mjs').toString('base64') }
    : { workflow_runs: [r] };
  assert.equal((await checkProductionCrawl({ request, dispatch: async () => calls++, now })).repairNeeded, true);
  assert.equal(calls, 0);
  assert.equal((await checkProductionCrawl({ request, dispatch: async () => calls++, now, repair: true })).dispatchRequested, true);
  assert.equal(calls, 1);
});
test('watchdog does not retry an uncertain dispatch', async () => {
  const r = run(180); let calls = 0;
  const request = async p => p.includes('/jobs?') ? { jobs: r.jobs, total_count: 1 }
    : p.includes('/contents/') ? { encoding: 'base64', content: Buffer.from('run: node scripts/production-crawl-admission.mjs').toString('base64') }
    : { workflow_runs: [r] };
  await assert.rejects(checkProductionCrawl({ request, now, repair: true, dispatch: async () => { calls++; throw Error('timeout'); } }));
  assert.equal(calls, 1);
});
