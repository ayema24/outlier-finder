# Outlier Finder

A static, no-build web app that finds videos from **small YouTube channels** that got unusually high views.

**Outlier score = views ÷ max(subscribers, 100)**, alongside views per day since publish.

Everything runs in your browser (HTML + vanilla JS + CSS). Your API key is stored only in your browser's `localStorage`. It is never committed and is sent only to `googleapis.com`.

## Features

- Search by keyword, publish window (7/30/90/365 days), format, max channel subscribers, min views and optional region code.
- **Shorts detection** (Shorts can be up to 3 minutes since Oct 2024, and the API has no "is Short" flag):
  1. Over 3 minutes means long-form.
  2. At 3 minutes or less, the player's shape decides. `videos.list` is asked for `part=player` with `maxHeight`, and a taller-than-wide embed means a Short. This costs no extra quota.
  3. With no shape info, a `#shorts` tag decides, then the old 60-second rule.
- Format filter: Any, Shorts, Long-form (all), or long-form under 4 / 4–20 / 20+ minutes. These map to `search.list` `videoDuration`, so fewer results are wasted.
- An All / Shorts / Long-form switch on the results ranks each format on its own, because Shorts rack up views much faster.
- Uses `search.list` (`order=viewCount`, 50 per page, "Load more" via `pageToken`), then `videos.list` and `channels.list` batched 50 IDs per call.
- Cards sorted by score, views, views/day or newest.
- Channels with hidden subscriber counts are skipped, and the UI tells you how many.
- Save videos to a list (localStorage); export results or saved list to CSV.
- Approximate quota counter for the session (search = 100 units, videos/channels = 1 unit per call).
- Clear messages for quota-exceeded, invalid key, referrer-blocked and API-not-enabled errors.
- **Niche explorer**: 89 niches in 8 categories (money, tech, stories, learning, lifestyle, making, gaming, viral formats), each tagged with a rough ad-rate tier ($ to $$$). Filter niches by name, or hit "Surprise me".
- **Previews that work on phones**: tap **▶ Preview** on any card to play the video muted inline (on desktop it also starts on hover). Tap the thumbnail to watch the full video in an in-app player.
- **Inspiration feed**: random small-channel hits from a random niche, cached for 6 hours to save quota.
- Installable to your home screen (web app manifest), responsive layout, dark and light themes (follows system, toggle in header).

## The tools

The header has five tabs (a bottom bar on phones). Every card also has **🧬 Similar channels** and **📈 Track channel** shortcuts.

| Tab | What it does | Rough quota cost |
| --- | --- | --- |
| **🎯 Outliers** | Everything above: keyword and niche search for small-channel hits. | ~100 per search |
| **🔥 Viral** | Live breakout radar. *Fresh breakouts* searches uploads from the last 24 h / 48 h / 7 days, sorted by **views per hour**. *Trending chart* reads YouTube's `mostPopular` chart (optionally by category and region) and scores each video against its channel size. Tick **auto-refresh** to reload the trending chart every 5 minutes while the tab is open. A **What's working right now** panel summarises the winners: format mix, share with numbers or questions in the title, recurring words and phrases, typical title length, best posting day. Tap a word to filter the videos. | ~100 (fresh) / ~2 (trending) |
| **📸 Find channel** | Drop, paste (Ctrl/⌘+V) or pick a screenshot. The text is read in your browser with [Tesseract.js](https://github.com/naptha/tesseract.js) (the image is never uploaded), then turned into clues: an `@handle`, a channel name, a video title and a "12.3K subscribers" hint. Clues are shown in an editable box so you can fix misreads. Searching goes cheapest-first: a handle is one `channels.list` call; otherwise one channel search plus one video-title search. Candidates are ranked with a confidence and the reasons. You can also paste a video link, channel link, `@handle` or name instead. | ~1 with a handle, ~200 without |
| **🧬 Similar** | Give a channel (link, `@handle`, video link or name). It reads the channel's recent uploads, works out its topic words, searches for channels and videos in the same space, then adds each candidate's recent uploads for growth signals: median views, views ÷ subs, uploads per month and **momentum** (median views of the newest 5 videos vs the 5 before). Two playbook panels compare what works for the source channel with what the similar channels do. Sort by topic match, views vs subs, momentum or size; filter to smaller channels. | ~220 |
| **📈 Trends** | A watchlist. Every visit stores at most one snapshot per day (subscribers, total views, videos), so subscriber growth and daily change build up over time. Each channel also shows a bar chart of views on its recent videos (videos at 2× the channel's median or better are highlighted), momentum, and a "breaking out on your watchlist" list with rising topics. **Backup / Restore** exports and imports the watchlist as JSON. | ~1 + 2 per channel per refresh |

Things to know:

- **Trend history is stored only in your browser** (`localStorage`). YouTube's API has no historical subscriber data, so the line starts the day you begin tracking. Use **Backup** before clearing site data or switching browsers.
- **Similar channels is a heuristic.** YouTube removed its "related channels" API, so this matches on topic words from titles, tags and descriptions. The "topic match" percentage is a rough overlap, not a probability. Channels that share no topic words with the source are dropped.
- **Momentum is a heuristic** too: it needs 6+ videos and ignores videos under 2 days old because their views are still climbing.
- **Screenshot reading is best-effort OCR.** It works well on clean, high-resolution screenshots where the name or handle is legible. The reader script is vendored in `vendor/` (tesseract.js 5.1.1, unmodified) so no third-party script runs on the page that holds your key; on first use it downloads its worker, WebAssembly core and English data (about 10 MB, cached afterwards) from jsDelivr into a Web Worker.

## Setup

### 1. Create a YouTube Data API v3 key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. Open **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.

### 2. Restrict the key to your GitHub Pages URL

Because the key is used from the browser, restrict it so others can't reuse it:

1. On the key's page, under **Application restrictions** choose **Websites (HTTP referrers)**.
2. Add your Pages origin, e.g. `https://YOUR-USER.github.io/*` (or `https://YOUR-USER.github.io/outlier-finder/*`).
3. Under **API restrictions** choose **Restrict key** and select only **YouTube Data API v3**.

To test locally you'd also need to allow `http://localhost:8000/*`, or use a separate unrestricted key kept private.

### 3. Enable GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, then Save.
4. After a minute the site is live at `https://YOUR-USER.github.io/REPO-NAME/`.

### 4. Use it

Open the site, click **⚙ Settings**, paste your key and press **Save**, then search.

## Quota notes

The default quota is 10,000 units/day. Each search costs about 100 units (plus a few 1-unit lookups), so you get roughly 90–100 searches a day. The counter in the header is a local estimate only. It resets on page reload, and Google's own count is authoritative. The quota resets at midnight Pacific Time.

`search.list` with `order=viewCount` returns the most-viewed videos overall, so many hits come from large channels and get filtered out. If you see few matches, use "Load more", widen the date window or raise max subs.

## Development

No build step. To run locally:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Scoring, parsing, sorting, CSV and error-mapping logic lives in `lib.js` (pure functions, also usable from Node) and is tested against `test/mock-data.json`:

```sh
node test/test.js
```

The tool tabs' analysis logic (patterns, topics, momentum, screenshot-text parsing, snapshots) lives in `insights.js`, tested in `test/insights.test.js`, which `test/test.js` runs too.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page and styles |
| `app.js` | Outliers UI, API helper, router, shared `OFApp` |
| `lib.js` | Pure logic (scoring, parsing, CSV, errors, Shorts detection) |
| `insights.js` | Pure logic for the tools: patterns, topics, momentum, OCR parsing, snapshots |
| `channels.js` | Shared channel lookups, recent uploads, SVG charts, channel cards |
| `viral.js`, `finder.js`, `similar.js`, `trends.js` | One file per tool tab |
| `test/` | Mock data and tests |
