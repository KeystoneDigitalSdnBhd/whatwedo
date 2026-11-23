// End-to-end check of the built server over real stdio: spawn dist/index.js,
// complete the MCP handshake, list tools, and call one tool. No network needed.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const EXPECTED_TOOLS = 16;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  // Only the PATH: never pass real credentials into the smoke test.
  env: { PATH: process.env.PATH ?? '', LAZADA_APP_KEY: '000000', LAZADA_APP_SECRET: 'smoke-secret' },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', (d) => (stderr += d));

const client = new Client({ name: 'lazada-mcp-smoke', version: '0.0.0' });
const timer = setTimeout(() => {
  console.error('smoke: timed out\n' + stderr);
  process.exit(1);
}, 20_000);

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  assert.equal(info?.name, 'lazada-open-platform');

  const { tools } = await client.listTools();
  assert.equal(tools.length, EXPECTED_TOOLS, `expected ${EXPECTED_TOOLS} tools, got ${tools.map((t) => t.name).join(', ')}`);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} needs a description`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} input schema`);
  }

  const status = await client.callTool({ name: 'lazada_token_status', arguments: {} });
  assert.notEqual(status.isError, true);
  const parsed = JSON.parse(status.content[0].text);
  assert.equal(parsed.authorized, false);
  assert.equal(parsed.writesEnabled, false);

  const auth = await client.callTool({
    name: 'lazada_get_auth_url',
    arguments: { redirect_uri: 'https://example.com/callback' },
  });
  assert.match(JSON.parse(auth.content[0].text).url, /^https:\/\/auth\.lazada\.com\/oauth\/authorize\?/);

  assert.match(stderr, /lazada-mcp ready/);
  console.log(`smoke: ok (${info.name} ${info.version}, ${tools.length} tools)`);
} catch (err) {
  console.error('smoke: FAILED\n', err, '\n--- server stderr ---\n' + stderr);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await client.close();
}
