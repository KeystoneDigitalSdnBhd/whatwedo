// Reads every curated dataset from the live data.gov.sg API and checks the shapes
// this product depends on. Optional: pulls one page of Lazada orders if configured.
import { dataGovFromEnv, lazadaFromEnv } from '../src/config.js';
import { DATASETS, ONLINE_SHARE_SERIES, RETAIL_SERIES } from '../src/datagov/datasets.js';
import { tidy } from '../src/datagov/singstat.js';
import { fetchOrders } from '../src/lazada/orders.js';

const dg = dataGovFromEnv({ ...process.env, SGMI_NO_CACHE: '1' });
let failed = 0;
const check = async (name: string, fn: () => Promise<string>) => {
  try { console.log(`  ok   ${name}  ${await fn()}`); } catch (e) { failed++; console.log(`  FAIL ${name}  ${(e as Error).message}`); }
};
for (const d of Object.values(DATASETS)) {
  await check(d.key, async () => {
    const t = await dg.table(d.id);
    if (d.layout === 'rows') return `${t.records.length} rows, ${t.records.at(-1)?.date}`;
    const s = tidy(t.records);
    const want = d.key === 'onlineShare' ? Object.values(ONLINE_SHARE_SERIES) : d.key === 'cpi' ? ['All Items'] : [...RETAIL_SERIES];
    const missing = want.filter((w) => !s.some((x) => x.name === w));
    if (missing.length) throw new Error(`series missing: ${missing.join(', ')}`);
    const latest = s[0]!.points.filter((p) => p.value !== null).at(-1)!;
    return `${s.length} series, latest ${latest.period} = ${latest.value}`;
  });
}
const lz = lazadaFromEnv();
if (lz) {
  await check('lazada /orders/get', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const o = await fetchOrders(lz, from.toISOString(), to.toISOString(), { pageSize: 20, maxOrders: 20 });
    return `${o.length} orders in the last 7 days (first page)`;
  });
} else console.log('  skip lazada (no LAZADA_APP_KEY)');
process.exit(failed ? 1 : 0);
