import { LazadaApiError, LazadaAuthError, LazadaHttpError, LazadaNetworkError } from './errors.js';
import { signRequest } from './signer.js';

export type HttpMethod = 'GET' | 'POST';
export type ParamValue = string | number | boolean | object | null | undefined;
export type ParamInput = Readonly<Record<string, ParamValue>>;

export interface LazadaEnvelope<T = unknown> {
  code: string;
  request_id?: string;
  data?: T;
  message?: string;
  type?: string;
  [key: string]: unknown;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Try to obtain a fresh token after Lazada rejected the current one. */
  forceRefresh(): Promise<boolean>;
}

export interface LazadaClientOptions {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  authBaseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CallOptions {
  method?: HttpMethod;
  /** Attach access_token (default true). */
  auth?: boolean;
  /** Send to the OAuth gateway instead of the regional one. */
  authApi?: boolean;
}

const API_PATH_RE = /^\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/;
/** System parameters the client owns; callers cannot override them. */
const RESERVED = new Set(['app_key', 'timestamp', 'sign_method', 'sign', 'access_token']);
/** Rejected before processing: safe to retry for any method. */
const RETRY_ANY_METHOD = new Set(['ApiCallLimit', 'AppCallLimit']);
/** Transient server-side codes: retried for GET only. */
const RETRY_GET_ONLY = new Set(['ServiceTimeout', 'ServiceUnavailable', 'InternalError', 'SYSTEM_ERROR']);
const AUTH_FAILURE = new Set(['IllegalAccessToken', 'AccessTokenExpired', 'MissingAccessToken']);

export class LazadaClient {
  private tokenProvider?: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: LazadaClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  async call<T = unknown>(apiPath: string, params: ParamInput = {}, options: CallOptions = {}): Promise<LazadaEnvelope<T>> {
    if (!API_PATH_RE.test(apiPath)) {
      throw new Error(`Invalid Lazada API path "${apiPath}" (expected e.g. /orders/get)`);
    }
    const method = options.method ?? 'GET';
    const auth = options.auth ?? true;
    const business = normalizeParams(params);

    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const token = auth ? await this.requireToken() : undefined;
      try {
        return await this.send<T>(apiPath, business, method, token, options.authApi === true);
      } catch (err) {
        if (
          auth &&
          !refreshed &&
          err instanceof LazadaApiError &&
          AUTH_FAILURE.has(err.code) &&
          this.tokenProvider
        ) {
          refreshed = true;
          if (await this.tokenProvider.forceRefresh()) continue;
        }
        if (attempt >= this.maxRetries || !isRetryable(err, method)) throw err;
        await this.sleep(this.backoff(attempt, err));
        attempt++;
      }
    }
  }

  private async requireToken(): Promise<string> {
    if (!this.tokenProvider) {
      throw new LazadaAuthError('No token provider configured; set LAZADA_ACCESS_TOKEN or authorize a seller first.');
    }
    return this.tokenProvider.getAccessToken();
  }

  private backoff(attempt: number, err: unknown): number {
    const base = err instanceof LazadaApiError && RETRY_ANY_METHOD.has(err.code) ? 1_000 : 400;
    const exp = Math.min(base * 2 ** attempt, 8_000);
    return Math.round(exp / 2 + this.random() * (exp / 2));
  }

  private async send<T>(
    apiPath: string,
    business: Record<string, string>,
    method: HttpMethod,
    accessToken: string | undefined,
    authApi: boolean,
  ): Promise<LazadaEnvelope<T>> {
    const params: Record<string, string> = {
      ...business,
      app_key: this.opts.appKey,
      timestamp: String(this.now()),
      sign_method: 'sha256',
    };
    if (accessToken) params.access_token = accessToken;
    params.sign = signRequest(apiPath, params, this.opts.appSecret);

    const base = authApi ? this.opts.authBaseUrl : this.opts.baseUrl;
    const endpoint = base.replace(/\/+$/, '') + apiPath;
    const query = new URLSearchParams(params).toString();
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'keystone-lazada-mcp/0.1' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let status: number;
    let ok: boolean;
    let text: string;
    try {
      const res =
        method === 'GET'
          ? await this.fetchImpl(`${endpoint}?${query}`, { method, headers, signal: ctrl.signal })
          : await this.fetchImpl(endpoint, {
              method,
              headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
              body: query,
              signal: ctrl.signal,
            });
      status = res.status;
      ok = res.ok;
      text = await res.text();
    } catch (err) {
      // Never include the URL: it carries the access token and signature.
      if (ctrl.signal.aborted) {
        throw new LazadaNetworkError(`Request to ${apiPath} timed out after ${this.timeoutMs} ms`, true);
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new LazadaNetworkError(`Request to ${apiPath} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new LazadaHttpError(status, `Non-JSON response from ${apiPath}`);
    }
    if (!isObject(body) || body.code === undefined) {
      if (!ok) throw new LazadaHttpError(status, `HTTP ${status} from ${apiPath}`);
      throw new LazadaHttpError(status, `Unexpected response shape from ${apiPath}`);
    }
    const code = String(body.code);
    if (code !== '0') {
      throw new LazadaApiError(
        code,
        typeof body.message === 'string' ? body.message : 'Unknown error',
        typeof body.request_id === 'string' ? body.request_id : undefined,
        typeof body.type === 'string' ? body.type : undefined,
        status,
      );
    }
    return { ...body, code } as LazadaEnvelope<T>;
  }
}

/** Stringify business parameters exactly as they will be signed and sent. */
export function normalizeParams(input: ParamInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED.has(key)) throw new Error(`Parameter "${key}" is managed by the client and cannot be set`);
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return out;
}

function isRetryable(err: unknown, method: HttpMethod): boolean {
  if (err instanceof LazadaApiError) {
    if (RETRY_ANY_METHOD.has(err.code)) return true;
    return method === 'GET' && RETRY_GET_ONLY.has(err.code);
  }
  if (err instanceof LazadaHttpError) {
    if (err.status === 429) return true;
    return method === 'GET' && err.status >= 500;
  }
  // A POST that failed in flight may have been applied; do not replay it.
  if (err instanceof LazadaNetworkError) return method === 'GET';
  return false;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
