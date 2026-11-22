import type { Point } from '../datagov/singstat.js';
import type { PeriodSales } from './sales.js';

export interface BenchmarkRow {
  month: string;
  orders: number;
  revenue: number;
  /** Shop revenue as an index, base month = 100. */
  shopIndex: number | null;
  /** Retail Sales Index rebased to the same base month = 100. */
  marketIndex: number | null;
  /** shopIndex / marketIndex × 100. Above 100: the shop outgrew the market since the base month. */
  relative: number | null;
  /** Revenue in base-month prices, deflated by CPI. */
  realRevenue: number | null;
  /** Online share of the market segment (%) that month, where published. */
  onlineShare: number | null;
  shopYoY: number | null;
  marketYoY: number | null;
}

export interface BenchmarkSummary {
  baseMonth: string | null;
  lastMonth: string | null;
  /** Months with both shop sales and market data. */
  comparableMonths: number;
  shopGrowth: number | null;
  marketGrowth: number | null;
  realShopGrowth: number | null;
  /** Shop growth minus market growth, in percentage points, over the comparable window. */
  gapPoints: number | null;
  verdict: 'outgrowing' | 'tracking' | 'lagging' | 'not enough data';
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function lookup(points: readonly Point[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points ?? []) if (p.value !== null) m.set(p.period, p.value);
  return m;
}

function yearBefore(month: string): string {
  const [y, m] = month.split('-');
  return `${Number(y) - 1}-${m}`;
}

/**
 * Compares a shop's monthly revenue with Singapore retail sales for its segment.
 * The base month is the first month where both the shop and the market have data.
 */
export function benchmark(
  shop: readonly PeriodSales[],
  market: readonly Point[],
  opts: { cpi?: readonly Point[]; onlineShare?: readonly Point[]; tolerancePoints?: number } = {},
): { rows: BenchmarkRow[]; summary: BenchmarkSummary } {
  const mkt = lookup(market);
  const cpi = lookup(opts.cpi);
  const online = lookup(opts.onlineShare);
  const shopBy = new Map(shop.map((s) => [s.period, s]));
  const months = [...new Set([...shop.map((s) => s.period)])].sort();
  const base = months.find((m) => (shopBy.get(m)?.revenue ?? 0) > 0 && mkt.has(m)) ?? null;

  const rows: BenchmarkRow[] = months.map((month) => {
    const s = shopBy.get(month)!;
    const m = mkt.get(month);
    const bRev = base ? shopBy.get(base)!.revenue : undefined;
    const bMkt = base ? mkt.get(base) : undefined;
    const shopIndex = bRev ? round((s.revenue / bRev) * 100) : null;
    const marketIndex = m !== undefined && bMkt ? round((m / bMkt) * 100) : null;
    const c = cpi.get(month);
    const bCpi = base ? cpi.get(base) : undefined;
    const prev = shopBy.get(yearBefore(month));
    const prevMkt = mkt.get(yearBefore(month));
    return {
      month,
      orders: s.orders,
      revenue: s.revenue,
      shopIndex,
      marketIndex,
      relative: shopIndex !== null && marketIndex ? round((shopIndex / marketIndex) * 100) : null,
      realRevenue: c && bCpi ? round(s.revenue * (bCpi / c), 2) : null,
      onlineShare: online.get(month) ?? null,
      shopYoY: prev && prev.revenue > 0 ? round((s.revenue / prev.revenue - 1) * 100) : null,
      marketYoY: m !== undefined && prevMkt ? round((m / prevMkt - 1) * 100) : null,
    };
  });

  const comparable = rows.filter((r) => r.shopIndex !== null && r.marketIndex !== null);
  const last = comparable.at(-1);
  const shopGrowth = last ? round(last.shopIndex! - 100) : null;
  const marketGrowth = last ? round(last.marketIndex! - 100) : null;
  const baseRow = rows.find((r) => r.month === base);
  const realShopGrowth = last?.realRevenue && baseRow?.revenue ? round((last.realRevenue / baseRow.revenue - 1) * 100) : null;
  const gap = shopGrowth !== null && marketGrowth !== null ? round(shopGrowth - marketGrowth) : null;
  const tol = opts.tolerancePoints ?? 2;
  const verdict: BenchmarkSummary['verdict'] =
    comparable.length < 2 || gap === null ? 'not enough data' : gap > tol ? 'outgrowing' : gap < -tol ? 'lagging' : 'tracking';

  return {
    rows,
    summary: {
      baseMonth: base,
      lastMonth: last?.month ?? null,
      comparableMonths: comparable.length,
      shopGrowth,
      marketGrowth,
      realShopGrowth,
      gapPoints: gap,
      verdict,
    },
  };
}
