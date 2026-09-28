# Outlier Finder

A static, no-build web app that finds videos from **small YouTube channels** that got unusually high views.

**Outlier score = views ÷ max(subscribers, 100)**, alongside views per day since publish.

Everything runs in your browser (HTML + vanilla JS + CSS). Your API key is stored only in your browser's `localStorage`. It is never committed and is sent only to `googleapis.com`.

## Features

- Search by keyword, publish window (7/30/90/365 days), type (any / Shorts under 60s / long-form), max channel subscribers, min views and optional region code.
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

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page and styles |
| `app.js` | UI, API calls, localStorage |
| `lib.js` | Pure logic (scoring, parsing, CSV, errors) |
| `test/` | Mock data and tests |
