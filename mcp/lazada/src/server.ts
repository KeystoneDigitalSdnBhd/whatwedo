import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LazadaClient } from './client.js';
import type { Config } from './config.js';
import { TokenManager } from './tokens.js';
import { registerTools } from './tools.js';
import { VERSION } from './version.js';

export interface ServerOverrides {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const INSTRUCTIONS = `Lazada Open Platform tools for one seller account in one country.
- Start with lazada_token_status. If not authorized: lazada_get_auth_url -> seller approves -> lazada_exchange_code.
- Orders: lazada_list_orders needs created_after or update_after (ISO 8601 with offset, e.g. 2026-11-01T00:00:00+08:00). Page with offset/limit.
- Finance reconciliation: lazada_get_transactions (YYYY-MM-DD range) and lazada_get_payout_status.
- Buyer personal data is redacted by default.
- Writes (lazada_update_price_quantity, POST via lazada_api_call) change the live store and are off unless the operator enabled them. Confirm with the user before any write.`;

export function createServer(config: Config, overrides: ServerOverrides = {}): McpServer {
  const server = new McpServer({ name: 'lazada-open-platform', version: VERSION }, { instructions: INSTRUCTIONS });

  let client: LazadaClient | undefined;
  let tokens: TokenManager | undefined;
  if (config.appKey && config.appSecret) {
    client = new LazadaClient({
      appKey: config.appKey,
      appSecret: config.appSecret,
      baseUrl: config.baseUrl,
      authBaseUrl: config.authBaseUrl,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fetch: overrides.fetch,
      now: overrides.now,
      sleep: overrides.sleep,
    });
    tokens = new TokenManager(client, {
      tokenFile: config.tokenFile,
      initial: { accessToken: config.accessToken, refreshToken: config.refreshToken },
      now: overrides.now,
    });
    client.setTokenProvider(tokens);
  }

  registerTools(server, { config, client, tokens });
  return server;
}
