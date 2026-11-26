import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { Pre, Table } from './shared'
import { DocsSearchContext, type DocsSearchValue } from './searchContext'
import { usePrimitives } from './primitivesContext'

// ─── Tab content ──────────────────────────────────────────────────────────────
// The site's docs: how the catalogue is built from the Playboi Carti Tracker
// sheet and where each song's audio comes from. Desktop and mobile both render
// this, supplying their own Code/Section primitives.

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4/htmlview'
const SITE_BASE = new URL(import.meta.env.BASE_URL || '/', location.origin).href

function OverviewTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="What this is">
        <p className="text-sm text-text-secondary leading-relaxed">
          A Playboi Carti player and tracker. Every song comes from the Playboi Carti Tracker spreadsheet -
          released, unreleased and unsurfaced - grouped by era, searchable, and playable wherever a file
          or stream exists.
        </p>
        <a
          href={SHEET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline mt-2"
        >
          Open the tracker sheet <ExternalLink size={11} />
        </a>
      </Section>

      <Section title="Categories">
        <Table
          headers={['Category', 'Meaning']}
          rows={[
            ['Released', 'Out officially - singles, albums, features, videos.'],
            ['Unreleased', 'Leaked or previewed: full songs, snippets, OG files.'],
            ['Unsurfaced', 'Known to exist (confirmed or rumored) but never leaked. Nothing to play yet.'],
          ]}
        />
      </Section>

      <Section title="Updates">
        <p className="text-sm text-text-secondary leading-relaxed">
          The site rebuilds from the sheet every 6 hours, so new leaks and edits show up on their own. The catalogue
          files live at <Code>{`${SITE_BASE}carti/songs.json`}</Code> and <Code>{`${SITE_BASE}carti/eras.json`}</Code>.
        </p>
      </Section>
    </div>
  )
}

function PlaybackTab() {
  const { Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Where the audio comes from">
        <p className="text-sm text-text-secondary leading-relaxed mb-3">
          Each song plays from the first of these that has it:
        </p>
        <Table
          headers={['Source', 'How it plays']}
          rows={[
            ['The song\'s own pillows.su or imgur.gg link', 'Streams straight into the player, with the equalizer, crossfade and lyrics views.'],
            ['The same song in another tab of the sheet (Recent, OG Snippets, Misc, Stems, Edits…)', 'Same as above. The song\'s info says which tab it came from.'],
            ['A YouTube, SoundCloud or Spotify link', 'Plays in that site\'s own player in a small card. Play, pause, seek and skip still work from the app\'s controls.'],
          ]}
        />
      </Section>

      <Section title="Lyrics">
        <p className="text-sm text-text-secondary leading-relaxed">
          The tracker has no lyrics, so when a song starts the player looks it up on LRCLIB, a free public lyrics
          database. A match needs the same title, artist and length, so mostly released songs get lyrics - usually
          timed line by line. Unreleased songs are rarely there.
        </p>
      </Section>

      <Section title="Spotify songs">
        <p className="text-sm text-text-secondary leading-relaxed">
          Spotify's player can't be started from outside, so press play in its card. Without a Spotify login in this
          browser it plays a 30-second preview.
        </p>
      </Section>

      <Section title="Can't play">
        <p className="text-sm text-text-secondary leading-relaxed">
          Unsurfaced songs have never leaked, so there is no audio for them anywhere yet. They're listed so the
          catalogue is complete and they'll become playable when the sheet gets a link.
        </p>
      </Section>
    </div>
  )
}

function DataTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Song fields">
        <Table
          headers={['Field', 'From the sheet']}
          rows={[
            [<Code key="n">name</Code>, 'First line of the Name column; feat./prod. credits are split out.'],
            [<Code key="e">era</Code>, 'The era section the song sits under.'],
            [<Code key="l">length</Code>, 'Track Length.'],
            [<Code key="d">date_leaked</Code>, 'Leak Date (released songs: Release Date).'],
            [<Code key="r">record_dates</Code>, 'File Date.'],
            [<Code key="q">bitrate</Code>, 'Quality.'],
            [<Code key="i">additional_information</Code>, 'Type, available length, quality, and every link in the row.'],
          ]}
        />
      </Section>

      <Section title="Example">
        <Pre>{`{
  "name": "Lil Chay is a bitch",
  "era": { "name": "Aviation Class" },
  "category": "unreleased",
  "length": "0:25",
  "producers": "JCee",
  "path": "https://api.pillows.su/api/download/…"
}`}</Pre>
      </Section>
    </div>
  )
}

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'playback', label: 'Playback' },
  { id: 'data',     label: 'Data' },
] as const

export type TabId = typeof TABS[number]['id']

const TAB_CONTENT: Record<TabId, () => JSX.Element> = {
  overview: OverviewTab,
  playback: PlaybackTab,
  data:     DataTab,
}

// One tab's worth of content. Kept mounted even when hidden so its Sections
// stay registered with the search index.
export function TabPanel({ tab, query, register, visible, showLabel }: {
  tab: typeof TABS[number]
  query: string
  register: DocsSearchValue['register']
  visible: boolean
  showLabel: boolean
}): JSX.Element {
  const ctx = useMemo(() => ({ query, tab: tab.id, register }), [query, tab.id, register])
  const Content = TAB_CONTENT[tab.id]
  return (
    <div id={`docs-panel-${tab.id}`} hidden={!visible}>
      <DocsSearchContext.Provider value={ctx}>
        {showLabel && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3 mt-2">{tab.label}</p>
        )}
        <Content />
      </DocsSearchContext.Provider>
    </div>
  )
}
