// Read-only contract check against the real Shopee gateway: the only test that
// proves signing, hosts and response shapes match production.
//
//   SHOPEE_PARTNER_ID=... SHOPEE_PARTNER_KEY=... SHOPEE_SHOP_ID=... \
//   SHOPEE_REFRESH_TOKEN=... SHOPEE_TOKEN_FILE=./shop.tokens.json npm run live-check
//
// Because Shopee rotates refresh tokens, give it a SHOPEE_TOKEN_FILE (or update the
// stored secret afterwards) when starting from a refresh token. Prints only
// non-personal metadata. Exits 2 (skipped) when credentials are absent.
import { ShopeeClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/errors.js';
import { TokenManager } from '../src/tokens.js';

const config = loadConfig();
if (config.partnerId === undefined || !config.partnerKey || config.shopId === undefined || !(config.accessToken || config.refreshToken || config.tokenFile)) {
  console.log('live-check: skipped (set SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_SHOP_ID and SHOPEE_ACCESS_TOKEN or SHOPEE_REFRESH_TOKEN)');
  process.exit(2);
}

const client = new ShopeeClient({
  partnerId: config.partnerId,
  partnerKey: config.partnerKey,
  baseUrl: config.baseUrl,
  timeoutMs: config.timeoutMs,
  maxRetries: 1,
});
const tokens = new TokenManager(client, {
  tokenFile: config.tokenFile,
  shopId: config.shopId,
  initial: { accessToken: config.accessToken, refreshToken: config.refreshToken },
});
client.setTokenProvider(tokens);

const nowS = Math.floor(Date.now() / 1000);
const checks: Array<[string, () => Promise<string>]> = [
  [
    'shop/get_shop_info',
    async () => {
      const r = await client.call<Record<string, unknown>>('/api/v2/shop/get_shop_info');
      return `region=${String(r.response?.region ?? (r as Record<string, unknown>).region ?? '?')} status=${String(r.response?.status ?? (r as Record<string, unknown>).status ?? '?')}`;
    },
  ],
  [
    'order/get_order_list',
    async () => {
      const r = await client.call<{ order_list?: unknown[]; more?: boolean }>('/api/v2/order/get_order_list', {
        time_range_field: 'update_time',
        time_from: nowS - 7 * 86_400,
        time_to: nowS,
        page_size: 20,
        cursor: '',
      });
      return `orders updated in last 7 days (first page): ${r.response?.order_list?.length ?? '?'} more=${String(r.response?.more)}`;
    },
  ],
  [
    'product/get_item_list',
    async () => {
      const r = await client.call<{ total_count?: number }>('/api/v2/product/get_item_list', { offset: 0, page_size: 1, item_status: ['NORMAL'] });
      return `NORMAL items: ${r.response?.total_count ?? '?'}`;
    },
  ],
];

let failed = 0;
console.log(`live-check: env=${config.env} gateway=${config.baseUrl} shop=${config.shopId}`);
for (const [name, fn] of checks) {
  try {
    console.log(`  ok   ${name}  ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}  ${describeError(err).replace(/\n/g, ' | ')}`);
  }
}
const s = await tokens.status();
console.log(`  token: source=${s.source} access_expires=${s.accessTokenExpiresAt ?? '?'} persisted=${s.persisted}`);
process.exit(failed ? 1 : 0);
