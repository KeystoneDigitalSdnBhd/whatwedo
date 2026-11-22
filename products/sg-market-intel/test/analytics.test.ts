import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmark } from '../src/analytics/benchmark.js';
import { calendarEffects, classify, isDoubleDay, isPayday } from '../src/analytics/calendar.js';
import { dailySales, fillDays, monthlySales, sgDate } from '../src/analytics/sales.js';
import { pickSeries, tidy } from '../src/datagov/singstat.js';
import type { SellerOrder } from '../src/lazada/orders.js';
import { fakeMarket, fixture, syntheticOrders } from './helpers.js';

const order = (createdAt: string, total: number, status = 'delivered'): SellerOrder => ({ orderId: createdAt, createdAt, status, total, items: 1 });

test('sales are bucketed by Singapore date, not UTC', () => {
  assert.equal(sgDate('2025-12-31T16:30:00Z'), '2026-01-01');
  assert.equal(sgDate('2025-12-31T23:59:00+08:00'), '2025-12-31');
  const m = monthlySales([order('2025-11-30T16:00:00Z', 10), order('2025-11-30T15:59:00Z', 5)]);
  assert.deepEqual(m, [
    { period: '2025-11', orders: 1, revenue: 5 },
    { period: '2025-12', orders: 1, revenue: 10 },
  ]);
});

test('cancelled, returned, failed and unpaid orders are not sales', () => {
  const d = dailySales([
    order('2025-10-01T10:00:00+08:00', 100),
    order('2025-10-01T11:00:00+08:00', 100, 'canceled'),
    order('2025-10-01T12:00:00+08:00', 100, 'returned'),
    order('2025-10-01T13:00:00+08:00', 100, 'unpaid'),
    order('2025-10-01T14:00:00+08:00', 33.335, 'shipped'),
  ]);
  assert.deepEqual(d, [{ period: '2025-10-01', orders: 2, revenue: 133.34 }]);
});

test('fillDays inserts zero days so averages are honest', () => {
  const f = fillDays([{ period: '2025-10-02', orders: 1, revenue: 9 }], '2025-10-01', '2025-10-03');
  assert.deepEqual(f.map((x) => x.revenue), [0, 9, 0]);
});

test('benchmark against the real ICT retail index: indices, relative, YoY, CPI and online share', () => {
  const market = pickSeries(tidy(fixture('retail-index-current').result.records), 'Computer & Telecommunications Equipment').points;
  const cpi = pickSeries(tidy(fixture('cpi').result.records), 'All Items').points;
  const online = pickSeries(tidy(fixture('online-share').result.records), 'Computer & Telecommunications Equipment').points;
  // Synthetic shop: S$1,000 in Jul 2025 rising to S$2,000 in Dec 2025, plus Dec 2024 for a YoY.
  const shop = [
    { period: '2024-12', orders: 10, revenue: 800 },
    { period: '2025-07', orders: 10, revenue: 1000 },
    { period: '2025-12', orders: 20, revenue: 2000 },
  ];
  const { rows, summary } = benchmark(shop, market, { cpi, onlineShare: online });
  assert.equal(summary.baseMonth, '2024-12');
  const dec = rows.find((r) => r.month === '2025-12')!;
  const m = new Map(market.map((p) => [p.period, p.value!]));
  assert.equal(dec.shopIndex, 250);
  assert.equal(dec.marketIndex, Math.round((m.get('2025-12')! / m.get('2024-12')!) * 1000) / 10);
  assert.equal(dec.shopYoY, 150);
  assert.equal(dec.marketYoY, Math.round((m.get('2025-12')! / m.get('2024-12')! - 1) * 1000) / 10);
  assert.equal(dec.onlineShare, 56.5);
  assert.equal(dec.realRevenue !== null, true);
  assert.equal(summary.comparableMonths, 3);
  assert.equal(summary.gapPoints, Math.round((250 - dec.marketIndex!) * 10) / 10);
  assert.equal(summary.verdict, summary.gapPoints! > 2 ? 'outgrowing' : summary.gapPoints! < -2 ? 'lagging' : 'tracking');
});

test('benchmark: months beyond the published market data are kept but not compared', () => {
  const market = pickSeries(tidy(fixture('retail-index-current').result.records), 'Total').points;
  const { rows, summary } = benchmark(
    [
      { period: '2025-11', orders: 1, revenue: 100 },
      { period: '2026-01', orders: 1, revenue: 120 },
    ],
    market,
  );
  assert.equal(rows.find((r) => r.month === '2026-01')!.marketIndex, null);
  assert.equal(summary.comparableMonths, 1);
  assert.equal(summary.verdict, 'not enough data');
});

test('calendar classification', () => {
  const h = new Set(['2026-11-08']);
  assert.equal(classify('2026-11-08', h), 'public-holiday');
  assert.equal(classify('2026-11-06', h), 'pre-holiday');
  assert.equal(classify('2026-11-11', h), 'double-day');
  assert.equal(classify('2026-11-29', h), 'payday');
  assert.equal(classify('2026-11-20', h), 'normal');
  assert.ok(isDoubleDay('2026-12-12') && !isDoubleDay('2026-12-13'));
  assert.ok(isPayday('2026-02-27') && isPayday('2026-02-28') && !isPayday('2026-02-26'));
});

test('calendarEffects measures uplift against normal days and lists what is coming', async () => {
  const holidays = await fakeMarket().holidays({ from: '2025-01-01' });
  // Synthetic: 2 orders a day, 6 on each double day (10.10, 11.11, 12.12), 0 on public holidays.
  const hs = new Set(holidays.map((h) => h.date));
  const orders = syntheticOrders('2025-10-01', '2025-12-31', (d) => (hs.has(d) ? 0 : ['2025-10-10', '2025-11-11', '2025-12-12'].includes(d) ? 6 : 2));
  const fx = calendarEffects(fillDays(dailySales(orders), '2025-10-01', '2025-12-31'), holidays);
  assert.equal(fx.normal.avgOrders, 2);
  const dd = fx.effects.find((e) => e.kind === 'double-day')!;
  assert.equal(dd.upliftPct, 200);
  const ph = fx.effects.find((e) => e.kind === 'public-holiday')!;
  assert.equal(ph.upliftPct, -100);
  assert.ok(fx.upcoming.length > 0 && fx.upcoming.every((u) => u.date > '2025-12-31'));
  assert.ok(fx.upcoming.some((u) => u.label === "New Year's Day" || /New Year/.test(u.label)));
});
