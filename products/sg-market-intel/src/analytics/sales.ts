import type { SellerOrder } from '../lazada/orders.js';

/** Statuses that are not sales. Everything else counts toward revenue. */
export const NON_SALE_STATUSES = new Set(['canceled', 'cancelled', 'returned', 'failed', 'unpaid', 'lost_by_3pl', 'damaged_by_3pl']);

export interface PeriodSales {
  period: string;
  orders: number;
  revenue: number;
}

const SG_OFFSET_MS = 8 * 3_600_000;

/** Calendar date in Singapore time (UTC+8, no daylight saving). */
export function sgDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Unreadable order time "${iso}"`);
  return new Date(t + SG_OFFSET_MS).toISOString().slice(0, 10);
}

export function isSale(o: SellerOrder): boolean {
  return !NON_SALE_STATUSES.has(o.status.toLowerCase());
}

function aggregate(orders: readonly SellerOrder[], key: (o: SellerOrder) => string): PeriodSales[] {
  const m = new Map<string, PeriodSales>();
  for (const o of orders) {
    if (!isSale(o)) continue;
    const k = key(o);
    const cur = m.get(k) ?? { period: k, orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += o.total;
    m.set(k, cur);
  }
  return [...m.values()]
    .map((p) => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function dailySales(orders: readonly SellerOrder[]): PeriodSales[] {
  return aggregate(orders, (o) => sgDate(o.createdAt));
}

export function monthlySales(orders: readonly SellerOrder[]): PeriodSales[] {
  return aggregate(orders, (o) => sgDate(o.createdAt).slice(0, 7));
}

/** Every date from `from` to `to` inclusive, filling days without sales with zero. */
export function fillDays(daily: readonly PeriodSales[], from: string, to: string): PeriodSales[] {
  const byDay = new Map(daily.map((d) => [d.period, d]));
  const out: PeriodSales[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { period: day, orders: 0, revenue: 0 });
  }
  return out;
}
