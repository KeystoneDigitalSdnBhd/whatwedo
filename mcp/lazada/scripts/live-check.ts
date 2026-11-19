// Read-only contract check against the real Lazada gateway. This is the only test
// that proves the signature algorithm and endpoints match production.
//
//   LAZADA_APP_KEY=... LAZADA_APP_SECRET=... LAZADA_ACCESS_TOKEN=... npm run live-check
//
// Prints only non-personal metadata. Exits 2 (skipped) when credentials are absent.
import { LazadaClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/errors.js';
import { TokenManager } from '../src/tokens.js';

const config = loadConfig();
if (!config.appKey || !config.appSecret || !(config.accessToken || config.refreshToken || config.tokenFile)) {
  console.log('live-check: skipped (set LAZADA_APP_KEY, LAZADA_APP_SECRET and LAZADA_ACCESS_TOKEN or LAZADA_REFRESH_TOKEN)');
  process.exit(2);
}

const client = new LazadaClient({
  appKey: config.appKey,
  appSecret: config.appSecret,
  baseUrl: config.baseUrl,
  authBaseUrl: config.authBaseUrl,
  timeoutMs: config.timeoutMs,
  maxRetries: 1,
});
const tokens = new TokenManager(client, {
  tokenFile: config.tokenFile,
  initial: { accessToken: config.accessToken, refreshToken: config.refreshToken },
});
client.setTokenProvider(tokens);

const checks: Array<[string, () => Promise<string>]> = [
  [
    '/seller/get',
    async () => {
      const r = await client.call<Record<string, unknown>>('/seller/get');
      return `seller_id=${String(r.data?.seller_id ?? '?')} location=${String(r.data?.location ?? '?')}`;
    },
  ],
  [
    '/orders/get',
    async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const r = await client.call<{ countTotal?: number; count?: number }>('/orders/get', { update_after: since, limit: 1 });
      return `orders updated in last 7 days: ${r.data?.countTotal ?? r.data?.count ?? '?'}`;
    },
  ],
  [
    '/products/get',
    async () => {
      const r = await client.call<{ total_products?: number }>('/products/get', { filter: 'all', limit: 1, offset: 0 });
      return `total products: ${r.data?.total_products ?? '?'}`;
    },
  ],
];

let failed = 0;
console.log(`live-check: region=${config.region} gateway=${config.baseUrl}`);
for (const [name, fn] of checks) {
  try {
    console.log(`  ok   ${name}  ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}  ${describeError(err).replace(/\n/g, ' | ')}`);
  }
}
process.exit(failed ? 1 : 0);
