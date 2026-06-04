# YunTrack MCP

MCP server (stdio transport) that tracks parcels via YunTrack.

## Stack
- Node.js LTS + TypeScript (strict), ESM
- Playwright (Chromium, headless)
- @modelcontextprotocol/sdk

## Architecture — IMPORTANT
Do NOT scrape the DOM. The tracking data is loaded via a POST request to
`services.yuntrack.com/Track/Query`. Capture that response with
`page.waitForResponse()` — register the predicate BEFORE navigating — and
return the JSON as-is.

## Conventions
- Reuse a single shared Browser instance; create a fresh context/page per request and close it afterwards.
- Shut the browser down gracefully on SIGINT/SIGTERM.
- Never add your own interpretation of the API fields unless explicitly asked.

## Running
- `npm run build && npm start`
- First-time setup: `npx playwright install chromium`

## Carrier codes (YunExpress)
UJ → PostNord · BCM → Citymail · 0099 → Earlybird

## Communication
Write all code, comments and commit messages in English. When explaining things
to the user in chat, respond in Swedish.

Full build spec: @docs/BUILD_SPEC.md