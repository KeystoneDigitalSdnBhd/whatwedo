import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LazadaClient, TokenProvider } from './client.js';
import { LazadaAuthError } from './errors.js';

export interface TokenState {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  /** Epoch ms. */
  refreshExpiresAt?: number;
  account?: string;
  country?: string;
  /** Seller IDs per country, as returned by Lazada for cross-border accounts. */
  countryUserInfo?: Array<{ country?: string; seller_id?: string; user_id?: string; short_code?: string }>;
  updatedAt?: number;
}

export interface TokenStatus {
  authorized: boolean;
  source: 'file' | 'env' | 'oauth' | 'none';
  account?: string;
  country?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  hasRefreshToken: boolean;
  persisted: boolean;
}

export interface TokenManagerOptions {
  tokenFile?: string;
  initial?: { accessToken?: string; refreshToken?: string };
  now?: () => number;
  /** Refresh this long before expiry (default 10 minutes). */
  skewMs?: number;
}

/**
 * Holds one seller's tokens. Lazada tokens are per seller and per country: run one
 * server instance (with its own LAZADA_TOKEN_FILE) per seller account.
 */
export class TokenManager implements TokenProvider {
  private state?: TokenState;
  private source: TokenStatus['source'] = 'none';
  private loaded?: Promise<void>;
  private inflight?: Promise<TokenState>;
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(
    private readonly client: LazadaClient,
    private readonly opts: TokenManagerOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.skewMs ?? 10 * 60_000;
  }

  async getAccessToken(): Promise<string> {
    await this.load();
    const s = this.state;
    if (!s) {
      throw new LazadaAuthError(
        'No Lazada access token. Set LAZADA_ACCESS_TOKEN, or run lazada_get_auth_url then lazada_exchange_code.',
      );
    }
    if (s.expiresAt !== undefined && this.now() >= s.expiresAt - this.skewMs) {
      if (this.canRefresh(s)) return (await this.refresh()).accessToken;
      if (this.now() >= s.expiresAt) {
        throw new LazadaAuthError('Lazada access token expired and no usable refresh token is available. Re-authorize the seller.');
      }
    }
    return s.accessToken;
  }

  async forceRefresh(): Promise<boolean> {
    await this.load();
    if (!this.state || !this.canRefresh(this.state)) return false;
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Exchange the one-time authorization code from the OAuth callback. */
  async exchangeCode(code: string): Promise<TokenStatus> {
    await this.load();
    const body = await this.client.call('/auth/token/create', { code }, { method: 'POST', auth: false, authApi: true });
    await this.apply(body, 'oauth');
    return this.status();
  }

  /** Refresh now. Concurrent callers share one request (refresh tokens rotate). */
  refresh(): Promise<TokenState> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  async status(): Promise<TokenStatus> {
    await this.load();
    const s = this.state;
    return {
      authorized: Boolean(s),
      source: this.source,
      account: s?.account,
      country: s?.country,
      accessTokenExpiresAt: iso(s?.expiresAt),
      refreshTokenExpiresAt: iso(s?.refreshExpiresAt),
      hasRefreshToken: Boolean(s?.refreshToken),
      persisted: Boolean(this.opts.tokenFile),
    };
  }

  /** Seller account metadata without any token material. */
  async sellerInfo(): Promise<Pick<TokenState, 'account' | 'country' | 'countryUserInfo'>> {
    await this.load();
    return { account: this.state?.account, country: this.state?.country, countryUserInfo: this.state?.countryUserInfo };
  }

  private canRefresh(s: TokenState): boolean {
    if (!s.refreshToken) return false;
    return s.refreshExpiresAt === undefined || this.now() < s.refreshExpiresAt;
  }

  private async doRefresh(): Promise<TokenState> {
    const refreshToken = this.state?.refreshToken;
    if (!refreshToken) throw new LazadaAuthError('No refresh token available.');
    const body = await this.client.call(
      '/auth/token/refresh',
      { refresh_token: refreshToken },
      { method: 'POST', auth: false, authApi: true },
    );
    return this.apply(body, this.source === 'none' ? 'oauth' : this.source);
  }

  private async apply(body: Record<string, unknown>, source: TokenStatus['source']): Promise<TokenState> {
    // Lazada returns token fields at the top level of the envelope; accept `data` too.
    const src = (typeof body.data === 'object' && body.data !== null ? body.data : body) as Record<string, unknown>;
    const accessToken = src.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new LazadaAuthError('Lazada token response did not contain an access_token.');
    }
    const t = this.now();
    const expiresIn = num(src.expires_in);
    const refreshExpiresIn = num(src.refresh_expires_in);
    const next: TokenState = {
      accessToken,
      refreshToken: typeof src.refresh_token === 'string' ? src.refresh_token : this.state?.refreshToken,
      expiresAt: expiresIn !== undefined ? t + expiresIn * 1000 : undefined,
      refreshExpiresAt: refreshExpiresIn !== undefined ? t + refreshExpiresIn * 1000 : this.state?.refreshExpiresAt,
      account: typeof src.account === 'string' ? src.account : this.state?.account,
      country: typeof src.country === 'string' ? src.country : this.state?.country,
      countryUserInfo: Array.isArray(src.country_user_info)
        ? (src.country_user_info as TokenState['countryUserInfo'])
        : this.state?.countryUserInfo,
      updatedAt: t,
    };
    this.state = next;
    this.source = source;
    await this.persist();
    return next;
  }

  private load(): Promise<void> {
    if (!this.loaded) this.loaded = this.doLoad();
    return this.loaded;
  }

  private async doLoad(): Promise<void> {
    if (this.opts.tokenFile) {
      try {
        const parsed = JSON.parse(await readFile(this.opts.tokenFile, 'utf8')) as Partial<TokenState>;
        if (typeof parsed.accessToken === 'string' && parsed.accessToken) {
          this.state = parsed as TokenState;
          this.source = 'file';
          return;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new LazadaAuthError(`Could not read LAZADA_TOKEN_FILE: ${(err as Error).message}`);
        }
      }
    }
    const { accessToken, refreshToken } = this.opts.initial ?? {};
    if (accessToken) {
      this.state = { accessToken, refreshToken };
      this.source = 'env';
    } else if (refreshToken) {
      // Only a refresh token: mint an access token on first use.
      this.state = { accessToken: '', refreshToken, expiresAt: 0 };
      this.source = 'env';
    }
  }

  /** Atomic write with owner-only permissions. */
  private async persist(): Promise<void> {
    const file = this.opts.tokenFile;
    if (!file || !this.state) return;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function iso(ms: number | undefined): string | undefined {
  return ms === undefined || ms === 0 ? undefined : new Date(ms).toISOString();
}
