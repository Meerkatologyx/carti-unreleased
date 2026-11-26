# Carti Unreleased

A Playboi Carti music player and tracker: every song from the
[Playboi Carti Tracker](https://docs.google.com/spreadsheets/d/1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4/htmlview)
spreadsheet (released, unreleased and unsurfaced), grouped by era, searchable
and playable.

**Live site:** https://meerkatologyx.github.io/carti-unreleased/

## How it works

There's no backend. Everything is built from the sheet:

- `scripts/build-carti-data.mjs` downloads the tracker's **Unreleased** and
  **Released** tabs and writes `src/renderer/public/carti/` (`songs.json`,
  `eras.json`, `stats.json` and a cover for each era).
- `src/renderer/src/lib/cartiApi.ts` answers the app's data requests in the
  browser from those files.
- `src/renderer/src/lib/basePath.ts` lets the app run under the
  `/carti-unreleased/` path GitHub Pages serves it from.

The GitHub Action in `.github/workflows/pages.yml` pulls the latest sheet and
redeploys on every push and every 6 hours.

## Playback

Each song plays from the first of these that has it:

1. its own pillows.su or imgur.gg link, streamed straight into the player;
2. the same song (same name and era) in another tab of the sheet (Recent,
   OG Snippets, Misc, Stems, Edits…; never Fakes or AI tracks);
3. its YouTube, SoundCloud or Spotify link, played in that site's own player in
   a small card (`EmbedDock.tsx`). The app's play/pause/seek/skip still drive it.

Unsurfaced songs have never leaked, so there's nothing to play for them yet.

Features that need a server (accounts and sync, chat, live Vamp FM, news, file
archive, edit proposals) aren't available. The tracker, search, filters, era
pages, the VAMP view, player, queue, shuffle radio, playlists, favourites and
local stats work, and are saved in your browser.

## Run it locally

```bash
YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm ci
node scripts/build-carti-data.mjs
npm run dev
```

## Credits

Built on the open-source *Unreleased* player by leanwrldd, MIT licensed (see
`LICENSE`). Song data from the Playboi Carti Tracker. Unofficial fan project,
not affiliated with Playboi Carti or anyone connected to him.
