// Songs whose only source is YouTube, SoundCloud or Spotify.
//
// Their catalogue path is "embed:<seconds>:<provider>:<ref>" (written by
// scripts/build-carti-data.mjs). Those sites only play through their own
// embedded players, so such a song is played in two halves:
//  - the app's audio element plays a silent placeholder of the song's length,
//    so the timeline, queue, pause, seek and end-of-song all keep working the
//    way they do for any other song;
//  - EmbedDock shows the site's player and keeps it in step with the app
//    (play / pause / seek, and moving on when the real song ends).

export type EmbedProvider = 'youtube' | 'soundcloud' | 'spotify'

export interface EmbedRef {
  provider: EmbedProvider
  ref: string
  /** Song length from the tracker; 0 when it isn't known. */
  seconds: number
}

/** Placeholder length when the tracker has none - the embed's own "ended" moves on before this runs out. */
export const UNKNOWN_EMBED_SECONDS = 600

export function isEmbedUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('embed:')
}

export function parseEmbedUrl(url: string | null | undefined): EmbedRef | null {
  const m = /^embed:(\d+):(youtube|soundcloud|spotify):(.+)$/.exec(url ?? '')
  return m ? { seconds: Number(m[1]), provider: m[2] as EmbedProvider, ref: m[3] } : null
}

export function embedSiteName(p: EmbedProvider): string {
  return p === 'youtube' ? 'YouTube' : p === 'soundcloud' ? 'SoundCloud' : 'Spotify'
}

/** The iframe URL for the site's player, set to start playing at `startAt` seconds. */
export function embedFrameUrl(e: EmbedRef, autoplay: boolean, startAt = 0): string {
  if (e.provider === 'youtube') {
    const q = new URLSearchParams({
      autoplay: autoplay ? '1' : '0', enablejsapi: '1', playsinline: '1', rel: '0',
      origin: location.origin, start: String(Math.floor(startAt)),
    })
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(e.ref)}?${q}`
  }
  if (e.provider === 'soundcloud') {
    const q = new URLSearchParams({ url: e.ref, auto_play: autoplay ? 'true' : 'false', visual: 'false', hide_related: 'true', show_comments: 'false', show_reposts: 'false' })
    return `https://w.soundcloud.com/player/?${q}`
  }
  return `https://open.spotify.com/embed/${e.ref}?utm_source=generator`
}

// ─── silent placeholder ─────────────────────────────────────────────────────

const silentUrls = new Map<number, string>()

/** A blob URL of `seconds` of silence (8 kHz, 8-bit mono WAV - 8 KB a second), shared per length. */
export function silentUrlFor(streamUrl: string): string {
  const e = parseEmbedUrl(streamUrl)
  const seconds = Math.max(1, Math.round(e?.seconds || UNKNOWN_EMBED_SECONDS))
  const cached = silentUrls.get(seconds)
  if (cached) return cached
  const rate = 8000
  const samples = rate * seconds
  const buf = new ArrayBuffer(44 + samples)
  const v = new DataView(buf)
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  str(36, 'data'); v.setUint32(40, samples, true)
  new Uint8Array(buf, 44).fill(128) // 8-bit PCM silence is the midpoint
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
  // Keep only a few lengths around; a placeholder in use is re-made if needed.
  if (silentUrls.size >= 6) {
    const [oldLen, oldUrl] = silentUrls.entries().next().value as [number, string]
    silentUrls.delete(oldLen)
    setTimeout(() => URL.revokeObjectURL(oldUrl), 60_000)
  }
  silentUrls.set(seconds, url)
  return url
}

/** True when this audio element is playing an embed song's silent placeholder. */
export function isSilentPlaceholder(src: string): boolean {
  for (const u of silentUrls.values()) if (u === src) return true
  return false
}
