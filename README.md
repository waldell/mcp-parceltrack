# mcp-parceltrack

MCP server (stdio transport) for parcel tracking. Currently supports
[YunTrack](https://www.yuntrack.com).

## How it works

The tracker calls `services.yuntrack.com/Track/Query` directly using a signed POST
request (HMAC-SHA256, key found in the page bundle). Because Alibaba Cloud WAF blocks
requests that lack Chrome's TLS fingerprint, a headless Chromium browser is kept alive
in the background and all API calls are made via `page.evaluate()` — the browser's
own `fetch()` — rather than loading the full tracking page each time. This keeps
response times around 400 ms per query.

A shared browser context is reused across all calls so warm-up only happens once.
The raw JSON from the API is returned as-is — no field interpretation.

## Build

```bash
npm install
npx playwright install chromium
npm run build
```

## Development & testing

```bash
npm run inspect   # opens MCP Inspector in the browser — lets you call tools interactively
npm run dev       # watch mode (tsc + node --watch)
```

---

## Installing in Claude Desktop

1. Open (or create) `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "parceltrack": {
      "command": "/absolute/path/to/mcp-parceltrack/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/mcp-parceltrack/src/index.ts"]
    }
  }
}
```

3. Restart Claude Desktop — the `track_parcel` tool is now available.

---

## Installing in Claude Code (CLI)

Run once from any directory:

```bash
claude mcp add parceltrack /absolute/path/to/mcp-parceltrack/node_modules/.bin/tsx /absolute/path/to/mcp-parceltrack/src/index.ts
```

Restart Claude Code. The tool is available in every project.

To confirm it loaded:

```bash
claude mcp list
```

---

## Installing in Claude Code via project config

Add a `.claude/mcp.json` (or `mcp.json`) in your project root:

```json
{
  "mcpServers": {
    "parceltrack": {
      "command": "/absolute/path/to/mcp-parceltrack/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/mcp-parceltrack/src/index.ts"]
    }
  }
}
```

This makes the server available to everyone who opens the project in Claude Code.

---

## Tool: `track_parcel`

**Single tracking number:**
```json
{ "trackingId": "UJ123456789SE" }
```

**Batch (up to 100 IDs per call, sent in one request):**
```json
{ "trackingIds": ["UJ123456789SE", "BCM987654321SE"] }
```

Returns the raw JSON from the YunTrack Query API.
