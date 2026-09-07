import { fourPx } from './providers/fourpx.js';
import { yunTrack } from './providers/yuntrack.js';
import type { Provider, ProviderName, TrackResult } from './providers/types.js';

// Cheapest first: this is the order unidentified numbers are probed in.
const PROVIDERS: Provider[] = [fourPx, yunTrack].sort((a, b) => a.cost - b.cost);

export const PROVIDER_NAMES = PROVIDERS.map((p) => p.name);

function byName(name: ProviderName): Provider {
  const provider = PROVIDERS.find((p) => p.name === name);
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

/** The provider whose number format this id matches, or null if none claims it. */
function detect(trackingId: string): Provider | null {
  return PROVIDERS.find((p) => p.matches(trackingId)) ?? null;
}

/**
 * Look up every tracking number, choosing a provider per number.
 *
 * Numbers in a known format go straight to the provider that owns that format;
 * a confident match that comes back empty is reported as-is, because the parcel
 * genuinely is not known to that provider — retrying elsewhere would only spend
 * a browser launch to confirm it.
 *
 * Numbers in no recognised format are probed cheapest-provider-first, and each
 * round only carries forward the ones still unaccounted for.
 *
 * Results come back in the order the ids were given.
 */
export async function track(
  trackingIds: string[],
  options: { provider?: ProviderName } = {},
): Promise<TrackResult[]> {
  const resolved = new Map<string, TrackResult>();

  if (options.provider) {
    const forced = byName(options.provider);
    for (const r of await forced.track(dedupe(trackingIds))) resolved.set(r.trackingId, r);
    return trackingIds.map((id) => resolved.get(id) ?? missing(id, forced.name));
  }

  const identified = new Map<ProviderName, string[]>();
  const unidentified: string[] = [];

  for (const id of dedupe(trackingIds)) {
    const provider = detect(id);
    if (provider) {
      const group = identified.get(provider.name) ?? [];
      group.push(id);
      identified.set(provider.name, group);
    } else {
      unidentified.push(id);
    }
  }

  // Identified numbers: one upstream call per provider, all in parallel.
  await Promise.all(
    [...identified].map(async ([name, ids]) => {
      for (const r of await byName(name).track(ids)) resolved.set(r.trackingId, r);
    }),
  );

  // Unidentified numbers: probe providers in cost order until one recognises
  // them. Both carriers answer for numbers they do not know, so `found` — not
  // the mere presence of a payload — decides whether a probe succeeded.
  let pending = unidentified;
  const lastAttempt = new Map<string, TrackResult>();

  for (const provider of PROVIDERS) {
    if (pending.length === 0) break;
    const attempts = await provider.track(pending);
    const stillPending: string[] = [];

    for (const attempt of attempts) {
      if (attempt.found) {
        resolved.set(attempt.trackingId, attempt);
      } else {
        lastAttempt.set(attempt.trackingId, attempt);
        stillPending.push(attempt.trackingId);
      }
    }

    pending = stillPending;
  }

  // No provider recognised these. Report the last attempt, which still carries
  // that provider's payload — and its error, if the request failed rather than
  // simply coming back empty.
  for (const id of pending) {
    resolved.set(id, lastAttempt.get(id) ?? missing(id, PROVIDERS[0]!.name));
  }

  return trackingIds.map((id) => resolved.get(id) ?? missing(id, PROVIDERS[0]!.name));
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function missing(trackingId: string, provider: ProviderName): TrackResult {
  return { trackingId, provider, found: false, result: null, error: 'No result returned' };
}

export async function closeAll(): Promise<void> {
  await Promise.all(PROVIDERS.map((p) => p.close?.()));
}
