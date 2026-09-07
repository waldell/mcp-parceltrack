import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHmac } from 'crypto';
import type { Provider, TrackResult } from './types.js';

const SIGN_KEY = 'f3c42837e3b46431ddf5d7db7d67017d';
const API_URL = 'https://services.yuntrack.com/Track/Query';
const BASE_URL = 'https://www.yuntrack.com/';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 30_000;

function buildBody(ids: string[]): object {
  const timestamp = Date.now();
  const signature = createHmac('sha256', SIGN_KEY)
    .update(`Timestamp=${timestamp}&NumberList=${JSON.stringify(ids)}`)
    .digest('hex');
  return { NumberList: ids, CaptchaVerification: '', Year: 0, Timestamp: timestamp, Signature: signature };
}

let browser: Browser | null = null;
let ctx: BrowserContext | null = null;
let page: Page | null = null;
let ready = false;
// Serialise warmup so concurrent callers don't race
let warmupPromise: Promise<void> | null = null;

async function launchBrowser(): Promise<void> {
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezoneId: 'Europe/Stockholm',
  });
  page = await ctx.newPage();
}

async function warmup(): Promise<void> {
  if (ready) return;
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    if (!browser?.isConnected()) await launchBrowser();
    if (!ctx || !page || page.isClosed()) {
      ctx = await browser!.newContext({
        userAgent: USER_AGENT,
        locale: 'en-US',
        timezoneId: 'Europe/Stockholm',
      });
      page = await ctx.newPage();
    }
    // Navigate to homepage to establish a valid Referer for CORS requests.
    // The subsequent page.evaluate() fetch with credentials:include will
    // trigger an OPTIONS preflight that sets the acw_tc WAF cookie, after
    // which the actual POST goes through.
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    ready = true;
  })().finally(() => { warmupPromise = null; });

  return warmupPromise;
}

type EvalResult = { status: number; text: string };

async function fetchViaPage(ids: string[]): Promise<unknown> {
  await warmup();
  const p = page!;
  const body = buildBody(ids);

  const result = await Promise.race<EvalResult>([
    p.evaluate<EvalResult, { url: string; b: object }>(
      async ({ url, b }) => {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Authorization': 'Nebula token:undefined',
          },
          body: JSON.stringify(b),
        });
        return { status: res.status, text: await res.text() };
      },
      { url: API_URL, b: body },
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tracking request timed out after 30 s')), FETCH_TIMEOUT_MS),
    ),
  ]);

  if (result.status === 405) {
    // acw_tc WAF cookie expired — mark stale so next call re-warms
    ready = false;
    throw Object.assign(new Error('WAF session expired'), { code: 'WAF_EXPIRED' });
  }
  if (result.status !== 200) {
    throw new Error(`Unexpected HTTP status ${result.status}`);
  }
  return JSON.parse(result.text);
}

async function withReauth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'WAF_EXPIRED') {
      // One retry after re-warmup
      await warmup();
      return fn();
    }
    throw err;
  }
}

// The API accepts up to 100 IDs per NumberList in a single request.
const BATCH_SIZE = 100;

interface ResultItem {
  Id: string;
  Status?: number;
  TrackInfo?: { TrackEventCount?: number };
  [key: string]: unknown;
}

interface QueryResponse {
  ResultList?: ResultItem[];
}

/**
 * YunTrack answers for any waybill number, echoing an unknown one back with
 * Status 0 and every field zeroed. Treat "no track events at all" as no record,
 * while still returning the payload it sent.
 */
function isFound(item: ResultItem): boolean {
  return (item.TrackInfo?.TrackEventCount ?? 0) > 0;
}

export const yunTrack: Provider = {
  name: 'yuntrack',
  // Needs a live Chromium to clear the WAF's TLS fingerprint check, so a cold
  // call pays a browser launch. Only query it when there is reason to.
  cost: 10,

  matches(trackingId) {
    // YunExpress carrier prefixes: UJ = PostNord, BCM = Citymail, 0099 = Earlybird.
    return /^(UJ|BCM|0099)/i.test(trackingId.trim());
  },

  async track(trackingIds) {
    const results: TrackResult[] = [];

    for (let i = 0; i < trackingIds.length; i += BATCH_SIZE) {
      const chunk = trackingIds.slice(i, i + BATCH_SIZE);
      try {
        const data = (await withReauth(() => fetchViaPage(chunk))) as QueryResponse;
        const byId = new Map((data?.ResultList ?? []).map((item) => [item.Id, item]));
        for (const id of chunk) {
          const item = byId.get(id) ?? null;
          results.push({
            trackingId: id,
            provider: 'yuntrack',
            found: item !== null && isFound(item),
            result: item,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        for (const id of chunk) {
          results.push({ trackingId: id, provider: 'yuntrack', found: false, result: null, error });
        }
      }
    }

    return results;
  },

  async close() {
    ready = false;
    if (browser) {
      await browser.close();
      browser = null;
      ctx = null;
      page = null;
    }
  },
};
