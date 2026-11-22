import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Client for data.gov.sg (Singapore Open Data).
 *
 * Rows come from the CKAN-style datastore at data.gov.sg/api/action/datastore_search.
 * The service is rate limited for clients without an API key, so this client
 * pages politely, honours Retry-After on 429, and can cache whole tables on disk.
 */
export const DATASTORE_URL = 'https://data.gov.sg/api/action/datastore_search';
export const METADATA_URL = 'https://api-production.data.gov.sg/v2/public/api/datasets';

/** data.gov.sg rejects some default library User-Agents, so always send one. */
const USER_AGENT = 'sg-market-intel/0.1 (+https://keystonedigital.com.my)';

export type Row = Record<string, string | number | null>;

export interface DatasetTable {
  resourceId: string;
  fields: string[];
  records: Row[];
  total: number;
  fetchedAt: string;
}

export interface DatasetMetadata {
  datasetId: string;
  name: string;
  description?: string;
  format?: string;
  lastUpdatedAt?: string;
  managedByAgencyName?: string;
}

export class DataGovError extends Error {
  override readonly name = 'DataGovError';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface DataGovClientOptions {
  /** Optional data.gov.sg API key (higher rate limits), sent as x-api-key. */
  apiKey?: string;
  /** Directory for cached tables. No caching when omitted. */
  cacheDir?: string;
  /** How long a cached table stays fresh (default 12 hours). */
  cacheTtlMs?: number;
  pageSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const ID_RE = /^d_[0-9a-f]{32}$/;

export class DataGovClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: DataGovClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Every row of a dataset, following pagination. Served from cache when fresh. */
  async table(resourceId: string): Promise<DatasetTable> {
    assertId(resourceId);
    const cached = await this.readCache(resourceId);
    if (cached) return cached;

    const pageSize = this.opts.pageSize ?? 1000;
    const records: Row[] = [];
    let fields: string[] = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += pageSize) {
      const url = `${DATASTORE_URL}?${new URLSearchParams({ resource_id: resourceId, limit: String(pageSize), offset: String(offset) })}`;
      const body = (await this.getJson(url)) as {
        success?: boolean;
        result?: { total?: number; fields?: Array<{ id: string }>; records?: Row[] };
        error?: unknown;
      };
      if (!body.success || !body.result) {
        throw new DataGovError(`data.gov.sg could not read dataset ${resourceId}: ${JSON.stringify(body.error ?? 'no result')}`);
      }
      const r = body.result;
      total = typeof r.total === 'number' ? r.total : 0;
      if (!fields.length) fields = (r.fields ?? []).map((f) => f.id).filter((f) => f !== '_id');
      const page = r.records ?? [];
      records.push(...page);
      if (page.length === 0) break;
    }
    const table: DatasetTable = { resourceId, fields, records, total: records.length, fetchedAt: new Date(this.now()).toISOString() };
    await this.writeCache(resourceId, table);
    return table;
  }

  /** Name, publisher and last update of a dataset. */
  async metadata(datasetId: string): Promise<DatasetMetadata> {
    assertId(datasetId);
    const body = (await this.getJson(`${METADATA_URL}/${datasetId}/metadata`)) as { code?: number; data?: DatasetMetadata; errorMsg?: string };
    if (body.code !== 0 || !body.data) throw new DataGovError(`No metadata for ${datasetId}: ${body.errorMsg ?? 'unknown error'}`);
    return body.data;
  }

  private async getJson(url: string): Promise<unknown> {
    const maxRetries = this.opts.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      let res: Response;
      try {
        const headers: Record<string, string> = { accept: 'application/json', 'user-agent': USER_AGENT };
        if (this.opts.apiKey) headers['x-api-key'] = this.opts.apiKey;
        res = await this.fetchImpl(url, { headers, signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt >= maxRetries) {
          throw new DataGovError(`data.gov.sg request failed: ${ctrl.signal.aborted ? 'timed out' : (err as Error).message}`);
        }
        await this.sleep(backoff(attempt));
        continue;
      }
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) {
          throw new DataGovError(
            res.status === 429 ? 'data.gov.sg rate limit reached; set DATAGOV_API_KEY or try again later' : `data.gov.sg returned HTTP ${res.status}`,
            res.status,
          );
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : backoff(attempt));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new DataGovError(`data.gov.sg returned HTTP ${res.status}`, res.status);
      try {
        return JSON.parse(text);
      } catch {
        throw new DataGovError('data.gov.sg returned a non-JSON response', res.status);
      }
    }
  }

  private cachePath(id: string): string | undefined {
    if (!this.opts.cacheDir) return undefined;
    return join(this.opts.cacheDir, `${createHash('sha256').update(id).digest('hex').slice(0, 16)}-${id}.json`);
  }

  private async readCache(id: string): Promise<DatasetTable | undefined> {
    const p = this.cachePath(id);
    if (!p) return undefined;
    try {
      const t = JSON.parse(await readFile(p, 'utf8')) as DatasetTable;
      const age = this.now() - Date.parse(t.fetchedAt);
      return age >= 0 && age < (this.opts.cacheTtlMs ?? 12 * 3_600_000) ? t : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(id: string, t: DatasetTable): Promise<void> {
    const p = this.cachePath(id);
    if (!p || !this.opts.cacheDir) return;
    await mkdir(this.opts.cacheDir, { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(t));
    await rename(tmp, p);
  }
}

function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new DataGovError(`"${id}" is not a data.gov.sg dataset id (expected d_ followed by 32 hex characters)`);
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15_000);
}
