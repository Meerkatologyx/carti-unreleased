import { create } from 'zustand'
import { ls } from '../lib/persist'
import { normalizeMode, EDGE_PREFIX, type Boost, type Quality } from '../lib/viz'
import { LOOKS } from '../desktop/light/looks'
import { useStore } from './useStore'
import type { MusicVideoChoice } from '../lib/musicVideos'

// Fullscreen visualizer preferences. Kept on this device rather than synced to
// the account: quality in particular is a per-GPU choice that shouldn't follow
// someone from a desktop to a laptop.
//
// Whether lyrics show in fullscreen is deliberately NOT stored here: it's the
// app's own lyrics toggle (the store's lyricsOverride and its "Toggle lyrics"
// hotkey). A second, fullscreen-only switch could disagree with it - lyrics
// hidden by one while the other says they're on, so the key appears dead.

export type VizCycle = 'off' | 'track' | 'album'

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra']
const BOOSTS: readonly Boost[] = ['off', 'auto', '2', '4', '8']
const CYCLES: readonly VizCycle[] = ['off', 'track', 'album']
const VIDEO_CHOICES: readonly MusicVideoChoice[] = ['off', 'music', 'all']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const fmPlace = (v: unknown): { x: number; y: number } | null => {
  const p = v as { x?: unknown; y?: unknown } | null
  return p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: Math.min(Math.max(p.x, 0), 1), y: Math.min(Math.max(p.y, 0), 1) }
    : null
}

const fmSize = (v: unknown): { w: number; h: number } | null => {
  const p = v as { w?: unknown; h?: unknown } | null
  return p && typeof p.w === 'number' && typeof p.h === 'number' && Number.isFinite(p.w) && Number.isFinite(p.h)
    ? { w: Math.round(p.w), h: Math.round(p.h) }
    : null
}

export interface VampVideoNow {
  songPath: string
  videos: { path: string; label: string }[]
  active: string | null
  /** The administrators' default for the song: a video's path, '' for no video, null for none set. */
  serverDefault: string | null
}

const videoPicks = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, p] of Object.entries(v)) if (typeof p === 'string' && p) out[k] = p
  return out
}

const edgeLook = (id: unknown): string | null => (LOOKS.some((l) => l.id === id) ? (id as string) : null)

// An Edge light saved as the visualizer itself, from before it was a setting of its own: Off, with that light round it.
const savedId = ls.get<string>('vizMode') ?? 'aurora'
const savedEdge = savedId.startsWith(EDGE_PREFIX) ? edgeLook(savedId.slice(EDGE_PREFIX.length)) : null
if (savedEdge) {
  ls.set('vizMode', 'none')
  ls.set('vizEdgeOverlay', savedEdge)
}
const savedMode = savedEdge ? 'none' : normalizeMode(savedId)

interface VizState {
  /** The saved default visualizer. */
  vizMode: string
  /** What's on screen now. Differs from vizMode after an auto-switch, which is
   *  deliberately not saved, so the chosen default survives a reload. */
  activeMode: string
  vizQuality: Quality
  vizUseArtwork: boolean
  vizBoost: Boost
  vizCycle: VizCycle
  /** Widgets layout: the desktop's player, playlist and clock stand in the tab instead of VAMP's own player and lyrics. */
  vampWidgets: boolean
  /** The Vamp FM card (voting, suggestions, chat) in the Widgets layout, while Vamp FM is on. */
  vampFm: boolean
  /** Where it was left: its center as a share of the tab's width and height; null for the default spot. */
  vampFmPlace: { x: number; y: number } | null
  /** Its size in pixels as dragged from the corner (kept within the tab when drawn); null for the default size. */
  vampFmSize: { w: number; h: number } | null
  /** Kept up without Vamp FM on (it is always up while Vamp FM is on): chat, up next and the station's votes without tuning in. */
  vampFmOpen: boolean
  /** Folded down to its header. */
  vampFmCollapsed: boolean
  /** Which side of it shows. */
  vampFmTab: 'radio' | 'chat'
  /** A sound for new chat lines from others and for a vote starting, while the card is up. Off by default. */
  vampFmSound: boolean
  /** The Edge light (its look's id) drawn round the edges: over the visualizer, or on its own with it Off; null for none. */
  vizEdgeOverlay: string | null
  /** How many pickers are open over the page (not saved). VAMP's visualizer and Edge light keep moving under them
   *  at a lower frame rate, so they don't fight the picker's own screens for the GPU. */
  vizCovered: number
  /** The song's official video in place of the visualizer, when the archive has one: off, music videos (a
   *  visualizer for a song with none), or lyric videos too. */
  vampVideos: MusicVideoChoice
  /** A video is up and the visualizer stopped under it (not saved). */
  vampVideoShown: boolean
  /** The video picked for a song (by its file path): a video's path, or 'none' for the visualizer. A song with no pick
   *  gets the best video that lines up. */
  vampVideoPicks: Record<string, string>
  /** The playing song's videos as VAMP found them, for the pickers (not saved). `active` is the one on screen. */
  vampVideoNow: VampVideoNow | null

  selectMode: (id: string, persist: boolean) => void
  setVizQuality: (q: Quality) => void
  setVizUseArtwork: (on: boolean) => void
  setVizBoost: (b: Boost) => void
  setVizCycle: (c: VizCycle) => void
  setVampWidgets: (on: boolean) => void
  setVampFm: (on: boolean) => void
  setVampFmPlace: (place: { x: number; y: number } | null) => void
  setVampFmSize: (size: { w: number; h: number } | null) => void
  setVampFmOpen: (on: boolean) => void
  setVampFmCollapsed: (on: boolean) => void
  setVampFmTab: (tab: 'radio' | 'chat') => void
  setVampFmSound: (on: boolean) => void
  setVizEdgeOverlay: (look: string | null) => void
  /** A picker opened (true) or closed (false). */
  coverViz: (on: boolean) => void
  setVampVideos: (choice: MusicVideoChoice) => void
  setVampVideoShown: (on: boolean) => void
  /** null: back to automatic. */
  setVampVideoPick: (songPath: string, pick: string | null) => void
  setVampVideoNow: (now: VampVideoNow | null) => void
}

export const useVizStore = create<VizState>((set) => ({
  vizMode: savedMode,
  activeMode: savedMode,
  vizQuality: pick(ls.get('vizQuality'), QUALITIES, 'medium'),
  vizUseArtwork: ls.get<boolean>('vizUseArtwork') ?? true,
  vizBoost: pick(ls.get('vizBoost'), BOOSTS, 'off'),
  vizCycle: pick(ls.get('vizCycle'), CYCLES, 'off'),
  // The default. Someone who had the retired visualizer-only layout gets the widgets, where hiding all three is the same.
  vampWidgets: ls.get<boolean>('immMinimal') ? true : (ls.get<boolean>('vampWidgets') ?? true),
  vizEdgeOverlay: edgeLook(ls.get('vizEdgeOverlay')),
  vampFm: ls.get<boolean>('vampFm') ?? true,
  vampFmPlace: fmPlace(ls.get('vampFmPlace')),
  vampFmSize: fmSize(ls.get('vampFmSize')),
  vampFmOpen: ls.get<boolean>('vampFmOpen') ?? false,
  vampFmCollapsed: ls.get<boolean>('vampFmCollapsed') ?? false,
  vampFmTab: ls.get('vampFmTab') === 'chat' ? 'chat' : 'radio',
  vampFmSound: ls.get<boolean>('vampFmSound') === true,
  vizCovered: 0,
  vampVideos: pick(ls.get('vampVideos'), VIDEO_CHOICES, 'music'),
  vampVideoShown: false,
  vampVideoPicks: videoPicks(ls.get('vampVideoPicks')),
  vampVideoNow: null,

  selectMode: (id, persist) => {
    const mode = normalizeMode(id)
    if (persist) {
      set({ activeMode: mode, vizMode: mode })
      ls.set('vizMode', mode)
    } else {
      set({ activeMode: mode })
    }
  },
  setVizQuality: (vizQuality) => { set({ vizQuality }); ls.set('vizQuality', vizQuality) },
  setVizUseArtwork: (vizUseArtwork) => { set({ vizUseArtwork }); ls.set('vizUseArtwork', vizUseArtwork) },
  setVizBoost: (vizBoost) => { set({ vizBoost }); ls.set('vizBoost', vizBoost) },
  setVizCycle: (vizCycle) => { set({ vizCycle }); ls.set('vizCycle', vizCycle) },
  setVampWidgets: (vampWidgets) => {
    set({ vampWidgets })
    ls.set('vampWidgets', vampWidgets)
    ls.set('immMinimal', false)
  },
  setVampFm: (vampFm) => { set({ vampFm }); ls.set('vampFm', vampFm) },
  setVampFmPlace: (place) => { const vampFmPlace = fmPlace(place); set({ vampFmPlace }); ls.set('vampFmPlace', vampFmPlace) },
  setVampFmSize: (size) => { const vampFmSize = fmSize(size); set({ vampFmSize }); ls.set('vampFmSize', vampFmSize) },
  setVampFmOpen: (vampFmOpen) => { set({ vampFmOpen }); ls.set('vampFmOpen', vampFmOpen) },
  setVampFmCollapsed: (vampFmCollapsed) => { set({ vampFmCollapsed }); ls.set('vampFmCollapsed', vampFmCollapsed) },
  setVampFmTab: (vampFmTab) => { set({ vampFmTab }); ls.set('vampFmTab', vampFmTab) },
  setVampFmSound: (vampFmSound) => { set({ vampFmSound }); ls.set('vampFmSound', vampFmSound) },
  // A light picked for VAMP is the screen light's look too: there's one look, the screen light's (Settings > Desktop).
  setVizEdgeOverlay: (look) => {
    const vizEdgeOverlay = edgeLook(look)
    set({ vizEdgeOverlay })
    ls.set('vizEdgeOverlay', vizEdgeOverlay)
    if (vizEdgeOverlay) useStore.getState().setDesktop({ light: { look: vizEdgeOverlay } })
  },
  coverViz: (on) => set((s) => ({ vizCovered: Math.max(0, s.vizCovered + (on ? 1 : -1)) })),
  setVampVideos: (vampVideos) => { set({ vampVideos }); ls.set('vampVideos', vampVideos) },
  setVampVideoShown: (vampVideoShown) => set({ vampVideoShown }),
  setVampVideoPick: (songPath, pick) => set((s) => {
    const vampVideoPicks = { ...s.vampVideoPicks }
    if (pick) vampVideoPicks[songPath] = pick
    else delete vampVideoPicks[songPath]
    ls.set('vampVideoPicks', vampVideoPicks)
    return { vampVideoPicks }
  }),
  setVampVideoNow: (vampVideoNow) => set({ vampVideoNow }),
}))

// Settings usually runs in a pop-out window with its own copy of this store. What it saves arrives here as a storage
// event, so VAMP follows at once instead of after a restart. Straight into the state: the setters would save again.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || !e.key?.startsWith('unreleased:')) return
    let value: unknown = null
    try { value = e.newValue ? JSON.parse(e.newValue) : null } catch { return }
    switch (e.key.slice('unreleased:'.length)) {
      case 'vizMode': {
        const mode = normalizeMode(typeof value === 'string' ? value : 'aurora')
        useVizStore.setState({ vizMode: mode, activeMode: mode })
        break
      }
      case 'vizQuality': useVizStore.setState({ vizQuality: pick(value, QUALITIES, 'medium') }); break
      case 'vizUseArtwork': useVizStore.setState({ vizUseArtwork: value !== false }); break
      case 'vizBoost': useVizStore.setState({ vizBoost: pick(value, BOOSTS, 'off') }); break
      case 'vizCycle': useVizStore.setState({ vizCycle: pick(value, CYCLES, 'off') }); break
      case 'vampWidgets': useVizStore.setState({ vampWidgets: value !== false }); break
      case 'vizEdgeOverlay': useVizStore.setState({ vizEdgeOverlay: edgeLook(value) }); break
      case 'vampFm': useVizStore.setState({ vampFm: value !== false }); break
      case 'vampFmPlace': useVizStore.setState({ vampFmPlace: fmPlace(value) }); break
      case 'vampFmSize': useVizStore.setState({ vampFmSize: fmSize(value) }); break
      case 'vampFmCollapsed': useVizStore.setState({ vampFmCollapsed: value === true }); break
      case 'vampFmTab': useVizStore.setState({ vampFmTab: value === 'chat' ? 'chat' : 'radio' }); break
      case 'vampFmSound': useVizStore.setState({ vampFmSound: value === true }); break
      case 'vampVideos': useVizStore.setState({ vampVideos: pick(value, VIDEO_CHOICES, 'music') }); break
      case 'vampVideoPicks': useVizStore.setState({ vampVideoPicks: videoPicks(value) }); break
    }
  })
}

// VAMP's Edge light draws the screen light's look; vizEdgeOverlay only says whether it's on. Read through these, not
// vizEdgeOverlay itself, which can hold an older pick (or one made in a popped-out Settings window, where the look
// changed but this window's vizEdgeOverlay didn't).

/** The look VAMP's Edge light draws, or null while it's off. */
export function vampEdgeLook(): string | null {
  return useVizStore.getState().vizEdgeOverlay !== null ? useStore.getState().desktop.light.look : null
}

export function useVampEdgeLook(): string | null {
  const on = useVizStore((s) => s.vizEdgeOverlay !== null)
  const look = useStore((s) => s.desktop.light.look)
  return on ? look : null
}
