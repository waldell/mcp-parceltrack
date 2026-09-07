# mcp-parceltrack

MCP server (stdio transport) for parcel tracking via YunTrack and 4PX.

## Stack
- Node.js LTS + TypeScript (strict), ESM
- Playwright (Chromium, headless)
- @modelcontextprotocol/sdk

## Architecture — IMPORTANT

### Providers and routing
Each carrier lives in `src/providers/<name>.ts` behind the `Provider` interface in
`src/providers/types.ts`. `src/router.ts` picks the provider per tracking number —
callers never say which carrier to use.

- Confident prefix match (`4PX…` → 4PX, `YT`/`UJ`/`BCM`/`0099` → YunTrack) goes straight
  to that provider. A confident match that comes back empty is NOT retried
  elsewhere; the parcel is simply unknown there.
- An unrecognised format is probed cheapest-provider-first (`Provider.cost`), and
  each round only carries forward the numbers still unaccounted for.
- **Only YunTrack may touch the browser.** A 4PX-only call must never launch or
  wait for Chromium. Anything added to the router has to preserve that.
- **`found` is not the same as `result`.** Both carriers answer for numbers they
  have never heard of — 4PX with an empty `status: 7` stub, YunTrack by echoing the
  number back with `Status: 0` and an empty `TrackEventDetails` — so a payload is no
  proof the parcel exists. A known and an unknown YunTrack parcel do not even share
  a `TrackInfo` shape; the fields present differ almost entirely, so detection keys
  off the two both have. Providers report `found` separately and still return the
  raw payload.

Tool results are always one entry per tracking number, in the order given:
`{ trackingId, provider, found, result, error? }`. `result` is the carrier's raw
JSON, untouched.

### YunTrack API
The tracking data comes from a signed POST to `services.yuntrack.com/Track/Query`.
Do NOT scrape the DOM — return the raw JSON as-is.

Request body:
```json
{ "NumberList": ["<id>", ...], "CaptchaVerification": "", "Year": 0,
  "Timestamp": <Date.now()>, "Signature": "<hmac>" }
```
Signature = `HMAC-SHA256("Timestamp=<ts>&NumberList=<JSON.stringify(ids)>", "f3c42837e3b46431ddf5d7db7d67017d")` → hex.

The API accepts up to 100 IDs per request in `NumberList`.

### Why YunTrack still needs Playwright
Direct `fetch` from Node.js is blocked by Alibaba Cloud WAF TLS-fingerprint checks.
Only requests from a real Chromium TLS handshake pass through. This applies to
YunTrack alone — 4PX has no WAF and goes over plain `fetch`.

### How requests are made (optimised)
1. One shared `Browser` + `BrowserContext` + `Page` is kept alive.
2. On first use the page navigates to `https://www.yuntrack.com/` (sets Referer
   context). The first `page.evaluate()` fetch triggers a CORS OPTIONS preflight
   which causes the WAF to set the `acw_tc` session cookie (~30 min TTL).
3. All subsequent queries call `fetch()` inside the browser via `page.evaluate()`
   with `credentials: 'include'` — no full page navigation required (~400 ms/call).
4. On HTTP 405 (WAF cookie expired) the context is re-warmed automatically.

### 4PX API
Open endpoint, no browser, no signature — see @docs/4PX_API.md. Note it processes
only the FIRST entry of `queryCodes`, so there is no batching: one parcel per
request, fanned out with bounded concurrency.

## Conventions
- One persistent Browser/Context/Page — do NOT recreate per request.
- A new carrier is a new file in `src/providers/` plus an entry in `src/router.ts`.
- Shut the browser down gracefully on SIGINT/SIGTERM.
- Never add your own interpretation of the API fields unless explicitly asked.

## Running
- `npm run build && npm start`
- First-time setup: `npx playwright install chromium`

## Carrier codes (YunExpress)
`YT` is YunExpress's own waybill format. UJ → PostNord · BCM → Citymail ·
0099 → Earlybird are last-mile numbers YunTrack also resolves — looking up a YT
number returns its UJ number as `TrackInfo.TrackingNumber`.

## Communication
Write all code, comments and commit messages in English. When explaining things
to the user in chat, respond in Swedish.

Full build spec: @docs/BUILD_SPEC.md