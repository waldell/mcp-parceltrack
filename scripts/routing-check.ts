/**
 * Live routing check. Hits both carriers for real, so it needs network access.
 *
 * The structural checks run with throwaway numbers. The "does a real parcel
 * resolve" checks need genuine tracking numbers, which are not committed —
 * supply your own:
 *
 *   PARCELTRACK_TEST_4PX=4PX… PARCELTRACK_TEST_YUNTRACK=YT… npm run check:routing
 */
import { track, closeAll } from '../src/router.js';

const REAL_4PX = process.env.PARCELTRACK_TEST_4PX;
const REAL_YUNTRACK = process.env.PARCELTRACK_TEST_YUNTRACK;

let failures = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failures++;
}

function skip(name: string, why: string) {
  console.log(`SKIP  ${name}  → ${why}`);
  skipped++;
}

// Prefix routing, using numbers that need not exist.
const prefixes = await track(['4PX0000000000CN', 'YT0000000000000000', 'UJ000000000SE']);
check('4PX prefix routed to 4px', prefixes[0]!.provider === '4px', prefixes[0]!.provider);
check('YT prefix routed to yuntrack', prefixes[1]!.provider === 'yuntrack', prefixes[1]!.provider);
check('UJ prefix routed to yuntrack', prefixes[2]!.provider === 'yuntrack', prefixes[2]!.provider);
check('confident miss does not fall back', prefixes[0]!.found === false && !prefixes[0]!.error);

// Order is preserved and duplicates collapse to a single upstream lookup.
const mixed = ['UJ000000000SE', '4PX0000000000CN', 'UJ000000000SE'];
const ordered = await track(mixed);
check('order preserved', ordered.map((r) => r.trackingId).join() === mixed.join());
check('duplicate ids share a result', ordered[0]!.provider === ordered[2]!.provider);

// An unrecognised format falls through every provider, cheapest first.
const unknown = await track(['ZZ999999999XX']);
check('unknown format probed through to last provider', unknown[0]!.provider === 'yuntrack', unknown[0]!.provider);
check('unknown format reported as not found', unknown[0]!.found === false);
check('unknown format is not an error', unknown[0]!.error === undefined);

// Real parcels: the only way to prove `found` works for a hit, not just a miss.
if (REAL_4PX) {
  const t0 = Date.now();
  const [r] = await track([REAL_4PX]);
  const elapsed = Date.now() - t0;
  check('real 4PX parcel found', r!.found === true && !r!.error);
  check('4PX lookup launches no browser', elapsed < 2000, `${elapsed} ms`);
  check('override honoured', (await track([REAL_4PX], { provider: '4px' }))[0]!.provider === '4px');
} else {
  skip('real 4PX parcel checks', 'set PARCELTRACK_TEST_4PX');
}

if (REAL_YUNTRACK) {
  const [r] = await track([REAL_YUNTRACK]);
  check('real YunTrack parcel found', r!.found === true && !r!.error, r!.provider);
} else {
  skip('real YunTrack parcel check', 'set PARCELTRACK_TEST_YUNTRACK');
}

await closeAll();
console.log(failures === 0 ? `\nALL PASS${skipped ? ` (${skipped} skipped)` : ''}` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
