# Mt. Whitney Day-Use Permit Watcher

Runs in the cloud 24/7 (GitHub Actions — free), checks recreation.gov every ~10
minutes for **Mt. Whitney day-use** permit openings, and sends you a **Telegram**
message the moment one appears.

It watches the dates you care about:

- **July 6 – October 31, 2026**
- **2+ day-use spots** available (flags when 4+ open so your whole group fits)
- **Skips July 22–26** (you're in Ireland)
- Highlights weekends, but includes midweek too

It only pings you when a date **newly** opens, so you won't get repeat spam for the
same opening.

---

## Why it uses a real browser

recreation.gov blocks plain automated requests, so a normal "fetch the API" script
gets an empty response. This watcher launches a real headless Chrome (Playwright),
loads the permit page like a person would, then reads the same availability feed the
website uses. That's what makes it reliable.

---

## Setup (about 10 minutes, one time)

### 1. Create your Telegram bot (gives you a token)

1. Open Telegram, search for **@BotFather**, start a chat.
2. Send `/newbot`. Follow the prompts (pick any name, then a username ending in `bot`).
3. BotFather replies with a **token** that looks like `8123456789:AAH...long-string`.
   Copy it — this is your `TELEGRAM_BOT_TOKEN`.

### 2. Get your chat ID

1. In Telegram, **send any message** ("hi") to the bot you just created. (This step
   is required — bots can't message you until you message them first.)
2. In a browser, open (paste your token in place of `<TOKEN>`):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Look for `"chat":{"id":123456789,...}`. That number is your `TELEGRAM_CHAT_ID`.
   - If you see `{"ok":true,"result":[]}`, send the bot another message and refresh.

### 3. Put the code on GitHub

1. Create a free account at github.com if you don't have one.
2. Create a **new repository** — name it anything (e.g. `whitney-watcher`).
   **Make it Public** (public repos get unlimited free Actions minutes).
3. Upload the contents of this `whitney-watcher` folder to the repo. Easiest way:
   on the new repo page, click **"uploading an existing file"** and drag in
   everything **except** the `node_modules` folder (there isn't one yet). Make sure
   the `.github/workflows/whitney.yml` file keeps that exact path.
   - Files to upload: `check.js`, `lib.js`, `test_logic.js`, `package.json`,
     `state.json`, `.gitignore`, `README.md`, and the `.github/` folder.

### 4. Add your secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add two:

| Name                  | Value                          |
| --------------------- | ------------------------------ |
| `TELEGRAM_BOT_TOKEN`  | the token from BotFather       |
| `TELEGRAM_CHAT_ID`    | the chat id from step 2        |

(Secrets are encrypted and never appear in the code or logs — safe even on a public repo.)

### 5. Turn it on and test

1. Go to the **Actions** tab. If prompted, click **"I understand my workflows,
   enable them."**
2. Click **"Mt Whitney Day-Use Watcher"** → **Run workflow** → toggle **test = true**
   → **Run workflow**.
3. Within a minute you should get a **"Whitney watcher is live"** message in Telegram.
   ✅ If you do, you're done — it now runs automatically every ~10 minutes.
   - If not, open the run in the Actions tab and check the logs (usually a wrong
     token or chat id).

---

## What you'll receive

When a date opens, you get a Telegram message like:

> 🏔️ **Mt. Whitney day-use permit available!**
> • **Sat Aug 15**: 4 spots — _weekend, ✅ fits your group_
>    Book this date →
>
> _Grab it fast — Whitney cancellations go within minutes._

Tap the link, log into recreation.gov, and book. **Speed matters** — cancellations
are often gone within minutes.

---

## Changing the settings

Everything is at the top of **`lib.js`**:

- `WATCH_START` / `WATCH_END` — the date window
- `EXCLUDE_DATES` — dates to skip (e.g. the Ireland trip)
- `MIN_SPOTS` — minimum spots to alert on (currently 2)
- `IDEAL_SPOTS` — threshold for the "fits your group" flag (currently 4)
- `MONTH_RANGES` — which months to query (keep these aligned with the window)

Check frequency is in **`.github/workflows/whitney.yml`** (`cron: '*/10 * * * *'`).

After editing, commit the change — the next run uses it. You can verify your logic
anytime with `node test_logic.js`.

---

## Good to know (honest caveats)

- **First real run is the true test.** GitHub's servers use datacenter IP addresses,
  which recreation.gov *occasionally* challenges even for a real browser. After
  enabling, let it run a few times and open a scheduled run's logs — you want to see
  `Checked N released date(s)`. If instead you see *"likely blocked by bot
  protection,"* tell me and I'll add a stealth plugin / proxy fallback.
- **Right now every summer date reads as 0 / "not yet released."** Whitney releases
  inventory and re-releases cancellations on a rolling basis, mostly in the ~2 weeks
  before each date. The watcher will start catching your dates as they open up — you
  won't see anything until then, and that's expected.
- **Timing isn't instant.** GitHub may delay scheduled runs to every 10–20 min under
  load, and a cancellation can vanish before the next check. This is great for
  awareness, but for winning races consider also running the free, purpose-built
  **Outdoor Status** Whitney alerts (https://outdoorstatus.com/alerts/) as a backstop.
- **Keep it alive.** GitHub auto-pauses scheduled workflows after 60 days of no repo
  activity. This watcher commits a tiny state update ~once a day, which keeps it
  active through the season. If GitHub ever emails you that it's paused, just click
  to re-enable.
- **Turning it off:** Actions tab → "Mt Whitney Day-Use Watcher" → "···" → Disable
  workflow. Or delete the repo.
