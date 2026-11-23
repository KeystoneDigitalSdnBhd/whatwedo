import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShopeeClient } from './client.js';
import type { Config } from './config.js';
import { TokenManager } from './tokens.js';
import { registerTools } from './tools.js';
import { VERSION } from './version.js';

export interface ServerOverrides {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const INSTRUCTIONS = `Shopee Open Platform v2 tools for one shop.
- Start with shopee_token_status. If not authorized: shopee_get_auth_url -> seller approves -> shopee_exchange_code with code and shop_id from the redirect.
- Orders are two-step: shopee_list_orders (order_sn list, max 15-day window, cursor paging) then shopee_get_order_detail (up to 50 order_sn).
- Income per order: shopee_get_escrow_detail. Ledger: shopee_list_wallet_transactions. Payout releases: shopee_list_escrow.
- Times are ISO 8601 with an offset, e.g. 2026-11-01T00:00:00+08:00.
- Buyer personal data is redacted by default.
- Writes (shopee_update_stock, shopee_update_price, POST via shopee_api_call) change the live shop and are off unless the operator enabled them. Confirm with the user before any write.`;

export function createServer(config: Config, overrides: ServerOverrides = {}): McpServer {
  const server = new McpServer({ name: 'shopee-open-platform', version: VERSION }, { instructions: INSTRUCTIONS });

  let client: ShopeeClient | undefined;
  let tokens: TokenManager | undefined;
  if (config.partnerId !== undefined && config.partnerKey) {
    client = new ShopeeClient({
      partnerId: config.partnerId,
      partnerKey: config.partnerKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fetch: overrides.fetch,
      now: overrides.now,
      sleep: overrides.sleep,
    });
    tokens = new TokenManager(client, {
      tokenFile: config.tokenFile,
      shopId: config.shopId,
      initial: { accessToken: config.accessToken, refreshToken: config.refreshToken },
      now: overrides.now,
    });
    client.setTokenProvider(tokens);
  }

  registerTools(server, { config, client, tokens });
  return server;
}
