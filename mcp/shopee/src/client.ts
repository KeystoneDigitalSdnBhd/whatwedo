import {
  ShopeeApiError,
  ShopeeAuthError,
  ShopeeHttpError,
  ShopeeNetworkError,
  isAuthFailure,
  isRateLimited,
  isTransient,
} from './errors.js';
import { sign } from './signer.js';

export type HttpMethod = 'GET' | 'POST';
export type QueryValue = string | number | boolean | ReadonlyArray<string | number> | null | undefined;
export type QueryInput = Readonly<Record<string, QueryValue>>;

export interface ShopeeEnvelope<T = unknown> {
  request_id?: string;
  error?: string;
  message?: string;
  warning?: unknown;
  response?: T;
  [key: string]: unknown;
}

export interface ShopCredentials {
  accessToken: string;
  shopId: number;
}

export interface TokenProvider {
  getCredentials(): Promise<ShopCredentials>;
  forceRefresh(): Promise<boolean>;
}

export interface ShopeeClientOptions {
  partnerId: number;
  partnerKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Epoch milliseconds; converted to seconds for Shopee. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CallOptions {
  method?: HttpMethod;
  /** Shop-level call: attach access_token + shop_id (default true). */
  auth?: boolean;
  /** JSON body for POST. */
  body?: Readonly<Record<string, unknown>>;
}

const PATH_RE = /^\/api\/v2\/[a-z0-9_]+(?:\/[a-z0-9_]+)+$/;
const RESERVED = new Set(['partner_id', 'timestamp', 'sign', 'access_token', 'shop_id', 'merchant_id']);

export class ShopeeClient {
  private tokenProvider?: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: ShopeeClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  get partnerId(): number {
    return this.opts.partnerId;
  }

  setTokenProvider(p: TokenProvider): void {
    this.tokenProvider = p;
  }

  /** Signed URL for public endpoints opened in a browser (auth_partner). */
  signedPublicUrl(path: string, extra: Record<string, string> = {}): string {
    const timestamp = this.timestamp();
    const q = new URLSearchParams({
      partner_id: String(this.opts.partnerId),
      timestamp: String(timestamp),
      sign: sign({ partnerId: this.opts.partnerId, path, timestamp }, this.opts.partnerKey),
      ...extra,
    });
    return `${this.opts.baseUrl}${path}?${q.toString()}`;
  }

  async call<T = unknown>(path: string, query: QueryInput = {}, options: CallOptions = {}): Promise<ShopeeEnvelope<T>> {
    if (!PATH_RE.test(path)) throw new Error(`Invalid Shopee API path "${path}" (expected e.g. /api/v2/order/get_order_list)`);
    const method = options.method ?? 'GET';
    const auth = options.auth ?? true;
    if (method === 'GET' && options.body) throw new Error('GET requests cannot have a body');
    const business = normalizeQuery(query);

    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const creds = auth ? await this.requireCredentials() : undefined;
      try {
        return await this.send<T>(path, business, method, creds, options.body);
      } catch (err) {
        if (auth && !refreshed && err instanceof ShopeeApiError && isAuthFailure(err) && this.tokenProvider) {
          refreshed = true;
          if (await this.tokenProvider.forceRefresh()) continue;
        }
        if (attempt >= this.maxRetries || !isRetryable(err, method)) throw err;
        await this.sleep(this.backoff(attempt, err));
        attempt++;
      }
    }
  }

  private timestamp(): number {
    return Math.floor(this.now() / 1000);
  }

  private async requireCredentials(): Promise<ShopCredentials> {
    if (!this.tokenProvider) throw new ShopeeAuthError('No shop credentials configured; authorize a shop first.');
    return this.tokenProvider.getCredentials();
  }

  private backoff(attempt: number, err: unknown): number {
    const base = err instanceof ShopeeApiError && isRateLimited(err) ? 1_000 : 400;
    const exp = Math.min(base * 2 ** attempt, 8_000);
    return Math.round(exp / 2 + this.random() * (exp / 2));
  }

  private async send<T>(
    path: string,
    business: Array<[string, string]>,
    method: HttpMethod,
    creds: ShopCredentials | undefined,
    body: Readonly<Record<string, unknown>> | undefined,
  ): Promise<ShopeeEnvelope<T>> {
    const timestamp = this.timestamp();
    const q = new URLSearchParams();
    q.set('partner_id', String(this.opts.partnerId));
    q.set('timestamp', String(timestamp));
    if (creds) {
      q.set('access_token', creds.accessToken);
      q.set('shop_id', String(creds.shopId));
    }
    q.set(
      'sign',
      sign(
        { partnerId: this.opts.partnerId, path, timestamp, accessToken: creds?.accessToken, shopId: creds?.shopId },
        this.opts.partnerKey,
      ),
    );
    for (const [k, v] of business) q.append(k, v);

    const endpoint = `${this.opts.baseUrl}${path}?${q.toString()}`;
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'keystone-shopee-mcp/0.1' };
    const init: RequestInit = { method, headers };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let status: number;
    let ok: boolean;
    let text: string;
    try {
      const res = await this.fetchImpl(endpoint, { ...init, signal: ctrl.signal });
      status = res.status;
      ok = res.ok;
      text = await res.text();
    } catch (err) {
      // Never include the URL: it carries the access token and signature.
      if (ctrl.signal.aborted) throw new ShopeeNetworkError(`Request to ${path} timed out after ${this.timeoutMs} ms`, true);
      throw new ShopeeNetworkError(`Request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ShopeeHttpError(status, `Non-JSON response from ${path}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ShopeeHttpError(status, `Unexpected response shape from ${path}`);
    }
    const env = parsed as ShopeeEnvelope<T>;
    if (typeof env.error === 'string' && env.error !== '') {
      throw new ShopeeApiError(env.error, typeof env.message === 'string' && env.message ? env.message : env.error, env.request_id, status);
    }
    if (!ok) throw new ShopeeHttpError(status, `HTTP ${status} from ${path}`);
    return env;
  }
}

/**
 * Query parameters as wire pairs. Arrays become repeated keys
 * (item_status=NORMAL&item_status=UNLIST), which is what Shopee expects for
 * string[] query parameters. Comma lists (order_sn_list) are passed as strings.
 */
export function normalizeQuery(input: QueryInput): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(input)) {
    if (RESERVED.has(k)) throw new Error(`Parameter "${k}" is managed by the client and cannot be set`);
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) out.push([k, String(x)]);
    else out.push([k, String(v)]);
  }
  return out;
}

function isRetryable(err: unknown, method: HttpMethod): boolean {
  if (err instanceof ShopeeApiError) {
    if (isRateLimited(err)) return true;
    return method === 'GET' && isTransient(err);
  }
  if (err instanceof ShopeeHttpError) {
    if (err.status === 429) return true;
    return method === 'GET' && err.status >= 500;
  }
  if (err instanceof ShopeeNetworkError) return method === 'GET';
  return false;
}
