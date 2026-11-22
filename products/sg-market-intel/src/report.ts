import { calendarEffects, type CalendarEffects } from './analytics/calendar.js';
import { benchmark, type BenchmarkRow, type BenchmarkSummary } from './analytics/benchmark.js';
import { dailySales, fillDays, monthlySales, sgDate } from './analytics/sales.js';
import { ONLINE_SHARE_SERIES } from './datagov/datasets.js';
import type { SellerOrder } from './lazada/orders.js';
import type { SgMarket } from './market.js';

export interface Report {
  generatedAt: string;
  segment: string;
  window: { from: string; to: string };
  orders: { total: number; counted: number };
  benchmark: { rows: BenchmarkRow[]; summary: BenchmarkSummary };
  calendar: CalendarEffects;
  /** Latest month the official data covers; shop months after it can't be compared yet. */
  marketDataThrough: string | null;
  sources: Array<{ title: string; id: string; series?: string }>;
}

export async function buildReport(market: SgMarket, orders: readonly SellerOrder[], segment: string, now = new Date()): Promise<Report> {
  if (!orders.length) throw new Error('No orders to analyse.');
  const dates = orders.map((o) => sgDate(o.createdAt)).sort();
  const from = dates[0]!;
  const to = dates.at(-1)!;
  const monthFrom = from.slice(0, 7);
  const monthTo = to.slice(0, 7);
  const yearEarlier = `${Number(monthFrom.slice(0, 4)) - 1}${monthFrom.slice(4)}`;

  const [rsi, cpi, holidays] = await Promise.all([
    market.retailIndex(segment, { from: yearEarlier, to: monthTo }),
    market.cpi('All Items', { from: monthFrom, to: monthTo }),
    market.holidays({ from, to: `${Number(to.slice(0, 4)) + 1}-12-31` }),
  ]);
  const online = ONLINE_SHARE_SERIES[segment] ? await market.onlineShare(segment, { from: monthFrom, to: monthTo }) : undefined;

  const monthly = monthlySales(orders);
  const b = benchmark(monthly, rsi.points, { cpi: cpi.points, onlineShare: online?.points });
  const cal = calendarEffects(fillDays(dailySales(orders), from, to), holidays);
  const marketDataThrough = rsi.points.filter((p) => p.value !== null).at(-1)?.period ?? null;

  const sources = [
    { title: rsi.dataset, id: rsi.datasetId, series: rsi.series },
    { title: cpi.dataset, id: cpi.datasetId, series: cpi.series },
    ...(online ? [{ title: online.dataset, id: online.datasetId, series: online.series }] : []),
    { title: 'Singapore public holidays (consolidated)', id: 'd_8ef23381f9417e4d4254ee8b4dcdb176' },
  ];

  return {
    generatedAt: now.toISOString(),
    segment,
    window: { from, to },
    orders: { total: orders.length, counted: monthly.reduce((a, m) => a + m.orders, 0) },
    benchmark: b,
    calendar: cal,
    marketDataThrough,
    sources,
  };
}

const fmt = (n: number | null, suffix = '') => (n === null ? '–' : `${n.toLocaleString('en-SG', { maximumFractionDigits: 2 })}${suffix}`);
const sgd = (n: number) => `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number | null, suffix = '%') => (n === null ? '–' : `${n > 0 ? '+' : ''}${n}${suffix}`);

export function renderMarkdown(r: Report): string {
  const s = r.benchmark.summary;
  const verdict: Record<BenchmarkSummary['verdict'], string> = {
    outgrowing: 'is **outgrowing** the Singapore market',
    tracking: 'is **tracking** the Singapore market',
    lagging: 'is **lagging** the Singapore market',
    'not enough data': 'cannot be compared yet (fewer than two months overlap with official data)',
  };
  const L: string[] = [];
  L.push(`# Shop vs Singapore retail: ${r.segment}`);
  L.push('');
  L.push(`Orders from ${r.window.from} to ${r.window.to} (Singapore time). ${r.orders.counted} of ${r.orders.total} orders counted as sales; cancelled, returned, failed and unpaid orders are excluded.`);
  L.push('');
  L.push(`## Verdict`);
  L.push('');
  L.push(
    s.baseMonth && s.lastMonth
      ? `From ${s.baseMonth} to ${s.lastMonth} the shop ${verdict[s.verdict]}: revenue ${signed(s.shopGrowth)} against ${signed(s.marketGrowth)} for the segment (${signed(s.gapPoints, ' pts')}). After inflation the shop's revenue changed ${signed(s.realShopGrowth)}.`
      : `The shop ${verdict['not enough data']}.`,
  );
  if (r.marketDataThrough && r.window.to.slice(0, 7) > r.marketDataThrough) {
    L.push('');
    L.push(`Official retail data is published through ${r.marketDataThrough}; later months show shop figures only.`);
  }
  L.push('');
  L.push('## Month by month');
  L.push('');
  L.push('| Month | Orders | Revenue | Shop index | Market index | Relative | Real revenue | Shop YoY | Market YoY | Online share |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of r.benchmark.rows) {
    L.push(
      `| ${x.month} | ${x.orders} | ${sgd(x.revenue)} | ${fmt(x.shopIndex)} | ${fmt(x.marketIndex)} | ${fmt(x.relative)} | ${x.realRevenue === null ? '–' : sgd(x.realRevenue)} | ${signed(x.shopYoY)} | ${signed(x.marketYoY)} | ${fmt(x.onlineShare, '%')} |`,
    );
  }
  L.push('');
  L.push(`Indices use ${s.baseMonth ?? 'the first month'} = 100. Relative above 100 means the shop grew faster than the market since then. Real revenue is in ${s.baseMonth ?? 'base-month'} prices, deflated by CPI (All Items).`);
  L.push('');
  L.push('## Sales calendar');
  L.push('');
  L.push(`Normal day: ${sgd(r.calendar.normal.avgRevenue)} and ${r.calendar.normal.avgOrders} orders on average (${r.calendar.normal.days} days).`);
  L.push('');
  L.push('| Day type | Days | Avg revenue | Avg orders | vs normal |');
  L.push('|---|---:|---:|---:|---:|');
  const names: Record<string, string> = { 'public-holiday': 'Public holiday', 'pre-holiday': '3 days before a holiday', 'double-day': 'Double-day sale (e.g. 11.11)', payday: 'Month-end payday' };
  for (const e of r.calendar.effects) L.push(`| ${names[e.kind]} | ${e.days} | ${sgd(e.avgRevenue)} | ${e.avgOrders} | ${signed(e.upliftPct)} |`);
  if (r.calendar.upcoming.length) {
    L.push('');
    L.push('Coming up: ' + r.calendar.upcoming.map((u) => `${u.date} ${u.label}`).join(' · '));
  }
  L.push('');
  L.push('## Sources');
  L.push('');
  for (const src of r.sources) L.push(`- ${src.title}${src.series ? ` (series: ${src.series})` : ''}: https://data.gov.sg/datasets/${src.id}/view`);
  L.push('');
  L.push(`Generated ${r.generatedAt}. Contains information from data.gov.sg accessed on that date, made available under the Singapore Open Data Licence version 1.0.`);
  return L.join('\n');
}
