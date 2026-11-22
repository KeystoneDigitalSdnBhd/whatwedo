import type { LazadaClient } from './client.js';

/**
 * The only order fields this product keeps. Buyer names, phones, emails and
 * addresses are never copied out of the API response (PDPA data minimisation).
 */
export interface SellerOrder {
  orderId: string;
  /** ISO 8601 with offset, as Lazada returns it. */
  createdAt: string;
  status: string;
  /** Order value in the shop's currency (SGD for Lazada Singapore). */
  total: number;
  items: number;
}

interface RawOrder {
  order_id?: string | number;
  created_at?: string;
  statuses?: unknown;
  price?: string | number;
  items_count?: string | number;
}

/**
 * Pulls every order created in [from, to) by paging /orders/get.
 * `from` and `to` are ISO 8601 date-times with an offset, e.g. 2026-01-01T00:00:00+08:00.
 */
export async function fetchOrders(
  client: LazadaClient,
  from: string,
  to: string,
  opts: { pageSize?: number; maxOrders?: number } = {},
): Promise<SellerOrder[]> {
  const limit = opts.pageSize ?? 100;
  const max = opts.maxOrders ?? 50_000;
  const out: SellerOrder[] = [];
  for (let offset = 0; offset < max; offset += limit) {
    const res = await client.call<{ orders?: RawOrder[]; count?: number }>('/orders/get', {
      created_after: from,
      created_before: to,
      sort_by: 'created_at',
      sort_direction: 'ASC',
      offset,
      limit,
    });
    const page = res.data?.orders ?? [];
    for (const o of page) {
      const order = toSellerOrder(o);
      if (order) out.push(order);
    }
    if (page.length < limit) break;
  }
  return out;
}

export function toSellerOrder(o: RawOrder): SellerOrder | undefined {
  const total = Number(String(o.price ?? '').replace(/,/g, ''));
  if (o.order_id === undefined || !o.created_at || !Number.isFinite(total)) return undefined;
  const statuses = Array.isArray(o.statuses) ? o.statuses.map(String) : [];
  return {
    orderId: String(o.order_id),
    createdAt: o.created_at.trim().replace(' ', 'T'),
    status: statuses[0] ?? 'unknown',
    total,
    items: Number(o.items_count ?? 0) || 0,
  };
}

/**
 * Orders exported from Seller Center or another system, as CSV with the
 * columns order_id, created_at, status, total and optionally items.
 */
export function parseOrdersCsv(text: string): SellerOrder[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsv(lines[0]!).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const need = ['order_id', 'created_at', 'status', 'total'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Orders CSV is missing column(s): ${missing.join(', ')}. Expected: order_id, created_at, status, total[, items]`);
  const out: SellerOrder[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = splitCsv(line);
    const total = Number((c[col('total')] ?? '').replace(/,/g, ''));
    const createdAt = (c[col('created_at')] ?? '').trim();
    if (!Number.isFinite(total) || Number.isNaN(Date.parse(createdAt.replace(' ', 'T')))) {
      throw new Error(`Orders CSV row ${i + 2}: unreadable created_at or total`);
    }
    out.push({
      orderId: (c[col('order_id')] ?? '').trim(),
      createdAt: createdAt.replace(' ', 'T'),
      status: (c[col('status')] ?? '').trim().toLowerCase(),
      total,
      items: col('items') >= 0 ? Number(c[col('items')]) || 0 : 0,
    });
  });
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
