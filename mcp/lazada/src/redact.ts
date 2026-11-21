/**
 * Buyer personal data (PDPA 2010) that should not flow into model context or logs
 * unless explicitly enabled. City, country and amounts are kept for analytics.
 */
const PII_KEYS = new Set([
  'customer_first_name',
  'customer_last_name',
  'customer_name',
  'buyer_name',
  'buyer_email',
  'buyer_phone',
  'first_name',
  'last_name',
  'name_local',
  'phone',
  'phone2',
  'mobile',
  'email',
  'address',
  'address1',
  'address2',
  'address3',
  'address4',
  'address5',
  'addressdsitrict',
  'address_district',
  'post_code',
  'postcode',
  'zip_code',
  'national_registration_number',
  'tax_code',
  'receiver_name',
  'receiver_phone',
  'receiver_address',
  'recipient_name',
  'recipient_phone',
  'recipient_address',
]);

export const REDACTED = '[redacted]';

export function redactPii<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (PII_KEYS.has(k.toLowerCase()) && v !== null && v !== '' && typeof v !== 'object') {
      out[k] = REDACTED;
    } else {
      out[k] = walk(v);
    }
  }
  return out;
}
