import type { Holiday } from '../market.js';
import type { PeriodSales } from './sales.js';

export type DayKind = 'public-holiday' | 'pre-holiday' | 'double-day' | 'payday' | 'normal';

export interface DayEffect {
  kind: Exclude<DayKind, 'normal'>;
  days: number;
  avgRevenue: number;
  avgOrders: number;
  /** Average revenue on these days vs normal days, in percent. null if no normal days. */
  upliftPct: number | null;
}

export interface CalendarEffects {
  normal: { days: number; avgRevenue: number; avgOrders: number };
  effects: DayEffect[];
  /** Upcoming dates in the holiday table that fall after the data, for planning. */
  upcoming: Array<{ date: string; label: string; kind: DayKind }>;
}

/** Double-day mega-sale dates used across Southeast Asian marketplaces (9.9, 10.10, 11.11, 12.12, …). */
export function isDoubleDay(date: string): boolean {
  const [, m, d] = date.split('-').map(Number);
  return m === d;
}

/** Singapore salaries are commonly paid at month end; flag the last two days of each month. */
export function isPayday(date: string): boolean {
  const t = Date.parse(`${date}T00:00:00Z`);
  const plus2 = new Date(t + 2 * 86_400_000).toISOString().slice(5, 7);
  return plus2 !== date.slice(5, 7);
}

export function classify(date: string, holidays: ReadonlySet<string>, preDays = 3): DayKind {
  if (holidays.has(date)) return 'public-holiday';
  const t = Date.parse(`${date}T00:00:00Z`);
  for (let i = 1; i <= preDays; i++) {
    if (holidays.has(new Date(t + i * 86_400_000).toISOString().slice(0, 10))) return 'pre-holiday';
  }
  if (isDoubleDay(date)) return 'double-day';
  if (isPayday(date)) return 'payday';
  return 'normal';
}

/**
 * Average daily revenue by kind of day, compared with normal days.
 * `daily` must include zero-sale days (see fillDays) so averages are honest.
 */
export function calendarEffects(daily: readonly PeriodSales[], holidays: readonly Holiday[], opts: { preDays?: number; upcomingLimit?: number } = {}): CalendarEffects {
  const hset = new Set(holidays.map((h) => h.date));
  const groups = new Map<DayKind, PeriodSales[]>();
  for (const d of daily) {
    const k = classify(d.period, hset, opts.preDays);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const stats = (xs: readonly PeriodSales[]) => ({
    days: xs.length,
    avgRevenue: xs.length ? Math.round((xs.reduce((a, x) => a + x.revenue, 0) / xs.length) * 100) / 100 : 0,
    avgOrders: xs.length ? Math.round((xs.reduce((a, x) => a + x.orders, 0) / xs.length) * 10) / 10 : 0,
  });
  const normal = stats(groups.get('normal') ?? []);
  const kinds: Array<Exclude<DayKind, 'normal'>> = ['public-holiday', 'pre-holiday', 'double-day', 'payday'];
  const effects = kinds
    .filter((k) => (groups.get(k)?.length ?? 0) > 0)
    .map((k) => {
      const s = stats(groups.get(k)!);
      return { kind: k, ...s, upliftPct: normal.days && normal.avgRevenue > 0 ? Math.round((s.avgRevenue / normal.avgRevenue - 1) * 1000) / 10 : null };
    });

  const last = daily.at(-1)?.period ?? '';
  const upcoming: CalendarEffects['upcoming'] = [];
  for (const h of holidays) if (h.date > last) upcoming.push({ date: h.date, label: h.holiday, kind: 'public-holiday' });
  if (last) {
    const y = Number(last.slice(0, 4));
    for (const yr of [y, y + 1]) {
      for (let m = 1; m <= 12; m++) {
        const date = `${yr}-${String(m).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
        if (date > last) upcoming.push({ date, label: `${m}.${m} sale`, kind: 'double-day' });
      }
    }
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { normal, effects, upcoming: upcoming.slice(0, opts.upcomingLimit ?? 8) };
}
