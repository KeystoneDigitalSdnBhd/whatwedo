/**
 * Buyer personal data (PDPA 2010 and equivalents) masked before results reach the
 * model. Shopee nests the delivery address under `recipient_address`, where `name`
 * means the buyer's name; elsewhere `name` is usually a product or channel name, so
 * address containers are handled separately.
 */
const PII_KEYS = new Set([
  'buyer_username',
  'buyer_email',
  'buyer_phone',
  'buyer_cpf_id',
  'buyer_cnpj_id',
  'buyer_tax_id',
  'tax_id',
  'phone',
  'email',
  'full_address',
  'zipcode',
  'message_to_seller',
  'note',
  'recipient_name',
  'recipient_phone',
]);

/** Inside these objects every scalar is masked except the keys in ADDRESS_KEEP. */
const ADDRESS_CONTAINERS = new Set(['recipient_address', 'buyer_address', 'shipping_address', 'invoice_data', 'pickup_address']);
const ADDRESS_KEEP = new Set(['city', 'state', 'region', 'country']);

export const REDACTED = '[redacted]';

export function redactPii<T>(value: T): T {
  return walk(value, false) as T;
}

function walk(value: unknown, inAddress: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, inAddress));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (v !== null && typeof v === 'object') {
      out[k] = walk(v, inAddress || ADDRESS_CONTAINERS.has(key));
    } else if (v === null || v === '' || v === undefined) {
      out[k] = v;
    } else if (PII_KEYS.has(key) || (inAddress && !ADDRESS_KEEP.has(key))) {
      out[k] = REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}
