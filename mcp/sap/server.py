"""SAP public developer knowledge tools for MCP clients. Python 3.10+."""
import json
import urllib.request
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("SAP Developer Knowledge")
ENDPOINT = "https://developers.sap.com/graphql/public"

def query(document: str) -> dict:
    request = urllib.request.Request(ENDPOINT,
        data=json.dumps({"query": document}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "SAP-Antigravity-MCP/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get("errors"):
        raise RuntimeError(json.dumps(result["errors"]))
    return result["data"]

@mcp.tool()
def sap_search(text: str, limit: int = 10) -> dict:
    """Search SAP's live public developer catalogue by title, ranked by searchScore."""
    if not text.strip() or len(text) > 300:
        raise ValueError("Supply a search term of 1–300 characters")
    if not 1 <= limit <= 50:
        raise ValueError("limit must be 1–50")
    return query('query { SearchService { SearchableItems(filter: {title: {contains: '
        + json.dumps(text) + '}}, orderBy: {searchScore: desc}, top: '
        + str(limit) + ') { totalCount nodes { title description taskType searchScore } } } }')

@mcp.tool()
def sap_concepts(text: str = "", limit: int = 20, skip: int = 0) -> dict:
    """List published SAP concepts; optionally filter by name. Supports pagination."""
    if len(text) > 300 or not 1 <= limit <= 100 or skip < 0:
        raise ValueError("text max 300 characters; limit 1–100; skip >= 0")
    filtering = 'filter: {name: {contains: ' + json.dumps(text) + '}}, ' if text else ''
    return query('query { KnowledgeGraphService { PublishedConcepts('
        + filtering + 'top: ' + str(limit) + ', skip: ' + str(skip)
        + ') { totalCount nodes { slug name description } } } }')

if __name__ == "__main__":
    mcp.run(transport="stdio")
