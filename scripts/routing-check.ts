import { track, closeAll } from '../src/router.js';

const REAL_4PX = '4PX3003133457168CN';
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failures++;
}

// A: identified 4PX number must resolve via 4px, fast, with no browser launch.
const t0 = Date.now();
const a = await track([REAL_4PX]);
const elapsed = Date.now() - t0;
check('4PX number routed to 4px', a[0]!.provider === '4px', a[0]!.provider);
check('4PX number found', a[0]!.found === true && !a[0]!.error);
check('no browser launched (fast path)', elapsed < 2000, `${elapsed} ms`);

// B: order is preserved and duplicates collapse to one upstream lookup.
const mixed = ['UJ000000000SE', REAL_4PX, 'UJ000000000SE'];
const b = await track(mixed);
check('order preserved', b.map((r) => r.trackingId).join() === mixed.join());
check('UJ prefix routed to yuntrack', b[0]!.provider === 'yuntrack', b[0]!.provider);
check('duplicate ids share a result', b[0]!.provider === b[2]!.provider);
check('confident miss does not fall back to 4px', b[0]!.provider === 'yuntrack' && b[0]!.found === false);

// C: an unrecognised format is probed cheapest-first and ends up unresolved.
const c = await track(['ZZ999999999XX']);
check('unknown format probed cheapest-first to last provider', c[0]!.provider === 'yuntrack', c[0]!.provider);
check('unknown format reported as not found', c[0]!.found === false);
check('unknown format keeps last payload, no bogus error', c[0]!.error === undefined);

// D: explicit override wins over detection.
const d = await track([REAL_4PX], { provider: '4px' });
check('override honoured', d[0]!.provider === '4px');

await closeAll();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
