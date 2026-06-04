import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHmac } from 'crypto';

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

export async function trackParcel(trackingId: string): Promise<unknown> {
  return withReauth(() => fetchViaPage([trackingId]));
}

// The API accepts up to 100 IDs per NumberList in a single request.
const BATCH_SIZE = 100;

export async function trackParcels(
  trackingIds: string[],
): Promise<Array<{ trackingId: string; result: unknown; error?: string }>> {
  const results: Array<{ trackingId: string; result: unknown; error?: string }> = [];

  for (let i = 0; i < trackingIds.length; i += BATCH_SIZE) {
    const chunk = trackingIds.slice(i, i + BATCH_SIZE);
    try {
      const data = await withReauth(() => fetchViaPage(chunk)) as { ResultList?: Array<{ Id: string } & Record<string, unknown>> };
      const list = data?.ResultList ?? [];
      for (const item of list) {
        results.push({ trackingId: item.Id, result: item });
      }
      // Any IDs missing from the response (shouldn't happen, but be safe)
      const returned = new Set(list.map(r => r.Id));
      for (const id of chunk) {
        if (!returned.has(id)) results.push({ trackingId: id, result: null, error: 'No result returned' });
      }
    } catch (err) {
      for (const id of chunk) {
        results.push({ trackingId: id, result: null, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return results;
}

export async function closeBrowser(): Promise<void> {
  ready = false;
  if (browser) {
    await browser.close();
    browser = null;
    ctx = null;
    page = null;
  }
}
