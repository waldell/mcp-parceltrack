# mcp-yuntrack

MCP server (stdio transport) for tracking parcels via [YunTrack](https://www.yuntrack.com).

## How it works

The tracker navigates to the YunTrack parcel page and intercepts the POST response from
`services.yuntrack.com/Track/Query` using Playwright's `waitForResponse`. The raw JSON
is returned as-is — no field interpretation.

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
    "yuntrack": {
      "command": "/absolute/path/to/mcp-yuntrack/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/mcp-yuntrack/src/index.ts"]
    }
  }
}
```

3. Restart Claude Desktop — the `track_parcel` tool is now available.

---

## Installing in Claude Code (CLI)

Run once from any directory:

```bash
claude mcp add yuntrack /absolute/path/to/mcp-yuntrack/node_modules/.bin/tsx /absolute/path/to/mcp-yuntrack/src/index.ts
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
    "yuntrack": {
      "command": "/absolute/path/to/mcp-yuntrack/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/mcp-yuntrack/src/index.ts"]
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

**Batch (up to any count, 3 concurrent pages):**
```json
{ "trackingIds": ["UJ123456789SE", "BCM987654321SE"] }
```

Returns the raw JSON from the YunTrack Query API.
