// Stand-in backend for the Carti tracker.
//
// The site is static: scripts/build-carti-data.mjs turns the Playboi Carti
// tracker sheet into /carti/{songs,eras,stats}.json, and this module patches
// window.fetch so every request to the app's API base is answered from those
// files in the browser. Catalogue endpoints (songs, eras, stats, shuffle
// radio) work; anything that needs a real server (accounts, chat, live radio,
// uploads, edits) gets a clean "not available" error, which the app already
// handles as a failed request.

import { CATALOG_API_BASE } from './apiServers'
import type { CatalogSong, CatalogEra, CatalogStats } from './catalogApi'

const ASSET_BASE = new URL(import.meta.env.BASE_URL || '/', location.origin).href

interface CartiEra extends CatalogEra { image_url: string | null }

let dataPromise: Promise<{ songs: CatalogSong[]; eras: CartiEra[]; stats: CatalogStats }> | null = null

function asset(p: string): string {
  return new URL(p.replace(/^\//, ''), ASSET_BASE).href
}

function loadData() {
  if (!dataPromise) {
    const get = (f: string) => origFetch(asset(`carti/${f}`), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load ${f} (${r.status})`)
      return r.json()
    })
    dataPromise = Promise.all([get('songs.json'), get('eras.json'), get('stats.json')]).then(([songs, eras, stats]) => {
      for (const s of songs as CatalogSong[]) if (s.image_url) s.image_url = asset(s.image_url)
      for (const e of eras as CartiEra[]) if (e.image_url) e.image_url = asset(e.image_url)
      return { songs, eras, stats }
    })
    dataPromise.catch(() => { dataPromise = null })
  }
  return dataPromise
}

const norm = (s: string): string => s.toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function matches(song: CatalogSong, q: string, deep: boolean): boolean {
  const n = norm(q)
  if (!n) return true
  const hay = [song.name, ...(song.track_titles ?? []), song.credited_artists, song.producers, song.era?.name ?? '']
  if (deep) hay.push(song.notes ?? '', song.additional_information ?? '', song.leak_type ?? '')
  const text = ` ${norm(hay.join(' '))} `
  return n.split(' ').every((w) => text.includes(w))
}

function omit(song: CatalogSong, fields: string[]): CatalogSong {
  if (!fields.length) return song
  const copy = { ...song } as Record<string, unknown>
  for (const f of fields) delete copy[f]
  return copy as unknown as CatalogSong
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UNAVAILABLE = { detail: "This feature isn't available on the Carti tracker." }

async function handle(url: URL, method: string): Promise<Response> {
  const p = url.pathname.slice(new URL(CATALOG_API_BASE).pathname.replace(/\/$/, '').length) || '/'
  const q = url.searchParams
  if (method !== 'GET' && method !== 'HEAD') {
    // Play counts are fire-and-forget; swallow them quietly.
    if (p.startsWith('/plays')) return json({ ok: true }, 201)
    return json(UNAVAILABLE, 503)
  }

  if (p === '/songs/' || p === '/songs') {
    const { songs } = await loadData()
    let rows = songs
    const deep = q.get('searchall')
    const shallow = q.get('search')
    if (deep) rows = rows.filter((s) => matches(s, deep, true))
    if (shallow) rows = rows.filter((s) => matches(s, shallow, false))
    const cat = q.get('category')
    if (cat) rows = rows.filter((s) => s.category === cat)
    const era = q.get('era')
    if (era) rows = rows.filter((s) => s.era?.name === era || String(s.era?.id) === era)
    const ids = q.get('ids')
    if (ids) { const set = new Set(ids.split(',').map(Number)); rows = rows.filter((s) => set.has(s.id)) }
    const fields = (q.get('omit') ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    if (q.get('all') === 'true') return json(rows.map((s) => omit(s, fields)))
    const size = Math.max(1, Number(q.get('page_size')) || 50)
    const page = Math.max(1, Number(q.get('page')) || 1)
    const start = (page - 1) * size
    const next = start + size < rows.length ? new URL(url) : null
    next?.searchParams.set('page', String(page + 1))
    const prev = page > 1 ? new URL(url) : null
    prev?.searchParams.set('page', String(page - 1))
    return json({ count: rows.length, next: next?.href ?? null, previous: prev?.href ?? null, results: rows.slice(start, start + size) })
  }

  const one = /^\/songs\/(\d+)\/?$/.exec(p)
  if (one) {
    const { songs } = await loadData()
    const song = songs.find((s) => s.id === Number(one[1]))
    return song ? json(song) : json({ detail: 'Not found.' }, 404)
  }

  if (p === '/eras/' || p === '/eras') {
    const { eras } = await loadData()
    return json(eras.map(({ image_url: _img, ...e }) => e))
  }

  if (p === '/stats/' || p === '/stats') return json((await loadData()).stats)

  // Shuffle radio: any song with a file of its own to stream (embed-only songs
  // need their site's player, so they're left to the normal queue).
  if (p === '/radio/random/') {
    const { songs } = await loadData()
    const pool = songs.filter((s) => /^https?:/.test(s.path))
    const song = pool[Math.floor(Math.random() * pool.length)]
    if (!song) return json({ detail: 'Nothing to play.' }, 404)
    return json({ title: song.name, path: song.path, song, size: 0, hash: String(song.id) })
  }

  if (p === '/plays/stats/') {
    return json({ total_plays: 0, total_songs_with_plays: 0, total_albums_with_plays: 0, total_eras_with_plays: 0, category_breakdown: [], top_songs: [], top_albums: [], top_eras: [], recent_plays: [] })
  }

  if (p === '/files/channels/') return json({ channels: [] })
  if (p.startsWith('/files/browse') || p.startsWith('/files/list-all')) return json({ items: [] })
  if (p.startsWith('/news')) return json({ count: 0, next: null, previous: null, results: [] })

  return json(UNAVAILABLE, 503)
}

const origFetch: typeof fetch = window.fetch.bind(window)

/** Era name → cover URL, for era art in the UI. */
export async function cartiEraCovers(): Promise<Record<string, string>> {
  const { eras } = await loadData()
  return Object.fromEntries(eras.filter((e) => e.image_url).map((e) => [e.name, e.image_url as string]))
}

export function installCartiApi(): void {
  const base = CATALOG_API_BASE.replace(/\/$/, '')
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (raw.startsWith(base)) {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      try {
        return await handle(new URL(raw), method)
      } catch (err) {
        return json({ detail: String((err as Error)?.message ?? err) }, 500)
      }
    }
    return origFetch(input, init)
  }
  // Live sockets (radio, notifications, chat) have no server here. Hand back
  // a socket that just never connects, so the app doesn't sit in a
  // reconnect loop against a URL that can't answer.
  const wsBase = base.replace(/^http/, 'ws')
  const RealWebSocket = window.WebSocket
  class DormantSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readyState = 0
    binaryType: BinaryType = 'blob'
    bufferedAmount = 0
    extensions = ''
    protocol = ''
    onopen: ((ev: Event) => unknown) | null = null
    onmessage: ((ev: MessageEvent) => unknown) | null = null
    onerror: ((ev: Event) => unknown) | null = null
    onclose: ((ev: CloseEvent) => unknown) | null = null
    constructor(readonly url: string) { super() }
    send(): void {}
    close(): void { this.readyState = 3 }
  }
  const PatchedWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = String(url)
    if (href.startsWith(wsBase)) return new DormantSocket(href)
    return new RealWebSocket(url, protocols)
  } as unknown as typeof WebSocket
  Object.assign(PatchedWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  PatchedWebSocket.prototype = RealWebSocket.prototype
  window.WebSocket = PatchedWebSocket

  // Warm the catalogue so the first view doesn't wait on it.
  void loadData().catch(() => undefined)
}
