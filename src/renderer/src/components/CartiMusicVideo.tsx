// A released song's music video, muted, behind VAMP - the way VampMusicVideo
// plays archive videos, for the videos the Carti tracker links instead: the
// song's "[Music Video]" row in the sheet (see scripts/build-carti-data.mjs,
// `music_video`). Those are YouTube uploads, so this is YouTube's player with
// its chrome hidden, kept at the song's position: seeked whenever it drifts
// more than a couple of seconds, paused and played with the song, and faded
// out when the video ends before the song does.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { getSongById } from '../lib/catalogApi'
import { trackIdToSongId } from '../lib/userApi'
import { isEmbedUrl } from '../lib/embedPlayback'
import { playingSeconds } from '../desktop/playClock'

const YT_ORIGIN = 'https://www.youtube-nocookie.com'
const FADE_MS = 700
/** How far the video may wander from the song before it's put back. */
const DRIFT_S = 2.5

interface SongVideo { id: string; title: string }

/** The current song's music video, or null. */
function useSongVideo(): SongVideo | null {
  const track = useStore((s) => s.currentTrack)
  const choice = useVizStore((s) => s.vampVideos)
  const [video, setVideo] = useState<SongVideo | null>(null)
  useEffect(() => {
    setVideo(null)
    const songId = track ? trackIdToSongId(track.id) : null
    // A song already playing through YouTube's own player (EmbedDock) shows that.
    if (songId == null || choice === 'off' || isEmbedUrl(track?.streamUrl)) return
    let live = true
    getSongById(songId).then((song) => {
      const mv = (song as { music_video?: { kind: string; id?: string; title: string } | null }).music_video
      if (live && mv?.kind === 'youtube' && mv.id) setVideo({ id: mv.id, title: mv.title })
    }).catch(() => {})
    return () => { live = false }
  }, [track?.id, track?.streamUrl, choice])
  return video
}

export default function CartiMusicVideo({ onShow }: { onShow?: (label: string) => void }): JSX.Element | null {
  const video = useSongVideo()
  const isPlaying = useStore((s) => s.isPlaying)
  const frame = useRef<HTMLIFrameElement>(null)
  const ytTime = useRef(0)
  const ytState = useRef(-1)
  const [shown, setShown] = useState(false)
  const onShowRef = useRef(onShow)
  onShowRef.current = onShow

  const send = (func: string, args: unknown[] = []): void => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), YT_ORIGIN)
  }

  // Listen to the player: where it is, and whether it's playing or done.
  useEffect(() => {
    setShown(false)
    ytTime.current = 0
    ytState.current = -1
    if (!video) return
    let announced = false
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return
      let d: { event?: string; info?: unknown }
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
      const info = d.info as { currentTime?: number; playerState?: number } | number | undefined
      const state = typeof info === 'number' ? (d.event === 'onStateChange' ? info : undefined) : info?.playerState
      if (typeof info === 'object' && typeof info?.currentTime === 'number') ytTime.current = info.currentTime
      if (state === undefined) return
      ytState.current = state
      if (state === 1) {
        // No captions over a background (auto-captions turn on for some viewers).
        send('unloadModule', ['captions'])
        send('unloadModule', ['cc'])
        setShown(true)
        if (!announced) { announced = true; onShowRef.current?.('Music video') }
      }
      if (state === 0) setShown(false) // the video ran out before the song
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [video?.id])

  // Follow the song: play/pause with it, and pull the video back when it drifts.
  useEffect(() => {
    if (!video) return
    send(isPlaying ? 'playVideo' : 'pauseVideo')
    if (!isPlaying) return
    const timer = window.setInterval(() => {
      if (ytState.current === 0) return
      const song = playingSeconds()
      if (Math.abs(ytTime.current - song) > DRIFT_S) send('seekTo', [song, true])
    }, 2000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, isPlaying])

  if (!video) return null
  const src = `${YT_ORIGIN}/embed/${encodeURIComponent(video.id)}?${new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', disablekb: '1', playsinline: '1', rel: '0', iv_load_policy: '3', cc_load_policy: '0',
    fs: '0', modestbranding: '1', enablejsapi: '1', origin: location.origin, start: String(Math.floor(playingSeconds())),
  })}`
  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ opacity: shown ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
      aria-hidden
    >
      <iframe
        key={video.id}
        ref={frame}
        src={src}
        title={video.title}
        tabIndex={-1}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN)}
        // 16:9, scaled to cover the whole view however its shape, a little over
        // that so older videos' own letterbox bars fall outside the view.
        style={{
          position: 'absolute', top: '50%', left: '50%', border: 0,
          width: '100vw', height: '56.25vw', minWidth: '177.78vh', minHeight: '100vh',
          transform: 'translate(-50%, -50%) scale(1.14)',
        }}
      />
    </div>
  )
}
