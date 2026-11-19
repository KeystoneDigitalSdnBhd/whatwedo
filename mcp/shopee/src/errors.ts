/** Shopee answered with a non-empty `error` field. */
export class ShopeeApiError extends Error {
  override readonly name = 'ShopeeApiError';
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Non-JSON or HTTP-level failure without a Shopee error envelope. */
export class ShopeeHttpError extends Error {
  override readonly name = 'ShopeeHttpError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Connection failure or timeout: the request may or may not have reached Shopee. */
export class ShopeeNetworkError extends Error {
  override readonly name = 'ShopeeNetworkError';
  constructor(
    message: string,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

export class ShopeeAuthError extends Error {
  override readonly name = 'ShopeeAuthError';
}

export class ShopeeConfigError extends Error {
  override readonly name = 'ShopeeConfigError';
}

export class ShopeeWriteDisabledError extends Error {
  override readonly name = 'ShopeeWriteDisabledError';
}

/** True when Shopee rejected the access token itself (worth one refresh + retry). */
export function isAuthFailure(err: ShopeeApiError): boolean {
  const c = err.code.toLowerCase();
  // Shopee has historically returned both spellings.
  if (c === 'invalid_access_token' || c === 'invalid_acceess_token' || c === 'error_access_token_expired') return true;
  return c === 'error_auth' && /access[_ ]?token/i.test(err.message);
}

export function isRateLimited(err: ShopeeApiError): boolean {
  return /too_many|rate_?limit|frequen|throttl/i.test(err.code) || err.httpStatus === 429;
}

const TRANSIENT = new Set(['error_server', 'error_busy', 'error_inner', 'error_network', 'internal_error', 'error_system']);
export function isTransient(err: ShopeeApiError): boolean {
  return TRANSIENT.has(err.code.toLowerCase()) || (err.httpStatus !== undefined && err.httpStatus >= 500);
}

function hint(err: ShopeeApiError): string | undefined {
  const c = err.code.toLowerCase();
  if (isAuthFailure(err)) {
    return 'Access token rejected and could not be refreshed. Re-authorize the shop (shopee_get_auth_url, then shopee_exchange_code).';
  }
  if (c === 'error_sign' || /sign/i.test(err.message)) {
    return 'Signature rejected. Check SHOPEE_PARTNER_KEY belongs to SHOPEE_PARTNER_ID and the environment (live/test) matches the key.';
  }
  if (c.includes('timestamp') || /timestamp/i.test(err.message)) return 'Timestamp rejected. Synchronise the server clock (NTP).';
  if (isRateLimited(err)) return 'Shopee rate limit reached. Slow down or retry later.';
  if (c === 'error_permission') {
    return 'The app lacks this API permission or the shop has not authorized it. Check the app permissions in the Shopee console.';
  }
  if (c === 'error_param') return 'A parameter was rejected. Check required fields and the time-range limit (usually 15 days).';
  if (c === 'error_not_found' || c === 'error_data_not_found') return 'Nothing matched. Check the IDs belong to this shop.';
  return undefined;
}

export function describeError(err: unknown): string {
  if (err instanceof ShopeeApiError) {
    const parts = [`Shopee API error ${err.code}: ${err.message}`];
    if (err.requestId) parts.push(`request_id=${err.requestId}`);
    const h = hint(err);
    if (h) parts.push(`Hint: ${h}`);
    return parts.join('\n');
  }
  if (err instanceof ShopeeHttpError) return `Shopee HTTP ${err.status}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
