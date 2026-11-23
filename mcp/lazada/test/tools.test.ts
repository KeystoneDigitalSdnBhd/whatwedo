import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { TOOL_NAMES } from '../src/tools.js';
import { apiErr, connect, fakeFetch, ok, text } from './helpers.js';

test('lists every tool with annotations; read tools are marked read-only', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const n of ['lazada_list_orders', 'lazada_get_transactions', 'lazada_list_products']) {
    assert.equal(byName.get(n)?.annotations?.readOnlyHint, true, n);
  }
  assert.equal(byName.get('lazada_update_price_quantity')?.annotations?.destructiveHint, true);
});

test('server without credentials still starts and explains what is missing', async () => {
  const server = createServer(loadConfig({}));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const r = await client.callTool({ name: 'lazada_token_status', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /LAZADA_APP_KEY/);
});

test('lazada_list_orders sends defaults, signs, and redacts buyer PII', async () => {
  const f = fakeFetch([
    ok({ count: 1, countTotal: 1, orders: [{ order_id: 99, customer_first_name: 'Siti', price: '42.00', address_billing: { phone: '012', city: 'Ipoh' } }] }),
  ]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({
    name: 'lazada_list_orders',
    arguments: { created_after: '2026-11-01T00:00:00+08:00', status: 'pending' },
  });
  assert.equal(r.isError, undefined);
  const req = f.calls[0]!;
  assert.equal(req.path, '/orders/get');
  assert.equal(req.params.limit, '50');
  assert.equal(req.params.offset, '0');
  assert.equal(req.params.status, 'pending');
  const out = JSON.parse(text(r));
  assert.equal(out.request_id, 'req-ok');
  assert.equal(out.data.orders[0].customer_first_name, '[redacted]');
  assert.equal(out.data.orders[0].address_billing.phone, '[redacted]');
  assert.equal(out.data.orders[0].address_billing.city, 'Ipoh');
  assert.equal(out.data.orders[0].price, '42.00');
});

test('PII redaction can be disabled by the operator', async () => {
  const f = fakeFetch([ok({ orders: [{ customer_first_name: 'Siti' }] })]);
  const { client } = await connect({ LAZADA_REDACT_PII: 'false' }, f.fetch);
  const r = await client.callTool({ name: 'lazada_list_orders', arguments: { update_after: '2026-11-01T00:00:00Z' } });
  assert.equal(JSON.parse(text(r)).data.orders[0].customer_first_name, 'Siti');
});

test('lazada_list_orders requires a lower time bound and validates input', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const r = await client.callTool({ name: 'lazada_list_orders', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /created_after or update_after/);
  const bad = await client.callTool({ name: 'lazada_list_orders', arguments: { created_after: 'yesterday', limit: 500 } });
  assert.equal(bad.isError, true);
});

test('lazada_get_multiple_order_items encodes the id list', async () => {
  const f = fakeFetch([ok([])]);
  const { client } = await connect({}, f.fetch);
  await client.callTool({ name: 'lazada_get_multiple_order_items', arguments: { order_ids: ['1', '22'] } });
  assert.equal(f.calls[0]?.params.order_ids, '[1,22]');
});

test('lazada_list_products sends filter and seller SKU list as JSON', async () => {
  const f = fakeFetch([ok({ products: [] })]);
  const { client } = await connect({}, f.fetch);
  await client.callTool({ name: 'lazada_list_products', arguments: { sku_seller_list: ['A', 'B'], limit: 10 } });
  const p = f.calls[0]!.params;
  assert.equal(p.filter, 'all');
  assert.equal(p.limit, '10');
  assert.equal(p.sku_seller_list, '["A","B"]');
});

test('lazada_get_transactions validates the date range', async () => {
  const f = fakeFetch([ok([])]);
  const { client } = await connect({}, f.fetch);
  const bad = await client.callTool({ name: 'lazada_get_transactions', arguments: { start_time: '2026-11-10', end_time: '2026-11-01' } });
  assert.equal(bad.isError, true);
  const good = await client.callTool({ name: 'lazada_get_transactions', arguments: { start_time: '2026-11-01', end_time: '2026-11-10' } });
  assert.equal(good.isError, undefined);
  assert.equal(f.calls[0]?.path, '/finance/transaction/details/get');
  assert.equal(f.calls[0]?.params.limit, '100');
});

test('writes are blocked unless LAZADA_ENABLE_WRITES=true', async () => {
  const f = fakeFetch([]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({ name: 'lazada_update_price_quantity', arguments: { skus: [{ seller_sku: 'A', quantity: 3 }] } });
  assert.equal(r.isError, true);
  assert.match(text(r), /LAZADA_ENABLE_WRITES/);
  const raw = await client.callTool({ name: 'lazada_api_call', arguments: { api_path: '/order/pack', method: 'POST', params: {} } });
  assert.equal(raw.isError, true);
  assert.equal(f.calls.length, 0, 'nothing reached Lazada');
});

test('price/quantity update posts the XML payload when writes are enabled', async () => {
  const f = fakeFetch([ok({})]);
  const { client } = await connect({ LAZADA_ENABLE_WRITES: 'true' }, f.fetch);
  const r = await client.callTool({
    name: 'lazada_update_price_quantity',
    arguments: { skus: [{ item_id: '1', sku_id: '2', quantity: 7 }] },
  });
  assert.equal(r.isError, undefined, text(r));
  const req = f.calls[0]!;
  assert.equal(req.method, 'POST');
  assert.equal(req.params.payload, '<Request><Product><Skus><Sku><ItemId>1</ItemId><SkuId>2</SkuId><Quantity>7</Quantity></Sku></Skus></Product></Request>');
});

test('lazada_api_call allows GET, rejects /auth/ paths and reserved params', async () => {
  const f = fakeFetch([ok({ items: [] })]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({
    name: 'lazada_api_call',
    arguments: { api_path: '/reverse/getreverseordersforseller', params: { page_size: 10, page_no: 1 } },
  });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(f.calls[0]?.params.page_size, '10');
  const auth = await client.callTool({ name: 'lazada_api_call', arguments: { api_path: '/auth/token/create' } });
  assert.equal(auth.isError, true);
  const reserved = await client.callTool({ name: 'lazada_api_call', arguments: { api_path: '/seller/get', params: { access_token: 'x' } } });
  assert.equal(reserved.isError, true);
  assert.match(text(reserved), /managed by the client/);
});

test('Lazada errors come back as tool errors with request_id and hint', async () => {
  const f = fakeFetch([apiErr('InsufficientPermission', 'no access')]);
  const { client } = await connect({}, f.fetch);
  const r = await client.callTool({ name: 'lazada_get_seller', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /InsufficientPermission/);
  assert.match(text(r), /request_id=req-err/);
  assert.match(text(r), /console/);
});

test('auth URL is built from the app key and never includes the secret', async () => {
  const { client } = await connect({}, fakeFetch([]).fetch);
  const r = await client.callTool({
    name: 'lazada_get_auth_url',
    arguments: { redirect_uri: 'https://keystonedigital.com.my/lazada/callback', state: 'abc' },
  });
  const u = new URL(JSON.parse(text(r)).url);
  assert.equal(u.origin + u.pathname, 'https://auth.lazada.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), '123456');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'abc');
  assert.doesNotMatch(u.toString(), /secret/);
});

test('large results are truncated to protect model context', async () => {
  const big = Array.from({ length: 500 }, (_, i) => ({ order_id: i, note: 'x'.repeat(50) }));
  const f = fakeFetch([ok({ orders: big })]);
  const { client } = await connect({ LAZADA_MAX_RESULT_CHARS: '2000' }, f.fetch);
  const r = await client.callTool({ name: 'lazada_list_orders', arguments: { update_after: '2026-11-01T00:00:00Z' } });
  assert.match(text(r), /\[truncated: \d+ chars total/);
  assert.ok(text(r).length < 2200);
});
