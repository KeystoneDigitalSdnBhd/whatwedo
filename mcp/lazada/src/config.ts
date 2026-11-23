import { LazadaConfigError } from './errors.js';
import { AUTH_GATEWAY, REGION_GATEWAYS, REGIONS, isRegion, type Region } from './regions.js';

export interface Config {
  appKey?: string;
  appSecret?: string;
  region: Region;
  /** Business API gateway (derived from region unless overridden). */
  baseUrl: string;
  /** OAuth token API gateway. */
  authBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  /** JSON file where refreshed tokens are persisted (mode 0600). */
  tokenFile?: string;
  enableWrites: boolean;
  redactPii: boolean;
  timeoutMs: number;
  maxRetries: number;
  /** Cap on characters returned per tool result, to protect the model's context. */
  maxResultChars: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const regionRaw = (str(env.LAZADA_REGION) ?? 'MY').toUpperCase();
  if (!isRegion(regionRaw)) {
    throw new LazadaConfigError(`LAZADA_REGION must be one of ${REGIONS.join(', ')} (got "${regionRaw}")`);
  }

  const appKey = str(env.LAZADA_APP_KEY);
  const appSecret = str(env.LAZADA_APP_SECRET);
  if (Boolean(appKey) !== Boolean(appSecret)) {
    throw new LazadaConfigError('LAZADA_APP_KEY and LAZADA_APP_SECRET must be set together');
  }

  return {
    appKey,
    appSecret,
    region: regionRaw,
    baseUrl: url(env.LAZADA_API_BASE_URL, 'LAZADA_API_BASE_URL') ?? REGION_GATEWAYS[regionRaw],
    authBaseUrl: url(env.LAZADA_AUTH_BASE_URL, 'LAZADA_AUTH_BASE_URL') ?? AUTH_GATEWAY,
    accessToken: str(env.LAZADA_ACCESS_TOKEN),
    refreshToken: str(env.LAZADA_REFRESH_TOKEN),
    tokenFile: str(env.LAZADA_TOKEN_FILE),
    enableWrites: bool(env.LAZADA_ENABLE_WRITES, false, 'LAZADA_ENABLE_WRITES'),
    redactPii: bool(env.LAZADA_REDACT_PII, true, 'LAZADA_REDACT_PII'),
    timeoutMs: int(env.LAZADA_TIMEOUT_MS, 15_000, 1_000, 120_000, 'LAZADA_TIMEOUT_MS'),
    maxRetries: int(env.LAZADA_MAX_RETRIES, 3, 0, 8, 'LAZADA_MAX_RETRIES'),
    maxResultChars: int(env.LAZADA_MAX_RESULT_CHARS, 100_000, 2_000, 2_000_000, 'LAZADA_MAX_RESULT_CHARS'),
  };
}

function str(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function bool(v: string | undefined, def: boolean, name: string): boolean {
  const t = str(v)?.toLowerCase();
  if (t === undefined) return def;
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  if (['0', 'false', 'no', 'off'].includes(t)) return false;
  throw new LazadaConfigError(`${name} must be true or false (got "${v}")`);
}

function int(v: string | undefined, def: number, min: number, max: number, name: string): number {
  const t = str(v);
  if (t === undefined) return def;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new LazadaConfigError(`${name} must be an integer between ${min} and ${max} (got "${v}")`);
  }
  return n;
}

/** Only https, or plain http to a loopback host (local mocks). */
function url(v: string | undefined, name: string): string | undefined {
  const t = str(v);
  if (t === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new LazadaConfigError(`${name} is not a valid URL`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw new LazadaConfigError(`${name} must use https (http is allowed only for localhost)`);
  }
  return t.replace(/\/+$/, '');
}
