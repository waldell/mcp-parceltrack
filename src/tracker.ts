import { chromium, type Browser } from 'playwright';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function trackParcel(trackingId: string): Promise<unknown> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezoneId: 'Europe/Stockholm',
  });
  const page = await ctx.newPage();

  try {
    const url = `https://www.yuntrack.com/parcelTracking?id=${encodeURIComponent(trackingId)}`;

    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('services.yuntrack.com/Track/Query') &&
        r.status() === 200,
      { timeout: 30000 },
    );

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const response = await responsePromise;
    return await response.json();
  } finally {
    await ctx.close();
  }
}

export async function trackParcels(
  trackingIds: string[],
  concurrency = 3,
): Promise<Array<{ trackingId: string; result: unknown; error?: string }>> {
  const results: Array<{ trackingId: string; result: unknown; error?: string }> = [];
  const queue = [...trackingIds];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      try {
        const result = await trackParcel(id);
        results.push({ trackingId: id, result });
      } catch (err) {
        results.push({
          trackingId: id,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, trackingIds.length) }, worker);
  await Promise.all(workers);
  return results;
}
