// Starts the built MCP server over stdio and the built CLI, without network or credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dist = (p) => fileURLToPath(new URL(`../dist/${p}`, import.meta.url));
const env = { PATH: process.env.PATH ?? '', SGMI_NO_CACHE: '1' };

const help = execFileSync(process.execPath, [dist('cli.js'), '--help'], { env, encoding: 'utf8' });
assert.match(help, /sgmi: benchmark a Lazada Singapore shop/);
const ds = JSON.parse(execFileSync(process.execPath, [dist('cli.js'), 'datasets'], { env, encoding: 'utf8' }));
assert.equal(ds.length, 6);

const transport = new StdioClientTransport({ command: process.execPath, args: [dist('mcp/index.js')], env, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (d) => (stderr += d));
const client = new Client({ name: 'smoke', version: '0' });
const timer = setTimeout(() => { console.error('smoke: timeout\n' + stderr); process.exit(1); }, 20_000);
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, 'sg-market-intel');
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  const seg = await client.callTool({ name: 'sg_segments', arguments: {} });
  assert.match(seg.content[0].text, /Computer & Telecommunications Equipment/);
  assert.match(stderr, /MCP ready \(lazada not configured\)/);
  console.log(`smoke: ok (cli + mcp, ${tools.length} tools)`);
} catch (e) {
  console.error('smoke: FAILED', e, stderr);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await client.close();
}
