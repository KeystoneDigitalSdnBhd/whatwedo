#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { lazadaFromEnv, marketFromEnv } from '../config.js';
import { VERSION } from '../version.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const lazada = lazadaFromEnv();
  const server = createServer({ market: marketFromEnv(), lazada, version: VERSION });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`sg-market-intel MCP ready (lazada ${lazada ? 'configured' : 'not configured'})\n`);
  const stop = () => void server.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  process.stderr.write(`sg-market-intel MCP failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
