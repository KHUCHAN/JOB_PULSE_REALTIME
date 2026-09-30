import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productionCrawlLimits } from '../scripts/production-crawl-limits.mjs';

test('full collections allow eighty minutes while retaining two native leases', () => {
  assert.deepEqual(productionCrawlLimits({}), { maximumMinutes: 80, requestConcurrency: 2 });
  assert.deepEqual(productionCrawlLimits({ JOB_PULSE_MAX_RUN_MINUTES: '80', JOB_PULSE_REQUEST_CONCURRENCY: '2' }), { maximumMinutes: 80, requestConcurrency: 2 });
});
test('push smoke retains its short window', () => {
  assert.equal(productionCrawlLimits({ JOB_PULSE_MAX_RUN_MINUTES: '2' }).maximumMinutes, 2);
});
test('unsafe overrides cannot raise the eighty-minute or two-lease ceilings', () => {
  assert.deepEqual(productionCrawlLimits({ JOB_PULSE_MAX_RUN_MINUTES: '999', JOB_PULSE_REQUEST_CONCURRENCY: '12' }), { maximumMinutes: 80, requestConcurrency: 2 });
  assert.deepEqual(productionCrawlLimits({ JOB_PULSE_MAX_RUN_MINUTES: '-5', JOB_PULSE_REQUEST_CONCURRENCY: '0' }), { maximumMinutes: 1, requestConcurrency: 1 });
});
test('invalid or empty configuration falls back safely', () => {
  for (const value of ['', '  ', 'NaN', 'Infinity']) {
    assert.deepEqual(productionCrawlLimits({ JOB_PULSE_MAX_RUN_MINUTES: value, JOB_PULSE_REQUEST_CONCURRENCY: value }), { maximumMinutes: 80, requestConcurrency: 2 });
  }
});
test('owner workflow and runner use the same limit without altering single-writer recovery', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-crawl.yml', import.meta.url), 'utf8');
  const runner = await readFile(new URL('../scripts/run-production-crawl.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /crawl:\s*\n[\s\S]*?timeout-minutes: 90/);
  assert.match(workflow, /JOB_PULSE_MAX_RUN_MINUTES:.*'2'.*'80'/);
  assert.match(workflow, /JOB_PULSE_REQUEST_CONCURRENCY: "2"/);
  assert.match(workflow, /REQUEST_FALLBACK_INGEST_CONCURRENCY: "1"/);
  assert.match(workflow, /BROWSER_FALLBACK_INGEST_CONCURRENCY: "1"/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(runner, /productionCrawlLimits\(\)/);
  assert.match(runner, /maxRunMinutes: maximumMinutes/);
});
