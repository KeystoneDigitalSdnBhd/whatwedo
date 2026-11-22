import type { Row } from './client.js';

/**
 * SingStat tables on data.gov.sg are wide: one row per series ("DataSeries"),
 * one column per period ("2025Dec", "2025 4Q", "2025"), and sub-series are
 * marked by four spaces of indentation per level. This turns them into tidy
 * series with a hierarchy path and time-ordered points.
 */
export interface Point {
  /** "YYYY-MM", "YYYY-Qn" or "YYYY". */
  period: string;
  /** null where SingStat publishes "na". */
  value: number | null;
}

export interface Series {
  name: string;
  /** Names from the top level down to this series. */
  path: string[];
  level: number;
  points: Point[];
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Normalise a SingStat column header to a sortable period, or undefined if it isn't one. */
export function parsePeriod(col: string): string | undefined {
  const c = col.trim();
  let m = /^(\d{4})\s?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.exec(c);
  if (m) return `${m[1]}-${MONTHS[m[2]!]}`;
  m = /^(\d{4})\s?([1-4])Q$/.exec(c);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = /^(\d{4})$/.exec(c);
  if (m) return m[1];
  return undefined;
}

export function parseValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '' || /^(na|n\.a\.|-|nil)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function tidy(records: readonly Row[]): Series[] {
  const out: Series[] = [];
  const stack: string[] = [];
  for (const rec of records) {
    const raw = String(rec.DataSeries ?? '');
    const indent = raw.length - raw.trimStart().length;
    const level = Math.floor(indent / 4);
    const name = raw.trim();
    if (!name) continue;
    stack.length = level;
    stack[level] = name;
    const points: Point[] = [];
    for (const [col, v] of Object.entries(rec)) {
      const period = parsePeriod(col);
      if (period) points.push({ period, value: parseValue(v) });
    }
    points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    out.push({ name, path: stack.slice(0, level + 1).filter(Boolean), level, points });
  }
  return out;
}

/** Find a series by exact name (case-insensitive), with a helpful error listing what exists. */
export function pickSeries(series: readonly Series[], name: string): Series {
  const want = name.trim().toLowerCase();
  const hit = series.find((s) => s.name.toLowerCase() === want);
  if (!hit) {
    throw new Error(`No series "${name}". Available: ${series.map((s) => s.name).join('; ')}`);
  }
  return hit;
}

/** Points within [from, to] inclusive, comparing period strings. */
export function between(points: readonly Point[], from?: string, to?: string): Point[] {
  return points.filter((p) => (!from || p.period >= from) && (!to || p.period <= to));
}
