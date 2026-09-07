# mcp-parceltrack

MCP server (stdio transport) for parcel tracking. Currently supports YunTrack.

## Stack
- Node.js LTS + TypeScript (strict), ESM
- Playwright (Chromium, headless)
- @modelcontextprotocol/sdk

## Architecture — IMPORTANT

### API
The tracking data comes from a signed POST to `services.yuntrack.com/Track/Query`.
Do NOT scrape the DOM — return the raw JSON as-is.

Request body:
```json
{ "NumberList": ["<id>", ...], "CaptchaVerification": "", "Year": 0,
  "Timestamp": <Date.now()>, "Signature": "<hmac>" }
```
Signature = `HMAC-SHA256("Timestamp=<ts>&NumberList=<JSON.stringify(ids)>", "f3c42837e3b46431ddf5d7db7d67017d")` → hex.

The API accepts up to 100 IDs per request in `NumberList`.

### Why we still need Playwright
Direct `fetch` from Node.js is blocked by Alibaba Cloud WAF TLS-fingerprint checks.
Only requests from a real Chromium TLS handshake pass through.

### How requests are made (optimised)
1. One shared `Browser` + `BrowserContext` + `Page` is kept alive.
2. On first use the page navigates to `https://www.yuntrack.com/` (sets Referer
   context). The first `page.evaluate()` fetch triggers a CORS OPTIONS preflight
   which causes the WAF to set the `acw_tc` session cookie (~30 min TTL).
3. All subsequent queries call `fetch()` inside the browser via `page.evaluate()`
   with `credentials: 'include'` — no full page navigation required (~400 ms/call).
4. On HTTP 405 (WAF cookie expired) the context is re-warmed automatically.

## Conventions
- One persistent Browser/Context/Page — do NOT recreate per request.
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