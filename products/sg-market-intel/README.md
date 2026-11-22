# SG Market Intel

**Is my Lazada Singapore shop growing faster than the Singapore market, after inflation, and which days actually sell?**

SG Market Intel answers that by combining a shop's own Lazada orders with official Singapore
statistics from [data.gov.sg](https://data.gov.sg). It runs as a command-line report, as an
MCP server that an AI assistant can use, or as a library.

By Keystone Digital Sdn. Bhd.

## What a seller gets

- **Verdict against the market.** Revenue growth compared with the Singapore Retail Sales
  Index for the shop's own segment, for example Computer & Telecommunications Equipment. The
  result is outgrowing, tracking or lagging, with the gap in percentage points.
- **Real growth.** Revenue deflated by the Singapore Consumer Price Index, so inflation isn't
  mistaken for growth.
- **Online share of the segment.** How much of Singapore's sales in the category already
  happen online, where SingStat publishes it.
- **Sales calendar.** Average revenue on public holidays, the three days before them,
  double-day sales (9.9, 10.10, 11.11, 12.12…) and month-end paydays, each compared with
  normal days. Upcoming dates are listed for planning.
- **Sources and licence on every report.** Each report links the exact datasets and series it
  used, as the Singapore Open Data Licence requires.

See [`examples/demo-report.md`](examples/demo-report.md). Its market figures are real, and its
shop figures are synthetic demo data.

## Data used

All figures are read live from data.gov.sg and cached locally for 12 hours by default.

| Dataset | Publisher | Id |
|---|---|---|
| Retail Sales Index (2017 = 100), current prices, monthly | SingStat | `d_8bd9b9872c7fcb456b7d2891a350be34` |
| Retail Sales Index, current prices, monthly, seasonally adjusted | SingStat | `d_96587181d80e9cb8a8b1984342c79a5f` |
| Retail Sales Index, chained volume terms, monthly | SingStat | `d_6b78d625911483860e162288a4000a0c` |
| Online retail sales proportion, monthly | SingStat | `d_65e4d47c3616d251f9a84ec1ad28f43c` |
| Consumer Price Index (2024 = 100), monthly | SingStat | `d_bdaff844e3ef89d39fceb962ff8f0791` |
| Singapore public holidays (consolidated) | Ministry of Manpower | `d_8ef23381f9417e4d4254ee8b4dcdb176` |

The ids were taken from the full data.gov.sg catalogue (4,677 datasets) on 20 Nov 2026.
`npm run live-check` and a weekly CI run confirm they still resolve and still contain the
series this tool relies on.

Shop data comes from the Lazada Open Platform (`/orders/get` on the Singapore gateway), or from
a CSV export with the columns `order_id, created_at, status, total[, items]`. Only the order
id, time, status, value and item count are kept. Buyer names, phone numbers, emails and
addresses are never read into the product.

## Quick start

```bash
npm ci && npm run build

# Singapore market data, no account needed
node dist/cli.js segments
node dist/cli.js market retail --segment "Computer & Telecommunications Equipment" --from 2025-01
node dist/cli.js market online --segment "Computer & Telecommunications Equipment"
node dist/cli.js market holidays --from 2026-01-01

# Shop report from a CSV export
node dist/cli.js report --segment "Computer & Telecommunications Equipment" --orders orders.csv --out report.md

# Shop report straight from Lazada (needs an approved Lazada app and the shop's token)
export LAZADA_APP_KEY=... LAZADA_APP_SECRET=... LAZADA_ACCESS_TOKEN=...
node dist/cli.js report --segment "Computer & Telecommunications Equipment" --from 2025-07-01 --to 2025-12-31
```

Behind an HTTPS proxy, run Node with `NODE_USE_ENV_PROXY=1`, because Node's built-in `fetch`
ignores `HTTPS_PROXY` otherwise.

### As an MCP server

```json
{
  "mcpServers": {
    "sg-market-intel": {
      "command": "node",
      "args": ["/path/to/sg-market-intel/dist/mcp/index.js"],
      "env": { "LAZADA_APP_KEY": "...", "LAZADA_APP_SECRET": "...", "LAZADA_TOKEN_FILE": "/path/shop-sg.tokens.json" }
    }
  }
}
```

Tools: `sg_datasets`, `sg_segments`, `sg_retail_index`, `sg_online_share`, `sg_cpi`,
`sg_public_holidays` and `shop_market_report`. All of them are read-only.

## How the numbers are worked out

- **Sales:** orders bucketed by Singapore calendar date (UTC+8). Cancelled, returned, failed,
  unpaid and lost or damaged by courier orders are excluded.
- **Indices:** the first month where both the shop and the market have data is the base,
  set to 100. Relative = shop index ÷ market index × 100.
- **Real revenue:** revenue × CPI(base month) ÷ CPI(month), using CPI All Items.
- **Verdict:** outgrowing or lagging when the growth gap exceeds ±2 percentage points,
  otherwise tracking. It needs at least two months that overlap with official data.
- **Calendar effects:** every day in the window is counted, including days with no sales. Each
  day falls into exactly one type, checked in this order: public holiday, then pre-holiday, then
  double-day, then payday.

## Limits to tell customers

- **Official data lags.** data.gov.sg's copy of the Retail Sales Index currently ends at
  **December 2025**, while CPI runs to September 2026. Later shop months are shown but not
  compared, and every report says so.
- **Segments are SingStat's, not Lazada's.** `sgmi segments` suggests a match for common
  Lazada categories. The seller should confirm it.
- **Not yet tested against the live Lazada API.** The Lazada client is covered by mocked tests
  only. Run `npm run live-check` with a shop's credentials before the first paid
  engagement.
- **Payday is an assumption.** It flags the last two days of each month, a common salary
  date in Singapore.

## Development

```bash
npm run typecheck
npm test            # 26 offline tests; fixtures are trimmed copies of real data.gov.sg responses
npm run build
npm run smoke       # built CLI + MCP server over stdio
npm run live-check  # live data.gov.sg (+ Lazada if configured)
```

CI (`.github/workflows/sg-market-intel.yml` at the repository root):
- Tests on Node 22 and 24, plus a dependency audit.
- A weekly live check against data.gov.sg, also runnable by hand. It uses the `sgmi-live` GitHub
  environment for an optional `DATAGOV_API_KEY` and Lazada secrets.

The Lazada client in `src/lazada/` is a copy of `mcp/lazada/src` in this repository.
Keep the two in step until it becomes a shared package.

## Licence

Proprietary. See [LICENSE](LICENSE). Data from data.gov.sg is used under the Singapore Open
Data Licence version 1.0.
