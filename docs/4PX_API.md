# 4PX Tracking API

Reference for adding 4PX as a second tracker alongside YunTrack.
Verified against the live endpoint on 2026-09-07.

## Endpoint

```
POST https://track.4px.com/track/v2/front/listTrackV3
Content-Type: application/json

{"queryCodes":["4PX3003133457168CN"],"language":"en-us","translateLanguage":""}
```

## No browser required — unlike YunTrack

This is the important architectural difference. 4PX has **no WAF, no signature, no
token, no cookie and no Referer requirement**. A plain `fetch`/`curl` from Node.js
returns HTTP 200 in ~190 ms.

Verified directly from the shell (no Playwright, no cookies, no headers beyond
`Content-Type`):

```bash
curl -s https://track.4px.com/track/v2/front/listTrackV3 \
  -H 'Content-Type: application/json' \
  -d '{"queryCodes":["4PX3003133457168CN"]}' | jq '.data[0].tracks[0]'
```

The SPA also fires `checkLogin`, `checkEnvironment` and `checkUserGrayPermission`
on load — all irrelevant to the query. `language` and `translateLanguage` are
optional and had no observable effect (zh-cn/sv/de all returned English); send
`en-us` or omit them.

**Consequence for this project:** the tracker abstraction must NOT assume every
provider needs the shared Playwright browser. YunTrack needs it (Alibaba Cloud WAF
TLS fingerprinting); 4PX must not pay that cost — it should go straight over
`fetch`, and 4PX-only calls must not warm up or require Chromium.

## Response shape

Top level: `{ result: number, message: string, data: Shipment[] }`.
`result: 1` = OK. Note `message` is Chinese (`"操作成功"`).

### Shipment (`data[]`)

| Field | Type | Notes |
|---|---|---|
| `queryCode` | string | echoes the requested code — key results on this |
| `serverCode` | string | 4PX internal number |
| `shipperCode` | string | |
| `channelTrackCode` | string \| null | last-mile number, when one exists |
| `ctStartCode` / `ctStartName` | string | origin, e.g. `CN` / `China` |
| `ctEndCode` / `ctEndName` | string | destination, e.g. `NO` / `NO` |
| `status` | number | |
| `duration` | number | |
| `tracks` | Track[] | **newest first** (verified) |
| `hawbCodeSet` | string[] | |
| `mutiPackage` | boolean | note the API's own typo |
| `masterOrderNum` | string \| null | |
| `returnStatusFlag` | ? \| null | always null in samples |
| `consigneePostcode` | string | `""` in samples |
| `channelContact` | object \| null | last-mile carrier — **fields are Chinese** |

`channelContact` example (mixed Chinese/English, so do not render it raw to users):

```json
{
  "channelCode": null,
  "channelSimpleName": null,
  "contact": "【服务商】Helthjem\n【联系方式】\n电话：400 64 009\n邮箱：kundesupport@helthjem.no",
  "countryName": "挪威",
  "customsPhone": "400 64 009",
  "website": "https://helthjem.no/",
  "workday": "周一到周五 8:00-16:00"
}
```

### Track (`data[].tracks[]`)

| Field | Type | Notes |
|---|---|---|
| `tkCode` | string | e.g. `FPX_C_ADFF` |
| `tkDesc` | string | |
| `tkTranslatedDesc` | string | equals `tkDesc` in samples |
| `tkLocation` | string | |
| `tkTimezone` | string | e.g. `UTC+08:00` |
| `tkDate` | string | ISO, UTC |
| `tkDateStr` | string | local time in `tkTimezone` |
| `tkCategoryCode` | string | `L`, `C`, … |
| `tkCategoryName` | string | e.g. `Operations in Warehouse` |
| `spTkSummary`, `spTkZipCode`, `tkTranslatedSummary` | null | null in samples |
| `sigPicUrl`, `isSigPic` | null | signature image, null in samples |

## Behaviour

### There is no batching — only the first code is processed

`queryCodes` is an array, but the endpoint answers for its **first element only**
and silently ignores the rest. Verified 2026-09-07:

| Request | `data` returned |
|---|---|
| `["4PX3003133457168CN"]` | the real parcel |
| `["4PX3003133457168CN", "BOGUS123456789XX"]` | the real parcel only |
| `["BOGUS123456789XX", "4PX3003133457168CN"]` | **the bogus code only** |
| `["ZZ999999999XX", "BOGUS…", "4PX…"]` | the `ZZ` code only |

So one parcel means one request. Fan out with bounded concurrency instead of
batching, and never assume a second code in the array was looked at.

This is easy to get wrong: querying a real code with a bogus one appended *looks*
like "unknown codes are dropped", when in fact the second code was never read.

### Unknown codes are answered, not dropped

An unrecognised code comes back as a real entry with `status: 7`,
`serverCode: null` and `tracks: []`. It is not an error and not an omission — so
`result: 1` and a non-empty `data` prove nothing about whether the parcel exists.
Decide "not found" structurally: no `serverCode` and no `tracks`.

## Caveats

- Undocumented internal endpoint with no stated rate limit. Cache per parcel
  (~30–60 min) and back off on 429/5xx to avoid an IP block.
- A browser-like `User-Agent` costs nothing to send; it was not proven necessary
  (bare curl with no UA override worked).
- No stability guarantee — the shape can change without notice.
