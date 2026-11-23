#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

// stdout is the MCP channel: all diagnostics go to stderr.
async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());

  const mode = config.appKey ? `region=${config.region} writes=${config.enableWrites ? 'on' : 'off'}` : 'unconfigured (no app key)';
  process.stderr.write(`lazada-mcp ready: ${mode}\n`);

  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`lazada-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
