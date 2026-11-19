import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ShopeeClient } from '../src/client.js';
import { ShopeeAuthError } from '../src/errors.js';
import { REFRESH_TOKEN_TTL_MS } from '../src/hosts.js';
import { TokenManager } from '../src/tokens.js';
import { fakeFetch, noSleep, ok, type Reply, type Responder } from './helpers.js';

let clock = 1_763_424_000_000;
const now = () => clock;

function setup(responder: Responder | Reply[], opts: ConstructorParameters<typeof TokenManager>[1] = {}) {
  const f = fakeFetch(responder);
  const client = new ShopeeClient({
    partnerId: 2001234,
    partnerKey: 'k',
    baseUrl: 'https://partner.shopeemobile.com',
    fetch: f.fetch,
    now,
    sleep: noSleep,
  });
  const tm = new TokenManager(client, { now, ...opts });
  client.setTokenProvider(tm);
  return { f, tm };
}

const tokenReply = (n: number, extra: Record<string, unknown> = {}): Reply => ({
  body: { request_id: `r${n}`, error: '', message: '', access_token: `access-${n}`, refresh_token: `refresh-${n}`, expire_in: 14_400, ...extra },
});

async function tmpFile() {
  return join(await mkdtemp(join(tmpdir(), 'shopee-mcp-')), 'nested', 'tokens.json');
}

test('no shop configured gives an actionable error', async () => {
  const { tm } = setup([]);
  await assert.rejects(tm.getCredentials(), (e: unknown) => e instanceof ShopeeAuthError && /shopee_get_auth_url/.test(e.message));
});

test('env tokens require SHOPEE_SHOP_ID', async () => {
  const { tm } = setup([], { initial: { accessToken: 'a' } });
  await assert.rejects(tm.getCredentials(), /SHOPEE_SHOP_ID is required/);
});

test('exchangeCode (shop authorization) persists a 0600 file and hides secrets', async () => {
  const file = await tmpFile();
  let n = 0;
  const { f, tm } = setup(() => tokenReply(++n), { tokenFile: file });
  const status = await tm.exchangeCode('the-code', { shopId: 556677 });
  const r = f.calls[0]!;
  assert.equal(r.path, '/api/v2/auth/token/get');
  assert.deepEqual(r.body, { code: 'the-code', partner_id: 2001234, shop_id: 556677 });
  assert.equal(status.shopId, 556677);
  assert.equal(status.hasRefreshToken, true);
  assert.equal(status.accessTokenExpiresAt, new Date(clock + 14_400_000).toISOString());
  assert.equal(status.refreshTokenExpiresAt, new Date(clock + REFRESH_TOKEN_TTL_MS).toISOString());
  assert.doesNotMatch(JSON.stringify(status), /access-1|refresh-1/);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.accessToken, 'access-1');
  assert.equal(saved.shopId, 556677);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await tm.getCredentials(), { accessToken: 'access-1', shopId: 556677 });
});

test('main-account authorization picks SHOPEE_SHOP_ID from shop_id_list, or rejects a foreign shop', async () => {
  const { f, tm } = setup([tokenReply(1, { shop_id_list: [111, 222], merchant_id_list: [9] })], { shopId: 222 });
  const s = await tm.exchangeCode('c', { mainAccountId: 77 });
  assert.deepEqual(f.calls[0]!.body, { code: 'c', partner_id: 2001234, main_account_id: 77 });
  assert.equal(s.shopId, 222);
  assert.deepEqual(s.shopIdList, [111, 222]);

  const { tm: other } = setup([tokenReply(1, { shop_id_list: [111] })], { shopId: 999 });
  await assert.rejects(other.exchangeCode('c', { mainAccountId: 77 }), /not among the authorized shops/);
});

test('exchangeCode needs exactly one of shop_id / main_account_id', async () => {
  const { tm } = setup([]);
  await assert.rejects(tm.exchangeCode('c', {}), /exactly one/);
  await assert.rejects(tm.exchangeCode('c', { shopId: 1, mainAccountId: 2 }), /exactly one/);
});

test('auto-refresh near expiry sends refresh_token + shop_id and rotates the refresh token', async () => {
  let n = 0;
  const { f, tm } = setup(() => tokenReply(++n));
  await tm.exchangeCode('c', { shopId: 556677 });
  clock += 14_400_000 - 5 * 60_000;
  assert.equal((await tm.getCredentials()).accessToken, 'access-2');
  assert.equal(f.calls[1]!.path, '/api/v2/auth/access_token/get');
  assert.deepEqual(f.calls[1]!.body, { refresh_token: 'refresh-1', partner_id: 2001234, shop_id: 556677 });
  clock += 14_400_000;
  await tm.getCredentials();
  assert.equal(f.calls[2]!.body?.refresh_token, 'refresh-2', 'uses the rotated token');
});

test('concurrent callers share one refresh (old refresh token would be invalid)', async () => {
  let n = 0;
  const { f, tm } = setup(() => tokenReply(++n), { shopId: 556677, initial: { refreshToken: 'seed' } });
  const r = await Promise.all([tm.getCredentials(), tm.getCredentials(), tm.getCredentials()]);
  assert.deepEqual(new Set(r.map((x) => x.accessToken)), new Set(['access-1']));
  assert.equal(f.calls.length, 1);
});

test('token file for a different shop is refused', async () => {
  const file = await tmpFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ accessToken: 'a', shopId: 1 }));
  const { tm } = setup([], { tokenFile: file, shopId: 2 });
  await assert.rejects(tm.getCredentials(), /belongs to shop 1/);
});

test('expired token without refresh token is an auth error; forceRefresh reports false', async () => {
  const file = await tmpFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ accessToken: 'a', shopId: 1, expiresAt: clock - 1 }));
  const { tm } = setup([], { tokenFile: file });
  await assert.rejects(tm.getCredentials(), /expired/);
  assert.equal(await tm.forceRefresh(), false);
});

test('token response without access_token is rejected', async () => {
  const { tm } = setup([ok({})]);
  await assert.rejects(tm.exchangeCode('c', { shopId: 1 }), /did not contain an access_token/);
});
