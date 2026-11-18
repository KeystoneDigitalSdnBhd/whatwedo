import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LazadaClient, ParamInput } from './client.js';
import type { Config } from './config.js';
import { LazadaConfigError, LazadaWriteDisabledError, describeError } from './errors.js';
import { redactPii } from './redact.js';
import { AUTHORIZE_URL } from './regions.js';
import type { TokenManager } from './tokens.js';
import { buildPriceQuantityXml } from './xml.js';

export interface ToolDeps {
  config: Config;
  client?: LazadaClient;
  tokens?: TokenManager;
}

/** Tool names, exported for tests and smoke checks. */
export const TOOL_NAMES = [
  'lazada_get_auth_url',
  'lazada_exchange_code',
  'lazada_refresh_token',
  'lazada_token_status',
  'lazada_get_seller',
  'lazada_list_orders',
  'lazada_get_order',
  'lazada_get_order_items',
  'lazada_get_multiple_order_items',
  'lazada_list_products',
  'lazada_get_product',
  'lazada_get_transactions',
  'lazada_get_payout_status',
  'lazada_get_shipment_providers',
  'lazada_update_price_quantity',
  'lazada_api_call',
] as const;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 date-time, e.g. 2026-11-01T00:00:00+08:00');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const numericId = z.string().regex(/^\d{1,20}$/, 'must be a numeric ID');

const ORDER_STATUSES = [
  'unpaid',
  'pending',
  'packed',
  'ready_to_ship',
  'shipped',
  'delivered',
  'returned',
  'canceled',
  'failed',
  'topack',
  'toship',
  'lost_by_3pl',
  'damaged_by_3pl',
] as const;

const PRODUCT_FILTERS = ['all', 'live', 'inactive', 'deleted', 'image-missing', 'pending', 'rejected', 'sold-out'] as const;

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { config } = deps;
  const shape = (data: unknown): unknown => (config.redactPii ? redactPii(data) : data);

  const ok = (data: unknown): CallToolResult => {
    let text = JSON.stringify(data, null, 2) ?? 'null';
    if (text.length > config.maxResultChars) {
      text =
        text.slice(0, config.maxResultChars) +
        `\n... [truncated: ${text.length} chars total; narrow the query with a smaller limit or filters]`;
    }
    return { content: [{ type: 'text', text }] };
  };
  const fail = (err: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: describeError(err) }] });
  const run =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return ok(await fn(args));
      } catch (err) {
        return fail(err);
      }
    };

  const client = (): LazadaClient => {
    if (!deps.client) throw new LazadaConfigError('LAZADA_APP_KEY and LAZADA_APP_SECRET are not set for this server.');
    return deps.client;
  };
  const tokens = (): TokenManager => {
    if (!deps.tokens) throw new LazadaConfigError('LAZADA_APP_KEY and LAZADA_APP_SECRET are not set for this server.');
    return deps.tokens;
  };
  const requireWrites = (): void => {
    if (!config.enableWrites) {
      throw new LazadaWriteDisabledError('Write operations are disabled. Set LAZADA_ENABLE_WRITES=true to allow them.');
    }
  };
  const get = async (path: string, params: ParamInput = {}) => {
    const res = await client().call(path, params);
    return shape({ request_id: res.request_id, data: res.data });
  };

  // ---------------------------------------------------------------- auth

  server.registerTool(
    'lazada_get_auth_url',
    {
      title: 'Build seller authorization URL',
      description:
        'Builds the Lazada OAuth URL a seller opens to grant this app access. After approval Lazada redirects to redirect_uri with ?code=...; pass that code to lazada_exchange_code within its short validity window.',
      inputSchema: {
        redirect_uri: z.string().url().describe('Callback URL registered for the app in the Lazada console.'),
        state: z.string().max(128).optional().describe('Opaque CSRF value echoed back on the callback.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ redirect_uri, state }) => {
      const appKey = config.appKey;
      if (!appKey) throw new LazadaConfigError('LAZADA_APP_KEY is not set for this server.');
      const u = new URL(AUTHORIZE_URL);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('force_auth', 'true');
      u.searchParams.set('redirect_uri', redirect_uri);
      u.searchParams.set('client_id', appKey);
      if (state) u.searchParams.set('state', state);
      return { url: u.toString() };
    }),
  );

  server.registerTool(
    'lazada_exchange_code',
    {
      title: 'Exchange authorization code for tokens',
      description:
        'Exchanges the OAuth code from the callback for access and refresh tokens. Tokens are kept in the server (and LAZADA_TOKEN_FILE if set) and are never returned.',
      inputSchema: { code: z.string().min(1).max(256) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async ({ code }) => tokens().exchangeCode(code)),
  );

  server.registerTool(
    'lazada_refresh_token',
    {
      title: 'Refresh access token',
      description: 'Forces a token refresh using the stored refresh token. Normally automatic; use after a long idle period.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async () => {
      await tokens().refresh();
      return tokens().status();
    }),
  );

  server.registerTool(
    'lazada_token_status',
    {
      title: 'Token status',
      description: 'Shows whether a seller is authorized, which account and country, and when tokens expire. No secrets.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async () => ({ region: config.region, writesEnabled: config.enableWrites, ...(await tokens().status()) })),
  );

  // ---------------------------------------------------------------- seller

  server.registerTool(
    'lazada_get_seller',
    {
      title: 'Get seller profile',
      description: 'Returns the authorized seller profile (/seller/get).',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => get('/seller/get')),
  );

  // ---------------------------------------------------------------- orders

  server.registerTool(
    'lazada_list_orders',
    {
      title: 'List orders',
      description:
        'Lists orders (/orders/get). Provide created_after or update_after. Use update_after for incremental sync. Paginate with offset/limit (max 100).',
      inputSchema: {
        created_after: isoDateTime.optional(),
        created_before: isoDateTime.optional(),
        update_after: isoDateTime.optional(),
        update_before: isoDateTime.optional(),
        status: z.enum(ORDER_STATUSES).optional(),
        sort_by: z.enum(['created_at', 'updated_at']).optional(),
        sort_direction: z.enum(['ASC', 'DESC']).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    run(async (args) => {
      if (!args.created_after && !args.update_after) {
        throw new Error('Provide created_after or update_after.');
      }
      return get('/orders/get', { ...args, limit: args.limit ?? 50, offset: args.offset ?? 0 });
    }),
  );

  server.registerTool(
    'lazada_get_order',
    {
      title: 'Get order',
      description: 'Returns one order header (/order/get).',
      inputSchema: { order_id: numericId },
      annotations: READ,
    },
    run(async ({ order_id }) => get('/order/get', { order_id })),
  );

  server.registerTool(
    'lazada_get_order_items',
    {
      title: 'Get order items',
      description: 'Returns line items for one order (/order/items/get), including SKU, price, status and tracking.',
      inputSchema: { order_id: numericId },
      annotations: READ,
    },
    run(async ({ order_id }) => get('/order/items/get', { order_id })),
  );

  server.registerTool(
    'lazada_get_multiple_order_items',
    {
      title: 'Get items for many orders',
      description: 'Returns line items for up to 50 orders in one call (/orders/items/get).',
      inputSchema: { order_ids: z.array(numericId).min(1).max(50) },
      annotations: READ,
    },
    run(async ({ order_ids }) => get('/orders/items/get', { order_ids: `[${order_ids.join(',')}]` })),
  );

  // ---------------------------------------------------------------- products

  server.registerTool(
    'lazada_list_products',
    {
      title: 'List products',
      description: 'Lists products (/products/get). Paginate with offset/limit (max 50).',
      inputSchema: {
        filter: z.enum(PRODUCT_FILTERS).optional(),
        search: z.string().max(255).optional(),
        create_after: isoDateTime.optional(),
        update_after: isoDateTime.optional(),
        sku_seller_list: z.array(z.string().min(1).max(200)).max(100).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ,
    },
    run(async ({ sku_seller_list, ...rest }) =>
      get('/products/get', {
        ...rest,
        filter: rest.filter ?? 'all',
        limit: rest.limit ?? 20,
        offset: rest.offset ?? 0,
        sku_seller_list,
      }),
    ),
  );

  server.registerTool(
    'lazada_get_product',
    {
      title: 'Get product',
      description: 'Returns one product with all SKUs (/product/item/get). Identify by item_id or seller_sku.',
      inputSchema: { item_id: numericId.optional(), seller_sku: z.string().min(1).max(200).optional() },
      annotations: READ,
    },
    run(async ({ item_id, seller_sku }) => {
      if (!item_id && !seller_sku) throw new Error('Provide item_id or seller_sku.');
      return get('/product/item/get', { item_id, seller_sku });
    }),
  );

  // ---------------------------------------------------------------- finance

  server.registerTool(
    'lazada_get_transactions',
    {
      title: 'Get finance transactions',
      description:
        'Account statement lines (/finance/transaction/details/get): item price credits, commissions, payment fees, shipping fees, adjustments. Use for reconciliation and e-invoicing.',
      inputSchema: {
        start_time: ymd,
        end_time: ymd,
        trans_type: z.string().regex(/^-?\d{1,6}$/).optional().describe('Numeric transaction type filter.'),
        trade_order_id: numericId.optional(),
        trade_order_line_id: numericId.optional(),
        offset: z.number().int().min(0).max(1_000_000).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ,
    },
    run(async (args) => {
      if (args.start_time > args.end_time) throw new Error('start_time must be on or before end_time.');
      return get('/finance/transaction/details/get', { ...args, limit: args.limit ?? 100, offset: args.offset ?? 0 });
    }),
  );

  server.registerTool(
    'lazada_get_payout_status',
    {
      title: 'Get payout status',
      description: 'Payout statements created after a date (/finance/payout/status/get).',
      inputSchema: { created_after: ymd },
      annotations: READ,
    },
    run(async ({ created_after }) => get('/finance/payout/status/get', { created_after })),
  );

  // ---------------------------------------------------------------- logistics

  server.registerTool(
    'lazada_get_shipment_providers',
    {
      title: 'Get shipment providers',
      description: 'Lists shipment providers available to the seller (/shipment/providers/get).',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => get('/shipment/providers/get')),
  );

  // ---------------------------------------------------------------- writes

  server.registerTool(
    'lazada_update_price_quantity',
    {
      title: 'Update price and stock',
      description:
        'Updates price, sale price and/or sellable quantity for up to 50 SKUs (/product/price_quantity/update). Changes are live on the storefront. Requires LAZADA_ENABLE_WRITES=true.',
      inputSchema: {
        skus: z
          .array(
            z.object({
              item_id: numericId.optional(),
              sku_id: numericId.optional(),
              seller_sku: z.string().min(1).max(200).optional(),
              price: z.number().positive().max(100_000_000).optional(),
              sale_price: z.number().positive().max(100_000_000).optional(),
              sale_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/).optional(),
              sale_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/).optional(),
              quantity: z.number().int().min(0).max(999_999).optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run(async ({ skus }) => {
      requireWrites();
      const payload = buildPriceQuantityXml(skus);
      const res = await client().call('/product/price_quantity/update', { payload }, { method: 'POST' });
      return { request_id: res.request_id, data: res.data, updated: skus.length };
    }),
  );

  // ---------------------------------------------------------------- escape hatch

  server.registerTool(
    'lazada_api_call',
    {
      title: 'Call any Lazada API',
      description:
        'Signed call to any Lazada Open Platform API path not covered by a dedicated tool, e.g. /reverse/getreverseordersforseller. GET is always allowed; POST requires LAZADA_ENABLE_WRITES=true. System parameters (app_key, timestamp, sign, access_token) are added automatically.',
      inputSchema: {
        api_path: z.string().regex(/^\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/, 'must look like /orders/get'),
        method: z.enum(['GET', 'POST']).default('GET'),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    run(async ({ api_path, method, params }) => {
      if (api_path.startsWith('/auth/')) throw new Error('Use the lazada_*_token tools for /auth/ APIs.');
      if (method === 'POST') requireWrites();
      const res = await client().call(api_path, params, { method });
      const { code: _code, ...rest } = res;
      return shape(rest);
    }),
  );
}
