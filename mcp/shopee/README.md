# Shopee Open Platform MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent work with
one Shopee shop through Open Platform **v2**: orders, products, payments (escrow and
wallet), logistics and returns. It's the Shopee counterpart of
[`../lazada`](../lazada/README.md), built for Keystone Digital's marketplace →
LHDN MyInvois e-invoicing and Bukku accounting flows.

- Transport: stdio. Runtime: Node.js 22+.
- Dependencies: `@modelcontextprotocol/sdk` and `zod` only.
- Safe defaults: writes are off, buyer personal data is redacted, and secrets never appear in tool output.

## How Shopee v2 works (and how it differs from Lazada)

| | Shopee v2 | Lazada |
|---|---|---|
| Gateway | One global host for every market (`partner.shopeemobile.com`), plus a test host and a mainland-China host | One host per country |
| App identity | `partner_id` (integer) + `partner_key` | `app_key` + `app_secret` |
| Account identity | `shop_id` on every shop call | Implied by the token |
| Signature input | `partner_id + path + timestamp [+ access_token + shop_id]`. **Business parameters are not signed.** | Every parameter, sorted |
| Signature output | HMAC-SHA256, **lowercase** hex | HMAC-SHA256, uppercase hex |
| Timestamp | Unix **seconds**, must be within about 5 minutes of Shopee's clock | Milliseconds |
| POST body | JSON, with the common parameters still in the query string | Form-encoded |
| Access token | About **4 hours** | Days |
| Refresh token | About 30 days, and **replaced on every refresh** (the old one stops working) | Long-lived |
| Errors | `{error, message, request_id}`; an empty `error` means success | `code != "0"` |
| Time windows | Most list APIs allow **at most 15 days** per call | Varies |

## Tools (21)

| Tool | Shopee API | Kind |
|---|---|---|
| `shopee_get_auth_url` | `/api/v2/shop/auth_partner` (signed link, valid about 5 minutes) | local |
| `shopee_exchange_code` | `/api/v2/auth/token/get` | auth |
| `shopee_refresh_token` | `/api/v2/auth/access_token/get` | auth |
| `shopee_token_status` | – | local |
| `shopee_get_shop_info` | `/api/v2/shop/get_shop_info` | read |
| `shopee_get_shop_profile` | `/api/v2/shop/get_profile` | read |
| `shopee_list_orders` | `/api/v2/order/get_order_list` (15-day window, cursor paging) | read |
| `shopee_get_order_detail` | `/api/v2/order/get_order_detail` (≤ 50 order_sn) | read |
| `shopee_list_ready_to_ship` | `/api/v2/order/get_shipment_list` | read |
| `shopee_list_items` | `/api/v2/product/get_item_list` | read |
| `shopee_get_items` | `/api/v2/product/get_item_base_info` (≤ 50) | read |
| `shopee_get_models` | `/api/v2/product/get_model_list` | read |
| `shopee_get_escrow_detail` | `/api/v2/payment/get_escrow_detail` | read |
| `shopee_list_escrow` | `/api/v2/payment/get_escrow_list` | read |
| `shopee_list_wallet_transactions` | `/api/v2/payment/get_wallet_transaction_list` | read |
| `shopee_get_logistics_channels` | `/api/v2/logistics/get_channel_list` | read |
| `shopee_get_tracking_number` | `/api/v2/logistics/get_tracking_number` | read |
| `shopee_list_returns` | `/api/v2/returns/get_return_list` | read |
| `shopee_update_stock` | `/api/v2/product/update_stock` | **write** |
| `shopee_update_price` | `/api/v2/product/update_price` | **write** |
| `shopee_api_call` | any `/api/v2/...` shop API (GET; POST only with writes on) | escape hatch |

Orders take two steps: `shopee_list_orders` returns order numbers, and
`shopee_get_order_detail` fetches their contents. For e-invoicing, take the totals and line items from
the order detail and Shopee's fees from `shopee_get_escrow_detail`.

## Setup

1. **Register on the Shopee Open Platform** as Keystone Digital Sdn. Bhd. and create an app:
   - **Seller In House System** for Keystone's own shops, or **ERP System** / **ISV** for client shops.
   - Set the redirect URL domain and request the permissions (Order, Product, Payment, Logistics, Returns).
   - Live access needs Shopee's approval. Until then use the test (sandbox) partner ID, its key, and a test shop.
2. **Install and build:** `cd mcp/shopee && npm ci && npm run build`
3. **Register with an MCP client.** For Claude Code:
   ```bash
   claude mcp add shopee-my \
     -e SHOPEE_PARTNER_ID=... -e SHOPEE_PARTNER_KEY=... -e SHOPEE_SHOP_ID=... \
     -e SHOPEE_TOKEN_FILE=$HOME/.config/keystone/shopee-my.tokens.json \
     -- node /path/to/whatwedo/mcp/shopee/dist/index.js
   ```
   For Claude Desktop or any other client:
   ```json
   {
     "mcpServers": {
       "shopee-my": {
         "command": "node",
         "args": ["/path/to/whatwedo/mcp/shopee/dist/index.js"],
         "env": {
           "SHOPEE_PARTNER_ID": "...",
           "SHOPEE_PARTNER_KEY": "...",
           "SHOPEE_SHOP_ID": "...",
           "SHOPEE_TOKEN_FILE": "/home/me/.config/keystone/shopee-my.tokens.json"
         }
       }
     }
   }
   ```
4. **Authorize the shop.**
   - Ask the agent to run `shopee_get_auth_url` with your redirect URL. The seller must open it **within about 5 minutes** and log in.
   - The redirect comes back as `?code=...&shop_id=...`, or `?code=...&main_account_id=...` when a main account authorizes.
   - Ask the agent to run `shopee_exchange_code` with those values. The tokens are saved to `SHOPEE_TOKEN_FILE` (mode 0600) and refreshed automatically 10 minutes before the 4-hour expiry.

Use **one instance per shop**, each with its own token file. The server refuses a token
file that belongs to a different shop.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | – | Must be set together. Live and test have separate pairs. |
| `SHOPEE_ENV` | `live` | `live`, `test` or `cn`. |
| `SHOPEE_SHOP_ID` | – | Required whenever tokens come from env vars. For a main-account authorization, it picks which shop this instance serves. |
| `SHOPEE_ACCESS_TOKEN` / `SHOPEE_REFRESH_TOKEN` | – | Bootstrap tokens. A refresh token on its own is enough. |
| `SHOPEE_TOKEN_FILE` | – | **Strongly recommended.** Without it, a restart after the first refresh loses access, because the old refresh token no longer works. |
| `SHOPEE_ENABLE_WRITES` | `false` | Required for stock and price updates and for POST through `shopee_api_call`. |
| `SHOPEE_REDACT_PII` | `true` | Masks the buyer username, the message to the seller, and the whole `recipient_address` except city, state and region. |
| `SHOPEE_TIMEOUT_MS` / `SHOPEE_MAX_RETRIES` / `SHOPEE_MAX_RESULT_CHARS` | 15000 / 3 / 100000 | |
| `SHOPEE_API_BASE_URL` | – | For proxies and mocks. Must be https, except for localhost. |

## Retry and safety policy

| Failure | GET | POST |
|---|---|---|
| Rate limited (`*too_many*`, HTTP 429) | retry with backoff | retry (rejected before processing) |
| `error_server`, `error_busy`, 5xx, timeout, network error | retry | **not retried** (the request may already have been applied) |
| `invalid_access_token` (and Shopee's misspelling `invalid_acceess_token`), or `error_auth` about the access token | one refresh, then retry | same |
| Anything else | returned with `request_id` and a hint | same |

- Error messages never include the URL, which carries the token and signature.
- Callers cannot set `partner_id`, `timestamp`, `sign`, `access_token`, `shop_id` or `merchant_id`.
- `shopee_api_call` refuses the `/api/v2/auth/*`, `/api/v2/public/*` and `auth_partner` paths.
- Inputs are validated before anything is sent: `order_sn` format, 15-day windows, ID formats, and the 50-item batch limit.

## Push notifications (webhooks)

`src/signer.ts` exports `verifyPushSignature(url, rawBody, authorizationHeader, partnerKey)`,
which checks `HMAC-SHA256(partner_key, url + "|" + body)` with a constant-time comparison. It's tested
but not yet wired to an HTTP endpoint. A Vercel receiver is the next step, so orders
arrive in real time instead of by polling `update_time`.

## Development

```bash
npm run typecheck   # tsc strict
npm test            # 47 unit + MCP protocol tests, no network
npm run build
npm run smoke       # spawns dist/index.js over stdio
npm run live-check  # read-only calls to real Shopee (exit 2 = skipped)
```

CI runs from `.github/workflows/mcp-servers.yml`; see the root README. For the
manual live job, the `shopee-live` GitHub environment needs `SHOPEE_PARTNER_ID`,
`SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` and a fresh `SHOPEE_ACCESS_TOKEN`, and optionally the
`SHOPEE_ENV` variable. CI deliberately gets **no refresh token**: using it would rotate it and
invalidate the stored secret.

## Not yet verified against live Shopee

These are written from Shopee's v2 docs as I know them. The network here blocks Shopee, so none
of it has been run against the real API. Run `live-check` first, then confirm:
- the test-environment host (Shopee has moved its sandbox before; override with `SHOPEE_API_BASE_URL`);
- the default `response_optional_fields` in `shopee_get_order_detail`, since an unknown field gives `error_param`;
- the rate-limit error code names. HTTP 429 is handled regardless.
- the 15-day limit on wallet and returns windows. It's enforced on the safe side, so loosen it if Shopee allows more.
- whether an old refresh token keeps working for a short grace period after rotation.
