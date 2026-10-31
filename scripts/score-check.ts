import { SEED_IPOS } from '../lib/data/seed';
import { scale, rate } from '../lib/scoring';
import { validateIpo } from '../lib/validate';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// Scale function
check('scale clamps low', scale(-50, [[0, 2], [10, 8]]) === 2);
check('scale clamps high', scale(50, [[0, 2], [10, 8]]) === 8);
check('scale interpolates', Math.abs(scale(5, [[0, 2], [10, 8]]) - 5) < 1e-9);

for (const ipo of SEED_IPOS) {
  const errs = validateIpo(ipo);
  check(`${ipo.slug}: validates`, errs.length === 0, errs.join('; '));

  const r = rate(ipo);
  const weights = r.factors.reduce((s, f) => s + f.weight, 0);
  check(`${ipo.slug}: weights sum to 100`, weights === 100, `got ${weights}`);
  check(`${ipo.slug}: score in 0-10`, r.score !== null && r.score >= 0 && r.score <= 10, `score ${r.score}`);
  check(
    `${ipo.slug}: promoter post <= pre when promoters only sell`,
    r.metrics.promoterPostPct <= r.metrics.promoterPrePct + 1e-9,
    `${r.metrics.promoterPrePct}% -> ${r.metrics.promoterPostPct.toFixed(1)}%`,
  );
  console.log(
    `      ${ipo.name}: ${r.score}/10 (${r.band}), confidence ${(r.confidence * 100).toFixed(0)}%, ` +
      `mcap ₹${r.metrics.marketCapCr.toFixed(0)} Cr, P/E ${r.metrics.pe?.toFixed(1) ?? 'n/a'}`,
  );
}

// Ordering sanity: the profitable, high-ROE business should outscore the loss-making one.
const byslug = Object.fromEntries(SEED_IPOS.map((i) => [i.slug, rate(i).score ?? -1]));
check('profitable company outscores loss-making company', byslug['demo-auto-components'] > byslug['sample-fintech']);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
