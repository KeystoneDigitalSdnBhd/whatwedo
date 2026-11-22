import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, TOOL_NAMES } from '../src/mcp/server.js';
import { buildReport, renderMarkdown } from '../src/report.js';
import { VERSION } from '../src/version.js';
import { fakeMarket, syntheticOrders } from './helpers.js';

const text = (r: unknown) => (r as { content: Array<{ text?: string }> }).content.map((c) => c.text ?? '').join('');

test('report combines synthetic shop orders with real Singapore data', async () => {
  // Synthetic shop: 3 orders a day Jul–Sep 2025, 6 a day Oct 2025–Jan 2026.
  const orders = syntheticOrders('2025-07-01', '2026-01-31', (d) => (d < '2025-10-01' ? 3 : 6));
  const r = await buildReport(fakeMarket(), orders, 'Computer & Telecommunications Equipment', new Date('2026-11-20T00:00:00Z'));
  assert.equal(r.window.from, '2025-07-01');
  assert.equal(r.marketDataThrough, '2025-12');
  assert.equal(r.benchmark.summary.baseMonth, '2025-07');
  assert.equal(r.benchmark.summary.lastMonth, '2025-12');
  assert.equal(r.benchmark.rows.find((x) => x.month === '2026-01')!.marketIndex, null);
  assert.ok(r.sources.some((s) => s.id === 'd_65e4d47c3616d251f9a84ec1ad28f43c'), 'online share is a source for ICT');

  const md = renderMarkdown(r);
  assert.match(md, /# Shop vs Singapore retail: Computer & Telecommunications Equipment/);
  assert.match(md, /Official retail data is published through 2025-12/);
  assert.match(md, /\| 2025-12 \| 186 \| S\$9,300\.00 \|/);
  assert.match(md, /Double-day sale/);
  assert.match(md, /Singapore Open Data Licence version 1\.0/);
  assert.match(md, /https:\/\/data\.gov\.sg\/datasets\/d_8bd9b9872c7fcb456b7d2891a350be34\/view/);
});

test('segments without an online-share series skip it', async () => {
  const r = await buildReport(fakeMarket(), syntheticOrders('2025-10-01', '2025-11-30', () => 1), 'Watches & Jewellery', new Date());
  assert.equal(r.sources.some((s) => s.id === 'd_65e4d47c3616d251f9a84ec1ad28f43c'), false);
  assert.ok(r.benchmark.rows.every((x) => x.onlineShare === null));
  assert.ok(r.benchmark.rows.every((x) => x.marketIndex !== null), 'the retail index itself is still used');
});

test('MCP server lists its tools and serves real market data', async () => {
  const server = createServer({ market: fakeMarket(), version: VERSION });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());

  const r = await client.callTool({ name: 'sg_online_share', arguments: { segment: 'Computer & Telecommunications Equipment', from: '2025-11' } });
  const body = JSON.parse(text(r));
  assert.deepEqual(body.points, [
    { period: '2025-11', value: 60.6 },
    { period: '2025-12', value: 56.5 },
  ]);

  const h = await client.callTool({ name: 'sg_public_holidays', arguments: { from: '2026-12-01', to: '2026-12-31' } });
  assert.deepEqual(JSON.parse(text(h)).map((x: { holiday: string }) => x.holiday), ['Christmas Day']);

  const bad = await client.callTool({ name: 'sg_retail_index', arguments: { segment: 'Groceries' } });
  assert.equal(bad.isError, true);

  const noShop = await client.callTool({ name: 'shop_market_report', arguments: { segment: 'Total', from: '2025-01-01', to: '2025-02-01' } });
  assert.equal(noShop.isError, true);
  assert.match(text(noShop), /LAZADA_APP_KEY/);
});

test('VERSION matches package.json', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});
