#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { lazadaFromEnv, marketFromEnv } from './config.js';
import { DATASETS, LAZADA_CATEGORY_HINTS, RETAIL_SERIES } from './datagov/datasets.js';
import { fetchOrders, parseOrdersCsv, type SellerOrder } from './lazada/orders.js';
import { buildReport, renderMarkdown } from './report.js';

const HELP = `sgmi: benchmark a Lazada Singapore shop against official Singapore data

Usage:
  sgmi datasets                         Data.gov.sg datasets used, with ids
  sgmi segments                         Retail segments, and Lazada category hints
  sgmi market retail [--segment S] [--from YYYY-MM] [--to YYYY-MM] [--adjusted|--volume]
  sgmi market online [--segment S] [--from YYYY-MM] [--to YYYY-MM]
  sgmi market cpi    [--series "All Items"] [--from YYYY-MM] [--to YYYY-MM]
  sgmi market holidays [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  sgmi report --segment S (--orders FILE.csv | --from YYYY-MM-DD --to YYYY-MM-DD)
              [--format md|json] [--out FILE]

Orders come from the Lazada Open Platform when LAZADA_APP_KEY, LAZADA_APP_SECRET and
a token are set, or from a CSV with columns order_id, created_at, status, total[, items].

Environment: DATAGOV_API_KEY (optional, higher rate limits), SGMI_CACHE_DIR,
SGMI_NO_CACHE=1, LAZADA_APP_KEY, LAZADA_APP_SECRET, LAZADA_ACCESS_TOKEN,
LAZADA_REFRESH_TOKEN, LAZADA_TOKEN_FILE, LAZADA_REGION (default SG).`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      segment: { type: 'string' },
      series: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      orders: { type: 'string' },
      format: { type: 'string', default: 'md' },
      out: { type: 'string' },
      adjusted: { type: 'boolean', default: false },
      volume: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, sub] = positionals;
  if (values.help || !cmd) {
    console.log(HELP);
    return cmd || values.help ? 0 : 1;
  }
  const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

  switch (cmd) {
    case 'datasets':
      print(Object.values(DATASETS).map((d) => ({ key: d.key, id: d.id, title: d.title, url: `https://data.gov.sg/datasets/${d.id}/view` })));
      return 0;
    case 'segments':
      print({ segments: RETAIL_SERIES, lazadaCategoryHints: LAZADA_CATEGORY_HINTS });
      return 0;
    case 'market': {
      const m = marketFromEnv();
      if (sub === 'retail') print(await m.retailIndex(values.segment, { from: values.from, to: values.to, adjusted: values.adjusted, volume: values.volume }));
      else if (sub === 'online') print(await m.onlineShare(values.segment, { from: values.from, to: values.to }));
      else if (sub === 'cpi') print(await m.cpi(values.series, { from: values.from, to: values.to }));
      else if (sub === 'holidays') print(await m.holidays({ from: values.from, to: values.to }));
      else throw new Error('market needs one of: retail, online, cpi, holidays');
      return 0;
    }
    case 'report': {
      if (!values.segment) throw new Error(`--segment is required. One of: ${RETAIL_SERIES.join('; ')}`);
      let orders: SellerOrder[];
      if (values.orders) {
        orders = parseOrdersCsv(await readFile(values.orders, 'utf8'));
      } else {
        const lz = lazadaFromEnv();
        if (!lz) throw new Error('Give --orders FILE.csv, or set LAZADA_APP_KEY, LAZADA_APP_SECRET and a token to pull orders from Lazada.');
        if (!values.from || !values.to) throw new Error('--from and --to (YYYY-MM-DD) are required when pulling from Lazada.');
        orders = await fetchOrders(lz, `${values.from}T00:00:00+08:00`, `${values.to}T23:59:59+08:00`);
      }
      const report = await buildReport(marketFromEnv(), orders, values.segment);
      const text = values.format === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report);
      if (values.out) {
        await writeFile(values.out, text);
        console.error(`Wrote ${values.out}`);
      } else console.log(text);
      return 0;
    }
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`sgmi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
