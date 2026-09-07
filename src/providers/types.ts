export type ProviderName = 'yuntrack' | '4px';

/**
 * One parcel's outcome.
 *
 * `result` holds the provider's raw payload for that parcel, unmodified — no
 * field interpretation happens anywhere in this server.
 *
 * `found` is routing metadata, kept deliberately separate from `result`: both
 * carriers answer for tracking numbers they have never heard of (4PX with an
 * empty status-7 stub, YunTrack by echoing the number back with zeroed fields),
 * so the presence of a payload says nothing about whether the parcel is known.
 * Keeping the flag beside the payload lets the router move on to another
 * provider without discarding what the first one actually said.
 */
export interface TrackResult {
  trackingId: string;
  provider: ProviderName;
  found: boolean;
  result: unknown;
  error?: string;
}

export interface Provider {
  readonly name: ProviderName;

  /**
   * Relative cost of querying this provider. The router tries cheap providers
   * first when it cannot tell which provider a tracking number belongs to.
   */
  readonly cost: number;

  /** True when the tracking number is confidently this provider's own format. */
  matches(trackingId: string): boolean;

  /**
   * Query the provider for every id. Returns one entry per requested id.
   *
   * `found: false` means this provider has no record of the parcel; it is not
   * an error, and `result` may still carry the empty payload the provider sent.
   * `error` is reserved for a request that actually failed.
   */
  track(trackingIds: string[]): Promise<TrackResult[]>;

  /** Release any long-lived resources (browser, sockets). */
  close?(): Promise<void>;
}
