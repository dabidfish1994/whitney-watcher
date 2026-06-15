'use strict';

// ---------------------------------------------------------------------------
// Mt. Whitney day-use watcher — main entry point.
//
// Uses a real headless Chromium (Playwright) to load recreation.gov, which gets
// past the site's bot protection, then reads the day-use availability feed the
// site itself uses. Sends Telegram messages for:
//   • new day-use openings in your window
//   • health problems (site blocking us / outage / permit layout changed)
//   • recovery once a problem clears
//   • a weekly "still healthy" heartbeat
//
// Env vars required:
//   TELEGRAM_BOT_TOKEN   from @BotFather
//   TELEGRAM_CHAT_ID     your chat id
// Optional:
//   TEST_ALERT=1         send a test Telegram message and exit
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const lib = require('./lib');

const STATE_FILE = path.join(__dirname, 'state.json');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const TEST = process.env.TEST_ALERT === '1' || process.argv.includes('--test');

function loadState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { s = {}; }
  return {
    openDates: Array.isArray(s.openDates) ? s.openDates : [],
    lastChecked: s.lastChecked || null,
    health: s.health && typeof s.health === 'object'
      ? { status: s.health.status || 'ok', since: s.health.since || null, alerted: !!s.health.alerted }
      : { status: 'ok', since: null, alerted: false },
    lastHeartbeat: s.lastHeartbeat || null,
  };
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function sendTelegram(html) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set.');
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { console.error('Telegram error:', JSON.stringify(j)); return false; }
  return true;
}

// Fetch the watch months PLUS the current month (the canary), in one browser.
async function fetchAll(now) {
  // Build a de-duplicated set of {start,end} month ranges to query.
  const byStart = new Map();
  for (const [s, e] of lib.MONTH_RANGES) byStart.set(s, [s, e]);
  const [cs, ce] = lib.currentMonthRange(now);
  byStart.set(cs, [cs, ce]);

  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  try {
    await page.goto(`https://www.recreation.gov/permits/${lib.PERMIT_ID}`, {
      waitUntil: 'domcontentloaded', timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const results = {};
    for (const [s, e] of byStart.values()) {
      const url = `https://www.recreation.gov/api/permitinyo/${lib.PERMIT_ID}` +
        `/availability?start_date=${s}&end_date=${e}`;
      results[s] = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { headers: { accept: 'application/json' } });
          if (!r.ok) return { __error: 'HTTP ' + r.status };
          const j = await r.json();
          if (!j || typeof j.payload !== 'object') return { __error: 'no payload' };
          return { payload: j.payload };
        } catch (e) { return { __error: String(e) }; }
      }, url);
      await page.waitForTimeout(600);
    }

    const canary = results[cs];
    const canaryFailed = !canary || !!canary.__error || !canary.payload;
    const canaryPayload = canaryFailed ? null : canary.payload;

    const watchPayload = {};
    let watchOk = 0;
    for (const [s] of lib.MONTH_RANGES) {
      const r = results[s];
      if (r && r.payload) { Object.assign(watchPayload, r.payload); watchOk++; }
      else console.error(`Month ${s.slice(0, 7)} failed:`, r && r.__error);
    }

    return { canaryPayload, canaryFailed, watchPayload, watchOk };
  } finally {
    await browser.close();
  }
}

(async () => {
  if (TEST) {
    const ok = await sendTelegram(
      '✅ <b>Whitney watcher is live</b>\nTelegram alerts are wired up correctly. ' +
      'You’ll get a message here the moment day-use permits open — plus health alerts if anything ever breaks.'
    );
    console.log('Test message sent:', ok);
    process.exit(ok ? 0 : 1);
  }

  const now = new Date();
  const state = loadState();

  let healthStatus = 'ok';
  let hits = [];
  const detail = { canaryCount: 0 };

  try {
    const { canaryPayload, canaryFailed, watchPayload, watchOk } = await fetchAll(now);
    detail.canaryCount = canaryPayload ? Object.keys(canaryPayload).length : 0;
    healthStatus = lib.assessHealth({ canaryPayload, canaryFailed, now });
    hits = lib.computeHits(watchPayload);
    console.log(
      `health=${healthStatus} canaryDates=${detail.canaryCount} watchMonthsOk=${watchOk} ` +
      `hits=${hits.length}`
    );
  } catch (err) {
    console.error('Fetch error:', err && err.message);
    healthStatus = 'blocked';
  }

  const plan = lib.planNotifications({ prevState: state, healthStatus, hits, detail, now });

  for (const m of plan.messages) {
    const ok = await sendTelegram(m.text);
    console.log(`sent ${m.type}:`, ok);
  }
  if (plan.messages.length === 0) console.log('No messages this run.');

  // Always persist state (keeps dedup memory + the daily commit that keeps the
  // schedule from being auto-paused). Exit 0 so this step's commit always runs.
  saveState(plan.nextState);
})();
