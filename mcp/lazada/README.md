# Lazada Open Platform MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent work with
one Lazada seller account: orders, products, finance statements, payouts and
logistics. Built for Keystone Digital's marketplace → e-invoice (LHDN MyInvois) and
accounting (Bukku) flows.

- Transport: stdio. Runtime: Node.js 22+.
- Dependencies: `@modelcontextprotocol/sdk` and `zod` only.
- Requests are signed with HMAC-SHA256. The OAuth token lifecycle (create, refresh, persist) is built in.
- Safe defaults: writes are off, buyer personal data is redacted, and secrets never appear in tool output.

## Tools

| Tool | Lazada API | Kind |
|---|---|---|
| `lazada_get_auth_url` | `auth.lazada.com/oauth/authorize` | local |
| `lazada_exchange_code` | `/auth/token/create` | auth |
| `lazada_refresh_token` | `/auth/token/refresh` | auth |
| `lazada_token_status` | – | local |
| `lazada_get_seller` | `/seller/get` | read |
| `lazada_list_orders` | `/orders/get` | read |
| `lazada_get_order` | `/order/get` | read |
| `lazada_get_order_items` | `/order/items/get` | read |
| `lazada_get_multiple_order_items` | `/orders/items/get` | read |
| `lazada_list_products` | `/products/get` | read |
| `lazada_get_product` | `/product/item/get` | read |
| `lazada_get_transactions` | `/finance/transaction/details/get` | read |
| `lazada_get_payout_status` | `/finance/payout/status/get` | read |
| `lazada_get_shipment_providers` | `/shipment/providers/get` | read |
| `lazada_update_price_quantity` | `/product/price_quantity/update` | **write** |
| `lazada_api_call` | any path (GET; POST only with writes on) | escape hatch |

## Setup

1. **Register the app.** In the Lazada Open Platform console, create an app, usually the
   seller in-house type for Keystone's own stores or ERP/ISV for client sellers. Set
   the callback URL. Apply for the API groups you need (Order, Product, Finance,
   Logistics). Copy the App Key and App Secret.
2. **Install and build:**
   ```bash
   cd mcp/lazada && npm ci && npm run build
   ```
3. **Register with an MCP client.** For Claude Code:
   ```bash
   claude mcp add lazada-my \
     -e LAZADA_APP_KEY=... -e LAZADA_APP_SECRET=... -e LAZADA_REGION=MY \
     -e LAZADA_TOKEN_FILE=$HOME/.config/keystone/lazada-my.tokens.json \
     -- node /path/to/whatwedo/mcp/lazada/dist/index.js
   ```
   For Claude Desktop or any other client, use the equivalent JSON:
   ```json
   {
     "mcpServers": {
       "lazada-my": {
         "command": "node",
         "args": ["/path/to/whatwedo/mcp/lazada/dist/index.js"],
         "env": {
           "LAZADA_APP_KEY": "...",
           "LAZADA_APP_SECRET": "...",
           "LAZADA_REGION": "MY",
           "LAZADA_TOKEN_FILE": "/home/me/.config/keystone/lazada-my.tokens.json"
         }
       }
     }
   }
   ```
4. **Authorize the seller.** Ask the agent to run `lazada_get_auth_url` with your
   callback URL. The seller opens it and approves, and the callback receives `?code=...`.
   Ask the agent to run `lazada_exchange_code` with that code; the code expires quickly. The
   tokens are saved to `LAZADA_TOKEN_FILE` with mode 0600 and refreshed automatically
   10 minutes before they expire.

Use **one server instance per seller account per country**, each with its own token file.
Name instances like `lazada-my` and `lazada-sg`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `LAZADA_APP_KEY` / `LAZADA_APP_SECRET` | – | Must be set together. Without them the server still starts, and every tool explains what is missing. |
| `LAZADA_REGION` | `MY` | One of `MY SG TH ID PH VN`. Selects the API gateway. |
| `LAZADA_ACCESS_TOKEN` / `LAZADA_REFRESH_TOKEN` | – | Bootstrap tokens. A refresh token on its own is enough. |
| `LAZADA_TOKEN_FILE` | – | Persists rotated tokens. If the file exists, it overrides the env tokens. |
| `LAZADA_ENABLE_WRITES` | `false` | Required for `lazada_update_price_quantity` and for POST through `lazada_api_call`. |
| `LAZADA_REDACT_PII` | `true` | Masks buyer names, phone numbers, emails, street addresses, postcodes and tax IDs. Keeps city, country and amounts. |
| `LAZADA_TIMEOUT_MS` | `15000` | Per request. |
| `LAZADA_MAX_RETRIES` | `3` | Exponential backoff with jitter. |
| `LAZADA_MAX_RESULT_CHARS` | `100000` | Longer tool results are truncated. |
| `LAZADA_API_BASE_URL` / `LAZADA_AUTH_BASE_URL` | – | For proxies and mocks. Must be https, except for localhost. |

## How requests are signed

Take every parameter except `sign`, sort the names in ASCII order, and concatenate
`name + value` pairs. Put the API path in front, then compute an HMAC-SHA256 with the
app secret and encode it as uppercase hex (`src/signer.ts`). The test vector in
`test/signer.test.ts` was computed independently with Python's `hmac`.
**Production compatibility is proven only by `npm run live-check`.**

## Retry and safety policy

| Failure | GET | POST |
|---|---|---|
| `ApiCallLimit`, `AppCallLimit`, HTTP 429 | retry | retry (Lazada rejects these before processing) |
| HTTP 5xx, `ServiceTimeout`, network error, timeout | retry | **not retried** (the request may already have been applied) |
| `IllegalAccessToken` / `AccessTokenExpired` | one token refresh, then retry | same |
| Other API errors | returned with `request_id` and a hint | same |

- Error messages never include the request URL, which carries the token and signature.
- `app_key`, `timestamp`, `sign`, `sign_method` and `access_token` cannot be set by callers.
- `/auth/*` paths are blocked in `lazada_api_call`.
- `lazada_exchange_code` and the token tools return only metadata, never tokens.

## Development

```bash
npm run typecheck   # tsc strict
npm test            # 46 unit + MCP protocol tests, no network
npm run build       # dist/
npm run smoke       # spawns dist/index.js over stdio, handshake + tools/list + calls
npm run live-check  # read-only calls to real Lazada (needs credentials; exit 2 = skipped)
```

## CI (`.github/workflows/lazada-mcp.yml`)

- **test**: runs on Node 22 and 24. Typecheck, tests, build, then the stdio smoke test. Triggered by pushes and PRs that touch `mcp/lazada/**`.
- **audit**: `npm audit` on production dependencies, failing on high severity.
- **live**: manual `workflow_dispatch` with `live: true` only. Uses the `lazada-live`
  GitHub environment secrets (`LAZADA_APP_KEY`, `LAZADA_APP_SECRET`,
  `LAZADA_ACCESS_TOKEN` or `LAZADA_REFRESH_TOKEN`) and the optional `LAZADA_REGION` variable.
  It never runs on pull requests, so untrusted code can't read the secrets.
- Dependabot opens weekly npm and monthly Actions updates.

## Not yet verified against live Lazada

The endpoints and field names follow Lazada's public docs and SDKs, but nothing here
has called the real gateway yet. Run `live-check` first. Then confirm:
- the token lifetimes (`expires_in`) and the shape of the token response;
- the valid `status` values for `/orders/get` and `filter` values for `/products/get` in your region;
- whether `/shipment/providers/get` still exists or has moved under `/order/...` for your account.
