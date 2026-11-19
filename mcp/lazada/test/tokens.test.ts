import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LazadaClient } from '../src/client.js';
import { LazadaAuthError } from '../src/errors.js';
import { TokenManager } from '../src/tokens.js';
import { fakeFetch, noSleep, ok, type Responder } from './helpers.js';

let clock = 1_763_424_000_000;
const now = () => clock;

function setup(responder: Responder, opts: ConstructorParameters<typeof TokenManager>[1] = {}) {
  const f = fakeFetch(responder);
  const client = new LazadaClient({
    appKey: '123456',
    appSecret: 'secret',
    baseUrl: 'https://api.lazada.com.my/rest',
    authBaseUrl: 'https://auth.lazada.com/rest',
    fetch: f.fetch,
    now,
    sleep: noSleep,
  });
  const tm = new TokenManager(client, { now, ...opts });
  client.setTokenProvider(tm);
  return { f, client, tm };
}

const tokenBody = (n: number) => ({
  body: {
    code: '0',
    request_id: `r${n}`,
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 3600,
    refresh_expires_in: 86_400,
    account: 'seller@example.com',
    country: 'my',
    country_user_info: [{ country: 'my', seller_id: '100', user_id: '200', short_code: 'MY1' }],
  },
});

async function tmpFile() {
  return join(await mkdtemp(join(tmpdir(), 'lazada-mcp-')), 'nested', 'tokens.json');
}

test('no token configured gives an actionable auth error', async () => {
  const { tm } = setup(() => ok({}));
  await assert.rejects(tm.getAccessToken(), (e: unknown) => e instanceof LazadaAuthError && /lazada_get_auth_url/.test(e.message));
});

test('exchangeCode stores tokens, persists 0600 file, and status hides secrets', async () => {
  const file = await tmpFile();
  let n = 0;
  const { f, tm } = setup(() => tokenBody(++n), { tokenFile: file });
  const status = await tm.exchangeCode('the-code');
  assert.equal(f.calls[0]?.path, '/auth/token/create');
  assert.equal(f.calls[0]?.params.code, 'the-code');
  assert.equal(status.authorized, true);
  assert.equal(status.account, 'seller@example.com');
  assert.equal(status.hasRefreshToken, true);
  assert.doesNotMatch(JSON.stringify(status), /access-1|refresh-1/);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.accessToken, 'access-1');
  assert.equal(saved.countryUserInfo[0].seller_id, '100');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await tm.getAccessToken(), 'access-1');
});

test('token file is loaded on start and takes precedence over env', async () => {
  const file = await tmpFile();
  const { tm: first } = setup(() => tokenBody(1), { tokenFile: file });
  await first.exchangeCode('c');
  const { tm } = setup(() => ok({}), { tokenFile: file, initial: { accessToken: 'env-token' } });
  assert.equal(await tm.getAccessToken(), 'access-1');
  assert.equal((await tm.status()).source, 'file');
});

test('refreshes automatically inside the expiry skew window and rotates refresh token', async () => {
  let n = 0;
  const { f, tm } = setup(() => tokenBody(++n));
  await tm.exchangeCode('c');
  clock += 3600_000 - 5 * 60_000; // 5 min before expiry (< 10 min skew)
  assert.equal(await tm.getAccessToken(), 'access-2');
  assert.equal(f.calls[1]?.path, '/auth/token/refresh');
  assert.equal(f.calls[1]?.params.refresh_token, 'refresh-1');
});

test('concurrent refreshes share one request', async () => {
  let n = 0;
  const { f, tm } = setup(() => tokenBody(++n), { initial: { refreshToken: 'seed' } });
  const results = await Promise.all([tm.getAccessToken(), tm.getAccessToken(), tm.getAccessToken()]);
  assert.deepEqual(results, ['access-1', 'access-1', 'access-1']);
  assert.equal(f.calls.length, 1);
});

test('expired access token without a refresh token is an auth error', async () => {
  const file = await tmpFile();
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ accessToken: 'old', expiresAt: clock - 1 }));
  const { tm } = setup(() => ok({}), { tokenFile: file });
  await assert.rejects(tm.getAccessToken(), /expired/);
});

test('forceRefresh returns false when refresh is impossible', async () => {
  const { tm } = setup(() => ok({}), { initial: { accessToken: 'only-access' } });
  assert.equal(await tm.forceRefresh(), false);
});

test('a token response without access_token is rejected', async () => {
  const { tm } = setup(() => ok({}));
  await assert.rejects(tm.exchangeCode('c'), /did not contain an access_token/);
});
