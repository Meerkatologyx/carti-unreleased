#!/usr/bin/env node
// Builds the site's song catalogue from the Playboi Carti tracker spreadsheet.
//
// The site has no backend: this script pulls the public tracker sheet
// (Unreleased and Released tabs) and writes it out as the catalogue the app
// reads, to src/renderer/public/carti/. lib/cartiApi.ts then answers the app's
// API requests from those files in the browser.
//
// Run: node scripts/build-carti-data.mjs   (CI runs it before every build)

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHEET_ID = '1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4'
const TABS = { unreleased: '0', released: '245504108' }
// Tabs searched (in this order) for audio of songs the two main tabs have no
// file for. Fakes, AI Tracks and Instrumental Remakes are left out on purpose.
const EXTRA_TABS = [
  ['1962169030', 'Recent'], ['334149012', 'Best Of'], ['2032692991', 'Special'], ['2131545997', 'Grails'],
  ['801413102', 'Wanted'], ['1033793988', 'Misc'], ['1864125989', 'OG Snippets'], ['711785744', 'Stems'],
  ['29911022', 'Edits/Remasters'], ['411433870', 'Performances'], ['305356845', 'Worst Of'], ['575290721', 'Remixes'],
]
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/renderer/public/carti')
const ERA_IMG_DIR = path.join(OUT, 'eras')
// imgur.gg page → direct file URL, kept between builds so each page is fetched once.
const IMGUR_CACHE = path.join(ROOT, 'scripts/imgur-cache.json')

// ─── fetch ───────────────────────────────────────────────────────────────────

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'carti-tracker-build' } })
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  return res.text()
}
const csvUrl = (gid) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
const htmlUrl = (gid) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview/sheet?headers=true&gid=${gid}`

// ─── CSV (RFC 4180, quoted fields may hold newlines) ─────────────────────────

function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const clean = (s) => (s ?? '').replace(/\r/g, '').trim()
const isNA = (s) => !s || /^(n\/a|\?\?\?|none|unknown)$/i.test(s.trim())
const nn = (s) => (isNA(s) ? null : clean(s))
const isEraHeader = (cell) => /\d+\s+(Total Full|Steaming|Streaming)/i.test(cell || '')

function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'era'
}

/** "Cry\n(feat. X) (prod. Harry Fraud)" → title, features, producers, extra names. */
function parseName(raw) {
  const lines = clean(raw).split('\n').map((l) => l.trim()).filter(Boolean)
  const title = (lines.shift() ?? '').replace(/\s+/g, ' ')
  const rest = lines.join(' ')
  const grab = (re) => [...rest.matchAll(re)].map((m) => m[1].trim()).filter((x) => x && !/^\?+$/.test(x))
  const feats = grab(/\((?:feat\.|ft\.|with)\s*([^)]*)\)/gi)
  const prods = grab(/\(prod\.\s*([^)]*)\)/gi)
  const alts = grab(/\(([^)]*)\)/g).filter((x) => !/^(feat\.|ft\.|with|prod\.|ref\.)/i.test(x))
  return { title, feats, prods, alts }
}

/** First audio-host link in the text: a pillows.su or imgur.gg file page. */
function audioRef(text) {
  const p = /(?:pillows?|pillowcase)\.su\/f\/([a-f0-9]{16,})/i.exec(text || '')
  if (p) return { kind: 'pillows', id: p[1] }
  const i = /(?<![\w.])imgur\.gg\/f\/([A-Za-z0-9]+)/i.exec(text || '')
  if (i) return { kind: 'imgur', id: i[1] }
  return null
}

/** imgur.gg file page → its direct (CORS-enabled) file URL on b.imgur.gg. Cached across builds. */
async function imgurAudio(id, cache) {
  if (cache[id]) return cache[id]
  try {
    const html = await getText(`https://imgur.gg/f/${id}`)
    // Audio, or a video (snippets are often screen recordings) whose sound the player can play.
    const src = /property="og:(?:audio|video)" content="(https:\/\/b\.imgur\.gg\/[^"]+)"/i.exec(html)?.[1]
      ?? /(?:src|href)="(https:\/\/b\.imgur\.gg\/[^"]+\.(?:mp3|m4a|wav|flac|ogg|opus|aac|webm|mp4|mov|m4v))"/i.exec(html)?.[1]
    if (src) cache[id] = decode(src)
    return cache[id] ?? null
  } catch {
    return null
  }
}

/** A YouTube / SoundCloud / Spotify link the app can play through that site's embedded player. */
function embedFor(links) {
  for (const l of links) {
    let u
    try { u = new URL(l) } catch { continue }
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host === 'youtube.com' || host === 'youtu.be') {
      const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') ?? /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[1]
      if (id && /^[\w-]{11}$/.test(id)) return { site: 'YouTube', path: `embed:youtube:${id}` }
    } else if (host === 'soundcloud.com' && u.pathname.split('/').filter(Boolean).length >= 2) {
      return { site: 'SoundCloud', path: `embed:soundcloud:${u.origin}${u.pathname}` }
    } else if (host === 'open.spotify.com') {
      const m = /\/(track|album)\/([A-Za-z0-9]{22})/.exec(u.pathname)
      if (m) return { site: 'Spotify', path: `embed:spotify:${m[1]}/${m[2]}` }
    }
  }
  return null
}

/** Song identity across tabs: its title (no tags, emoji or version brackets) plus its era. */
/** A title as a lowercase key: tracker tags (⭐ 🥉 …), [V2]/(feat. …) asides and punctuation removed. */
function bareTitle(name) {
  return clean(name).split('\n')[0].toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '').replace(/\[.*?\]|\(.*?\)|\*/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function matchKey(name, eraName) {
  const n = clean(name).split('\n')[0].toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '').replace(/\[.*?\]|\(.*?\)|\*/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return n && eraName ? `${n}|${eraName.trim().toLowerCase()}` : ''
}

/** "embed:youtube:ID" → "embed:<seconds>:youtube:ID" - the player needs the length up front (0 = unknown). */
function withLength(embedPath, length) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(length || '')
  const secs = !m ? 0 : m[3] ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : (+m[1] * 60 + +m[2])
  return embedPath.replace(/^embed:/, `embed:${secs}:`)
}

async function mapLimit(items, limit, fn) {
  let i = 0
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]) }))
}

const allLinks = (s) => (clean(s).match(/https?:\/\/\S+/g) ?? [])

// "Era" header rows carry an image in the HTML view; map era name → image src.
function eraImagesFromHtml(html) {
  const out = {}
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    if (!isEraHeader(tr.replace(/<[^>]+>/g, ' '))) continue
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    const img = /<img[^>]*src="([^"]+)"/.exec(tr)?.[1]
    // Era name is the first non-header text cell after the counts cell.
    const idx = cells.findIndex((c) => isEraHeader(c.replace(/<[^>]+>/g, ' ')))
    const name = decode(cells.slice(idx + 1).map((c) => c.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).find((t) => t.trim()) ?? '')
    if (name && img) out[clean(name).split('\n')[0].trim()] = decode(img)
  }
  return out
}
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

async function saveEraImage(name, src) {
  const file = `${slug(name)}.jpg`
  const dest = path.join(ERA_IMG_DIR, file)
  try {
    const big = src.replace(/=w\d+-h\d+$/, '=w600-h600')
    const res = await fetch(big)
    if (!res.ok) throw new Error(String(res.status))
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    if (!existsSync(dest)) { console.warn(`  ! no cover for ${name}: ${err.message}`); return null }
  }
  return `/carti/eras/${file}`
}

// Stable numeric ids: a hash of category + era + raw name, so a song keeps its
// id (and with it play history, favourites, playlists) across rebuilds.
const usedIds = new Set()
function idFor(key) {
  let n = parseInt(createHash('sha1').update(key).digest('hex').slice(0, 8), 16) % 900_000_000 + 100_000
  while (usedIds.has(n)) n++
  usedIds.add(n)
  return n
}

// ─── build ───────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(ERA_IMG_DIR, { recursive: true })
  console.log('Fetching Carti tracker sheet…')
  const [unCsv, relCsv, unHtml, relHtml] = await Promise.all([
    getText(csvUrl(TABS.unreleased)), getText(csvUrl(TABS.released)),
    getText(htmlUrl(TABS.unreleased)), getText(htmlUrl(TABS.released)).catch(() => ''),
  ])

  const eraImgSrc = { ...eraImagesFromHtml(relHtml), ...eraImagesFromHtml(unHtml) }
  const eras = new Map() // name → era
  const songs = []

  function era(name, description = '', timeFrame = '') {
    name = clean(name).split('\n')[0].trim()
    if (!name) return null
    let e = eras.get(name)
    if (!e) {
      e = { id: eras.size + 1, name, description: '', time_frame: '', image: null }
      eras.set(name, e)
    }
    if (description && !e.description) e.description = description
    if (timeFrame && !e.time_frame) e.time_frame = timeFrame
    return e
  }

  let current = null
  // Unreleased tab: Era | Name | Notes | Track Length | Leak Date | File Date | Type | Available Length | Quality | Link(s)
  for (const r of parseCsv(unCsv).slice(1)) {
    const [eraName, name, notes, length, leakDate, fileDate, type, avail, quality, links] = r.map(clean)
    if (isEraHeader(eraName)) {
      const dates = [...(notes.match(/\(([A-Z][a-z]{2} \d{1,2}, \d{4}|~?\d{4})\)/g) ?? [])]
      const tf = dates.length ? `${dates[0].replace(/[()~]/g, '')} – ${dates[dates.length - 1].replace(/[()~]/g, '')}` : ''
      // The era blurb sits in whichever later cell is merged across the row.
      const blurb = r.slice(3).map(clean).sort((a, b) => b.length - a.length)[0] ?? ''
      current = era(name, blurb.length > 40 ? blurb : notes, tf)
      continue
    }
    if (!eraName || !name) continue // section dividers ("Snippets", "Unavailable")
    // The sheet's promo rows ("⭐ Carti Hub") link only to a Discord server.
    if (/discord\.gg\//i.test(links) && !/https?:\/\/(?!discord\.gg)/i.test(links)) continue
    songs.push(toSong({ eraObj: current, category: null, eraName, name, notes, length, leakDate, fileDate, type, avail, quality, links }))
  }

  current = null
  // Released tab: Rel. Era | Rec. Era | Name | Notes | Track Length | Release Date | Type | Streaming | Link(s)
  for (const r of parseCsv(relCsv).slice(1)) {
    const [relEra, recEra, name, notes, length, releaseDate, type, streaming, links] = r.map(clean)
    if (isEraHeader(relEra)) { current = era(name, notes); continue }
    if (!relEra || !name) continue
    songs.push(toSong({ eraObj: current, category: 'released', eraName: relEra, recEra, name, notes, length, releaseDate, type, streaming, links }))
  }

  function toSong(f) {
    const e = f.eraObj ?? era(f.eraName)
    const { title, feats, prods, alts } = parseName(f.name)
    const own = audioRef(f.links)
    const unavailable = /not available|^lost$|rumou?red|confirmed/i.test(`${f.avail ?? ''}`) || /^(lost|rumou?red)$/i.test(f.type ?? '')
    // An imgur.gg link may be a proof screenshot rather than audio, so only a
    // pillows.su file overrides the sheet's own "not available".
    const category = f.category ?? (own?.kind === 'pillows' ? 'unreleased' : unavailable ? 'unsurfaced' : 'unreleased')
    const info = [
      f.type && `Type: ${f.type}`,
      f.avail && `Available length: ${f.avail}`,
      f.quality && `Quality: ${f.quality}`,
      f.streaming && `On streaming: ${f.streaming}`,
      f.recEra && f.recEra !== f.eraName && `Recorded during: ${f.recEra}`,
    ].filter(Boolean).join('\n')
    const links = allLinks(f.links)
    const song = {
      id: idFor(`${category}|${f.eraName}|${f.name}`),
      public_id: null,
      name: title.replace(/\*+$/, '').trim() || title,
      original_key: null,
      track_titles: [title, ...alts].filter((v, i, a) => v && a.indexOf(v) === i),
      path: '',
      length: isNA(f.length) ? '' : f.length,
      credited_artists: ['Playboi Carti', ...feats].join(', '),
      producers: prods.join(', '),
      engineers: null,
      recording_locations: null,
      record_dates: nn(f.fileDate),
      bitrate: nn(f.quality),
      bpm: null,
      key: null,
      additional_information: [info, links.length ? `Links:\n${links.join('\n')}` : ''].filter(Boolean).join('\n\n') || null,
      file_names: null,
      instrumentals: null,
      instrumental_names: null,
      preview_date: null,
      release_date: nn(f.releaseDate),
      dates: null,
      session_titles: null,
      session_tracking: null,
      notes: nn(f.notes),
      snippets: [],
      era: e ? { id: e.id, name: e.name, description: e.description, time_frame: e.time_frame } : null,
      image_url: null, // filled from the era cover below
      category,
      lyrics: null,
      synced_lyrics: null,
      leak_type: nn(f.type),
      date_leaked: nn(f.leakDate),
      album: e?.name ?? null,
    }
    // Build-time only (not enumerable, so never written out): where its audio comes from.
    Object.defineProperty(song, '_src', { value: { own, links, recEra: f.recEra }, enumerable: false })
    return song
  }

  // ─── audio for every song that has any ──────────────────────────────────
  // 1. the song's own pillows.su / imgur.gg link
  // 2. the same song (name + era) in another tab of the sheet: Recent, OG
  //    Snippets, Misc, Stems, Edits… - fakes, AI tracks and remakes excluded
  // 3. its YouTube / SoundCloud / Spotify link, played through that site's
  //    own embedded player (path "embed:<provider>:<id>", see EmbedDock.tsx)
  console.log('Indexing the other tabs for audio…')
  const otherTabs = await Promise.all(EXTRA_TABS.map(([gid, tab]) => getText(csvUrl(gid)).then((t) => [tab, t]).catch(() => [tab, ''])))
  const byNameEra = new Map()
  for (const [tab, text] of otherTabs) {
    if (!text) continue
    const rows = parseCsv(text)
    const ni = rows[0].map((h) => clean(h).split('\n')[0].toLowerCase()).indexOf('name')
    if (ni < 0) continue
    for (const r of rows.slice(1)) {
      const ref = audioRef(r.join(' '))
      const key = matchKey(r[ni], clean(r[0]).split('\n')[0])
      if (ref && key && !byNameEra.has(key)) byNameEra.set(key, { ...ref, tab })
    }
  }

  const imgurCache = existsSync(IMGUR_CACHE) ? JSON.parse(await readFile(IMGUR_CACHE, 'utf8')) : {}
  const counts = { own: 0, otherTab: 0, embed: 0, none: 0 }
  const toResolve = []
  for (const s of songs) {
    const { own, links, recEra } = s._src
    let ref = own
    let note = null
    if (ref) counts.own++
    else {
      const eraNames = [s.era?.name, recEra].filter(Boolean)
      for (const n of s.track_titles.length ? s.track_titles : [s.name]) {
        for (const en of eraNames) ref ??= byNameEra.get(matchKey(n, en))
      }
      if (ref) { counts.otherTab++; note = `Audio from the tracker's ${ref.tab} tab` }
    }
    if (ref) { toResolve.push([s, ref, note]); continue }
    // Unsurfaced songs' links are proof (interviews, teasers), not the song itself.
    const embed = s.category === 'unsurfaced' ? null : embedFor(links)
    if (embed) {
      counts.embed++
      s.path = withLength(embed.path, s.length)
      s.additional_information = [`Plays through the ${embed.site} player`, s.additional_information].filter(Boolean).join('\n')
    } else {
      counts.none++
    }
  }

  console.log(`Resolving ${toResolve.length} audio links…`)
  await mapLimit(toResolve, 8, async ([s, ref, note]) => {
    const url = ref.kind === 'pillows' ? `https://api.pillows.su/api/download/${ref.id}` : await imgurAudio(ref.id, imgurCache)
    if (!url) {
      const embed = s.category === 'unsurfaced' ? null : embedFor(s._src.links)
      if (embed) { counts.embed++; s.path = withLength(embed.path, s.length) } else counts.none++
      return
    }
    s.path = url
    if (note) s.additional_information = [note, s.additional_information].filter(Boolean).join('\n')
  })
  await writeFile(IMGUR_CACHE, JSON.stringify(imgurCache, null, 1))
  console.log(`Audio: ${counts.own} own link, ${counts.otherTab} from other tabs, ${counts.embed} via embeds, ${counts.none} with none.`)

  console.log(`Saving ${Object.keys(eraImgSrc).length} era covers…`)
  for (const e of eras.values()) {
    const src = eraImgSrc[e.name]
    if (src) e.image = await saveEraImage(e.name, src)
    else if (existsSync(path.join(ERA_IMG_DIR, `${slug(e.name)}.jpg`))) e.image = `/carti/eras/${slug(e.name)}.jpg`
  }
  for (const s of songs) s.image_url = s.era ? eras.get(s.era.name)?.image ?? null : null

  // ─── music videos ───────────────────────────────────────────────────────
  // The Released tab lists each video as its own row ("Sky [Music Video] [V2]").
  // Every released song with the same title gets that video, which VAMP plays
  // muted behind the player (CartiMusicVideo.tsx): a real video file (imgur.gg
  // .mp4/.mov) when the row has one, else its YouTube link. The rows' pillows.su
  // links are audio rips, so they're not used here.
  const videoKey = (name) => bareTitle(name).replace(/\b(official\s+)?(music\s+)?video\b/gi, '').replace(/\s+/g, ' ').trim()
  const isVideoRow = (s) => /\b(music video|official video|visuali[sz]er)\b/i.test(s.name) || /^Type: Music Video$/im.test(s.additional_information ?? '')
  const videos = new Map()
  for (const s of songs) {
    if (s.category !== 'released' || !isVideoRow(s)) continue
    const key = videoKey(s.name)
    if (!key) continue
    let video = null
    for (const l of s._src.links) {
      const i = /(?<![\w.])imgur\.gg\/f\/([A-Za-z0-9]+)/i.exec(l)
      if (!i) continue
      const url = await imgurAudio(i[1], imgurCache)
      if (url && /\.(mp4|mov|m4v|webm)$/i.test(url)) { video = { kind: 'file', url }; break }
    }
    if (!video) {
      const yt = embedFor(s._src.links.filter((l) => /youtu/.test(l)))
      if (yt) video = { kind: 'youtube', id: yt.path.split(':').pop() }
    }
    if (video && !videos.has(key)) videos.set(key, { ...video, title: s.name })
  }
  let withVideo = 0
  for (const s of songs) {
    const v = s.category === 'released' ? videos.get(videoKey(s.name)) : null
    s.music_video = v ?? null
    if (v) withVideo++
  }
  await writeFile(IMGUR_CACHE, JSON.stringify(imgurCache, null, 1))
  console.log(`Music videos: ${videos.size} found, on ${withVideo} released songs.`)

  const eraList = [...eras.values()].map(({ image, ...e }) => ({ ...e, image_url: image }))
  const stats = {
    total_songs: songs.length,
    category_stats: { released: 0, unreleased: 0, unsurfaced: 0, recording_session: 0 },
    era_stats: {},
  }
  for (const s of songs) {
    stats.category_stats[s.category]++
    if (s.era) stats.era_stats[s.era.name] = (stats.era_stats[s.era.name] ?? 0) + 1
  }

  await writeFile(path.join(OUT, 'songs.json'), JSON.stringify(songs))
  await writeFile(path.join(OUT, 'eras.json'), JSON.stringify(eraList, null, 1))
  await writeFile(path.join(OUT, 'stats.json'), JSON.stringify({ ...stats, built_at: new Date().toISOString() }, null, 1))
  console.log(`Wrote ${songs.length} songs across ${eraList.length} eras (${songs.filter((s) => s.path).length} playable).`)
}

main().catch((err) => {
  console.error(err)
  // A sheet outage shouldn't break the deploy when a previous snapshot exists.
  if (existsSync(path.join(OUT, 'songs.json'))) {
    console.warn('Keeping the existing data snapshot.')
    process.exit(0)
  }
  process.exit(1)
})
