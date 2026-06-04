# Build Spec: YunTrack Parcel Tracking MCP Server

Build a complete MCP server (Model Context Protocol) in **Node.js + TypeScript**
that exposes a tool for tracking parcels via YunTrack.

## Tech stack
- Node.js (LTS) + TypeScript (strict mode)
- Official `@modelcontextprotocol/sdk`
- Transport: stdio (`StdioServerTransport`)
- Headless browser: **Playwright** (Chromium) — choose Playwright over Puppeteer
  because its `waitForResponse` API makes network interception clean and reliable.

## Core idea: capture the network response, do NOT scrape the DOM
The page `https://www.yuntrack.com/parcelTracking?id=[TRACKINGID]` does not render
the tracking data directly in HTML — it is fetched via a POST request to
`https://services.yuntrack.com/Track/Query`.

Implement it like this:
1. Launch a headless Chromium page.
2. Register a `page.waitForResponse()` predicate matching URLs that contain
   `services.yuntrack.com/Track/Query` with status 200, BEFORE navigating.
3. Navigate to `https://www.yuntrack.com/parcelTracking?id=<encodeURIComponent(trackingId)>`
   using `waitUntil: 'domcontentloaded'`.
4. Await the matched response and return `await response.json()` raw (unmodified)
   as the tool result.

Example of the core logic:
```ts
const responsePromise = page.waitForResponse(
  (r) => r.url().includes('services.yuntrack.com/Track/Query') && r.status() === 200,
  { timeout: 30000 }
);
await page.goto(url, { waitUntil: 'domcontentloaded' });
const response = await responsePromise;
const data = await response.json();
```

## MCP tool
Expose a tool `track_parcel`:
- **Input:** `trackingId: string` (required). Validate that it is not empty.
- **Optional:** also support `trackingIds: string[]` for batch tracking (run
  sequentially or with limited concurrency, e.g. max 3 pages at once).
- **Output:** the raw JSON from the Query request, returned as text/JSON in the
  MCP tool result. Do not add your own interpretation of the fields.

## Performance & lifecycle
- Reuse ONE shared `Browser` instance across calls (lazy-start on first call),
  but create a fresh `BrowserContext`/`page` per request and close it afterwards.
- Set a realistic User-Agent and `locale`/`timezone` to reduce the risk of
  hitting bot protection.
- Shut the browser down gracefully on process shutdown (SIGINT/SIGTERM).

## Error handling
- Timeout if the Query response does not arrive within 30 s → return a clear error.
- Invalid/unknown tracking ID → return whatever YunTrack responds (pass the raw
  JSON back even if it indicates "not found").
- Network/navigation errors → catch and return as an MCP error; do not crash the server.

## Project structure & deliverables
- `package.json` with scripts: `build` (tsc), `start`, `dev`.
- `tsconfig.json` (strict, ESM or NodeNext).
- `src/index.ts` — MCP server + tool registration.
- `src/tracker.ts` — the browser logic (interception).
- `README.md` covering: installation (`npm i`, `npx playwright install chromium`),
  how to run, and an example MCP client config (claude_desktop_config.json /
  mcp.json) pointing at the built server.

## Deliver
Complete, runnable code for all files above. No placeholders — it should run with
`npm install && npm run build && start` directly.

## Optional optimization
Since `Track/Query` is a plain POST request, it may be possible to replicate it
without a browser at all: capture the request payload and headers once, then call
the endpoint directly with `fetch`. That is much faster and lighter. However,
YunTrack may sign the requests or require page-generated tokens, so browser
interception is the robust default. If feasible, check whether the Query request
can be replicated directly with the captured payload, and fall back to the browser
otherwise.