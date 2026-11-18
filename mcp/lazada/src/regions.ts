/**
 * Lazada Open Platform gateways.
 *
 * Business APIs are served per seller country; the OAuth token APIs are served
 * from a single global auth host. Verify against the console if Lazada moves them.
 */
export const REGION_GATEWAYS = {
  MY: 'https://api.lazada.com.my/rest',
  SG: 'https://api.lazada.sg/rest',
  TH: 'https://api.lazada.co.th/rest',
  ID: 'https://api.lazada.co.id/rest',
  PH: 'https://api.lazada.com.ph/rest',
  VN: 'https://api.lazada.vn/rest',
} as const;

export type Region = keyof typeof REGION_GATEWAYS;

export const REGIONS = Object.keys(REGION_GATEWAYS) as Region[];

/** Token create / refresh endpoints live here. */
export const AUTH_GATEWAY = 'https://auth.lazada.com/rest';

/** Where a seller is sent to grant the app access. */
export const AUTHORIZE_URL = 'https://auth.lazada.com/oauth/authorize';

export function isRegion(value: string): value is Region {
  return Object.prototype.hasOwnProperty.call(REGION_GATEWAYS, value);
}
