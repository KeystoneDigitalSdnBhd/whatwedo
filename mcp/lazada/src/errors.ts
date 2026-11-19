/** Lazada answered with a non-zero `code` in the response envelope. */
export class LazadaApiError extends Error {
  override readonly name = 'LazadaApiError';
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly type?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Non-JSON or HTTP-level failure (gateway errors, proxies, 429/5xx without an envelope). */
export class LazadaHttpError extends Error {
  override readonly name = 'LazadaHttpError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Connection failure or timeout: the request may or may not have reached Lazada. */
export class LazadaNetworkError extends Error {
  override readonly name = 'LazadaNetworkError';
  constructor(
    message: string,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

/** Missing or unusable credentials / tokens. */
export class LazadaAuthError extends Error {
  override readonly name = 'LazadaAuthError';
}

/** Invalid server configuration (environment variables). */
export class LazadaConfigError extends Error {
  override readonly name = 'LazadaConfigError';
}

/** A write tool was invoked while LAZADA_ENABLE_WRITES is off. */
export class LazadaWriteDisabledError extends Error {
  override readonly name = 'LazadaWriteDisabledError';
}

const HINTS: Record<string, string> = {
  IllegalAccessToken:
    'The access token is invalid or expired and could not be refreshed. Re-authorize the seller (lazada_get_auth_url, then lazada_exchange_code).',
  AccessTokenExpired:
    'The access token expired. Re-authorize the seller or supply a valid LAZADA_REFRESH_TOKEN.',
  IncompleteSignature:
    'Signature rejected. Check LAZADA_APP_SECRET matches the app key, and that the server clock is correct.',
  InvalidSignature:
    'Signature rejected. Check LAZADA_APP_SECRET matches the app key, and that the server clock is correct.',
  InvalidTimestamp: 'Timestamp rejected. Synchronise the server clock (NTP).',
  ApiCallLimit: 'Lazada rate limit reached. Slow down, reduce page sizes, or retry later.',
  InsufficientPermission:
    'The app has not been granted this API group. Request the permission in the Lazada Open Platform console.',
  AppCallLimit: 'App-level quota exhausted. Check the quota for this app in the console.',
};

/** Human-readable, secret-free description for tool results. */
export function describeError(err: unknown): string {
  if (err instanceof LazadaApiError) {
    const parts = [`Lazada API error ${err.code}: ${err.message}`];
    if (err.requestId) parts.push(`request_id=${err.requestId}`);
    const hint = HINTS[err.code];
    if (hint) parts.push(`Hint: ${hint}`);
    return parts.join('\n');
  }
  if (err instanceof LazadaHttpError) return `Lazada HTTP ${err.status}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
