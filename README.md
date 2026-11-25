# whatwedo
whatwedo

## MCP servers

- [`mcp/lazada`](mcp/lazada/README.md): Lazada Open Platform (orders, products, finance, logistics) for AI agents.
- [`mcp/shopee`](mcp/shopee/README.md): Shopee Open Platform v2 (orders, products, payments, logistics, returns) for AI agents.

CI for both: `.github/workflows/mcp-servers.yml`.


## Apple Foundation Models

The Sovereign Agent can run one-shot text prompts through Apple Foundation Models
on macOS 27 or later. Select Xcode 27 or later for the Swift toolchain and SDK.

```sh
printf '%s\n' 'Summarize the requirements for an export-readiness checklist.' |
  npm run --silent agent:apple -- on-device
```

On-device mode requires Apple Intelligence to be enabled. Hosted mode sends the
prompt to the configured Chat Completions provider through Apple's
`FoundationModelsUtilities` package.

```sh
export KEYSTONE_APPLE_BASE_URL='https://ark.ap-southeast.bytepluses.com/api/v3'
export KEYSTONE_APPLE_MODEL='<your ModelArk endpoint or model ID>'
# Supply KEYSTONE_APPLE_API_KEY through the environment if the provider requires it.
npm run --silent agent:apple -- hosted < prompt.txt
```

Use a provider base URL such as `/v1` or `/api/v3`. The client appends the
chat-completions path. For a local compatible server, use a loopback HTTP URL.
