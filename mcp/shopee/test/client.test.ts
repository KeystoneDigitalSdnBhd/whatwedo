import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShopeeClient, normalizeQuery } from '../src/client.js';
import { ShopeeApiError, ShopeeHttpError, ShopeeNetworkError } from '../src/errors.js';
import { sign } from '../src/signer.js';
import { NOW_MS, apiErr, fakeFetch, noSleep, ok } from './helpers.js';

const TS = Math.floor(NOW_MS / 1000);

function make(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof ShopeeClient>[0]> = {}) {
  const c = new ShopeeClient({
    partnerId: 2001234,
    partnerKey: 'shpk_test_key',
    baseUrl: 'https://partner.shopeemobile.com',
    fetch: fetchImpl,
    now: () => NOW_MS,
    sleep: noSleep,
    ...extra,
  });
  let token = 'tok';
  let refreshes = 0;
  c.setTokenProvider({
    getCredentials: async () => ({ accessToken: token, shopId: 556677 }),
    forceRefresh: async () => {
      refreshes++;
      token = 'tok2';
      return true;
    },
  });
  return { c, refreshes: () => refreshes };
}

test('shop GET: common params in query, seconds timestamp, valid shop signature', async () => {
  const f = fakeFetch([ok({ order_list: [] })]);
  const { c } = make(f.fetch);
  await c.call('/api/v2/order/get_order_list', { time_range_field: 'create_time', page_size: 50 });
  const r = f.calls[0]!;
  assert.equal(r.method, 'GET');
  assert.equal(r.url.origin + r.path, 'https://partner.shopeemobile.com/api/v2/order/get_order_list');
  assert.equal(r.query.get('partner_id'), '2001234');
  assert.equal(r.query.get('timestamp'), String(TS));
  assert.equal(r.query.get('access_token'), 'tok');
  assert.equal(r.query.get('shop_id'), '556677');
  assert.equal(r.query.get('page_size'), '50');
  assert.equal(
    r.query.get('sign'),
    sign({ partnerId: 2001234, path: '/api/v2/order/get_order_list', timestamp: TS, accessToken: 'tok', shopId: 556677 }, 'shpk_test_key'),
  );
});

test('public POST: JSON body, no access_token/shop_id, public signature', async () => {
  const f = fakeFetch([{ body: { request_id: 'r', error: '', access_token: 'a' } }]);
  const { c } = make(f.fetch);
  await c.call('/api/v2/auth/token/get', {}, { method: 'POST', auth: false, body: { code: 'x', shop_id: 1, partner_id: 2001234 } });
  const r = f.calls[0]!;
  assert.equal(r.method, 'POST');
  assert.equal(r.headers['content-type'], 'application/json');
  assert.deepEqual(r.body, { code: 'x', shop_id: 1, partner_id: 2001234 });
  assert.equal(r.query.get('access_token'), null);
  assert.equal(r.query.get('shop_id'), null);
  assert.equal(r.query.get('sign'), sign({ partnerId: 2001234, path: '/api/v2/auth/token/get', timestamp: TS }, 'shpk_test_key'));
});

test('array query values become repeated keys', async () => {
  const f = fakeFetch([ok({})]);
  const { c } = make(f.fetch);
  await c.call('/api/v2/product/get_item_list', { item_status: ['NORMAL', 'UNLIST'], offset: 0 });
  assert.deepEqual(f.calls[0]!.query.getAll('item_status'), ['NORMAL', 'UNLIST']);
});

test('non-empty error becomes ShopeeApiError, even with HTTP 4xx', async () => {
  const f = fakeFetch([apiErr('error_param', 'time range too large', 400)]);
  const { c } = make(f.fetch);
  await assert.rejects(c.call('/api/v2/order/get_order_list'), (e: unknown) => {
    assert.ok(e instanceof ShopeeApiError);
    assert.equal(e.code, 'error_param');
    assert.equal(e.requestId, 'req-err');
    assert.equal(e.httpStatus, 400);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('rate limit is retried with backoff for GET and POST', async () => {
  const delays: number[] = [];
  const f = fakeFetch([apiErr('error_too_many_request', 'slow down', 429), ok({})]);
  const { c } = make(f.fetch, { sleep: async (ms) => void delays.push(ms), random: () => 0.5 });
  await c.call('/api/v2/product/update_stock', {}, { method: 'POST', body: { item_id: 1 } });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(delays, [750]);
});

test('transient server errors are retried for GET only', async () => {
  const g = fakeFetch([apiErr('error_server', 'busy', 500), ok({})]);
  await make(g.fetch).c.call('/api/v2/shop/get_shop_info');
  assert.equal(g.calls.length, 2);

  const p = fakeFetch([apiErr('error_server', 'busy', 500)]);
  await assert.rejects(make(p.fetch).c.call('/api/v2/product/update_price', {}, { method: 'POST', body: {} }), ShopeeApiError);
  assert.equal(p.calls.length, 1, 'POST is not replayed');
});

test('invalid access token triggers one refresh and retry (both spellings)', async () => {
  for (const code of ['invalid_access_token', 'invalid_acceess_token']) {
    const f = fakeFetch([apiErr(code, 'Invalid access_token.', 403), ok({})]);
    const { c, refreshes } = make(f.fetch);
    await c.call('/api/v2/shop/get_shop_info');
    assert.equal(refreshes(), 1, code);
    assert.equal(f.calls[1]!.query.get('access_token'), 'tok2');
  }
});

test('error_auth about access token also refreshes; other error_auth does not', async () => {
  const f = fakeFetch([apiErr('error_auth', 'Invalid access_token'), ok({})]);
  const a = make(f.fetch);
  await a.c.call('/api/v2/shop/get_shop_info');
  assert.equal(a.refreshes(), 1);

  const g = fakeFetch([apiErr('error_auth', 'no permission to this shop')]);
  const b = make(g.fetch);
  await assert.rejects(b.c.call('/api/v2/shop/get_shop_info'), ShopeeApiError);
  assert.equal(b.refreshes(), 0);
});

test('timeout becomes ShopeeNetworkError without leaking token or sign', async () => {
  const hang = (async (_u: unknown, init?: RequestInit) =>
    new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  const { c } = make(hang, { timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(c.call('/api/v2/shop/get_shop_info'), (e: unknown) => {
    assert.ok(e instanceof ShopeeNetworkError && e.timedOut);
    assert.doesNotMatch((e as Error).message, /tok|sign=|access_token/);
    return true;
  });
});

test('HTTP error without envelope and non-JSON bodies', async () => {
  await assert.rejects(make(fakeFetch([{ status: 502, body: '<html/>' }]).fetch, { maxRetries: 0 }).c.call('/api/v2/shop/get_shop_info'), ShopeeHttpError);
  await assert.rejects(make(fakeFetch([{ status: 404, body: {} }]).fetch).c.call('/api/v2/shop/get_shop_info'), /HTTP 404/);
});

test('path validation and GET-with-body are rejected', async () => {
  const { c } = make(fakeFetch([]).fetch);
  for (const p of ['/api/v1/shop/get', 'api/v2/shop/get', '/api/v2/shop', '/api/v2/Shop/Get', '/api/v2/shop/get?x=1', '/api/v2/../x']) {
    await assert.rejects(c.call(p), /Invalid Shopee API path/, p);
  }
  await assert.rejects(c.call('/api/v2/shop/get_shop_info', {}, { body: { a: 1 } }), /cannot have a body/);
});

test('normalizeQuery refuses reserved keys and drops empties', () => {
  assert.deepEqual(normalizeQuery({ a: 1, b: undefined, c: null, d: [1, 'x'], e: false }), [
    ['a', '1'],
    ['d', '1'],
    ['d', 'x'],
    ['e', 'false'],
  ]);
  for (const k of ['partner_id', 'timestamp', 'sign', 'access_token', 'shop_id', 'merchant_id']) {
    assert.throws(() => normalizeQuery({ [k]: '1' }), /managed by the client/);
  }
});
