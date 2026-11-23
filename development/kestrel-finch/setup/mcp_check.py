"""Finding values over MCP (DQ §5.8a): Amélie's token sees them hidden."""
import json

import httpx
from kf import API, WS, Api, ApiError

ines, amelie = Api("ines.kovac"), Api("amelie.fontaine")
settings = ines.call("GET", "instance-settings")
if not settings.get("mcpEnabled"):
    ines.call("PUT", "instance-settings", json={**{k: v for k, v in settings.items() if k == "mcpEnabled"}, "mcpEnabled": True})
listing = amelie.call("GET", "instance-settings/mcp/tokens")
for t in (listing.get("items", listing) if isinstance(listing, dict) else listing) or []:
    if isinstance(t, dict) and t.get("name") in ("kf-check", "kf-shape"):
        amelie.call("DELETE", f"instance-settings/mcp/tokens/{t['id']}")
made = amelie.call("POST", "instance-settings/mcp/tokens", json={"name": "kf-check"})
token = made["plainTextToken"]
headers = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream",
           "content-type": "application/json"}


def rpc(method: str, params: dict, i: int) -> dict:
    r = httpx.post(f"{API}/{WS}/mcp", headers=headers, timeout=120,
                   json={"jsonrpc": "2.0", "id": i, "method": method, "params": params})
    text = r.text
    if text.startswith("event:") or "data:" in text[:20]:
        text = next(line[5:] for line in text.splitlines() if line.startswith("data:"))
    return json.loads(text)


rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "kf", "version": "1"}}, 1)
listed = rpc("tools/list", {}, 2); tools = [t["name"] for t in listed["result"]["tools"]]
name = next(t for t in tools if t in ("search_findings", "list_findings"))
out = rpc("tools/call", {"name": name, "arguments": {"limit": 5}}, 3)["result"]
text = out["content"][0]["text"]
print("tool", name, "→", "5864" in text, "AT48" in text, text.count("••••"), "hidden markers")
print(text[:400])
amelie.call("DELETE", f"instance-settings/mcp/tokens/{made['id']}")
