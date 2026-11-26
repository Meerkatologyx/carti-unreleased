# Unreleased — Playboi Carti

A Playboi Carti music player and tracker. It's a fork of
[Juice-WRLD-API/Unreleased](https://github.com/Juice-WRLD-API/Unreleased) (MIT),
using the same app, with its data swapped for the
[Playboi Carti Tracker](https://docs.google.com/spreadsheets/d/1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4/htmlview)
spreadsheet.

**Live site:** https://meerkatologyx.github.io/carti-unreleased/

## How it works

The original app runs against a backend API. This fork has no backend:

- `scripts/build-carti-data.mjs` downloads the tracker's **Unreleased** and
  **Released** tabs and writes them to `src/renderer/public/carti/`
  (`songs.json`, `eras.json`, `stats.json`, and an era cover for each era) in
  the same format the original API returned.
- `src/renderer/src/lib/cartiApi.ts` answers the app's API requests in the
  browser from those files.
- Songs with a pillows.su link play straight from pillows.su.
- `src/renderer/src/lib/basePath.ts` lets the app run under the
  `/carti-unreleased/` path GitHub Pages serves it from.

The GitHub Action in `.github/workflows/pages.yml` pulls the latest sheet and
redeploys on every push and every 6 hours, so the site follows the tracker.

Features that need a server (accounts and sync, chat, 999 FM radio, news,
file archive, edit proposals) aren't available here. The tracker, search,
filters, era pages, player, queue, playlists, favourites and local stats work,
and they're saved in your browser.

## Run it locally

```bash
YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm ci
node scripts/build-carti-data.mjs
npm run dev
```

## Credits

App by [leanwrldd](https://github.com/Juice-WRLD-API/Unreleased), MIT licensed
(see `LICENSE`). Song data from the Playboi Carti Tracker. This is an
unofficial fan project and isn't affiliated with Playboi Carti or anyone
connected to him.
