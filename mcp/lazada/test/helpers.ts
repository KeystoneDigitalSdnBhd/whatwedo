import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

export interface Recorded {
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  headers: Record<string, string>;
}

export type Responder = (req: Recorded) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** Fake fetch that records requests and answers from a responder or a queue. */
export function fakeFetch(responder: Responder | Array<{ status?: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const queue = Array.isArray(responder) ? [...responder] : undefined;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const params =
      method === 'GET'
        ? Object.fromEntries(url.searchParams)
        : Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const rec: Recorded = { method, url, path: url.pathname.replace(/^\/rest/, ''), params, headers };
    calls.push(rec);
    const next = queue ? queue.shift() : await (responder as Responder)(rec);
    if (!next) throw new Error(`fakeFetch: no response queued for ${method} ${rec.path}`);
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  body: { code: '0', request_id: 'req-ok', data, ...extra },
});

export const apiErr = (code: string, message = code) => ({
  body: { code, type: 'ISV', message, request_id: 'req-err' },
});

export const noSleep = async () => {};

export async function connect(env: Record<string, string>, fetchImpl: typeof fetch, now = () => 1_763_424_000_000) {
  const config = loadConfig({ LAZADA_APP_KEY: '123456', LAZADA_APP_SECRET: 'secret', LAZADA_ACCESS_TOKEN: 'tok', ...env });
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
