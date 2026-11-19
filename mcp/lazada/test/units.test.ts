import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { LazadaApiError, describeError } from '../src/errors.js';
import { REDACTED, redactPii } from '../src/redact.js';
import { VERSION } from '../src/version.js';
import { buildPriceQuantityXml, escapeXml } from '../src/xml.js';

test('config defaults', () => {
  const c = loadConfig({});
  assert.equal(c.region, 'MY');
  assert.equal(c.baseUrl, 'https://api.lazada.com.my/rest');
  assert.equal(c.authBaseUrl, 'https://auth.lazada.com/rest');
  assert.equal(c.enableWrites, false);
  assert.equal(c.redactPii, true);
  assert.equal(c.timeoutMs, 15_000);
  assert.equal(c.maxRetries, 3);
});

test('config region mapping and validation', () => {
  assert.equal(loadConfig({ LAZADA_REGION: 'th' }).baseUrl, 'https://api.lazada.co.th/rest');
  assert.throws(() => loadConfig({ LAZADA_REGION: 'US' }), /LAZADA_REGION/);
  assert.throws(() => loadConfig({ LAZADA_APP_KEY: 'k' }), /set together/);
  assert.throws(() => loadConfig({ LAZADA_ENABLE_WRITES: 'maybe' }), /true or false/);
  assert.throws(() => loadConfig({ LAZADA_TIMEOUT_MS: '5' }), /between/);
  assert.throws(() => loadConfig({ LAZADA_API_BASE_URL: 'http://example.com/rest' }), /https/);
  assert.equal(loadConfig({ LAZADA_API_BASE_URL: 'http://127.0.0.1:9000/rest/' }).baseUrl, 'http://127.0.0.1:9000/rest');
});

test('redactPii masks buyer data at any depth and keeps business fields', () => {
  const out = redactPii({
    data: {
      orders: [
        {
          order_id: 1,
          customer_first_name: 'Ali',
          price: '10.00',
          address_shipping: { first_name: 'Ali', phone: '+6012', address1: 'Jalan 1', city: 'Kuala Lumpur', country: 'Malaysia', post_code: '50000' },
          items: [{ name: 'Product title stays', email: 'a@b.c' }],
        },
      ],
    },
  });
  const o = out.data.orders[0]!;
  assert.equal(o.customer_first_name, REDACTED);
  assert.equal(o.price, '10.00');
  assert.equal(o.address_shipping.first_name, REDACTED);
  assert.equal(o.address_shipping.phone, REDACTED);
  assert.equal(o.address_shipping.address1, REDACTED);
  assert.equal(o.address_shipping.post_code, REDACTED);
  assert.equal(o.address_shipping.city, 'Kuala Lumpur');
  assert.equal(o.items[0]!.name, 'Product title stays');
  assert.equal(o.items[0]!.email, REDACTED);
});

test('price/quantity XML payload', () => {
  assert.equal(
    buildPriceQuantityXml([
      { item_id: '1', sku_id: '2', price: 19.9, quantity: 5 },
      { seller_sku: 'A&B<1>', sale_price: 9.9 },
    ]),
    '<Request><Product><Skus>' +
      '<Sku><ItemId>1</ItemId><SkuId>2</SkuId><Price>19.9</Price><Quantity>5</Quantity></Sku>' +
      '<Sku><SellerSku>A&amp;B&lt;1&gt;</SellerSku><SalePrice>9.9</SalePrice></Sku>' +
      '</Skus></Product></Request>',
  );
  assert.throws(() => buildPriceQuantityXml([]), /At least one/);
  assert.throws(() => buildPriceQuantityXml([{ item_id: '1', price: 1 }]), /item_id and sku_id, or seller_sku/);
  assert.throws(() => buildPriceQuantityXml([{ seller_sku: 'x' }]), /nothing to update/);
  assert.throws(() => buildPriceQuantityXml([{ seller_sku: 'x', price: 5, sale_price: 6 }]), /cannot exceed/);
  assert.equal(escapeXml(`"'`), '&quot;&apos;');
});

test('describeError adds request id and hints', () => {
  const msg = describeError(new LazadaApiError('IllegalAccessToken', 'bad token', 'r-1'));
  assert.match(msg, /IllegalAccessToken/);
  assert.match(msg, /request_id=r-1/);
  assert.match(msg, /Re-authorize/);
});

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
