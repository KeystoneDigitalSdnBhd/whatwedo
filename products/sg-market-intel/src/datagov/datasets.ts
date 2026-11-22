/**
 * Curated data.gov.sg datasets. Ids were read from the live data.gov.sg catalogue
 * (all 4,677 datasets) on 20 Nov 2026. Publisher: Singapore Department of
 * Statistics, except public holidays (Ministry of Manpower).
 */
export interface CuratedDataset {
  key: string;
  id: string;
  title: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'daily';
  unit: string;
  layout: 'singstat-wide' | 'rows';
  agency: string;
}

export const DATASETS = {
  retailIndexCurrent: {
    key: 'retailIndexCurrent',
    id: 'd_8bd9b9872c7fcb456b7d2891a350be34',
    title: 'Retail Sales Index (2017 = 100), at current prices, monthly',
    frequency: 'monthly',
    unit: 'index, 2017 = 100',
    layout: 'singstat-wide',
    agency: 'Singapore Department of Statistics',
  },
  retailIndexCurrentSA: {
    key: 'retailIndexCurrentSA',
    id: 'd_96587181d80e9cb8a8b1984342c79a5f',
    title: 'Retail Sales Index (2017 = 100), at current prices, monthly, seasonally adjusted',
    frequency: 'monthly',
    unit: 'index, 2017 = 100',
    layout: 'singstat-wide',
    agency: 'Singapore Department of Statistics',
  },
  retailIndexVolume: {
    key: 'retailIndexVolume',
    id: 'd_6b78d625911483860e162288a4000a0c',
    title: 'Retail Sales Index (2017 = 100), in chained volume terms, monthly',
    frequency: 'monthly',
    unit: 'index, 2017 = 100',
    layout: 'singstat-wide',
    agency: 'Singapore Department of Statistics',
  },
  onlineShare: {
    key: 'onlineShare',
    id: 'd_65e4d47c3616d251f9a84ec1ad28f43c',
    title: "Online retail sales proportion (out of the industry's total sales), monthly",
    frequency: 'monthly',
    unit: 'percent',
    layout: 'singstat-wide',
    agency: 'Singapore Department of Statistics',
  },
  cpi: {
    key: 'cpi',
    id: 'd_bdaff844e3ef89d39fceb962ff8f0791',
    title: 'Consumer Price Index (2024 = 100), monthly',
    frequency: 'monthly',
    unit: 'index, 2024 = 100',
    layout: 'singstat-wide',
    agency: 'Singapore Department of Statistics',
  },
  publicHolidays: {
    key: 'publicHolidays',
    id: 'd_8ef23381f9417e4d4254ee8b4dcdb176',
    title: 'Singapore public holidays (consolidated)',
    frequency: 'daily',
    unit: 'date',
    layout: 'rows',
    agency: 'Ministry of Manpower',
  },
} as const satisfies Record<string, CuratedDataset>;

export type DatasetKey = keyof typeof DATASETS;

/**
 * Retail Sales Index series that a Lazada shop can be compared with, keyed by
 * the series name SingStat uses. Online share exists only for the four starred
 * categories plus the totals.
 */
export const RETAIL_SERIES = [
  'Total',
  'Total (Excluding Motor Vehicles)',
  'Department Stores',
  'Supermarkets & Hypermarkets',
  'Mini-Marts & Convenience Stores',
  'Food & Alcohol',
  'Cosmetics, Toiletries & Medical Goods',
  'Wearing Apparel & Footwear',
  'Furniture & Household Equipment',
  'Recreational Goods',
  'Watches & Jewellery',
  'Computer & Telecommunications Equipment',
  'Optical Goods & Books',
  'Others',
] as const;

/** The matching series in the online-share table, where SingStat publishes one. */
export const ONLINE_SHARE_SERIES: Record<string, string> = {
  Total: 'Retail Trade',
  'Total (Excluding Motor Vehicles)': 'Retail Trade (Excluding Motor Vehicles)',
  'Supermarkets & Hypermarkets': 'Supermarkets & Hypermarkets',
  'Computer & Telecommunications Equipment': 'Computer & Telecommunications Equipment',
  'Furniture & Household Equipment': 'Furniture & Household Equipment',
};

/**
 * Suggested Retail Sales Index series for common Lazada top-level categories.
 * A starting point only: the seller should confirm which series fits their range.
 */
export const LAZADA_CATEGORY_HINTS: Record<string, string> = {
  'Mobiles & Tablets': 'Computer & Telecommunications Equipment',
  'Computers & Laptops': 'Computer & Telecommunications Equipment',
  'Electronic Accessories': 'Computer & Telecommunications Equipment',
  'TV, Audio / Video, Gaming & Wearables': 'Recreational Goods',
  'Home Appliances': 'Furniture & Household Equipment',
  'Home & Living': 'Furniture & Household Equipment',
  'Health & Beauty': 'Cosmetics, Toiletries & Medical Goods',
  'Groceries': 'Supermarkets & Hypermarkets',
  "Women's Fashion & Accessories": 'Wearing Apparel & Footwear',
  "Men's Fashion & Accessories": 'Wearing Apparel & Footwear',
  'Watches, Bags & Jewellery': 'Watches & Jewellery',
  'Sports & Outdoors': 'Recreational Goods',
  'Toys, Games & Hobbies': 'Recreational Goods',
  'Books & Stationery': 'Optical Goods & Books',
  'Mother & Baby': 'Others',
  'Pet Supplies': 'Others',
};
