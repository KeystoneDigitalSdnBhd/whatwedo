"""Offline MCP protocol check using the real SDK client and stdio transport."""
import asyncio
from pathlib import Path
import sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(command=sys.executable, args=[str(Path(__file__).with_name('server.py'))])
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            assert {t.name for t in (await session.list_tools()).tools} == {'sap_search', 'sap_concepts'}
            for name, arguments in [('sap_search', {'text':'CAP', 'limit':0}), ('sap_concepts', {'skip':-1})]:
                assert (await session.call_tool(name, arguments)).isError
    print('MCP initialization, discovery and validation passed')

if __name__ == '__main__':
    asyncio.run(main())
