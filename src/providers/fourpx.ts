import type { Provider, TrackResult } from './types.js';

const ENDPOINT = 'https://track.4px.com/track/v2/front/listTrackV3';
const TIMEOUT_MS = 15_000;
// Undocumented internal endpoint with no stated rate limit — keep the fan-out
// modest so a large batch cannot get the IP blocked.
const CONCURRENCY = 4;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface Shipment {
  queryCode: string;
  serverCode: string | null;
  tracks?: unknown[];
  [key: string]: unknown;
}

interface Response {
  result: number;
  message: string;
  data?: Shipment[];
}

/**
 * Look up exactly one code.
 *
 * `queryCodes` is an array, but the endpoint only ever processes its FIRST
 * element — everything after it is silently ignored (verified 2026-09-07).
 * So there is no batching to exploit here: one parcel, one request.
 */
async function query(trackingId: string): Promise<{ found: boolean; shipment: Shipment | null }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ queryCodes: [trackingId], language: 'en-us', translateLanguage: '' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`4PX HTTP ${res.status}`);

  const json = (await res.json()) as Response;
  if (json.result !== 1) throw new Error(`4PX result=${json.result}: ${json.message}`);

  const shipment = (json.data ?? []).find((s) => s.queryCode === trackingId) ?? null;
  if (!shipment) return { found: false, shipment: null };

  // An unrecognised code still comes back as an entry, just an empty one
  // (observed as status 7, no serverCode, no tracks). Flag it as not found, but
  // hand the payload back anyway so nothing the API said is thrown away.
  const empty = shipment.serverCode == null && (shipment.tracks ?? []).length === 0;
  return { found: !empty, shipment };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

export const fourPx: Provider = {
  name: '4px',
  // Plain HTTPS POST, no browser, ~200 ms — cheap enough to probe speculatively.
  cost: 1,

  matches(trackingId) {
    return /^4PX/i.test(trackingId.trim());
  },

  async track(trackingIds) {
    return mapLimit(trackingIds, CONCURRENCY, async (trackingId): Promise<TrackResult> => {
      try {
        const { found, shipment } = await query(trackingId);
        return { trackingId, provider: '4px', found, result: shipment };
      } catch (err) {
        return {
          trackingId,
          provider: '4px',
          found: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  },
};
