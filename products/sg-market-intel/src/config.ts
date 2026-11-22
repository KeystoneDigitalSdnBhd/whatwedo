import { homedir } from 'node:os';
import { join } from 'node:path';
import { DataGovClient } from './datagov/client.js';
import { LazadaClient } from './lazada/client.js';
import { AUTH_GATEWAY, REGION_GATEWAYS, isRegion } from './lazada/regions.js';
import { TokenManager } from './lazada/tokens.js';
import { SgMarket } from './market.js';

type Env = Record<string, string | undefined>;

export function dataGovFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): DataGovClient {
  const noCache = env.SGMI_NO_CACHE === '1';
  return new DataGovClient({
    apiKey: env.DATAGOV_API_KEY?.trim() || undefined,
    cacheDir: noCache ? undefined : env.SGMI_CACHE_DIR || join(homedir(), '.cache', 'sg-market-intel'),
    cacheTtlMs: env.SGMI_CACHE_TTL_HOURS ? Number(env.SGMI_CACHE_TTL_HOURS) * 3_600_000 : undefined,
    fetch: fetchImpl,
  });
}

export function marketFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): SgMarket {
  return new SgMarket(dataGovFromEnv(env, fetchImpl));
}

/** Lazada client for the shop, or undefined when no app credentials are configured. */
export function lazadaFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): LazadaClient | undefined {
  const appKey = env.LAZADA_APP_KEY?.trim();
  const appSecret = env.LAZADA_APP_SECRET?.trim();
  if (!appKey || !appSecret) return undefined;
  const region = (env.LAZADA_REGION ?? 'SG').toUpperCase();
  if (!isRegion(region)) throw new Error(`LAZADA_REGION must be one of ${Object.keys(REGION_GATEWAYS).join(', ')}`);
  const client = new LazadaClient({
    appKey,
    appSecret,
    baseUrl: REGION_GATEWAYS[region],
    authBaseUrl: AUTH_GATEWAY,
    fetch: fetchImpl,
  });
  const tokens = new TokenManager(client, {
    tokenFile: env.LAZADA_TOKEN_FILE?.trim() || undefined,
    initial: { accessToken: env.LAZADA_ACCESS_TOKEN?.trim() || undefined, refreshToken: env.LAZADA_REFRESH_TOKEN?.trim() || undefined },
  });
  client.setTokenProvider(tokens);
  return client;
}
