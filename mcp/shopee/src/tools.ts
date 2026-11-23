import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { QueryInput, ShopeeClient } from './client.js';
import type { Config } from './config.js';
import { ShopeeConfigError, ShopeeWriteDisabledError, describeError } from './errors.js';
import { AUTH_PARTNER_PATH } from './hosts.js';
import { redactPii } from './redact.js';
import type { TokenManager } from './tokens.js';

export interface ToolDeps {
  config: Config;
  client?: ShopeeClient;
  tokens?: TokenManager;
}

export const TOOL_NAMES = [
  'shopee_get_auth_url',
  'shopee_exchange_code',
  'shopee_refresh_token',
  'shopee_token_status',
  'shopee_get_shop_info',
  'shopee_get_shop_profile',
  'shopee_list_orders',
  'shopee_get_order_detail',
  'shopee_list_ready_to_ship',
  'shopee_list_items',
  'shopee_get_items',
  'shopee_get_models',
  'shopee_get_escrow_detail',
  'shopee_list_escrow',
  'shopee_list_wallet_transactions',
  'shopee_get_logistics_channels',
  'shopee_get_tracking_number',
  'shopee_list_returns',
  'shopee_update_stock',
  'shopee_update_price',
  'shopee_api_call',
] as const;

/** Shopee caps most time-ranged list APIs at 15 days per call. */
export const MAX_RANGE_DAYS = 15;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 date-time, e.g. 2026-11-01T00:00:00+08:00');
const id = z.string().regex(/^\d{1,20}$/, 'must be a numeric ID');
const orderSn = z.string().regex(/^[A-Z0-9]{6,32}$/, 'must be a Shopee order_sn, e.g. 2611180ABCDEFG');

const ORDER_STATUSES = [
  'UNPAID',
  'READY_TO_SHIP',
  'PROCESSED',
  'RETRY_SHIP',
  'SHIPPED',
  'TO_CONFIRM_RECEIVE',
  'IN_CANCEL',
  'CANCELLED',
  'TO_RETURN',
  'COMPLETED',
  'INVOICE_PENDING',
] as const;

const ITEM_STATUSES = ['NORMAL', 'BANNED', 'UNLIST', 'REVIEWING', 'SELLER_DELETE', 'SHOPEE_DELETE'] as const;

/** Detail fields requested by default: enough for fulfilment, invoicing and reconciliation. */
export const DEFAULT_ORDER_FIELDS = [
  'buyer_user_id',
  'buyer_username',
  'recipient_address',
  'item_list',
  'pay_time',
  'total_amount',
  'payment_method',
  'shipping_carrier',
  'actual_shipping_fee',
  'estimated_shipping_fee',
  'package_list',
  'invoice_data',
  'cancel_reason',
  'note',
].join(',');

export function toUnixSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function checkRange(fromIso: string, toIso: string, label: string, maxDays?: number): [number, number] {
  const from = toUnixSeconds(fromIso);
  const to = toUnixSeconds(toIso);
  if (from > to) throw new Error(`${label}: start must be before end.`);
  if (maxDays !== undefined && to - from > maxDays * 86_400) {
    throw new Error(`${label}: Shopee allows at most ${maxDays} days per call. Split the range and page through it.`);
  }
  return [from, to];
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { config } = deps;
  const shape = (data: unknown): unknown => (config.redactPii ? redactPii(data) : data);

  const ok = (data: unknown): CallToolResult => {
    let text = JSON.stringify(data, null, 2) ?? 'null';
    if (text.length > config.maxResultChars) {
      text =
        text.slice(0, config.maxResultChars) +
        `\n... [truncated: ${text.length} chars total; narrow the query with a smaller page_size or time range]`;
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

  const notConfigured = () => new ShopeeConfigError('SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY are not set for this server.');
  const client = (): ShopeeClient => {
    if (!deps.client) throw notConfigured();
    return deps.client;
  };
  const tokens = (): TokenManager => {
    if (!deps.tokens) throw notConfigured();
    return deps.tokens;
  };
  const requireWrites = (): void => {
    if (!config.enableWrites) {
      throw new ShopeeWriteDisabledError('Write operations are disabled. Set SHOPEE_ENABLE_WRITES=true to allow them.');
    }
  };
  const get = async (path: string, query: QueryInput = {}) => {
    const res = await client().call(path, query);
    return shape({ request_id: res.request_id, warning: res.warning, response: res.response });
  };
  const post = async (path: string, body: Record<string, unknown>) => {
    requireWrites();
    const res = await client().call(path, {}, { method: 'POST', body });
    return { request_id: res.request_id, warning: res.warning, response: res.response };
  };

  // ---------------------------------------------------------------- auth

  server.registerTool(
    'shopee_get_auth_url',
    {
      title: 'Build shop authorization URL',
      description:
        'Builds the signed Shopee authorization link a seller opens to grant this app access. The link expires about 5 minutes after it is generated. After approval Shopee redirects to redirect_url with ?code=...&shop_id=... (or main_account_id=...); pass them to shopee_exchange_code.',
      inputSchema: { redirect_url: z.string().url().describe('Redirect URL; its domain must match the app settings.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ redirect_url }) => ({
      url: client().signedPublicUrl(AUTH_PARTNER_PATH, { redirect: redirect_url }),
      expires_in_seconds: 300,
    })),
  );

  server.registerTool(
    'shopee_exchange_code',
    {
      title: 'Exchange authorization code for tokens',
      description:
        'Exchanges the one-time code from the callback for shop tokens. Pass shop_id (shop authorization) or main_account_id (main account authorization). Tokens stay in the server and are never returned.',
      inputSchema: { code: z.string().min(1).max(256), shop_id: id.optional(), main_account_id: id.optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async ({ code, shop_id, main_account_id }) =>
      tokens().exchangeCode(code, {
        shopId: shop_id === undefined ? undefined : Number(shop_id),
        mainAccountId: main_account_id === undefined ? undefined : Number(main_account_id),
      }),
    ),
  );

  server.registerTool(
    'shopee_refresh_token',
    {
      title: 'Refresh access token',
      description:
        'Forces a token refresh. Normally automatic (access tokens last ~4 hours). Each refresh rotates the refresh token.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run(async () => {
      await tokens().refresh();
      return tokens().status();
    }),
  );

  server.registerTool(
    'shopee_token_status',
    {
      title: 'Token status',
      description: 'Shows whether a shop is authorized, the shop ID, and token expiry times. No secrets.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async () => ({ env: config.env, writesEnabled: config.enableWrites, ...(await tokens().status()) })),
  );

  // ---------------------------------------------------------------- shop

  server.registerTool(
    'shopee_get_shop_info',
    {
      title: 'Get shop info',
      description: 'Shop name, region, status, authorization expiry and SIP/CB flags (/api/v2/shop/get_shop_info).',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => get('/api/v2/shop/get_shop_info')),
  );

  server.registerTool(
    'shopee_get_shop_profile',
    {
      title: 'Get shop profile',
      description: 'Shop logo, description and display name (/api/v2/shop/get_profile).',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => get('/api/v2/shop/get_profile')),
  );

  // ---------------------------------------------------------------- orders

  server.registerTool(
    'shopee_list_orders',
    {
      title: 'List orders',
      description: `Lists order_sn values in a time window (/api/v2/order/get_order_list). Window is at most ${MAX_RANGE_DAYS} days. Use time_range_field=update_time for incremental sync. Page with cursor (next_cursor). Then call shopee_get_order_detail for contents.`,
      inputSchema: {
        time_range_field: z.enum(['create_time', 'update_time']).default('create_time'),
        time_from: isoDateTime,
        time_to: isoDateTime,
        order_status: z.enum(ORDER_STATUSES).optional(),
        page_size: z.number().int().min(1).max(100).default(50),
        cursor: z.string().max(512).optional(),
        response_optional_fields: z.literal('order_status').optional(),
      },
      annotations: READ,
    },
    run(async (a) => {
      const [from, to] = checkRange(a.time_from, a.time_to, 'time_from/time_to', MAX_RANGE_DAYS);
      return get('/api/v2/order/get_order_list', {
        time_range_field: a.time_range_field,
        time_from: from,
        time_to: to,
        page_size: a.page_size,
        cursor: a.cursor ?? '',
        order_status: a.order_status,
        response_optional_fields: a.response_optional_fields ?? 'order_status',
      });
    }),
  );

  server.registerTool(
    'shopee_get_order_detail',
    {
      title: 'Get order details',
      description:
        'Full details for up to 50 orders (/api/v2/order/get_order_detail): items, amounts, payment, shipping, packages. Buyer personal data is redacted by default.',
      inputSchema: {
        order_sn_list: z.array(orderSn).min(1).max(50),
        response_optional_fields: z
          .string()
          .regex(/^[a-z_]+(,[a-z_]+)*$/)
          .optional()
          .describe('Comma-separated fields; defaults to a fulfilment + finance set.'),
      },
      annotations: READ,
    },
    run(async ({ order_sn_list, response_optional_fields }) =>
      get('/api/v2/order/get_order_detail', {
        order_sn_list: order_sn_list.join(','),
        response_optional_fields: response_optional_fields ?? DEFAULT_ORDER_FIELDS,
      }),
    ),
  );

  server.registerTool(
    'shopee_list_ready_to_ship',
    {
      title: 'List orders to ship',
      description: 'Orders waiting to be arranged for shipment (/api/v2/order/get_shipment_list). Page with cursor.',
      inputSchema: { page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(512).optional() },
      annotations: READ,
    },
    run(async ({ page_size, cursor }) => get('/api/v2/order/get_shipment_list', { page_size, cursor: cursor ?? '' })),
  );

  // ---------------------------------------------------------------- products

  server.registerTool(
    'shopee_list_items',
    {
      title: 'List items',
      description: 'Item IDs in the shop (/api/v2/product/get_item_list). Page with offset; check has_next_page/next_offset.',
      inputSchema: {
        item_status: z.array(z.enum(ITEM_STATUSES)).min(1).max(6).default(['NORMAL']),
        offset: z.number().int().min(0).max(100_000).default(0),
        page_size: z.number().int().min(1).max(100).default(50),
        update_time_from: isoDateTime.optional(),
        update_time_to: isoDateTime.optional(),
      },
      annotations: READ,
    },
    run(async (a) => {
      let from: number | undefined;
      let to: number | undefined;
      if (a.update_time_from || a.update_time_to) {
        if (!a.update_time_from || !a.update_time_to) throw new Error('Provide both update_time_from and update_time_to.');
        [from, to] = checkRange(a.update_time_from, a.update_time_to, 'update_time range');
      }
      return get('/api/v2/product/get_item_list', {
        offset: a.offset,
        page_size: a.page_size,
        item_status: a.item_status,
        update_time_from: from,
        update_time_to: to,
      });
    }),
  );

  server.registerTool(
    'shopee_get_items',
    {
      title: 'Get item details',
      description: 'Base info for up to 50 items: name, SKU, category, price, stock, status (/api/v2/product/get_item_base_info).',
      inputSchema: { item_id_list: z.array(id).min(1).max(50) },
      annotations: READ,
    },
    run(async ({ item_id_list }) => get('/api/v2/product/get_item_base_info', { item_id_list: item_id_list.join(',') })),
  );

  server.registerTool(
    'shopee_get_models',
    {
      title: 'Get item variations',
      description: 'Variations (models) of one item with per-model price and stock (/api/v2/product/get_model_list).',
      inputSchema: { item_id: id },
      annotations: READ,
    },
    run(async ({ item_id }) => get('/api/v2/product/get_model_list', { item_id })),
  );

  // ---------------------------------------------------------------- payments

  server.registerTool(
    'shopee_get_escrow_detail',
    {
      title: 'Get order income breakdown',
      description:
        'Escrow (seller income) breakdown for one order: buyer paid, commission, service and transaction fees, shipping, vouchers, final payout (/api/v2/payment/get_escrow_detail). The basis for e-invoicing and reconciliation.',
      inputSchema: { order_sn: orderSn },
      annotations: READ,
    },
    run(async ({ order_sn }) => get('/api/v2/payment/get_escrow_detail', { order_sn })),
  );

  server.registerTool(
    'shopee_list_escrow',
    {
      title: 'List released escrow',
      description: `Orders whose escrow was released in a window (/api/v2/payment/get_escrow_list), at most ${MAX_RANGE_DAYS} days.`,
      inputSchema: {
        release_time_from: isoDateTime,
        release_time_to: isoDateTime,
        page_no: z.number().int().min(1).max(10_000).default(1),
        page_size: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ,
    },
    run(async (a) => {
      const [from, to] = checkRange(a.release_time_from, a.release_time_to, 'release_time range', MAX_RANGE_DAYS);
      return get('/api/v2/payment/get_escrow_list', {
        release_time_from: from,
        release_time_to: to,
        page_no: a.page_no,
        page_size: a.page_size,
      });
    }),
  );

  server.registerTool(
    'shopee_list_wallet_transactions',
    {
      title: 'List wallet transactions',
      description: `Seller wallet ledger: escrow credits, withdrawals, adjustments (/api/v2/payment/get_wallet_transaction_list), at most ${MAX_RANGE_DAYS} days per call.`,
      inputSchema: {
        create_time_from: isoDateTime,
        create_time_to: isoDateTime,
        page_no: z.number().int().min(0).max(10_000).default(0),
        page_size: z.number().int().min(1).max(100).default(50),
        transaction_type: z.string().regex(/^[A-Z_]{3,64}$/).optional(),
      },
      annotations: READ,
    },
    run(async (a) => {
      const [from, to] = checkRange(a.create_time_from, a.create_time_to, 'create_time range', MAX_RANGE_DAYS);
      return get('/api/v2/payment/get_wallet_transaction_list', {
        create_time_from: from,
        create_time_to: to,
        page_no: a.page_no,
        page_size: a.page_size,
        transaction_type: a.transaction_type,
      });
    }),
  );

  // ---------------------------------------------------------------- logistics

  server.registerTool(
    'shopee_get_logistics_channels',
    {
      title: 'Get logistics channels',
      description: 'Logistics channels and whether each is enabled for the shop (/api/v2/logistics/get_channel_list).',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => get('/api/v2/logistics/get_channel_list')),
  );

  server.registerTool(
    'shopee_get_tracking_number',
    {
      title: 'Get tracking number',
      description: 'Tracking number for a shipped order or package (/api/v2/logistics/get_tracking_number).',
      inputSchema: { order_sn: orderSn, package_number: z.string().max(64).optional() },
      annotations: READ,
    },
    run(async ({ order_sn, package_number }) => get('/api/v2/logistics/get_tracking_number', { order_sn, package_number })),
  );

  // ---------------------------------------------------------------- returns

  server.registerTool(
    'shopee_list_returns',
    {
      title: 'List returns and refunds',
      description: `Return/refund requests (/api/v2/returns/get_return_list). Optional create-time window of at most ${MAX_RANGE_DAYS} days.`,
      inputSchema: {
        page_no: z.number().int().min(0).max(10_000).default(0),
        page_size: z.number().int().min(1).max(100).default(50),
        create_time_from: isoDateTime.optional(),
        create_time_to: isoDateTime.optional(),
        status: z.string().regex(/^[A-Z_]{3,64}$/).optional(),
      },
      annotations: READ,
    },
    run(async (a) => {
      let from: number | undefined;
      let to: number | undefined;
      if (a.create_time_from || a.create_time_to) {
        if (!a.create_time_from || !a.create_time_to) throw new Error('Provide both create_time_from and create_time_to.');
        [from, to] = checkRange(a.create_time_from, a.create_time_to, 'create_time range', MAX_RANGE_DAYS);
      }
      return get('/api/v2/returns/get_return_list', {
        page_no: a.page_no,
        page_size: a.page_size,
        create_time_from: from,
        create_time_to: to,
        status: a.status,
      });
    }),
  );

  // ---------------------------------------------------------------- writes

  server.registerTool(
    'shopee_update_stock',
    {
      title: 'Update stock',
      description:
        'Sets seller stock for an item or its models (/api/v2/product/update_stock). Use model_id 0 for items without variations. Live on the storefront. Requires SHOPEE_ENABLE_WRITES=true.',
      inputSchema: {
        item_id: id,
        stock_list: z
          .array(
            z.object({
              model_id: id.default('0'),
              stock: z.number().int().min(0).max(999_999),
              location_id: z.string().max(64).optional().describe('Warehouse location for multi-warehouse shops.'),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run(async ({ item_id, stock_list }) =>
      post('/api/v2/product/update_stock', {
        item_id: Number(item_id),
        stock_list: stock_list.map((s) => ({
          model_id: Number(s.model_id),
          seller_stock: [{ ...(s.location_id ? { location_id: s.location_id } : {}), stock: s.stock }],
        })),
      }),
    ),
  );

  server.registerTool(
    'shopee_update_price',
    {
      title: 'Update price',
      description:
        'Sets the original price for an item or its models (/api/v2/product/update_price). Use model_id 0 for items without variations. Live on the storefront. Requires SHOPEE_ENABLE_WRITES=true.',
      inputSchema: {
        item_id: id,
        price_list: z
          .array(z.object({ model_id: id.default('0'), original_price: z.number().positive().max(100_000_000) }))
          .min(1)
          .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run(async ({ item_id, price_list }) =>
      post('/api/v2/product/update_price', {
        item_id: Number(item_id),
        price_list: price_list.map((p) => ({ model_id: Number(p.model_id), original_price: p.original_price })),
      }),
    ),
  );

  // ---------------------------------------------------------------- escape hatch

  server.registerTool(
    'shopee_api_call',
    {
      title: 'Call any Shopee v2 shop API',
      description:
        'Signed shop-level call to any Shopee v2 API not covered above, e.g. /api/v2/logistics/get_tracking_info. GET is always allowed; POST (JSON body) requires SHOPEE_ENABLE_WRITES=true. partner_id, timestamp, sign, access_token and shop_id are added automatically.',
      inputSchema: {
        api_path: z.string().regex(/^\/api\/v2\/[a-z0-9_]+(?:\/[a-z0-9_]+)+$/, 'must look like /api/v2/order/get_order_list'),
        method: z.enum(['GET', 'POST']).default('GET'),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])).default({}),
        body: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    run(async ({ api_path, method, query, body }) => {
      if (api_path.startsWith('/api/v2/auth/') || api_path === AUTH_PARTNER_PATH || api_path.startsWith('/api/v2/public/')) {
        throw new Error('Auth and public APIs are handled by the shopee_*_token tools.');
      }
      if (method === 'POST') requireWrites();
      if (method === 'GET' && body) throw new Error('GET requests cannot have a body; use query.');
      const res = await client().call(api_path, query, { method, body });
      return shape({ request_id: res.request_id, warning: res.warning, response: res.response });
    }),
  );
}
