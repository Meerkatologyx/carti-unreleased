// The YouTube / SoundCloud / Spotify player for songs that only exist there
// (see lib/embedPlayback.ts). Shown while such a song is the current track,
// and kept in step with the app's own player: play / pause / seek follow the
// silent placeholder the app is playing, and the song moving on when the
// real one ends.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../store/useStore'
import { embedFrameUrl, embedSiteName, isSilentPlaceholder, parseEmbedUrl, type EmbedRef } from '../lib/embedPlayback'

const ORIGINS: Record<EmbedRef['provider'], string> = {
  youtube: 'https://www.youtube-nocookie.com',
  soundcloud: 'https://w.soundcloud.com',
  spotify: 'https://open.spotify.com',
}

/** The app's audio element that's playing the placeholder right now, if any. */
function placeholderAudio(): HTMLAudioElement | null {
  for (const a of Array.from(document.querySelectorAll('audio'))) {
    if (a.currentSrc && isSilentPlaceholder(a.currentSrc) && !a.paused) return a
  }
  for (const a of Array.from(document.querySelectorAll('audio'))) {
    if (a.currentSrc && isSilentPlaceholder(a.currentSrc)) return a
  }
  return null
}

export default function EmbedDock(): JSX.Element | null {
  const track = useStore((s) => s.currentTrack)
  const isPlaying = useStore((s) => s.isPlaying)
  const embed = useMemo(() => parseEmbedUrl(track?.streamUrl), [track?.streamUrl])
  const frame = useRef<HTMLIFrameElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const ready = useRef(false)
  const trackId = track?.id

  // The iframe is made once per song; play/pause afterwards go over postMessage.
  const src = useMemo(
    () => (embed ? embedFrameUrl(embed, useStore.getState().isPlaying) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackId, embed?.provider, embed?.ref],
  )

  const send = (msg: unknown): void => {
    if (!embed || !frame.current?.contentWindow) return
    frame.current.contentWindow.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg), ORIGINS[embed.provider])
  }
  const command = (what: 'play' | 'pause' | 'seek', seconds = 0): void => {
    if (!embed) return
    if (embed.provider === 'youtube') {
      const func = what === 'play' ? 'playVideo' : what === 'pause' ? 'pauseVideo' : 'seekTo'
      send({ event: 'command', func, args: what === 'seek' ? [seconds, true] : [], id: 1, channel: 'widget' })
    } else if (embed.provider === 'soundcloud') {
      send(what === 'seek' ? { method: 'seekTo', value: Math.round(seconds * 1000) } : { method: what })
    }
    // Spotify's embed takes no outside commands - it's played from its own button.
  }

  // Hear the embed: when it's ready, and when the real song ends.
  useEffect(() => {
    if (!embed) return
    ready.current = false
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== ORIGINS[embed.provider] || e.source !== frame.current?.contentWindow) return
      let data: Record<string, unknown>
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
      if (embed.provider === 'youtube') {
        if (data.event === 'onReady' || data.event === 'initialDelivery') {
          if (!ready.current) {
            ready.current = true
            send({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' })
            if (!useStore.getState().isPlaying) command('pause')
          }
        }
        if (data.event === 'onStateChange' && data.info === 0) finished()
      } else if (embed.provider === 'soundcloud') {
        if (data.method === 'ready' && !ready.current) {
          ready.current = true
          send({ method: 'addEventListener', value: 'finish' })
          if (!useStore.getState().isPlaying) command('pause')
        }
        if (data.method === 'finish') finished()
      }
    }
    const finished = (): void => {
      const s = useStore.getState()
      if (s.currentTrack?.id !== trackId) return
      // The placeholder ends at the tracker's length on its own; only step in
      // when the real song finished well before that (or the length is unknown).
      const a = placeholderAudio()
      if (a && Number.isFinite(a.duration) && a.duration - a.currentTime < 3) return
      s.nextTrack()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, embed?.provider, embed?.ref])

  // YouTube only starts sending events once it's been told someone's listening.
  const onLoad = (): void => {
    if (embed?.provider === 'youtube') send({ event: 'listening', id: 1, channel: 'widget' })
  }

  // Play / pause follow the app.
  useEffect(() => {
    if (embed && ready.current) command(isPlaying ? 'play' : 'pause')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Seeking the app's timeline seeks the embed.
  useEffect(() => {
    if (!embed) return
    const onSeeked = (e: Event): void => {
      const a = e.target as HTMLAudioElement
      if (a.tagName === 'AUDIO' && a.currentSrc && isSilentPlaceholder(a.currentSrc)) command('seek', a.currentTime)
    }
    document.addEventListener('seeked', onSeeked, true)
    return () => document.removeEventListener('seeked', onSeeked, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, embed?.provider, embed?.ref])

  if (!embed || !track) return null
  const site = embedSiteName(embed.provider)
  const height = embed.provider === 'youtube' ? 180 : embed.provider === 'soundcloud' ? 120 : 152
  return (
    <div
      className="fixed right-4 z-[60] w-[320px] max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden border border-[var(--border)] bg-surface-raised shadow-2xl"
      style={{ bottom: 'calc(var(--player-height, 88px) + 16px)' }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:text-text-primary"
        title={collapsed ? 'Show player' : 'Hide player (keeps playing)'}
      >
        <span className="flex-1 truncate">
          Playing from {site}
          {embed.provider === 'spotify' ? ' - press play in the Spotify player' : ''}
        </span>
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {/* Collapsed keeps the frame (and the music) alive, just out of sight. */}
      <div style={collapsed ? { height: 1, opacity: 0, overflow: 'hidden' } : { height }}>
        <iframe
          key={`${trackId}`}
          ref={frame}
          src={src}
          onLoad={onLoad}
          title={`${track.title} on ${site}`}
          width="100%"
          height={height}
          allow="autoplay; encrypted-media; clipboard-write; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
