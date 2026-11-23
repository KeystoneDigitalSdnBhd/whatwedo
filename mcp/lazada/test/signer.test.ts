import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSignString, signRequest } from '../src/signer.js';

const params = {
  timestamp: '1763424000000',
  app_key: '123456',
  sign_method: 'sha256',
  access_token: 'tok',
  created_after: '2026-11-01T00:00:00+08:00',
};

test('sign string: api path prefix, keys in ASCII order, no separators', () => {
  assert.equal(
    buildSignString('/orders/get', params),
    '/orders/getaccess_tokentokapp_key123456created_after2026-11-01T00:00:00+08:00sign_methodsha256timestamp1763424000000',
  );
});

test('sign string excludes an existing sign parameter', () => {
  assert.equal(buildSignString('/a', { sign: 'X', b: '2', a: '1' }), '/aa1b2');
});

test('ASCII ordering puts uppercase before lowercase and _ after uppercase', () => {
  assert.equal(buildSignString('/p', { b: '1', B: '2', _x: '3', a_b: '4', ab: '5' }), '/pB2_x3a_b4ab5b1');
});

test('HMAC-SHA256 uppercase hex matches an independently computed vector (Python hmac)', () => {
  assert.equal(
    signRequest('/orders/get', params, 'secret'),
    '33548545D12D597422E5CC145002091BB81F48586457FAE1719FD4022C65ECAF',
  );
});

test('UTF-8 values are signed as bytes', () => {
  const s = signRequest('/products/get', { search: '基石 café' }, 'secret');
  assert.match(s, /^[0-9A-F]{64}$/);
  assert.notEqual(s, signRequest('/products/get', { search: '基石 cafe' }, 'secret'));
});
