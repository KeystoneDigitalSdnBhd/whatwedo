import { DataGovClient } from './datagov/client.js';
import { DATASETS, ONLINE_SHARE_SERIES } from './datagov/datasets.js';
import { between, pickSeries, tidy, type Point, type Series } from './datagov/singstat.js';

export interface Holiday {
  date: string;
  day: string;
  holiday: string;
}

export interface MarketSeries {
  dataset: string;
  datasetId: string;
  series: string;
  unit: string;
  points: Point[];
}

/** Singapore market data from data.gov.sg, reshaped for analysis. */
export class SgMarket {
  constructor(private readonly client: DataGovClient) {}

  async listSeries(key: 'retailIndexCurrent' | 'retailIndexCurrentSA' | 'retailIndexVolume' | 'onlineShare' | 'cpi'): Promise<Series[]> {
    const t = await this.client.table(DATASETS[key].id);
    return tidy(t.records);
  }

  async retailIndex(series = 'Total (Excluding Motor Vehicles)', opts: { from?: string; to?: string; adjusted?: boolean; volume?: boolean } = {}): Promise<MarketSeries> {
    if (opts.adjusted && opts.volume) throw new Error('Choose seasonally adjusted (current prices) or volume terms, not both.');
    const ds = opts.volume ? DATASETS.retailIndexVolume : opts.adjusted ? DATASETS.retailIndexCurrentSA : DATASETS.retailIndexCurrent;
    return this.series(ds, series, opts.from, opts.to);
  }

  /** Online share (%) for a Retail Sales Index series, where SingStat publishes one. */
  async onlineShare(retailSeries = 'Total (Excluding Motor Vehicles)', opts: { from?: string; to?: string } = {}): Promise<MarketSeries> {
    const name = ONLINE_SHARE_SERIES[retailSeries] ?? retailSeries;
    return this.series(DATASETS.onlineShare, name, opts.from, opts.to);
  }

  async cpi(series = 'All Items', opts: { from?: string; to?: string } = {}): Promise<MarketSeries> {
    return this.series(DATASETS.cpi, series, opts.from, opts.to);
  }

  async holidays(opts: { from?: string; to?: string } = {}): Promise<Holiday[]> {
    const t = await this.client.table(DATASETS.publicHolidays.id);
    return t.records
      .map((r) => ({ date: String(r.date), day: String(r.day), holiday: String(r.holiday) }))
      .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && (!opts.from || h.date >= opts.from) && (!opts.to || h.date <= opts.to))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  private async series(ds: { id: string; title: string; unit: string }, name: string, from?: string, to?: string): Promise<MarketSeries> {
    const t = await this.client.table(ds.id);
    const s = pickSeries(tidy(t.records), name);
    return { dataset: ds.title, datasetId: ds.id, series: s.name, unit: ds.unit, points: between(s.points, from, to) };
  }
}
