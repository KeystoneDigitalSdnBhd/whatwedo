import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DataGovClient, DataGovError } from '../src/datagov/client.js';
import { DATASETS } from '../src/datagov/datasets.js';
import { between, parsePeriod, parseValue, pickSeries, tidy } from '../src/datagov/singstat.js';
import { fakeDataGov, fixture } from './helpers.js';

test('parsePeriod handles SingStat monthly, quarterly and annual headers', () => {
  assert.equal(parsePeriod('2025Dec'), '2025-12');
  assert.equal(parsePeriod('2025 Jan'), '2025-01');
  assert.equal(parsePeriod('2025 4Q'), '2025-Q4');
  assert.equal(parsePeriod('2025'), '2025');
  assert.equal(parsePeriod('DataSeries'), undefined);
  assert.equal(parsePeriod('_id'), undefined);
});

test('parseValue maps "na" and blanks to null', () => {
  assert.equal(parseValue('120.627'), 120.627);
  assert.equal(parseValue('1,234.5'), 1234.5);
  for (const v of ['na', 'NA', '', '-', null, undefined]) assert.equal(parseValue(v), null);
});

test('tidy reads the real Retail Sales Index table: 16 series, hierarchy and ordered points', () => {
  const series = tidy(fixture('retail-index-current').result.records);
  assert.equal(series.length, 16);
  const total = pickSeries(series, 'Total');
  assert.equal(total.level, 0);
  const ict = pickSeries(series, 'computer & telecommunications equipment');
  assert.equal(ict.level, 1);
  assert.deepEqual(ict.path, ['Total', 'Computer & Telecommunications Equipment']);
  assert.equal(ict.points.length, 30);
  assert.equal(ict.points[0]!.period, '2023-07');
  assert.equal(ict.points.at(-1)!.period, '2025-12');
  // Values as published by SingStat on data.gov.sg.
  assert.deepEqual(between(total.points, '2025-09', '2025-12').map((p) => p.value), [103.728, 109.931, 111.575, 120.627]);
  const exMv = pickSeries(series, 'Total (Excluding Motor Vehicles)');
  assert.equal(exMv.level, 0, 'a second top-level series resets the hierarchy');
});

test('tidy keeps deep CPI hierarchy (4 spaces per level)', () => {
  const series = tidy(fixture('cpi').result.records);
  const rice = pickSeries(series, 'Rice');
  assert.equal(rice.level, 3);
  // In SingStat's table "Food Excl …" is a sibling of "Food", so Rice hangs under it.
  assert.deepEqual(rice.path, ['All Items', 'Food Excl Food & Beverage Serving Services', 'Rice & Cereal Products', 'Rice']);
  assert.equal(pickSeries(series, 'All Items').points.at(-1)!.period, '2026-09');
});

test('pickSeries lists what exists when a name is wrong', () => {
  assert.throws(() => pickSeries(tidy(fixture('online-share').result.records), 'Groceries'), /Available: Retail Trade; /);
});

test('client pages through the datastore and always sends a User-Agent', async () => {
  const f = fakeDataGov();
  const c = new DataGovClient({ fetch: f.fetch, pageSize: 40 });
  const t = await c.table(DATASETS.publicHolidays.id);
  assert.equal(t.records.length, 104);
  assert.deepEqual(f.calls.map((u) => u.searchParams.get('offset')), ['0', '40', '80']);
  assert.deepEqual(t.fields, ['date', 'day', 'holiday']);
});

test('client retries 429 honouring Retry-After, then succeeds', async () => {
  const waits: number[] = [];
  let n = 0;
  const f = (async () => {
    n++;
    if (n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '3' } });
    return Response.json({ success: true, result: { total: 1, fields: [{ id: 'a' }], records: [{ a: 1 }] } });
  }) as typeof fetch;
  const c = new DataGovClient({ fetch: f, sleep: async (ms) => void waits.push(ms) });
  const t = await c.table('d_' + '0'.repeat(32));
  assert.equal(t.records.length, 1);
  assert.deepEqual(waits, [3000]);
});

test('client gives a clear error after repeated 429s', async () => {
  const f = (async () => new Response('', { status: 429 })) as typeof fetch;
  const c = new DataGovClient({ fetch: f, sleep: async () => {}, maxRetries: 2 });
  await assert.rejects(c.table('d_' + '1'.repeat(32)), (e: unknown) => e instanceof DataGovError && /DATAGOV_API_KEY/.test(e.message));
});

test('client sends x-api-key only when configured', async () => {
  const seen: Array<string | undefined> = [];
  const f = (async (_u: unknown, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>)['x-api-key']);
    return Response.json({ success: true, result: { total: 0, fields: [], records: [] } });
  }) as typeof fetch;
  await new DataGovClient({ fetch: f }).table('d_' + '2'.repeat(32));
  await new DataGovClient({ fetch: f, apiKey: 'k' }).table('d_' + '3'.repeat(32));
  assert.deepEqual(seen, [undefined, 'k']);
});

test('client rejects malformed ids and unsuccessful responses', async () => {
  const c = new DataGovClient({ fetch: fakeDataGov().fetch });
  await assert.rejects(c.table('retail'), /not a data.gov.sg dataset id/);
  await assert.rejects(c.table('d_' + 'f'.repeat(32)), /could not read dataset/);
});

test('disk cache serves fresh tables without a request and refetches stale ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgmi-cache-'));
  let clock = Date.parse('2026-11-20T00:00:00Z');
  const f = fakeDataGov();
  const c = new DataGovClient({ fetch: f.fetch, cacheDir: dir, cacheTtlMs: 3_600_000, now: () => clock });
  await c.table(DATASETS.onlineShare.id);
  await c.table(DATASETS.onlineShare.id);
  assert.equal(f.calls.length, 1);
  clock += 2 * 3_600_000;
  await c.table(DATASETS.onlineShare.id);
  assert.equal(f.calls.length, 2);
});
