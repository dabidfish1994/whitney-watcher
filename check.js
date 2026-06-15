'use strict';

// ---------------------------------------------------------------------------
// Mt. Whitney day-use watcher — main entry point.
//
// Uses a real headless Chromium (Playwright) to load recreation.gov, which gets
// past the site's bot protection, then reads the day-use availability feed the
// site itself uses. Sends a Telegram message when new dates open up.
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
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { openDates: [], lastChecked: null }; }
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
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { console.error('Telegram error:', JSON.stringify(j)); return false; }
  return true;
}

async function fetchAvailability() {
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
    // Load the permit page first so Akamai sets its clearance cookie.
    await page.goto(`https://www.recreation.gov/permits/${lib.PERMIT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const merged = {};
    let validMonths = 0;
    for (const [start, end] of lib.MONTH_RANGES) {
      const url = `https://www.recreation.gov/api/permitinyo/${lib.PERMIT_ID}` +
        `/availability?start_date=${start}&end_date=${end}`;
      const result = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { headers: { accept: 'application/json' } });
          if (!r.ok) return { __error: 'HTTP ' + r.status };
          const j = await r.json();
          if (!j || typeof j.payload !== 'object') return { __error: 'no payload' };
          return { payload: j.payload };
        } catch (e) {
          return { __error: String(e) };
        }
      }, url);

      if (result && result.payload) {
        Object.assign(merged, result.payload);
        validMonths++;
      } else {
        console.error(`Month ${start.slice(0, 7)} failed:`, result && result.__error);
      }
      await page.waitForTimeout(800);
    }

    if (validMonths === 0) {
      throw new Error('All month requests failed — likely blocked by bot protection.');
    }
    return merged;
  } finally {
    await browser.close();
  }
}

(async () => {
  if (TEST) {
    const ok = await sendTelegram(
      '✅ <b>Whitney watcher is live</b>\nTelegram alerts are wired up correctly. ' +
      'You’ll get a message here the moment day-use permits open for your dates.'
    );
    console.log('Test message sent:', ok);
    process.exit(ok ? 0 : 1);
  }

  const state = loadState();

  let payload;
  try {
    payload = await fetchAvailability();
  } catch (err) {
    console.error('Availability fetch failed:', err.message);
    process.exit(1); // surfaces as a red run in GitHub so silent blocking is visible
  }

  const hits = lib.computeHits(payload);
  const newly = lib.diffNewlyOpen(hits, state.openDates);
  console.log(
    `Checked ${Object.keys(payload).length} released date(s); ` +
    `${hits.length} match your criteria; ${newly.length} newly open.`
  );

  if (newly.length > 0) {
    const sent = await sendTelegram(lib.formatMessage(newly));
    console.log('Alert sent:', sent, '->', newly.map((h) => h.date).join(', '));
  }

  saveState({
    openDates: hits.map((h) => h.date),
    lastChecked: new Date().toISOString().slice(0, 10),
  });
})();
