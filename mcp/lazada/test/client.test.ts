import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LazadaClient, normalizeParams } from '../src/client.js';
import { LazadaApiError, LazadaHttpError, LazadaNetworkError } from '../src/errors.js';
import { signRequest } from '../src/signer.js';
import { apiErr, fakeFetch, noSleep, ok } from './helpers.js';

const NOW = 1_763_424_000_000;

function make(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof LazadaClient>[0]> = {}) {
  const c = new LazadaClient({
    appKey: '123456',
    appSecret: 'secret',
    baseUrl: 'https://api.lazada.com.my/rest',
    authBaseUrl: 'https://auth.lazada.com/rest',
    fetch: fetchImpl,
    now: () => NOW,
    sleep: noSleep,
    ...extra,
  });
  let token = 'tok';
  let refreshes = 0;
  c.setTokenProvider({
    getAccessToken: async () => token,
    forceRefresh: async () => {
      refreshes++;
      token = 'tok2';
      return true;
    },
  });
  return { c, refreshes: () => refreshes };
}

function assertSigned(params: Record<string, string>, path: string) {
  const { sign, ...rest } = params;
  assert.equal(sign, signRequest(path, rest, 'secret'));
}

test('GET sends system params in the query and a valid signature', async () => {
  const f = fakeFetch([ok({ orders: [] })]);
  const { c } = make(f.fetch);
  const res = await c.call('/orders/get', { created_after: '2026-11-01T00:00:00+08:00', limit: 50 });
  assert.equal(res.code, '0');
  const [req] = f.calls;
  assert.ok(req);
  assert.equal(req.method, 'GET');
  assert.equal(req.url.origin + req.url.pathname, 'https://api.lazada.com.my/rest/orders/get');
  assert.equal(req.params.app_key, '123456');
  assert.equal(req.params.timestamp, String(NOW));
  assert.equal(req.params.sign_method, 'sha256');
  assert.equal(req.params.access_token, 'tok');
  assert.equal(req.params.limit, '50');
  assertSigned(req.params, '/orders/get');
});

test('POST sends a form-encoded body to the auth gateway when authApi is set', async () => {
  const f = fakeFetch([ok(null, { access_token: 'a' })]);
  const { c } = make(f.fetch);
  await c.call('/auth/token/create', { code: 'xyz' }, { method: 'POST', auth: false, authApi: true });
  const [req] = f.calls;
  assert.ok(req);
  assert.equal(req.url.toString(), 'https://auth.lazada.com/rest/auth/token/create');
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded;charset=utf-8');
  assert.equal(req.params.code, 'xyz');
  assert.equal(req.params.access_token, undefined);
  assertSigned(req.params, '/auth/token/create');
});

test('non-zero code becomes LazadaApiError with request_id', async () => {
  const f = fakeFetch([apiErr('InvalidParameter', 'bad limit')]);
  const { c } = make(f.fetch);
  await assert.rejects(c.call('/orders/get'), (e: unknown) => {
    assert.ok(e instanceof LazadaApiError);
    assert.equal(e.code, 'InvalidParameter');
    assert.equal(e.requestId, 'req-err');
    return true;
  });
  assert.equal(f.calls.length, 1, 'client errors are not retried');
});

test('ApiCallLimit is retried with backoff, then succeeds', async () => {
  const f = fakeFetch([apiErr('ApiCallLimit'), apiErr('ApiCallLimit'), ok({})]);
  const delays: number[] = [];
  const { c } = make(f.fetch, { sleep: async (ms) => void delays.push(ms), random: () => 0.5 });
  await c.call('/orders/get');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(delays, [750, 1500]);
});

test('retries stop at maxRetries', async () => {
  const f = fakeFetch(() => ({ status: 503, body: 'upstream down' }));
  const { c } = make(f.fetch, { maxRetries: 2 });
  await assert.rejects(c.call('/orders/get'), LazadaHttpError);
  assert.equal(f.calls.length, 3);
});

test('POST is not retried on 5xx (it may have been applied)', async () => {
  const f = fakeFetch(() => ({ status: 502, body: '<html>bad gateway</html>' }));
  const { c } = make(f.fetch);
  await assert.rejects(c.call('/product/price_quantity/update', { payload: '<x/>' }, { method: 'POST' }), LazadaHttpError);
  assert.equal(f.calls.length, 1);
});

test('POST is retried on ApiCallLimit (rejected before processing)', async () => {
  const f = fakeFetch([apiErr('ApiCallLimit'), ok({})]);
  const { c } = make(f.fetch);
  await c.call('/product/price_quantity/update', { payload: '<x/>' }, { method: 'POST' });
  assert.equal(f.calls.length, 2);
});

test('IllegalAccessToken triggers one forced refresh and a retry with the new token', async () => {
  const f = fakeFetch([apiErr('IllegalAccessToken'), ok({})]);
  const { c, refreshes } = make(f.fetch);
  await c.call('/seller/get');
  assert.equal(refreshes(), 1);
  assert.equal(f.calls[0]?.params.access_token, 'tok');
  assert.equal(f.calls[1]?.params.access_token, 'tok2');
});

test('a second auth failure after refresh surfaces the error', async () => {
  const f = fakeFetch([apiErr('IllegalAccessToken'), apiErr('IllegalAccessToken')]);
  const { c, refreshes } = make(f.fetch);
  await assert.rejects(c.call('/seller/get'), LazadaApiError);
  assert.equal(refreshes(), 1);
});

test('timeouts become LazadaNetworkError without leaking the URL or token', async () => {
  const hang = (async (_u: unknown, init?: RequestInit) =>
    new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  const { c } = make(hang, { timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(c.call('/orders/get'), (e: unknown) => {
    assert.ok(e instanceof LazadaNetworkError);
    assert.ok(e.timedOut);
    assert.doesNotMatch(e.message, /tok|access_token|sign=/);
    return true;
  });
});

test('non-JSON 200 response is an HTTP error', async () => {
  const f = fakeFetch([{ body: 'not json' }]);
  const { c } = make(f.fetch);
  await assert.rejects(c.call('/orders/get'), LazadaHttpError);
});

test('rejects malformed API paths', async () => {
  const { c } = make(fakeFetch([]).fetch);
  for (const p of ['orders/get', '/orders/get?x=1', '/../x', '/a b', 'https://evil/x']) {
    await assert.rejects(c.call(p), /Invalid Lazada API path/);
  }
});

test('normalizeParams stringifies, drops nulls and refuses reserved keys', () => {
  assert.deepEqual(normalizeParams({ a: 1, b: true, c: null, d: undefined, e: ['x'], f: { g: 1 } }), {
    a: '1',
    b: 'true',
    e: '["x"]',
    f: '{"g":1}',
  });
  for (const k of ['app_key', 'sign', 'access_token', 'timestamp', 'sign_method']) {
    assert.throws(() => normalizeParams({ [k]: 'x' }), /managed by the client/);
  }
});
