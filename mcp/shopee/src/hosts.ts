/**
 * Shopee Open Platform v2 hosts. One global gateway serves every market
 * (MY, SG, TH, ID, PH, VN, TW, BR, MX, CO, CL...); the shop's market is implied by
 * the shop_id. Mainland-China sellers (CNSC) use a separate host. Verify against
 * the console if Shopee moves them.
 */
export const HOSTS = {
  live: 'https://partner.shopeemobile.com',
  test: 'https://partner.test-stable.shopeemobile.com',
  cn: 'https://openplatform.shopee.cn',
} as const;

export type ShopeeEnv = keyof typeof HOSTS;
export const ENVS = Object.keys(HOSTS) as ShopeeEnv[];

export const AUTH_PARTNER_PATH = '/api/v2/shop/auth_partner';
export const TOKEN_GET_PATH = '/api/v2/auth/token/get';
export const TOKEN_REFRESH_PATH = '/api/v2/auth/access_token/get';

/** Shopee documents a 30-day refresh-token lifetime; the token responses do not state it. */
export const REFRESH_TOKEN_TTL_MS = 30 * 86_400_000;

export function isEnv(v: string): v is ShopeeEnv {
  return Object.prototype.hasOwnProperty.call(HOSTS, v);
}
