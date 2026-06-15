'use strict';

// ---------------------------------------------------------------------------
// Mt. Whitney DAY-USE permit watcher — pure logic (no network, easily testable)
// ---------------------------------------------------------------------------

// recreation.gov permit + division IDs (verified June 2026)
const PERMIT_ID = '445860';               // Mt. Whitney, Inyo National Forest
const DAY_USE_DIVISION = '406';           // "Mt. Whitney Day Use (All Routes)"
// (Overnight is division 166 — intentionally ignored.)

// What David is watching for
const WATCH_START = '2026-07-06';         // after July 5th
const WATCH_END   = '2026-10-31';         // through end of quota season
const EXCLUDE_DATES = new Set([           // in Ireland for the Beau Gomez wedding
  '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26',
]);
const MIN_SPOTS   = 2;                     // need at least 2 to bother
const IDEAL_SPOTS = 4;                     // 4-6 means the whole group fits
const HEARTBEAT_DAYS = 7;                  // weekly "still alive & healthy" ping

// recreation.gov's API only accepts first/last day of a single month per call.
const MONTH_RANGES = [
  ['2026-07-01', '2026-07-31'],
  ['2026-08-01', '2026-08-31'],
  ['2026-09-01', '2026-09-30'],
  ['2026-10-01', '2026-10-31'],
];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- date helpers ---------------------------------------------------------
function dowIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getDay();
}
function dayName(dateStr) { return DOW[dowIndex(dateStr)]; }
function isWeekend(dateStr) { const i = dowIndex(dateStr); return i === 0 || i === 5 || i === 6; } // Fri/Sat/Sun
function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(now) { return now.toISOString().slice(0, 10); } // UTC YYYY-MM-DD
function daysBetween(aStr, bStr) {
  if (!aStr || !bStr) return Infinity;
  return Math.abs((Date.parse(bStr + 'T00:00:00Z') - Date.parse(aStr + 'T00:00:00Z')) / 86400000);
}
// First/last day of the month that `now` falls in (UTC). Used as the canary.
function currentMonthRange(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(last)}`];
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function bookingLink(date) {
  return `https://www.recreation.gov/permits/${PERMIT_ID}/registration/detailed-availability?type=day-use&date=${date}`;
}

// ---- availability ---------------------------------------------------------
// payloadByDate: { 'YYYY-MM-DD': { '406': { remaining, total }, ... }, ... }
function computeHits(payloadByDate) {
  const hits = [];
  for (const date of Object.keys(payloadByDate || {})) {
    if (date < WATCH_START || date > WATCH_END) continue;
    if (EXCLUDE_DATES.has(date)) continue;
    const div = payloadByDate[date] && payloadByDate[date][DAY_USE_DIVISION];
    if (!div) continue;
    const remaining = Number(div.remaining);
    if (!Number.isFinite(remaining) || remaining < MIN_SPOTS) continue;
    hits.push({
      date,
      remaining,
      total: Number.isFinite(Number(div.total)) ? Number(div.total) : null,
      weekend: isWeekend(date),
      day: dayName(date),
      ideal: remaining >= IDEAL_SPOTS,
    });
  }
  hits.sort((a, b) => a.date.localeCompare(b.date));
  return hits;
}

function diffNewlyOpen(hits, prevOpenDates) {
  const prev = new Set(prevOpenDates || []);
  return hits.filter((h) => !prev.has(h.date));
}

// ---- health / guardrails --------------------------------------------------
// Decide whether the data source looks healthy, using the current month as a
// "canary": during quota season (May–Oct) the current month ALWAYS has a few
// released near-term dates, and each released date always carries the day-use
// division. Violations mean the site is blocking us, is down, or changed shape.
//   ok        — reachable and shaped as expected
//   blocked   — could not fetch the canary month at all
//   empty     — canary returned zero released dates during season (block/outage)
//   structure — canary has dates but the day-use division (406) is gone
function assessHealth({ canaryPayload, canaryFailed, now }) {
  if (canaryFailed || !canaryPayload) return 'blocked';
  const dates = Object.keys(canaryPayload);
  const month = now.getUTCMonth() + 1;
  const inSeason = month >= 5 && month <= 10; // Mt. Whitney quota season
  if (dates.length === 0) return inSeason ? 'empty' : 'ok';
  const anyDayUse = dates.some((d) => canaryPayload[d] && canaryPayload[d][DAY_USE_DIVISION]);
  return anyDayUse ? 'ok' : 'structure';
}

// ---- message formatting ---------------------------------------------------
function formatMessage(newHits) {
  const lines = [];
  lines.push('\u{1F3D4}️ <b>Mt. Whitney day-use permit available!</b>');
  lines.push('');
  for (const h of newHits) {
    const flags = [];
    if (h.weekend) flags.push('\u{1F5D3}️ weekend');
    if (h.ideal) flags.push('✅ fits your group');
    const tag = flags.length ? ` — <i>${flags.join(', ')}</i>` : '';
    const href = escapeHtml(bookingLink(h.date));
    lines.push(`• <b>${h.day} ${prettyDate(h.date)}</b>: ${h.remaining} spot${h.remaining === 1 ? '' : 's'}${tag}`);
    lines.push(`   <a href="${href}">Book this date →</a>`);
  }
  lines.push('');
  lines.push('<i>Grab it fast — Whitney cancellations go within minutes. (Watching Jul 6–Oct 31, day-use, 2+ spots, excl. Jul 22–26.)</i>');
  return lines.join('\n');
}

function formatHealthAlert(status, detail = {}) {
  if (status === 'blocked') {
    return '🚨 <b>Whitney watcher: can’t reach recreation.gov</b>\n' +
      'Every request failed — likely a temporary block of the cloud server or a site outage. ' +
      'Day-use alerts are paused until it recovers; I’ll message you the moment it’s back.';
  }
  if (status === 'empty') {
    return '🚨 <b>Whitney watcher: recreation.gov returned no data</b>\n' +
      'The current month shows zero released dates, which usually means the site is blocking the ' +
      'cloud server or is down. Permits could open without an alert. I’ll message you when it recovers.';
  }
  if (status === 'structure') {
    return '🚨 <b>Whitney watcher: day-use section not found</b>\n' +
      'recreation.gov appears to have changed the Mt. Whitney permit layout (the day-use division ID). ' +
      'Day-use alerts are paused until the watcher is updated.';
  }
  return '🚨 <b>Whitney watcher: unexpected health issue</b>';
}

function formatRecovery(detail = {}) {
  const n = detail.canaryCount != null ? detail.canaryCount : '?';
  return '✅ <b>Whitney watcher recovered</b>\n' +
    `recreation.gov is reachable again (current month shows ${n} released dates). ` +
    'Day-use monitoring is back to normal.';
}

function formatHeartbeat(detail = {}) {
  const n = detail.canaryCount != null ? detail.canaryCount : '?';
  return '🟢 <b>Whitney watcher — weekly check-in</b>\n' +
    `All healthy. recreation.gov reachable (current month: ${n} released dates). ` +
    'No day-use openings in your window (Jul 6–Oct 31) yet — I’ll ping you the instant one appears.';
}

// ---- notification planner (pure, stateful decision logic) -----------------
// Given previous state + this run's findings, decide what to send and what the
// next state should be. Centralizes dedup so we never spam.
function planNotifications({ prevState, healthStatus, hits, detail, now, heartbeatDays = HEARTBEAT_DAYS }) {
  const messages = [];
  const today = isoDate(now);
  const prevHealth = (prevState && prevState.health) || { status: 'ok', since: null, alerted: false };

  if (healthStatus !== 'ok') {
    // Only alert on the first run of a problem (or if the problem type changed).
    if (prevHealth.status !== healthStatus || !prevHealth.alerted) {
      messages.push({ type: 'health', text: formatHealthAlert(healthStatus, detail) });
    }
    const health = {
      status: healthStatus,
      since: prevHealth.status === healthStatus ? prevHealth.since : today,
      alerted: true,
    };
    // Data is untrustworthy: don't touch the openDates baseline, skip heartbeat.
    return {
      messages,
      nextState: {
        openDates: (prevState && prevState.openDates) || [],
        lastChecked: today,
        health,
        lastHeartbeat: (prevState && prevState.lastHeartbeat) || null,
      },
    };
  }

  // Healthy.
  if (prevHealth.status !== 'ok') {
    messages.push({ type: 'recovery', text: formatRecovery(detail) });
  }
  const health = { status: 'ok', since: prevHealth.status === 'ok' ? prevHealth.since : today, alerted: false };

  const newly = diffNewlyOpen(hits, (prevState && prevState.openDates) || []);
  if (newly.length) messages.push({ type: 'availability', text: formatMessage(newly) });

  let lastHeartbeat = (prevState && prevState.lastHeartbeat) || null;
  if (daysBetween(lastHeartbeat, today) >= heartbeatDays) {
    messages.push({ type: 'heartbeat', text: formatHeartbeat(detail) });
    lastHeartbeat = today;
  }

  return {
    messages,
    nextState: { openDates: hits.map((h) => h.date), lastChecked: today, health, lastHeartbeat },
  };
}

module.exports = {
  PERMIT_ID, DAY_USE_DIVISION, WATCH_START, WATCH_END, EXCLUDE_DATES,
  MIN_SPOTS, IDEAL_SPOTS, MONTH_RANGES, HEARTBEAT_DAYS,
  computeHits, diffNewlyOpen, assessHealth, planNotifications,
  formatMessage, formatHealthAlert, formatRecovery, formatHeartbeat,
  bookingLink, dayName, isWeekend, prettyDate, escapeHtml,
  isoDate, daysBetween, currentMonthRange,
};
