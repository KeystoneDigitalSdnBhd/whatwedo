import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ShopCredentials, ShopeeClient, TokenProvider } from './client.js';
import { ShopeeAuthError } from './errors.js';
import { REFRESH_TOKEN_TTL_MS, TOKEN_GET_PATH, TOKEN_REFRESH_PATH } from './hosts.js';

export interface TokenState {
  accessToken: string;
  refreshToken?: string;
  shopId: number;
  /** Epoch ms. */
  expiresAt?: number;
  /** Epoch ms (documented 30-day lifetime from issue). */
  refreshExpiresAt?: number;
  /** Shops/merchants covered when a main (CNSC/KRSC) account authorized. */
  shopIdList?: number[];
  merchantIdList?: number[];
  updatedAt?: number;
}

export interface TokenStatus {
  authorized: boolean;
  source: 'file' | 'env' | 'oauth' | 'none';
  shopId?: number;
  shopIdList?: number[];
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  hasRefreshToken: boolean;
  persisted: boolean;
}

export interface TokenManagerOptions {
  tokenFile?: string;
  shopId?: number;
  initial?: { accessToken?: string; refreshToken?: string };
  now?: () => number;
  /** Refresh this long before expiry (default 10 min; access tokens last ~4 h). */
  skewMs?: number;
}

/**
 * One shop's tokens. Shopee rotates the refresh token on every refresh and the old
 * one stops working, so persisting tokens is not optional in production: without
 * SHOPEE_TOKEN_FILE a restart after the first refresh loses access.
 */
export class TokenManager implements TokenProvider {
  private state?: TokenState;
  private source: TokenStatus['source'] = 'none';
  private loaded?: Promise<void>;
  private inflight?: Promise<TokenState>;
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(
    private readonly client: ShopeeClient,
    private readonly opts: TokenManagerOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.skewMs ?? 10 * 60_000;
  }

  async getCredentials(): Promise<ShopCredentials> {
    await this.load();
    const s = this.state;
    if (!s) {
      throw new ShopeeAuthError(
        'No Shopee shop token. Set SHOPEE_SHOP_ID with SHOPEE_ACCESS_TOKEN/SHOPEE_REFRESH_TOKEN, or run shopee_get_auth_url then shopee_exchange_code.',
      );
    }
    if (s.expiresAt !== undefined && this.now() >= s.expiresAt - this.skewMs) {
      if (this.canRefresh(s)) {
        const n = await this.refresh();
        return { accessToken: n.accessToken, shopId: n.shopId };
      }
      if (this.now() >= s.expiresAt) {
        throw new ShopeeAuthError('Shopee access token expired and no usable refresh token is available. Re-authorize the shop.');
      }
    }
    return { accessToken: s.accessToken, shopId: s.shopId };
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

  /**
   * Exchange the callback code. A shop authorization returns `shop_id` on the callback;
   * a main-account authorization returns `main_account_id` and a list of shops.
   */
  async exchangeCode(code: string, owner: { shopId?: number; mainAccountId?: number }): Promise<TokenStatus> {
    await this.load();
    if ((owner.shopId === undefined) === (owner.mainAccountId === undefined)) {
      throw new Error('Provide exactly one of shop_id or main_account_id from the callback URL.');
    }
    const body: Record<string, unknown> = { code, partner_id: this.client.partnerId };
    if (owner.shopId !== undefined) body.shop_id = owner.shopId;
    else body.main_account_id = owner.mainAccountId;
    const res = await this.client.call(TOKEN_GET_PATH, {}, { method: 'POST', auth: false, body });

    const shopIdList = ids(res.shop_id_list);
    const shopId = owner.shopId ?? this.opts.shopId ?? shopIdList?.[0];
    if (shopId === undefined) throw new ShopeeAuthError('Shopee did not return any shop for this main account.');
    if (owner.mainAccountId !== undefined && shopIdList && !shopIdList.includes(shopId)) {
      throw new ShopeeAuthError(`SHOPEE_SHOP_ID ${shopId} is not among the authorized shops: ${shopIdList.join(', ')}`);
    }
    await this.apply(res, shopId, 'oauth', { shopIdList, merchantIdList: ids(res.merchant_id_list) });
    return this.status();
  }

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
      shopId: s?.shopId,
      shopIdList: s?.shopIdList,
      accessTokenExpiresAt: iso(s?.expiresAt),
      refreshTokenExpiresAt: iso(s?.refreshExpiresAt),
      hasRefreshToken: Boolean(s?.refreshToken),
      persisted: Boolean(this.opts.tokenFile),
    };
  }

  private canRefresh(s: TokenState): boolean {
    if (!s.refreshToken) return false;
    return s.refreshExpiresAt === undefined || this.now() < s.refreshExpiresAt;
  }

  private async doRefresh(): Promise<TokenState> {
    const s = this.state;
    if (!s?.refreshToken) throw new ShopeeAuthError('No refresh token available.');
    const res = await this.client.call(
      TOKEN_REFRESH_PATH,
      {},
      { method: 'POST', auth: false, body: { refresh_token: s.refreshToken, partner_id: this.client.partnerId, shop_id: s.shopId } },
    );
    return this.apply(res, s.shopId, this.source === 'none' ? 'oauth' : this.source, {});
  }

  private async apply(
    body: Record<string, unknown>,
    shopId: number,
    source: TokenStatus['source'],
    extra: Pick<TokenState, 'shopIdList' | 'merchantIdList'>,
  ): Promise<TokenState> {
    // Token endpoints answer at the top level; accept a `response` wrapper too.
    const src = (typeof body.response === 'object' && body.response !== null ? body.response : body) as Record<string, unknown>;
    const accessToken = src.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new ShopeeAuthError('Shopee token response did not contain an access_token.');
    }
    const t = this.now();
    const expireIn = num(src.expire_in ?? src.expires_in);
    const newRefresh = typeof src.refresh_token === 'string' && src.refresh_token ? src.refresh_token : undefined;
    const next: TokenState = {
      accessToken,
      refreshToken: newRefresh ?? this.state?.refreshToken,
      shopId,
      expiresAt: expireIn !== undefined ? t + expireIn * 1000 : undefined,
      refreshExpiresAt: newRefresh ? t + REFRESH_TOKEN_TTL_MS : this.state?.refreshExpiresAt,
      shopIdList: extra.shopIdList ?? this.state?.shopIdList,
      merchantIdList: extra.merchantIdList ?? this.state?.merchantIdList,
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
        if (typeof parsed.accessToken === 'string' && typeof parsed.shopId === 'number') {
          if (this.opts.shopId !== undefined && parsed.shopId !== this.opts.shopId) {
            throw new ShopeeAuthError(
              `SHOPEE_TOKEN_FILE belongs to shop ${parsed.shopId}, but SHOPEE_SHOP_ID is ${this.opts.shopId}. Use one token file per shop.`,
            );
          }
          this.state = parsed as TokenState;
          this.source = 'file';
          return;
        }
      } catch (err) {
        if (err instanceof ShopeeAuthError) throw err;
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new ShopeeAuthError(`Could not read SHOPEE_TOKEN_FILE: ${(err as Error).message}`);
        }
      }
    }
    const { accessToken, refreshToken } = this.opts.initial ?? {};
    const shopId = this.opts.shopId;
    if ((accessToken || refreshToken) && shopId === undefined) {
      throw new ShopeeAuthError('SHOPEE_SHOP_ID is required when SHOPEE_ACCESS_TOKEN or SHOPEE_REFRESH_TOKEN is set.');
    }
    if (shopId === undefined) return;
    if (accessToken) {
      this.state = { accessToken, refreshToken, shopId };
      this.source = 'env';
    } else if (refreshToken) {
      this.state = { accessToken: '', refreshToken, shopId, expiresAt: 0 };
      this.source = 'env';
    }
  }

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

function ids(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  return out.length ? out : undefined;
}

function iso(ms: number | undefined): string | undefined {
  return ms === undefined || ms === 0 ? undefined : new Date(ms).toISOString();
}
