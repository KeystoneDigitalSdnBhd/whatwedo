import { ShopeeConfigError } from './errors.js';
import { ENVS, HOSTS, isEnv, type ShopeeEnv } from './hosts.js';

export interface Config {
  partnerId?: number;
  partnerKey?: string;
  env: ShopeeEnv;
  baseUrl: string;
  shopId?: number;
  accessToken?: string;
  refreshToken?: string;
  tokenFile?: string;
  enableWrites: boolean;
  redactPii: boolean;
  timeoutMs: number;
  maxRetries: number;
  maxResultChars: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const envName = (str(env.SHOPEE_ENV) ?? 'live').toLowerCase();
  if (!isEnv(envName)) throw new ShopeeConfigError(`SHOPEE_ENV must be one of ${ENVS.join(', ')} (got "${envName}")`);

  const partnerId = id(env.SHOPEE_PARTNER_ID, 'SHOPEE_PARTNER_ID');
  const partnerKey = str(env.SHOPEE_PARTNER_KEY);
  if ((partnerId === undefined) !== (partnerKey === undefined)) {
    throw new ShopeeConfigError('SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY must be set together');
  }

  return {
    partnerId,
    partnerKey,
    env: envName,
    baseUrl: url(env.SHOPEE_API_BASE_URL, 'SHOPEE_API_BASE_URL') ?? HOSTS[envName],
    shopId: id(env.SHOPEE_SHOP_ID, 'SHOPEE_SHOP_ID'),
    accessToken: str(env.SHOPEE_ACCESS_TOKEN),
    refreshToken: str(env.SHOPEE_REFRESH_TOKEN),
    tokenFile: str(env.SHOPEE_TOKEN_FILE),
    enableWrites: bool(env.SHOPEE_ENABLE_WRITES, false, 'SHOPEE_ENABLE_WRITES'),
    redactPii: bool(env.SHOPEE_REDACT_PII, true, 'SHOPEE_REDACT_PII'),
    timeoutMs: int(env.SHOPEE_TIMEOUT_MS, 15_000, 1_000, 120_000, 'SHOPEE_TIMEOUT_MS'),
    maxRetries: int(env.SHOPEE_MAX_RETRIES, 3, 0, 8, 'SHOPEE_MAX_RETRIES'),
    maxResultChars: int(env.SHOPEE_MAX_RESULT_CHARS, 100_000, 2_000, 2_000_000, 'SHOPEE_MAX_RESULT_CHARS'),
  };
}

function str(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function id(v: string | undefined, name: string): number | undefined {
  const t = str(v);
  if (t === undefined) return undefined;
  if (!/^\d{1,15}$/.test(t) || Number(t) === 0) throw new ShopeeConfigError(`${name} must be a positive integer (got "${v}")`);
  return Number(t);
}

function bool(v: string | undefined, def: boolean, name: string): boolean {
  const t = str(v)?.toLowerCase();
  if (t === undefined) return def;
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  if (['0', 'false', 'no', 'off'].includes(t)) return false;
  throw new ShopeeConfigError(`${name} must be true or false (got "${v}")`);
}

function int(v: string | undefined, def: number, min: number, max: number, name: string): number {
  const t = str(v);
  if (t === undefined) return def;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ShopeeConfigError(`${name} must be an integer between ${min} and ${max} (got "${v}")`);
  }
  return n;
}

function url(v: string | undefined, name: string): string | undefined {
  const t = str(v);
  if (t === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ShopeeConfigError(`${name} is not a valid URL`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw new ShopeeConfigError(`${name} must use https (http is allowed only for localhost)`);
  }
  return t.replace(/\/+$/, '');
}
