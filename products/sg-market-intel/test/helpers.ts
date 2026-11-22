import { readFileSync } from 'node:fs';
import { DataGovClient } from '../src/datagov/client.js';
import { DATASETS } from '../src/datagov/datasets.js';
import type { SellerOrder } from '../src/lazada/orders.js';
import { SgMarket } from '../src/market.js';

/** Trimmed copies of real data.gov.sg responses captured on 20 Nov 2026. */
export function fixture(name: string): { success: boolean; result: { total: number; fields: Array<{ id: string }>; records: Array<Record<string, string | number | null>> } } {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

const BY_ID: Record<string, string> = {
  [DATASETS.retailIndexCurrent.id]: 'retail-index-current',
  [DATASETS.onlineShare.id]: 'online-share',
  [DATASETS.cpi.id]: 'cpi',
  [DATASETS.publicHolidays.id]: 'public-holidays',
};

/** Fake data.gov.sg datastore that serves the fixtures with real paging semantics. */
export function fakeDataGov() {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const ua = (init?.headers as Record<string, string> | undefined)?.['user-agent'];
    if (!ua) return new Response('forbidden', { status: 403 });
    const name = BY_ID[url.searchParams.get('resource_id') ?? ''];
    if (!name) return Response.json({ success: false, error: { message: 'Not found' } });
    const f = fixture(name);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return Response.json({ success: true, result: { ...f.result, records: f.result.records.slice(offset, offset + limit) } });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export function fakeMarket(): SgMarket {
  return new SgMarket(new DataGovClient({ fetch: fakeDataGov().fetch, sleep: async () => {} }));
}

/**
 * SYNTHETIC test orders, not real shop data: `perDay(date)` orders of `value`
 * each, every day from `from` to `to`, created at 12:00 Singapore time.
 */
export function syntheticOrders(from: string, to: string, perDay: (date: string) => number, value = 50): SellerOrder[] {
  const out: SellerOrder[] = [];
  let n = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    for (let i = 0; i < perDay(date); i++) {
      out.push({ orderId: String(++n), createdAt: `${date}T12:00:00+08:00`, status: 'delivered', total: value, items: 1 });
    }
  }
  return out;
}
