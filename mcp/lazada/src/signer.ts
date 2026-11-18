import { createHmac } from 'node:crypto';

/**
 * Lazada Open Platform request signature (sign_method=sha256):
 *
 *   1. Take every request parameter (system + business) except `sign`.
 *      File uploads are never part of the signature.
 *   2. Sort the parameter names by ASCII order.
 *   3. Concatenate name + value for each, with no separators.
 *   4. Prefix the API path, e.g. "/orders/get".
 *   5. HMAC-SHA256 the UTF-8 string with the app secret; hex-encode uppercase.
 *
 * Values must be signed exactly as they are sent, so callers pass the already
 * stringified parameter map that will go on the wire.
 */
export function buildSignString(apiPath: string, params: Readonly<Record<string, string>>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort(asciiCompare);
  let out = apiPath;
  for (const k of keys) out += k + params[k];
  return out;
}

export function signRequest(
  apiPath: string,
  params: Readonly<Record<string, string>>,
  appSecret: string,
): string {
  return createHmac('sha256', appSecret)
    .update(buildSignString(apiPath, params), 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** Byte-order comparison (not locale-aware), matching the reference SDKs. */
function asciiCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
