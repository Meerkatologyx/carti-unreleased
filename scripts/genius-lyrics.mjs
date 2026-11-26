#!/usr/bin/env node
// Plain lyrics from Genius for the catalogue, written to
// src/renderer/public/carti/lyrics.json ({ "<song id>": "lyrics…" }).
//
// Genius can't be read from a browser (no CORS), so this runs at build time,
// after build-carti-data.mjs. Each distinct title is searched once; a hit has
// to be the same title by Carti (or the artist the tracker names). Results are
// cached in scripts/genius-cache.json so a build only asks about new songs;
// misses are retried after a week. The player prefers LRCLIB's timed lyrics and
// shows these when there are none (Player.tsx).
//
// Run: node scripts/genius-lyrics.mjs [--max N]   (N new lookups per run, default 600)

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SONGS = path.join(ROOT, 'src/renderer/public/carti/songs.json')
const OUT = path.join(ROOT, 'src/renderer/public/carti/lyrics.json')
const CACHE = path.join(ROOT, 'scripts/genius-cache.json')
const MISS_TTL = 7 * 24 * 3600 * 1000
const DELAY_MS = 350
const maxArg = process.argv.indexOf('--max')
const MAX_NEW = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 600

const UA = { 'user-agent': 'Mozilla/5.0 (carti-tracker build)', accept: 'text/html,application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const norm = (s) => s.toLowerCase().normalize('NFKC')
  .replace(/['’‘`]/g, '').replace(/\$/g, 's').replace(/&/g, 'and')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const VARIANT = /\b(remix|sped|slowed|reverb|live|instrumental|acapella|a cappella|nightcore|8d|cover|mashup)\b/i

/** "⭐ Ye - CITY OF GOD [V23] (feat. X)" → [{ title: "Ye - CITY OF GOD" }, { title: "CITY OF GOD", artist: "Ye" }] */
function searchTerms(name) {
  const title = name.replace(/^[^\p{L}\p{N}(]+/u, '').replace(/\[[^\]]*\]|\([^)]*\)|\*/g, '').replace(/\s+/g, ' ').trim()
  // Placeholders ("???", "[Unknown … Songs]", a bare "V1") aren't searchable titles.
  if (!title || /^[?\s]+$/.test(title) || /^unknown\b/i.test(title) || /^v\d+$/i.test(title)) return []
  const out = [{ title, artist: null }]
  const m = /^(.+?) - (.+)$/.exec(title)
  if (m) out.push({ title: m[2].trim(), artist: m[1].trim() })
  return out
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA })
  if (res.status === 429 || res.status === 403) throw new Error(`Genius refused (${res.status})`)
  if (!res.ok) return null
  return res.json()
}

async function search(title, artist, variant) {
  const q = `${title} ${artist ?? 'Playboi Carti'}`
  const j = await getJson(`https://genius.com/api/search/song?${new URLSearchParams({ q, per_page: '5' })}`)
  const hits = j?.response?.sections?.[0]?.hits ?? []
  const want = norm(title)
  const who = norm(artist ?? 'Playboi Carti')
  for (const { result: r } of hits) {
    if (!r || r.instrumental) continue
    const t = norm((r.title ?? '').replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, ''))
    if (t !== want && norm(r.title_with_featured ?? '') !== want) continue
    if (VARIANT.test(r.title ?? '') !== variant) continue
    if (!norm(r.artist_names ?? '').includes(who)) continue
    return r.url
  }
  return null
}

// ─── lyric page → text ──────────────────────────────────────────────────────

/** The inner HTML of every element opened at `starts`, by matching <div>…</div> depth. */
function blocks(html, startRe) {
  const out = []
  const re = startRe.global ? startRe : new RegExp(startRe.source, startRe.flags + 'g')
  for (const m of html.matchAll(re)) {
    let i = m.index + m[0].length, depth = 1
    const tag = /<\/?div\b[^>]*>/gi
    tag.lastIndex = i
    let t
    while (depth && (t = tag.exec(html))) depth += t[0][1] === '/' ? -1 : 1
    if (t) out.push(html.slice(i, t.index))
  }
  return out
}

function removeExcluded(html) {
  // Genius tucks a contributors/translations header inside the first container.
  let s = html
  for (;;) {
    const m = /<div[^>]*data-exclude-from-selection="true"[^>]*>/i.exec(s)
    if (!m) return s
    const inner = blocks(s.slice(m.index), /<div[^>]*data-exclude-from-selection="true"[^>]*>/i)[0] ?? ''
    s = s.slice(0, m.index) + s.slice(m.index + m[0].length + inner.length + '</div>'.length)
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function toText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (e, c) => c[0] === '#'
      ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10))
      : ENTITIES[c.toLowerCase()] ?? e)
}

async function lyricsAt(url) {
  const res = await fetch(url, { headers: UA })
  if (res.status === 429 || res.status === 403) throw new Error(`Genius refused (${res.status})`)
  if (!res.ok) return null
  const html = await res.text()
  const parts = blocks(html, /<div[^>]*data-lyrics-container="true"[^>]*>/gi).map((b) => toText(removeExcluded(b)))
  const text = parts.join('\n')
    .replace(/^\s*\[[^\]\n]*\]\s*$/gm, '') // [Chorus], [Verse 1: Playboi Carti] - as the old editor did on paste
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Unreleased pages often carry only a note that the lyrics aren't out yet.
  if (!text || /lyrics for this song have yet to be (released|transcribed)/i.test(text)) return null
  // A page of "..." and one guessed line isn't lyrics.
  const real = text.split('\n').filter((l) => (l.match(/\p{L}/gu) ?? []).length >= 6)
  if (real.length < 3) return null
  return text
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const songs = JSON.parse(await readFile(SONGS, 'utf8'))
  const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, 'utf8')) : {}
  const now = Date.now()
  const fresh = (c) => c && (c.lyrics || now - c.t < MISS_TTL)

  // One lookup per distinct title (versions of a song share their words).
  const byKey = new Map()
  for (const s of songs) {
    const terms = searchTerms(s.name)
    if (!terms.length) continue
    const key = `${norm(terms[0].title)}|${VARIANT.test(s.name) ? 'v' : ''}`
    if (!byKey.has(key)) byKey.set(key, { terms, variant: VARIANT.test(s.name), songs: [] })
    byKey.get(key).songs.push(s)
  }

  const todo = [...byKey.entries()].filter(([key]) => !fresh(cache[key]))
  console.log(`Genius: ${byKey.size} distinct titles, ${byKey.size - todo.length} cached, looking up ${Math.min(todo.length, MAX_NEW)} now.`)
  let looked = 0, found = 0
  try {
    for (const [key, entry] of todo.slice(0, MAX_NEW)) {
      let url = null
      for (const t of entry.terms) {
        url = await search(t.title, t.artist, entry.variant)
        await sleep(DELAY_MS)
        if (url) break
      }
      const lyrics = url ? await lyricsAt(url) : null
      if (url) await sleep(DELAY_MS)
      cache[key] = { t: Date.now(), url, lyrics }
      looked++
      if (lyrics) found++
      if (looked % 50 === 0) {
        console.log(`  ${looked} looked up, ${found} with lyrics…`)
        await writeFile(CACHE, JSON.stringify(cache))
      }
    }
  } catch (err) {
    // Rate-limited or blocked: keep what we have, the next build carries on.
    console.warn(`  stopped early: ${err.message}`)
  }
  await writeFile(CACHE, JSON.stringify(cache))

  const out = {}
  for (const [key, entry] of byKey) {
    const lyrics = cache[key]?.lyrics
    if (lyrics) for (const s of entry.songs) out[s.id] = lyrics
  }
  await writeFile(OUT, JSON.stringify(out))
  console.log(`Genius: ${looked} looked up (${found} with lyrics); lyrics for ${Object.keys(out).length} of ${songs.length} songs.`)
}

main().catch((err) => { console.error(err); process.exit(existsSync(OUT) ? 0 : 1) })
