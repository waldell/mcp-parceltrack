# mcp-parceltrack

MCP server (stdio transport) for parcel tracking, supporting
[YunTrack](https://www.yuntrack.com) (YunExpress) and [4PX](https://track.4px.com).
You do not pick a carrier — the server works it out from the tracking number.

## How it works

Each carrier is a provider behind a common interface, and a router chooses per
tracking number: a recognised prefix (`4PX…`, or `UJ`/`BCM`/`0099`) goes straight to
its carrier, while an unrecognised one is probed cheapest-carrier-first.

The two carriers could hardly be less alike. 4PX is a plain open endpoint (~200 ms,
no browser, no signature) — but it only ever reads the first entry of its
`queryCodes` array, so it cannot batch: each parcel is its own request, fanned out
a few at a time.

YunTrack is the opposite. It batches 100 numbers per call, but its provider has to
call `services.yuntrack.com/Track/Query` with a signed POST request (HMAC-SHA256,
key found in the page bundle). Because Alibaba Cloud WAF blocks
requests that lack Chrome's TLS fingerprint, a headless Chromium browser is kept alive
in the background and all API calls are made via `page.evaluate()` — the browser's
own `fetch()` — rather than loading the full tracking page each time. This keeps
response times around 400 ms per query.

A shared browser context is reused across all calls so warm-up only happens once,
and it is started lazily — a 4PX-only lookup never launches Chromium at all.
The raw JSON from each API is returned as-is — no field interpretation.

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

**Batch — carriers may be mixed freely:**
```json
{ "trackingIds": ["UJ123456789SE", "4PX3003133457168CN"] }
```

**Forcing a carrier** (rarely needed; only when auto-detection is known to be wrong):
```json
{ "trackingId": "1234567890", "provider": "4px" }
```

### Result

One entry per tracking number, in the order you gave them:

```json
[
  {
    "trackingId": "4PX3003133457168CN",
    "provider": "4px",
    "found": true,
    "result": { "queryCode": "4PX3003133457168CN", "tracks": [ ... ] }
  }
]
```

- `provider` — which carrier answered.
- `found` — whether that carrier actually has a record of the parcel. Check this,
  not `result`: both carriers reply to numbers they have never heard of (4PX with an
  empty stub, YunTrack by echoing the number back with zeroed fields), so a payload
  alone proves nothing.
- `result` — the carrier's raw JSON, unmodified. Shapes differ per carrier.
- `error` — present only when the request itself failed, never for a simple miss.

### Checking the routing

```bash
npm run check:routing
```

Hits both carriers live and asserts the routing rules (correct carrier per prefix,
input order preserved, no browser launched for a 4PX-only lookup).
