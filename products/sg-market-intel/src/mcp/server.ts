import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DATASETS, LAZADA_CATEGORY_HINTS, RETAIL_SERIES } from '../datagov/datasets.js';
import type { LazadaClient } from '../lazada/client.js';
import { fetchOrders } from '../lazada/orders.js';
import type { SgMarket } from '../market.js';
import { buildReport, renderMarkdown } from '../report.js';

export const TOOL_NAMES = [
  'sg_datasets',
  'sg_segments',
  'sg_retail_index',
  'sg_online_share',
  'sg_cpi',
  'sg_public_holidays',
  'shop_market_report',
] as const;

const month = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const segment = z.enum(RETAIL_SERIES);
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function createServer(deps: { market: SgMarket; lazada?: LazadaClient; version: string; maxChars?: number }): McpServer {
  const server = new McpServer(
    { name: 'sg-market-intel', version: deps.version },
    {
      instructions:
        'Official Singapore market data (data.gov.sg) and a Lazada Singapore shop benchmark. Use sg_segments to pick the retail segment closest to the shop. shop_market_report pulls the shop\'s orders from Lazada and compares them with Singapore retail sales, CPI and public holidays. Always cite data.gov.sg as the source of market figures.',
    },
  );
  const max = deps.maxChars ?? 100_000;
  const ok = (data: unknown): CallToolResult => {
    let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (text.length > max) text = `${text.slice(0, max)}\n... [truncated; narrow the date range]`;
    return { content: [{ type: 'text', text }] };
  };
  const run =
    <A>(fn: (a: A) => Promise<unknown>) =>
    async (a: A): Promise<CallToolResult> => {
      try {
        return ok(await fn(a));
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
      }
    };

  server.registerTool(
    'sg_datasets',
    { title: 'Datasets used', description: 'The data.gov.sg datasets this tool reads, with ids and links.', inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false } },
    run(async () => Object.values(DATASETS).map((d) => ({ id: d.id, title: d.title, agency: d.agency, url: `https://data.gov.sg/datasets/${d.id}/view` }))),
  );

  server.registerTool(
    'sg_segments',
    {
      title: 'Retail segments',
      description: 'Singapore Retail Sales Index segments, and suggested segments for common Lazada categories.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async () => ({ segments: RETAIL_SERIES, lazadaCategoryHints: LAZADA_CATEGORY_HINTS })),
  );

  server.registerTool(
    'sg_retail_index',
    {
      title: 'Retail Sales Index',
      description: 'Monthly Singapore Retail Sales Index (2017 = 100) for a segment, from SingStat via data.gov.sg. Current prices by default; seasonally adjusted or volume terms on request.',
      inputSchema: { segment: segment.default('Total (Excluding Motor Vehicles)'), from: month.optional(), to: month.optional(), adjusted: z.boolean().default(false), volume: z.boolean().default(false) },
      annotations: READ,
    },
    run(async (a) => deps.market.retailIndex(a.segment, a)),
  );

  server.registerTool(
    'sg_online_share',
    {
      title: 'Online share of retail',
      description: 'Percentage of Singapore retail sales made online, monthly. Published for the totals, Supermarkets & Hypermarkets, Computer & Telecommunications Equipment, and Furniture & Household Equipment.',
      inputSchema: { segment: segment.default('Total (Excluding Motor Vehicles)'), from: month.optional(), to: month.optional() },
      annotations: READ,
    },
    run(async (a) => deps.market.onlineShare(a.segment, a)),
  );

  server.registerTool(
    'sg_cpi',
    {
      title: 'Consumer Price Index',
      description: 'Singapore CPI (2024 = 100), monthly. Series names follow SingStat, e.g. "All Items", "Food", "Clothing & Footwear".',
      inputSchema: { series: z.string().min(1).max(120).default('All Items'), from: month.optional(), to: month.optional() },
      annotations: READ,
    },
    run(async (a) => deps.market.cpi(a.series, a)),
  );

  server.registerTool(
    'sg_public_holidays',
    { title: 'Public holidays', description: 'Singapore public holidays (Ministry of Manpower), 2020 onwards.', inputSchema: { from: day.optional(), to: day.optional() }, annotations: READ },
    run(async (a) => deps.market.holidays(a)),
  );

  server.registerTool(
    'shop_market_report',
    {
      title: 'Shop vs Singapore market report',
      description:
        'Pulls the Lazada shop\'s orders for a date range and compares monthly revenue with the Singapore Retail Sales Index for the chosen segment, adjusts for CPI, and measures sales on public holidays, pre-holiday days, double-day sales and month-end. Only order id, time, status and value are read; no buyer data.',
      inputSchema: { segment, from: day, to: day, format: z.enum(['markdown', 'json']).default('markdown') },
      annotations: READ,
    },
    run(async (a) => {
      if (!deps.lazada) throw new Error('Lazada is not configured: set LAZADA_APP_KEY, LAZADA_APP_SECRET and a token.');
      if (a.from > a.to) throw new Error('from must be on or before to.');
      const orders = await fetchOrders(deps.lazada, `${a.from}T00:00:00+08:00`, `${a.to}T23:59:59+08:00`);
      const report = await buildReport(deps.market, orders, a.segment);
      return a.format === 'json' ? report : renderMarkdown(report);
    }),
  );

  return server;
}
