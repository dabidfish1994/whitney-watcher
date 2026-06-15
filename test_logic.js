'use strict';

// Offline sanity checks for the filtering / dedup / formatting logic.
// Run with:  node test_logic.js   (no network, no Playwright needed)

const lib = require('./lib');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// Anchor: confirms day-of-week math is correct.
check("Jul 15 2026 is Wed", lib.dayName('2026-07-15') === 'Wed');
check("Jul 18 2026 is Sat (weekend)", lib.dayName('2026-07-18') === 'Sat' && lib.isWeekend('2026-07-18'));
check("Aug 12 2026 is Wed (midweek)", lib.dayName('2026-08-12') === 'Wed' && !lib.isWeekend('2026-08-12'));

const mock = {
  '2026-06-14': { '406': { remaining: 3, total: 79 } },                 // before window -> excluded
  '2026-07-04': { '406': { remaining: 5, total: 100 } },               // before Jul 6 -> excluded
  '2026-07-11': { '406': { remaining: 2, total: 100 }, '166': { remaining: 0 } }, // Sat, hit (weekend)
  '2026-07-15': { '406': { remaining: 1, total: 100 } },               // only 1 -> below min, excluded
  '2026-07-18': { '406': { remaining: 6, total: 100 } },               // Sat, hit (weekend, ideal)
  '2026-07-22': { '406': { remaining: 8, total: 100 } },               // Ireland -> excluded
  '2026-07-25': { '406': { remaining: 4, total: 100 } },               // Ireland -> excluded
  '2026-08-12': { '406': { remaining: 2, total: 100 } },               // Wed, hit (midweek)
  '2026-10-31': { '406': { remaining: 4, total: 100 } },               // Sat, hit (last day, ideal)
  '2026-11-01': { '406': { remaining: 9, total: 100 } },               // after window -> excluded
  '2026-09-09': { '166': { remaining: 5 } },                           // overnight only -> excluded
};

const hits = lib.computeHits(mock);
const hitDates = hits.map((h) => h.date);

check("4 hits total", hits.length === 4);
check("hits are exactly the right dates, sorted",
  hitDates.join(',') === '2026-07-11,2026-07-18,2026-08-12,2026-10-31');
check("Ireland dates excluded", !hitDates.includes('2026-07-22') && !hitDates.includes('2026-07-25'));
check("before-window excluded", !hitDates.includes('2026-07-04') && !hitDates.includes('2026-06-14'));
check("after-window excluded", !hitDates.includes('2026-11-01'));
check("below-min excluded", !hitDates.includes('2026-07-15'));
check("overnight-only excluded", !hitDates.includes('2026-09-09'));
check("Jul 18 flagged ideal (>=4)", hits.find((h) => h.date === '2026-07-18').ideal === true);
check("Aug 12 not ideal (2 spots)", hits.find((h) => h.date === '2026-08-12').ideal === false);
check("Aug 12 flagged midweek", hits.find((h) => h.date === '2026-08-12').weekend === false);

// Dedup behavior across runs.
const run1 = lib.diffNewlyOpen(hits, []);
check("first run alerts on all 4", run1.length === 4);

const afterRun1 = hits.map((h) => h.date);
const run2 = lib.diffNewlyOpen(hits, afterRun1);
check("second run with same availability alerts on nothing", run2.length === 0);

// A date closes (07-18 booked) and a new one opens (09-05).
const mock3 = Object.assign({}, mock);
delete mock3['2026-07-18'];
mock3['2026-09-05'] = { '406': { remaining: 3, total: 100 } }; // Sat
const hits3 = lib.computeHits(mock3);
const run3 = lib.diffNewlyOpen(hits3, afterRun1);
check("third run alerts only on the newly reopened date", run3.length === 1 && run3[0].date === '2026-09-05');

// Message formatting smoke test.
const msg = lib.formatMessage(run1);
check("message mentions Whitney", /Mt\. Whitney/.test(msg));
check("message has a booking link with &amp; escaped", msg.includes('&amp;date=2026-07-11'));
check("message has no raw unescaped & in href", !/href="[^"]*[^p];date/.test(msg)); // sanity

console.log('\n--- sample message ---\n' + msg + '\n----------------------');
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
