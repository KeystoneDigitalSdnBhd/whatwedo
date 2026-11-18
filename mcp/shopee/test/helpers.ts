import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

export const NOW_MS = 1_763_424_000_000;
export const PARTNER_ID = '2001234';
export const PARTNER_KEY = 'shpk_test_key';
export const SHOP_ID = '556677';

export interface Recorded {
  method: string;
  url: URL;
  path: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

export type Reply = { status?: number; body: unknown };
export type Responder = (req: Recorded) => Reply | Promise<Reply>;

export function fakeFetch(responder: Responder | Reply[]) {
  const calls: Recorded[] = [];
  const queue = Array.isArray(responder) ? [...responder] : undefined;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const rec: Recorded = {
      method,
      url,
      path: url.pathname,
      query: url.searchParams,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    };
    calls.push(rec);
    const next = queue ? queue.shift() : await (responder as Responder)(rec);
    if (!next) throw new Error(`fakeFetch: no response queued for ${method} ${rec.path}`);
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const ok = (response: unknown, extra: Record<string, unknown> = {}): Reply => ({
  body: { request_id: 'req-ok', error: '', message: '', response, ...extra },
});

export const apiErr = (error: string, message = error, status = 200): Reply => ({
  status,
  body: { request_id: 'req-err', error, message },
});

export const noSleep = async () => {};

export async function connect(env: Record<string, string>, fetchImpl: typeof fetch, now = () => NOW_MS) {
  const config = loadConfig({
    SHOPEE_PARTNER_ID: PARTNER_ID,
    SHOPEE_PARTNER_KEY: PARTNER_KEY,
    SHOPEE_SHOP_ID: SHOP_ID,
    SHOPEE_ACCESS_TOKEN: 'tok',
    ...env,
  });
  const server = createServer(config, { fetch: fetchImpl, now, sleep: noSleep });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server, config };
}

export function text(result: unknown): string {
  const r = result as { content: Array<{ type: string; text?: string }> };
  return r.content.map((c) => c.text ?? '').join('');
}
