export interface SkuUpdate {
  item_id?: string;
  sku_id?: string;
  seller_sku?: string;
  price?: number;
  sale_price?: number;
  sale_start_date?: string;
  sale_end_date?: string;
  quantity?: number;
}

const FIELDS: Array<[keyof SkuUpdate, string]> = [
  ['item_id', 'ItemId'],
  ['sku_id', 'SkuId'],
  ['seller_sku', 'SellerSku'],
  ['price', 'Price'],
  ['sale_price', 'SalePrice'],
  ['sale_start_date', 'SaleStartDate'],
  ['sale_end_date', 'SaleEndDate'],
  ['quantity', 'Quantity'],
];

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Payload for /product/price_quantity/update. Each SKU must be identified by
 * item_id + sku_id, or by seller_sku, and change at least one value.
 */
export function buildPriceQuantityXml(skus: readonly SkuUpdate[]): string {
  if (skus.length === 0) throw new Error('At least one SKU is required');
  const parts = skus.map((sku, i) => {
    const identified = (sku.item_id && sku.sku_id) || sku.seller_sku;
    if (!identified) throw new Error(`SKU #${i + 1}: provide item_id and sku_id, or seller_sku`);
    const changes = sku.price ?? sku.sale_price ?? sku.quantity;
    if (changes === undefined) throw new Error(`SKU #${i + 1}: nothing to update (price, sale_price or quantity)`);
    if (sku.sale_price !== undefined && sku.price !== undefined && sku.sale_price > sku.price) {
      throw new Error(`SKU #${i + 1}: sale_price cannot exceed price`);
    }
    const inner = FIELDS.filter(([k]) => sku[k] !== undefined)
      .map(([k, tag]) => `<${tag}>${escapeXml(String(sku[k]))}</${tag}>`)
      .join('');
    return `<Sku>${inner}</Sku>`;
  });
  return `<Request><Product><Skus>${parts.join('')}</Skus></Product></Request>`;
}
