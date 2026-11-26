// Lyrics from LRCLIB (https://lrclib.net), a free public lyrics database with
// line- and word-timed LRC. The tracker sheet has no lyrics, so when a song
// starts playing the player asks LRCLIB for it (see Player.tsx). Mostly this
// finds released songs; unreleased leaks are rarely there.
//
// A result is only used when it's clearly the same song: same title once tags
// are stripped, the right artist, and - when the tracker knows the length -
// within a few seconds of it, so a different version never lends its words.

import type { CatalogSong } from './catalogApi'

const API = 'https://lrclib.net/api/search'
const CACHE_KEY = 'lrclib:'
/** Found lyrics are kept a month; a miss is retried after a day (LRCLIB grows). */
const HIT_TTL = 30 * 24 * 3600 * 1000
const MISS_TTL = 24 * 3600 * 1000
const LENGTH_SLACK_S = 8

export interface FoundLyrics { lyrics: string | null; syncedLyrics: string | null }

interface LrclibResult {
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

const norm = (s: string): string => s.toLowerCase()
  .replace(/['’‘`]/g, '').replace(/\$/g, 's').replace(/&/g, 'and')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** "⭐ Ye - CITY OF GOD [V23] (feat. X)" → { artist: "Ye", title: "CITY OF GOD" }. */
function searchTerms(song: CatalogSong): { title: string; artist: string | null } {
  let title = song.name
    .replace(/^[^\p{L}\p{N}(]+/u, '') // tracker tags: ⭐ 🥉 ✨ 🗑️ …
    .replace(/\[[^\]]*\]|\([^)]*\)|\*/g, '') // [V2], (feat. …), (Remix), *
    .replace(/\s+/g, ' ').trim()
  let artist: string | null = null
  const m = /^(.+?) - (.+)$/.exec(title)
  if (m) { artist = m[1].trim(); title = m[2].trim() }
  return { title, artist }
}

function seconds(length: string | null | undefined): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(length ?? '')
  if (!m) return null
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]
}

function readCache(id: number): FoundLyrics | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY + id)
    if (!raw) return undefined
    const c = JSON.parse(raw) as { t: number; l: string | null; s: string | null; hit: boolean }
    if (Date.now() - c.t > (c.hit ? HIT_TTL : MISS_TTL)) return undefined
    return c.hit ? { lyrics: c.l, syncedLyrics: c.s } : null
  } catch {
    return undefined
  }
}

function writeCache(id: number, found: FoundLyrics | null): void {
  try {
    localStorage.setItem(CACHE_KEY + id, JSON.stringify({ t: Date.now(), hit: !!found, l: found?.lyrics ?? null, s: found?.syncedLyrics ?? null }))
  } catch { /* storage full or blocked - just look it up again next time */ }
}

const inFlight = new Map<number, Promise<FoundLyrics | null>>()

/** The song's lyrics from LRCLIB, or null when there's no confident match. Never throws. */
export function findLyrics(song: CatalogSong): Promise<FoundLyrics | null> {
  const cached = readCache(song.id)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inFlight.get(song.id)
  if (pending) return pending
  const p = lookup(song)
    .then((found) => { writeCache(song.id, found); return found })
    .catch(() => null) // offline / rate-limited: try again next play, cache nothing
    .finally(() => inFlight.delete(song.id))
  inFlight.set(song.id, p)
  return p
}

async function lookup(song: CatalogSong): Promise<FoundLyrics | null> {
  const { title, artist } = searchTerms(song)
  if (!title) return null
  const q = new URLSearchParams({ track_name: title, artist_name: artist ?? 'Playboi Carti' })
  const res = await fetch(`${API}?${q}`, { headers: { 'Lrclib-Client': 'Carti Unreleased' } })
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`)
  const results = (await res.json()) as LrclibResult[]

  const want = norm(title)
  const artists = [artist, 'playboi carti', ...song.credited_artists.split(',')].filter(Boolean).map((a) => norm(a!))
  const length = seconds(song.length)
  const fits = results.filter((r) =>
    !r.instrumental
    && (r.plainLyrics || r.syncedLyrics)
    && norm(r.trackName.replace(/\([^)]*\)|\[[^\]]*\]/g, '')) === want
    && artists.some((a) => a && norm(r.artistName).includes(a))
    && (length == null || Math.abs(r.duration - length) <= LENGTH_SLACK_S))
  if (!fits.length) return null
  // Timed lyrics first, then the closest length.
  fits.sort((a, b) => (+!!b.syncedLyrics - +!!a.syncedLyrics) || (length == null ? 0 : Math.abs(a.duration - length) - Math.abs(b.duration - length)))
  const best = fits[0]
  return { lyrics: best.plainLyrics || null, syncedLyrics: best.syncedLyrics || null }
}
