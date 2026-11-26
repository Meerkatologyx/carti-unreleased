#!/usr/bin/env node
// Builds the site's song catalogue from the Playboi Carti tracker spreadsheet.
//
// The original app reads everything from a live backend API. This fork has no
// backend: instead this script pulls the public tracker sheet (Unreleased and
// Released tabs) and writes it out in the exact shape that API served, to
// src/renderer/public/carti/. lib/cartiApi.ts then answers the app's API
// requests from those files in the browser.
//
// Run: node scripts/build-carti-data.mjs   (CI runs it before every build)

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHEET_ID = '1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4'
const TABS = { unreleased: '0', released: '245504108' }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/renderer/public/carti')
const ERA_IMG_DIR = path.join(OUT, 'eras')

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

/** First pillows.su link in the cell → its direct, CORS-enabled audio URL. */
function audioUrl(links) {
  const m = /pillows?\.su\/f\/([a-f0-9]{16,})/i.exec(links || '') || /pillowcase\.su\/f\/([a-f0-9]{16,})/i.exec(links || '')
  return m ? `https://api.pillows.su/api/download/${m[1]}` : ''
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
    const path = audioUrl(f.links)
    const unavailable = /not available|^lost$|rumou?red|confirmed/i.test(`${f.avail ?? ''}`) || /^(lost|rumou?red)$/i.test(f.type ?? '')
    const category = f.category ?? (path ? 'unreleased' : unavailable ? 'unsurfaced' : 'unreleased')
    const info = [
      f.type && `Type: ${f.type}`,
      f.avail && `Available length: ${f.avail}`,
      f.quality && `Quality: ${f.quality}`,
      f.streaming && `On streaming: ${f.streaming}`,
      f.recEra && f.recEra !== f.eraName && `Recorded during: ${f.recEra}`,
    ].filter(Boolean).join('\n')
    const links = allLinks(f.links)
    return {
      id: idFor(`${category}|${f.eraName}|${f.name}`),
      public_id: null,
      name: title.replace(/\*+$/, '').trim() || title,
      original_key: null,
      track_titles: [title, ...alts].filter((v, i, a) => v && a.indexOf(v) === i),
      path,
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
  }

  console.log(`Saving ${Object.keys(eraImgSrc).length} era covers…`)
  for (const e of eras.values()) {
    const src = eraImgSrc[e.name]
    if (src) e.image = await saveEraImage(e.name, src)
    else if (existsSync(path.join(ERA_IMG_DIR, `${slug(e.name)}.jpg`))) e.image = `/carti/eras/${slug(e.name)}.jpg`
  }
  for (const s of songs) s.image_url = s.era ? eras.get(s.era.name)?.image ?? null : null

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

main().catch(async (err) => {
  console.error(err)
  // A sheet outage shouldn't break the deploy when a previous snapshot exists.
  if (existsSync(path.join(OUT, 'songs.json'))) {
    console.warn('Keeping the existing data snapshot.')
    await readFile(path.join(OUT, 'songs.json'))
    process.exit(0)
  }
  process.exit(1)
})
