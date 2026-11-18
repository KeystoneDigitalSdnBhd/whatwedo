import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBaseString, sign, verifyPushSignature } from '../src/signer.js';

const KEY = 'shpk_test_key';

test('public API base string: partner_id + path + timestamp', () => {
  assert.equal(
    buildBaseString({ partnerId: 2001234, path: '/api/v2/auth/token/get', timestamp: 1763424000 }),
    '2001234/api/v2/auth/token/get1763424000',
  );
});

test('shop API base string appends access_token + shop_id', () => {
  assert.equal(
    buildBaseString({ partnerId: 2001234, path: '/api/v2/order/get_order_list', timestamp: 1763424000, accessToken: 'tok', shopId: 556677 }),
    '2001234/api/v2/order/get_order_list1763424000tok556677',
  );
});

test('merchant API base string appends access_token + merchant_id', () => {
  assert.equal(
    buildBaseString({ partnerId: 1, path: '/api/v2/merchant/get_merchant_info', timestamp: 2, accessToken: 't', merchantId: 9 }),
    '1/api/v2/merchant/get_merchant_info2t9',
  );
});

test('signing an access-token call without an owner, or with both owners, is refused', () => {
  assert.throws(() => buildBaseString({ partnerId: 1, path: '/p', timestamp: 1, accessToken: 't' }), /shop_id or merchant_id/);
  assert.throws(
    () => buildBaseString({ partnerId: 1, path: '/p', timestamp: 1, accessToken: 't', shopId: 1, merchantId: 2 }),
    /not both/,
  );
});

test('signatures match independently computed vectors (Python hmac), lowercase hex', () => {
  assert.equal(
    sign({ partnerId: 2001234, path: '/api/v2/auth/token/get', timestamp: 1763424000 }, KEY),
    '25c729f9335f5ad646871098b20b3c8bb9ce95b60971392f931692516b7c94ff',
  );
  assert.equal(
    sign({ partnerId: 2001234, path: '/api/v2/order/get_order_list', timestamp: 1763424000, accessToken: 'tok', shopId: 556677 }, KEY),
    '0312d3ce060047c12479346d0a8eeab507d3dfeb17fb4e46f2cf41dab632cc9c',
  );
});

test('push signature verification: url|body, constant-time compare', () => {
  const url = 'https://example.com/shopee/push';
  const body = '{"code":3,"shop_id":556677}';
  const good = '50c5c5f163a986fef347628efb8d1804ba1834d905e6c7ffab590abd55da1e80';
  assert.equal(verifyPushSignature(url, body, good, KEY), true);
  assert.equal(verifyPushSignature(url, body + ' ', good, KEY), false);
  assert.equal(verifyPushSignature(url, body, good.slice(0, -1), KEY), false);
  assert.equal(verifyPushSignature(url, body, good, 'other-key'), false);
});
