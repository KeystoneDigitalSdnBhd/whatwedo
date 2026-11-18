import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { DEFAULT_ORDER_FIELDS, TOOL_NAMES } from '../src/tools.js';
import { NOW_MS, apiErr, connect, fakeFetch, ok, text } from './helpers.js';

test('lists every tool; reads are read-only, writes destructive', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  const by = new Map(tools.map((t) => [t.name, t]));
  for (const n of ['shopee_list_orders', 'shopee_get_order_detail', 'shopee_get_escrow_detail', 'shopee_list_items']) {
    assert.equal(by.get(n)?.annotations?.readOnlyHint, true, n);
  }
  for (const n of ['shopee_update_stock', 'shopee_update_price']) assert.equal(by.get(n)?.annotations?.destructiveHint, true, n);
});

test('unconfigured server starts and explains what is missing', async () => {
  const server = createServer(loadConfig({}));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const r = await client.callTool({ name: 'shopee_token_status', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /SHOPEE_PARTNER_ID/);
});

test('auth URL is signed for auth_partner with the redirect and no secret', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const r = await client.callTool({ name: 'shopee_get_auth_url', arguments: { redirect_url: 'https://keystonedigital.com.my/shopee/callback' } });
  const u = new URL(JSON.parse(text(r)).url);
  assert.equal(u.origin + u.pathname, 'https://partner.shopeemobile.com/api/v2/shop/auth_partner');
  assert.equal(u.searchParams.get('partner_id'), '2001234');
  assert.equal(u.searchParams.get('timestamp'), String(Math.floor(NOW_MS / 1000)));
  assert.equal(u.searchParams.get('redirect'), 'https://keystonedigital.com.my/shopee/callback');
  assert.match(u.searchParams.get('sign') ?? '', /^[0-9a-f]{64}$/);
  assert.doesNotMatch(u.toString(), /shpk_test_key/);
});

test('shopee_list_orders converts ISO times to unix seconds and enforces 15 days', async () => {
  const f = fakeFetch([ok({ more: false, next_cursor: '', order_list: [{ order_sn: '2611180ABCDEFG', order_status: 'READY_TO_SHIP' }] })]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({
    name: 'shopee_list_orders',
    arguments: { time_from: '2026-11-01T00:00:00+08:00', time_to: '2026-11-15T00:00:00+08:00', order_status: 'READY_TO_SHIP' },
  });
  assert.equal(r.isError, undefined, text(r));
  const q = f.calls[0]!.query;
  assert.equal(f.calls[0]!.path, '/api/v2/order/get_order_list');
  assert.equal(q.get('time_range_field'), 'create_time');
  assert.equal(q.get('time_from'), String(Date.parse('2026-11-01T00:00:00+08:00') / 1000));
  assert.equal(q.get('page_size'), '50');
  assert.equal(q.get('cursor'), '');
  assert.equal(q.get('response_optional_fields'), 'order_status');

  const tooLong = await client.callTool({
    name: 'shopee_list_orders',
    arguments: { time_from: '2026-10-01T00:00:00Z', time_to: '2026-11-01T00:00:00Z' },
  });
  assert.equal(tooLong.isError, true);
  assert.match(text(tooLong), /at most 15 days/);
  const backwards = await client.callTool({
    name: 'shopee_list_orders',
    arguments: { time_from: '2026-11-02T00:00:00Z', time_to: '2026-11-01T00:00:00Z' },
  });
  assert.match(text(backwards), /before end/);
  assert.equal(f.calls.length, 1);
});

test('shopee_get_order_detail joins order_sn list, uses default fields, and redacts buyer PII', async () => {
  const f = fakeFetch([
    ok({ order_list: [{ order_sn: '2611180ABCDEFG', buyer_username: 'siti88', recipient_address: { name: 'Siti', city: 'Ipoh' }, total_amount: 42 }] }),
  ]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({ name: 'shopee_get_order_detail', arguments: { order_sn_list: ['2611180ABCDEFG', '2611180HIJKLM'] } });
  const q = f.calls[0]!.query;
  assert.equal(q.get('order_sn_list'), '2611180ABCDEFG,2611180HIJKLM');
  assert.equal(q.get('response_optional_fields'), DEFAULT_ORDER_FIELDS);
  const o = JSON.parse(text(r)).response.order_list[0];
  assert.equal(o.buyer_username, '[redacted]');
  assert.equal(o.recipient_address.name, '[redacted]');
  assert.equal(o.recipient_address.city, 'Ipoh');
  assert.equal(o.total_amount, 42);
});

test('order_sn format is validated', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const r = await client.callTool({ name: 'shopee_get_order_detail', arguments: { order_sn_list: ["x'; DROP"] } });
  assert.equal(r.isError, true);
});

test('shopee_list_items sends repeated item_status and optional update window', async () => {
  const f = fakeFetch([ok({ item: [], has_next_page: false })]);
  const { client } = await connect({}, f.fetch);
  await client.callTool({ name: 'shopee_list_items', arguments: { item_status: ['NORMAL', 'UNLIST'], page_size: 20 } });
  const q = f.calls[0]!.query;
  assert.deepEqual(q.getAll('item_status'), ['NORMAL', 'UNLIST']);
  assert.equal(q.get('page_size'), '20');
  assert.equal(q.get('update_time_from'), null);
  const half = await client.callTool({ name: 'shopee_list_items', arguments: { update_time_from: '2026-11-01T00:00:00Z' } });
  assert.match(text(half), /both/);
});

test('finance tools: escrow detail and wallet transactions', async () => {
  const f = fakeFetch([ok({ order_income: { escrow_amount: 38.2 } }), ok({ transaction_list: [] })]);
  const { client } = await connect({}, f.fetch);
  await client.callTool({ name: 'shopee_get_escrow_detail', arguments: { order_sn: '2611180ABCDEFG' } });
  assert.equal(f.calls[0]!.path, '/api/v2/payment/get_escrow_detail');
  assert.equal(f.calls[0]!.query.get('order_sn'), '2611180ABCDEFG');
  await client.callTool({
    name: 'shopee_list_wallet_transactions',
    arguments: { create_time_from: '2026-11-01T00:00:00Z', create_time_to: '2026-11-10T00:00:00Z' },
  });
  assert.equal(f.calls[1]!.query.get('page_no'), '0');
});

test('writes are blocked unless SHOPEE_ENABLE_WRITES=true', async () => {
  const f = fakeFetch([]);
  const { client } = await connect({}, f.fetch);
  for (const [name, args] of [
    ['shopee_update_stock', { item_id: '1', stock_list: [{ stock: 5 }] }],
    ['shopee_update_price', { item_id: '1', price_list: [{ original_price: 9.9 }] }],
    ['shopee_api_call', { api_path: '/api/v2/logistics/ship_order', method: 'POST', body: {} }],
  ] as const) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, name);
    assert.match(text(r), /SHOPEE_ENABLE_WRITES/);
  }
  assert.equal(f.calls.length, 0);
});

test('update_stock and update_price send the documented JSON bodies when enabled', async () => {
  const f = fakeFetch([ok({ success_list: [], failure_list: [] }), ok({ success_list: [] })]);
  const { client } = await connect({ SHOPEE_ENABLE_WRITES: 'true' }, f.fetch);
  const s = await client.callTool({
    name: 'shopee_update_stock',
    arguments: { item_id: '800', stock_list: [{ stock: 5 }, { model_id: '42', stock: 0, location_id: 'MYZ' }] },
  });
  assert.equal(s.isError, undefined, text(s));
  assert.equal(f.calls[0]!.method, 'POST');
  assert.deepEqual(f.calls[0]!.body, {
    item_id: 800,
    stock_list: [
      { model_id: 0, seller_stock: [{ stock: 5 }] },
      { model_id: 42, seller_stock: [{ location_id: 'MYZ', stock: 0 }] },
    ],
  });
  await client.callTool({ name: 'shopee_update_price', arguments: { item_id: '800', price_list: [{ model_id: '42', original_price: 19.9 }] } });
  assert.deepEqual(f.calls[1]!.body, { item_id: 800, price_list: [{ model_id: 42, original_price: 19.9 }] });
});

test('shopee_api_call: GET allowed, auth/public paths and reserved params refused', async () => {
  const f = fakeFetch([ok({ tracking_info: [] })]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({
    name: 'shopee_api_call',
    arguments: { api_path: '/api/v2/logistics/get_tracking_info', query: { order_sn: '2611180ABCDEFG' } },
  });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(f.calls[0]!.query.get('order_sn'), '2611180ABCDEFG');
  for (const api_path of ['/api/v2/auth/token/get', '/api/v2/shop/auth_partner', '/api/v2/public/get_shops_by_partner']) {
    const x = await client.callTool({ name: 'shopee_api_call', arguments: { api_path } });
    assert.equal(x.isError, true, api_path);
  }
  const reserved = await client.callTool({ name: 'shopee_api_call', arguments: { api_path: '/api/v2/shop/get_shop_info', query: { shop_id: 1 } } });
  assert.match(text(reserved), /managed by the client/);
});

test('Shopee errors surface with request_id and hint', async () => {
  const f = fakeFetch([apiErr('error_permission', 'no permission')]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({ name: 'shopee_get_shop_info', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /error_permission/);
  assert.match(text(r), /request_id=req-err/);
  assert.match(text(r), /console/);
});

test('large results are truncated', async () => {
  const big = Array.from({ length: 400 }, (_, i) => ({ order_sn: `SN${i}`, pad: 'x'.repeat(60) }));
  const f = fakeFetch([ok({ order_list: big })]);
  const { client } = await connect({ SHOPEE_MAX_RESULT_CHARS: '2000' }, f.fetch);
  const r = await client.callTool({ name: 'shopee_list_ready_to_ship', arguments: {} });
  assert.match(text(r), /\[truncated: \d+ chars total/);
});
