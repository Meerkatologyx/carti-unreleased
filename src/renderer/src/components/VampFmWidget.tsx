import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, BellOff, ChevronDown, ChevronUp, Headphones, Radio, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { useRadioChatStore } from '../store/radioChatStore'
import { acquireRadioChat } from '../lib/radioChatSocket'
import { playNotificationSound } from '../lib/notifications'
import RadioChatPanel from './RadioChatPanel'
import RadioFmControls from './RadioFmControls'
import { RadioVoteCard } from './RadioVotePopup'
import { toggleRadioFm } from '../hooks/useVampCore'

// Vamp FM as a card in VAMP's Widgets layout, where VAMP's own FM panel is
// hidden: the Radio side (vote, suggest the next song, up next) and the Chat
// side. Shown while Vamp FM is on, or opened from VAMP's toolbar without
// tuning in (the station's state and the chat run either way; voting and
// suggesting need a listener, so the card offers Tune in). Dragged by its
// header, kept where it was left, folded down to the header on request
// (Settings > Lyrics & VAMP turns it off). React-drawn, unlike the desktop widgets beside it, which are the
// desktop's own pages in frames.

/** The size it starts at, and the smallest it can be dragged to from its corner. */
const WIDTH = 360
const HEIGHT = 480
const MIN_WIDTH = 300
const MIN_HEIGHT = 320
const HEADER = 48
/** How far off the tab's edges it is kept. */
const MARGIN = 12
/** The vote card's gap under the widget, and its height with a track line (room check only). */
const VOTE_GAP = 10
const VOTE_HEIGHT = 168

type Tab = 'radio' | 'chat'

export default function VampFmWidget(): JSX.Element | null {
  const fmOn = useStore((s) => s.radioFmActive)
  const live = useStore((s) => s.radioFmIsLive === true)
  const fmOffAir = useStore((s) => s.radioFmIsLive === false)
  const listeners = useStore((s) => s.radioFmListeners)
  const voteWaiting = useStore((s) => !!s.radioFmVote?.active && !s.radioFmVoteDismissed)
  const playlistRight = useStore((s) => s.desktop.playlist.inVamp && s.desktop.playlist.side === 'right')
  const voteActive = useStore((s) => !!s.radioFmVote?.active)
  const { vampFm, vampFmOpen, vampFmPlace, vampFmCollapsed, vampFmTab, vampFmSound, vampFmSize, setVampFmSize, setVampFmOpen, setVampFmPlace, setVampFmCollapsed, setVampFmTab, setVampFmSound } = useVizStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [moving, setMoving] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ id: number; from: { x: number; y: number }; base: { x: number; y: number } } | null>(null)
  const [sizing, setSizing] = useState<{ w: number; h: number } | null>(null)
  const sizeDrag = useRef<{ id: number; from: { x: number; y: number }; base: { w: number; h: number }; left: number; top: number } | null>(null)
  const shown = vampFm && (fmOn || vampFmOpen)

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const measure = (): void => setArea({ width: layer.clientWidth, height: layer.clientHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(layer)
    return () => watch.disconnect()
  }, [])

  // The chat socket stays open while the card is up, folded or on the Radio
  // side, so the Chat tab can count new lines.
  useEffect(() => (shown ? acquireRadioChat() : undefined), [shown])
  const messages = useRadioChatStore((s) => s.messages)
  const chatKnown = useRadioChatStore((s) => s.enabled !== null)
  const chatOff = useRadioChatStore((s) => s.enabled === false)
  const readingChat = !vampFmCollapsed && vampFmTab === 'chat'
  const [seenId, setSeenId] = useState(0)
  const primed = useRef(false)
  const newestId = messages.length ? messages[messages.length - 1].id : 0
  useEffect(() => {
    // The backlog that arrives on connecting counts as seen; only lines after it are new.
    if (readingChat || (!primed.current && chatKnown)) setSeenId(newestId)
    if (chatKnown) primed.current = true
  }, [readingChat, newestId, chatKnown])
  const unseen = readingChat || chatOff ? 0 : messages.filter((m) => m.id > seenId).length

  // The optional sound: one sound for the lines that arrived since the last
  // one (not our own), and one when a vote starts. The backlog on connecting
  // stays quiet. It plays the notification sound chosen in Settings.
  const soundOn = vampFmSound && shown
  const soundedId = useRef<number | null>(null)
  useEffect(() => {
    if (!chatKnown) return
    if (soundedId.current === null) { soundedId.current = newestId; return }
    const from = soundedId.current
    soundedId.current = newestId
    if (!soundOn || chatOff) return
    const { me, name } = useRadioChatStore.getState()
    const ours = (me?.name || name).trim().toLowerCase()
    if (messages.some((m) => m.id > from && (!ours || m.name.trim().toLowerCase() !== ours))) playNotificationSound()
  }, [newestId, chatKnown])
  const votePrev = useRef<boolean | null>(null)
  useEffect(() => {
    const was = votePrev.current
    votePrev.current = voteActive
    if (soundOn && was === false && voteActive) playNotificationSound()
  }, [voteActive])
  const voteBadge = voteWaiting && (vampFmCollapsed || vampFmTab !== 'radio')
  // The Radio side shows the vote itself; folded or on Chat it hangs under the card.
  const voteCard = voteBadge && fmOn

  // Its size: the one being dragged, else the saved one, else the default; kept inside the tab.
  const fit = (v: number, min: number, room: number): number => Math.round(Math.min(Math.max(v, min), Math.max(room - MARGIN * 2, HEADER)))
  const width = fit(sizing?.w ?? vampFmSize?.w ?? WIDTH, MIN_WIDTH, area.width)
  const fullHeight = fit(sizing?.h ?? vampFmSize?.h ?? HEIGHT, MIN_HEIGHT, area.height)
  const height = vampFmCollapsed ? HEADER : fullHeight
  // The default spot keeps clear of the player (center) and the playlist (its side).
  const place = vampFmPlace ?? { x: playlistRight ? 0.16 : 0.84, y: 0.5 }
  const center = moving ?? { x: area.width * place.x, y: area.height * place.y }
  const clamp = (v: number, size: number, room: number): number => Math.min(Math.max(v - size / 2, MARGIN), Math.max(room - size - MARGIN, MARGIN))
  // Folded, it keeps its header where the full card's header was.
  const lift = vampFmCollapsed ? (fullHeight - HEADER) / 2 : 0
  const left = Math.round(clamp(center.x, width, area.width))
  const top = Math.round(clamp(center.y - lift, height, area.height))

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, from: { x: e.clientX, y: e.clientY }, base: center }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setMoving({ x: d.base.x + e.clientX - d.from.x, y: d.base.y + e.clientY - d.from.y })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (moving && area.width && area.height) {
      // Saved as where it ended up, after keeping it in the tab.
      setVampFmPlace({ x: (left + width / 2) / area.width, y: (top + height / 2 + lift) / area.height })
    }
    setMoving(null)
  }

  // The corner handle: the top-left stays put and the far corner follows the
  // pointer, then the size and the center it ended up at are saved.
  const onSizeDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    sizeDrag.current = { id: e.pointerId, from: { x: e.clientX, y: e.clientY }, base: { w: width, h: height }, left, top }
  }
  const onSizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = sizeDrag.current
    if (!d || d.id !== e.pointerId) return
    const w = Math.round(Math.min(Math.max(d.base.w + e.clientX - d.from.x, MIN_WIDTH), Math.max(area.width - MARGIN - d.left, MIN_WIDTH)))
    const h = Math.round(Math.min(Math.max(d.base.h + e.clientY - d.from.y, MIN_HEIGHT), Math.max(area.height - MARGIN - d.top, MIN_HEIGHT)))
    setSizing({ w, h })
    setMoving({ x: d.left + w / 2, y: d.top + h / 2 })
  }
  const onSizeUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = sizeDrag.current
    if (!d || d.id !== e.pointerId) return
    sizeDrag.current = null
    if (sizing && area.width && area.height) {
      setVampFmSize(sizing)
      setVampFmPlace({ x: (left + width / 2) / area.width, y: (top + height / 2) / area.height })
    }
    setSizing(null)
    setMoving(null)
  }

  const pick = (tab: Tab): void => {
    setVampFmTab(tab)
    if (vampFmCollapsed) setVampFmCollapsed(false)
  }
  const tabClass = (tab: Tab): string => `relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
    vampFmTab === tab && !vampFmCollapsed ? 'bg-white/10 text-white/90' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
  }`

  return (
    <div ref={layerRef} className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
      {shown && area.width > 0 && (
        <section
          aria-label="Vamp FM"
          className="absolute pointer-events-auto flex flex-col rounded-[22px] overflow-hidden border border-white/10 bg-black/45 backdrop-blur-2xl shadow-[0_24px_60px_rgba(0,0,0,0.45)] animate-vamp-view-in"
          style={{ left, top, width, height }}
        >
          <div
            className={`shrink-0 flex items-center gap-1 pl-4 pr-3 select-none touch-none ${moving && !sizing ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ height: HEADER }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setVampFmCollapsed(!vampFmCollapsed) }}
          >
            <Radio size={14} className={`shrink-0 ${live ? 'text-red-400 animate-pulse' : 'text-white/40'}`} />
            <span className="text-white/80 text-xs font-bold tracking-[0.1em] uppercase">Vamp FM</span>
            {listeners != null && (
              <span
                className="flex items-center gap-1 text-white/45 text-[11px] tabular-nums"
                title={`${listeners} ${listeners === 1 ? 'person' : 'people'} listening, on the site and in Discord`}
                aria-label={`${listeners} listening`}
              >
                <Headphones size={11} /> {listeners}
              </span>
            )}
            <span className="w-1.5 shrink-0" />
            <div role="tablist" aria-label="Vamp FM" className="flex items-center gap-0.5">
              <button role="tab" aria-selected={vampFmTab === 'radio'} onClick={() => pick('radio')} className={tabClass('radio')}>
                Radio
                {voteBadge && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="A vote is on" />}
              </button>
              <button role="tab" aria-selected={vampFmTab === 'chat'} onClick={() => pick('chat')} className={tabClass('chat')}>
                Chat
                {unseen > 0 && (
                  <span className="min-w-[16px] h-4 px-1 rounded-full bg-red-500/80 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unseen > 99 ? '99+' : unseen}
                  </span>
                )}
              </button>
            </div>
            {!fmOn && (
              <button
                onClick={toggleRadioFm}
                disabled={fmOffAir}
                title={fmOffAir ? 'Vamp FM is off the air' : 'Tune in to Vamp FM'}
                className="ml-auto px-1.5 py-1 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                Tune in
              </button>
            )}
            <button
              onClick={() => {
                const on = !vampFmSound
                setVampFmSound(on)
                // A preview, and the click that lets the browser start audio.
                if (on) playNotificationSound()
              }}
              title={vampFmSound ? 'Sound on for new chat lines and votes' : 'Play a sound for new chat lines and votes'}
              aria-label="Sound for new chat lines and votes"
              aria-pressed={vampFmSound}
              className={`${fmOn ? 'ml-auto' : ''} p-1 rounded-lg transition-colors hover:bg-white/10 ${vampFmSound ? 'text-white/85' : 'text-white/40 hover:text-white/80'}`}
            >
              {vampFmSound ? <Bell size={14} /> : <BellOff size={14} />}
            </button>
            <button
              onClick={() => setVampFmCollapsed(!vampFmCollapsed)}
              title={vampFmCollapsed ? 'Open Vamp FM' : 'Fold Vamp FM away'}
              aria-label={vampFmCollapsed ? 'Open Vamp FM' : 'Fold Vamp FM away'}
              aria-expanded={!vampFmCollapsed}
              className="p-1 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            >
              {vampFmCollapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {!fmOn && (
              <button
                onClick={() => setVampFmOpen(false)}
                title="Close Vamp FM"
                aria-label="Close Vamp FM"
                className="p-1 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {!vampFmCollapsed && (
            <div key={vampFmTab} className="flex-1 min-h-0 flex flex-col animate-vamp-view-in">
              {vampFmTab === 'chat'
                ? <div className="flex-1 min-h-0 flex flex-col px-4 pb-4"><RadioChatPanel /></div>
                : <RadioFmControls />}
            </div>
          )}
          {!vampFmCollapsed && (
            <div
              role="separator"
              aria-label="Resize Vamp FM (double-click for the default size)"
              title="Drag to resize; double-click for the default size"
              className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize touch-none group"
              onPointerDown={onSizeDown}
              onPointerMove={onSizeMove}
              onPointerUp={onSizeUp}
              onPointerCancel={onSizeUp}
              onDoubleClick={() => setVampFmSize(null)}
            >
              <span className="absolute right-1 bottom-1 w-2 h-2 border-r-2 border-b-2 border-white/25 rounded-br-[3px] group-hover:border-white/60 transition-colors" />
            </div>
          )}
        </section>
      )}
      {shown && area.width > 0 && voteCard && (
        <RadioVoteCard
          className="absolute pointer-events-auto"
          style={{
            left, width,
            // Directly under; above it only where the tab has no room below.
            top: top + height + VOTE_GAP + VOTE_HEIGHT <= area.height ? top + height + VOTE_GAP : undefined,
            bottom: top + height + VOTE_GAP + VOTE_HEIGHT <= area.height ? undefined : area.height - top + VOTE_GAP,
          }}
        />
      )}
    </div>
  )
}
