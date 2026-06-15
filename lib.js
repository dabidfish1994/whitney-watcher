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

// recreation.gov's API only accepts first/last day of a single month per call.
const MONTH_RANGES = [
  ['2026-07-01', '2026-07-31'],
  ['2026-08-01', '2026-08-31'],
  ['2026-09-01', '2026-09-30'],
  ['2026-10-01', '2026-10-31'],
];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dowIndex(dateStr) {
  // Parse as local noon so timezone never shifts the day.
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getDay();
}
function dayName(dateStr) { return DOW[dowIndex(dateStr)]; }
function isWeekend(dateStr) { const i = dowIndex(dateStr); return i === 0 || i === 5 || i === 6; } // Fri/Sat/Sun
function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function bookingLink(date) {
  return `https://www.recreation.gov/permits/${PERMIT_ID}/registration/detailed-availability?type=day-use&date=${date}`;
}

// Given a merged { 'YYYY-MM-DD': { '406': { remaining, total }, ... } } object,
// return the list of dates that match David's criteria.
function computeHits(payloadByDate) {
  const hits = [];
  for (const date of Object.keys(payloadByDate || {})) {
    if (date < WATCH_START || date > WATCH_END) continue;   // outside the window
    if (EXCLUDE_DATES.has(date)) continue;                  // Ireland
    const div = payloadByDate[date] && payloadByDate[date][DAY_USE_DIVISION];
    if (!div) continue;                                     // no day-use data this date
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

// Only alert on dates that weren't already open on the previous run.
function diffNewlyOpen(hits, prevOpenDates) {
  const prev = new Set(prevOpenDates || []);
  return hits.filter((h) => !prev.has(h.date));
}

// Build the Telegram message (HTML parse mode).
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

module.exports = {
  PERMIT_ID, DAY_USE_DIVISION, WATCH_START, WATCH_END, EXCLUDE_DATES,
  MIN_SPOTS, IDEAL_SPOTS, MONTH_RANGES,
  computeHits, diffNewlyOpen, formatMessage, bookingLink,
  dayName, isWeekend, prettyDate, escapeHtml,
};
