export { DataGovClient, DataGovError, type DatasetTable } from './datagov/client.js';
export { DATASETS, RETAIL_SERIES, ONLINE_SHARE_SERIES, LAZADA_CATEGORY_HINTS } from './datagov/datasets.js';
export { tidy, parsePeriod, pickSeries, type Series, type Point } from './datagov/singstat.js';
export { SgMarket, type Holiday, type MarketSeries } from './market.js';
export { fetchOrders, parseOrdersCsv, type SellerOrder } from './lazada/orders.js';
export { dailySales, monthlySales, fillDays, sgDate } from './analytics/sales.js';
export { benchmark } from './analytics/benchmark.js';
export { calendarEffects, classify } from './analytics/calendar.js';
export { buildReport, renderMarkdown, type Report } from './report.js';
