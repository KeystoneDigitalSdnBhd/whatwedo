import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LazadaClient } from '../src/lazada/client.js';
import { fetchOrders, parseOrdersCsv, toSellerOrder } from '../src/lazada/orders.js';

function lazada(pages: Array<Array<Record<string, unknown>>>) {
  const seen: URLSearchParams[] = [];
  const f = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    seen.push(u.searchParams);
    const page = pages[seen.length - 1] ?? [];
    return Response.json({ code: '0', request_id: 'r', data: { count: page.length, orders: page } });
  }) as typeof fetch;
  const c = new LazadaClient({ appKey: '1', appSecret: 's', baseUrl: 'https://api.lazada.sg/rest', authBaseUrl: 'https://auth.lazada.com/rest', fetch: f, sleep: async () => {} });
  c.setTokenProvider({ getAccessToken: async () => 'tok', forceRefresh: async () => false });
  return { c, seen };
}

const raw = (i: number) => ({
  order_id: 1000 + i,
  created_at: '2025-11-11 10:00:00 +0800',
  statuses: ['delivered'],
  price: '1,234.50',
  items_count: 2,
  customer_first_name: 'Siti',
  address_shipping: { phone: '+65 9123 4567', address1: '1 Orchard Rd' },
});

test('fetchOrders pages /orders/get on the SG gateway until a short page', async () => {
  const { c, seen } = lazada([Array.from({ length: 2 }, (_, i) => raw(i)), [raw(2)]]);
  const orders = await fetchOrders(c, '2025-11-01T00:00:00+08:00', '2025-11-30T23:59:59+08:00', { pageSize: 2 });
  assert.equal(orders.length, 3);
  assert.deepEqual(seen.map((s) => s.get('offset')), ['0', '2']);
  assert.equal(seen[0]!.get('created_after'), '2025-11-01T00:00:00+08:00');
  assert.equal(seen[0]!.get('sort_direction'), 'ASC');
});

test('only non-personal order fields are kept', () => {
  const o = toSellerOrder(raw(1))!;
  assert.deepEqual(o, { orderId: '1001', createdAt: '2025-11-11T10:00:00 +0800', status: 'delivered', total: 1234.5, items: 2 });
  assert.doesNotMatch(JSON.stringify(o), /Siti|9123|Orchard/);
});

test('orders with no id, time or price are skipped', () => {
  assert.equal(toSellerOrder({ created_at: 'x', price: '1' }), undefined);
  assert.equal(toSellerOrder({ order_id: 1, price: '1' }), undefined);
  assert.equal(toSellerOrder({ order_id: 1, created_at: '2025-01-01T00:00:00+08:00', price: 'abc' }), undefined);
});

test('CSV import: quoted values, BOM, optional items column, clear errors', () => {
  const csv = '﻿order_id,created_at,status,total,items\n1,2025-11-11 10:00:00+08:00,Delivered,"1,200.00",3\n2,2025-11-12T09:00:00+08:00,canceled,10,1\n';
  const o = parseOrdersCsv(csv);
  assert.equal(o.length, 2);
  assert.deepEqual(o[0], { orderId: '1', createdAt: '2025-11-11T10:00:00+08:00', status: 'delivered', total: 1200, items: 3 });
  assert.throws(() => parseOrdersCsv('id,total\n1,2'), /missing column\(s\): order_id, created_at, status/);
  assert.throws(() => parseOrdersCsv('order_id,created_at,status,total\n1,yesterday,delivered,5'), /row 2/);
});
