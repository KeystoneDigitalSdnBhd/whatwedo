import { createHmac } from 'node:crypto';

/**
 * Shopee Open Platform v2 signature.
 *
 *   Public APIs (auth, auth_partner):  partner_id + api_path + timestamp
 *   Shop APIs:                         partner_id + api_path + timestamp + access_token + shop_id
 *   Merchant APIs:                     partner_id + api_path + timestamp + access_token + merchant_id
 *
 * sign = HMAC-SHA256(partner_key, base_string), lowercase hex.
 * `timestamp` is Unix seconds and must be within ~5 minutes of Shopee's clock.
 * Unlike Lazada, business parameters are NOT part of the signature.
 */
export interface SignInput {
  partnerId: number;
  path: string;
  timestamp: number;
  accessToken?: string;
  shopId?: number;
  merchantId?: number;
}

export function buildBaseString(i: SignInput): string {
  let s = `${i.partnerId}${i.path}${i.timestamp}`;
  if (i.accessToken !== undefined) {
    const owner = i.shopId ?? i.merchantId;
    if (owner === undefined) throw new Error('Shop/merchant APIs need shop_id or merchant_id to sign');
    if (i.shopId !== undefined && i.merchantId !== undefined) throw new Error('Sign with shop_id or merchant_id, not both');
    s += i.accessToken + String(owner);
  }
  return s;
}

export function sign(i: SignInput, partnerKey: string): string {
  return createHmac('sha256', partnerKey).update(buildBaseString(i), 'utf8').digest('hex');
}

/**
 * Push (webhook) verification: Shopee sends `Authorization: HMAC-SHA256(partner_key, url + "|" + raw_body)`.
 * Exposed for the future webhook receiver; compares in constant time.
 */
export function verifyPushSignature(url: string, rawBody: string, header: string, partnerKey: string): boolean {
  const expected = createHmac('sha256', partnerKey).update(`${url}|${rawBody}`, 'utf8').digest('hex');
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
