'use strict';

// Offline sanity checks for filtering, dedup, health guardrails, and the
// notification planner. Run with:  node test_logic.js  (no network / Playwright)

const lib = require('./lib');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// ---- date / availability --------------------------------------------------
check('Jul 15 2026 is Wed', lib.dayName('2026-07-15') === 'Wed');
check('Jul 18 2026 is Sat (weekend)', lib.dayName('2026-07-18') === 'Sat' && lib.isWeekend('2026-07-18'));
check('Aug 12 2026 is Wed (midweek)', lib.dayName('2026-08-12') === 'Wed' && !lib.isWeekend('2026-08-12'));

const mock = {
  '2026-06-14': { '406': { remaining: 3, total: 79 } },                 // before window
  '2026-07-04': { '406': { remaining: 5, total: 100 } },               // before Jul 6
  '2026-07-11': { '406': { remaining: 2, total: 100 }, '166': { remaining: 0 } }, // Sat hit
  '2026-07-15': { '406': { remaining: 1, total: 100 } },               // below min
  '2026-07-18': { '406': { remaining: 6, total: 100 } },               // Sat hit (ideal)
  '2026-07-22': { '406': { remaining: 8, total: 100 } },               // Ireland
  '2026-07-25': { '406': { remaining: 4, total: 100 } },               // Ireland
  '2026-08-12': { '406': { remaining: 2, total: 100 } },               // Wed hit
  '2026-10-31': { '406': { remaining: 4, total: 100 } },               // Sat hit (ideal)
  '2026-11-01': { '406': { remaining: 9, total: 100 } },               // after window
  '2026-09-09': { '166': { remaining: 5 } },                           // overnight only
};
const hits = lib.computeHits(mock);
check('4 hits, correct & sorted',
  hits.map((h) => h.date).join(',') === '2026-07-11,2026-07-18,2026-08-12,2026-10-31');
check('Ireland + out-of-window + below-min + overnight-only all excluded', hits.length === 4);
check('Jul 18 flagged ideal', hits.find((h) => h.date === '2026-07-18').ideal === true);
check('Aug 12 not ideal & midweek',
  hits.find((h) => h.date === '2026-08-12').ideal === false &&
  hits.find((h) => h.date === '2026-08-12').weekend === false);
check('message escapes & in link', lib.formatMessage(hits).includes('&amp;date=2026-07-11'));

// ---- health (canary) ------------------------------------------------------
const julNow = new Date('2026-07-15T12:00:00Z'); // in season
const janNow = new Date('2026-01-15T12:00:00Z'); // off season
const goodCanary = { '2026-07-14': { '406': { remaining: 3 }, '166': { remaining: 1 } }, '2026-07-15': { '406': { remaining: 0 } } };
const noDayUseCanary = { '2026-07-14': { '166': { remaining: 1 } } };

check('health ok when canary has day-use data',
  lib.assessHealth({ canaryPayload: goodCanary, canaryFailed: false, now: julNow }) === 'ok');
check('health blocked when fetch failed',
  lib.assessHealth({ canaryPayload: null, canaryFailed: true, now: julNow }) === 'blocked');
check('health empty when canary empty in-season',
  lib.assessHealth({ canaryPayload: {}, canaryFailed: false, now: julNow }) === 'empty');
check('health ok when canary empty off-season',
  lib.assessHealth({ canaryPayload: {}, canaryFailed: false, now: janNow }) === 'ok');
check('health structure when day-use division gone',
  lib.assessHealth({ canaryPayload: noDayUseCanary, canaryFailed: false, now: julNow }) === 'structure');

// ---- notification planner -------------------------------------------------
const detail = { canaryCount: 16 };
const base = { openDates: [], lastChecked: null, health: { status: 'ok', since: null, alerted: false }, lastHeartbeat: '2026-07-15' };

// First-ever heartbeat (lastHeartbeat null) on a healthy empty run.
let p = lib.planNotifications({ prevState: { ...base, lastHeartbeat: null }, healthStatus: 'ok', hits: [], detail, now: julNow });
check('healthy + no heartbeat-yet => sends heartbeat', p.messages.some((m) => m.type === 'heartbeat'));
check('heartbeat sets lastHeartbeat', p.nextState.lastHeartbeat === '2026-07-15');

// Heartbeat suppressed when recent.
p = lib.planNotifications({ prevState: base, healthStatus: 'ok', hits: [], detail, now: julNow });
check('healthy + recent heartbeat => silent', p.messages.length === 0);

// New availability fires an alert.
p = lib.planNotifications({ prevState: base, healthStatus: 'ok', hits, detail, now: julNow });
check('new openings => availability alert', p.messages.some((m) => m.type === 'availability'));
check('nextState records open dates', p.nextState.openDates.length === 4);

// Same availability next run => no repeat.
p = lib.planNotifications({ prevState: { ...base, openDates: hits.map((h) => h.date) }, healthStatus: 'ok', hits, detail, now: julNow });
check('repeat availability => no spam', !p.messages.some((m) => m.type === 'availability'));

// Health problem alerts once, then dedups.
p = lib.planNotifications({ prevState: base, healthStatus: 'blocked', hits: [], detail, now: julNow });
check('first health problem => one health alert', p.messages.length === 1 && p.messages[0].type === 'health');
check('health problem preserves openDates baseline', Array.isArray(p.nextState.openDates));
const afterProblem = p.nextState;
p = lib.planNotifications({ prevState: afterProblem, healthStatus: 'blocked', hits: [], detail, now: julNow });
check('repeat health problem => deduped (silent)', p.messages.length === 0);

// Recovery fires once when health returns to ok.
p = lib.planNotifications({ prevState: { ...afterProblem, lastHeartbeat: '2026-07-15' }, healthStatus: 'ok', hits: [], detail, now: julNow });
check('recovery => recovery alert', p.messages.some((m) => m.type === 'recovery'));
check('recovery clears health to ok', p.nextState.health.status === 'ok' && p.nextState.health.alerted === false);

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
