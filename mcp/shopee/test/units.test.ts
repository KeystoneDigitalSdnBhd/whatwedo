import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { ShopeeApiError, describeError, isAuthFailure, isRateLimited } from '../src/errors.js';
import { REDACTED, redactPii } from '../src/redact.js';
import { VERSION } from '../src/version.js';

test('config defaults and env mapping', () => {
  const c = loadConfig({});
  assert.equal(c.env, 'live');
  assert.equal(c.baseUrl, 'https://partner.shopeemobile.com');
  assert.equal(c.enableWrites, false);
  assert.equal(c.redactPii, true);
  assert.equal(loadConfig({ SHOPEE_ENV: 'test' }).baseUrl, 'https://partner.test-stable.shopeemobile.com');
  assert.equal(loadConfig({ SHOPEE_ENV: 'CN' }).baseUrl, 'https://openplatform.shopee.cn');
});

test('config validation', () => {
  assert.throws(() => loadConfig({ SHOPEE_ENV: 'prod' }), /SHOPEE_ENV/);
  assert.throws(() => loadConfig({ SHOPEE_PARTNER_ID: '1' }), /set together/);
  assert.throws(() => loadConfig({ SHOPEE_PARTNER_ID: 'abc', SHOPEE_PARTNER_KEY: 'k' }), /positive integer/);
  assert.throws(() => loadConfig({ SHOPEE_SHOP_ID: '0' }), /positive integer/);
  assert.throws(() => loadConfig({ SHOPEE_ENABLE_WRITES: 'sure' }), /true or false/);
  assert.throws(() => loadConfig({ SHOPEE_API_BASE_URL: 'http://evil.example' }), /https/);
  const c = loadConfig({ SHOPEE_PARTNER_ID: '2001234', SHOPEE_PARTNER_KEY: 'k', SHOPEE_SHOP_ID: '556677' });
  assert.equal(c.partnerId, 2001234);
  assert.equal(c.shopId, 556677);
});

test('redaction: recipient_address masked except city/state/region; product names kept', () => {
  const out = redactPii({
    response: {
      order_list: [
        {
          order_sn: '2611180ABCDEFG',
          buyer_user_id: 123,
          buyer_username: 'siti88',
          message_to_seller: 'call me at 012-3456789',
          total_amount: 42.5,
          recipient_address: {
            name: 'Siti',
            phone: '60123456789',
            full_address: 'No 1, Jalan 2',
            town: 'Bangsar',
            district: 'Lembah Pantai',
            city: 'Kuala Lumpur',
            state: 'WP Kuala Lumpur',
            region: 'MY',
            zipcode: '59100',
          },
          item_list: [{ item_name: 'Kopi 1kg', model_name: 'Dark', item_sku: 'KOPI-1' }],
          shipping_carrier: 'SPX',
        },
      ],
    },
  });
  const o = out.response.order_list[0]!;
  assert.equal(o.buyer_username, REDACTED);
  assert.equal(o.message_to_seller, REDACTED);
  assert.equal(o.buyer_user_id, 123);
  assert.equal(o.total_amount, 42.5);
  for (const k of ['name', 'phone', 'full_address', 'town', 'district', 'zipcode'] as const) {
    assert.equal(o.recipient_address[k], REDACTED, k);
  }
  assert.equal(o.recipient_address.city, 'Kuala Lumpur');
  assert.equal(o.recipient_address.state, 'WP Kuala Lumpur');
  assert.equal(o.recipient_address.region, 'MY');
  assert.equal(o.item_list[0]!.item_name, 'Kopi 1kg');
  assert.equal(o.shipping_carrier, 'SPX');
});

test('error classification', () => {
  assert.equal(isAuthFailure(new ShopeeApiError('invalid_acceess_token', 'x')), true);
  assert.equal(isAuthFailure(new ShopeeApiError('error_auth', 'Invalid access_token.')), true);
  assert.equal(isAuthFailure(new ShopeeApiError('error_auth', 'shop not bound')), false);
  assert.equal(isRateLimited(new ShopeeApiError('error_too_many_request', 'x')), true);
  assert.equal(isRateLimited(new ShopeeApiError('error_param', 'x', undefined, 429)), true);
});

test('describeError includes request_id and a hint', () => {
  const m = describeError(new ShopeeApiError('error_sign', 'Wrong sign.', 'rid-1'));
  assert.match(m, /error_sign/);
  assert.match(m, /request_id=rid-1/);
  assert.match(m, /SHOPEE_PARTNER_KEY/);
  assert.match(describeError(new ShopeeApiError('error_param', 'bad')), /15 days/);
});

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
