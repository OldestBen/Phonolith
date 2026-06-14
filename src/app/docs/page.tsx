'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

// ─── Helper components ───────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-8">
      <h2 className="text-text-primary text-2xl font-bold mb-6 pb-3 border-b border-border">{title}</h2>
      {children}
    </section>
  )
}

function SubSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-8 scroll-mt-8">
      <h3 className="text-text-primary text-lg font-semibold mb-3">{title}</h3>
      <div className="text-text-muted text-sm leading-relaxed space-y-3">{children}</div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-sm">
      <span className="text-accent font-semibold">Tip: </span>
      <span className="text-text-primary">{children}</span>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 border border-border rounded-lg px-4 py-3 text-sm">
      <span className="text-text-muted font-semibold">Note: </span>
      <span className="text-text-muted">{children}</span>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-warning/10 border border-warning/20 rounded-lg px-4 py-3 text-sm">
      <span className="text-warning font-semibold">Warning: </span>
      <span className="text-text-primary">{children}</span>
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-background border border-border rounded-lg p-4 text-xs font-mono text-text-primary overflow-x-auto">
      <code>{children}</code>
    </pre>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left text-text-muted text-xs uppercase tracking-wider py-2 px-3 border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-2 px-3 text-text-primary">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── TOC data ────────────────────────────────────────────────────────────────

const TOC = [
  {
    id: 'getting-started', label: 'Getting Started', children: [
      { id: 'what-is-phonolith', label: 'What is Phonolith?' },
      { id: 'requirements', label: 'Requirements' },
      { id: 'quick-start', label: 'Quick Start' },
      { id: 'first-steps', label: 'First Steps' },
    ]
  },
  {
    id: 'search', label: 'Search & Discovery', children: [
      { id: 'how-search-works', label: 'How Search Works' },
      { id: 'artist-pages', label: 'Artist Pages' },
      { id: 'song-pages', label: 'Song Pages' },
    ]
  },
  {
    id: 'visualization', label: 'Visualization', children: [
      { id: 'galaxy-view', label: 'Galaxy View' },
      { id: 'viz-navigation', label: 'Navigation' },
      { id: 'connection-types', label: 'Connection Types' },
      { id: 'timeline-view', label: 'Timeline View' },
      { id: 'viz-controls', label: 'VizControls Panel' },
    ]
  },
  {
    id: 'library', label: 'Library', children: [
      { id: 'audio-formats', label: 'Supported Formats' },
      { id: 'adding-sources', label: 'Adding Sources' },
      { id: 'smb-setup', label: 'SMB Setup' },
      { id: 'analysis-pipeline', label: 'Analysis Pipeline' },
      { id: 'dr-score', label: 'DR Score' },
      { id: 'watcher', label: 'Auto-watcher' },
    ]
  },
  {
    id: 'history', label: 'History & Tags', children: [
      { id: 'history-tracking', label: 'History Tracking' },
      { id: 'echograph', label: 'EchoGraph' },
      { id: 'tags', label: 'Tags' },
    ]
  },
  {
    id: 'settings', label: 'Settings', children: [
      { id: 'api-keys', label: 'API Keys' },
      { id: 's3-backup', label: 'S3 Backup' },
      { id: 'ports', label: 'Port Configuration' },
    ]
  },
  {
    id: 'services', label: 'Services Reference', children: [
      { id: 'service-app', label: 'app (Next.js)' },
      { id: 'service-db', label: 'db (PostgreSQL)' },
      { id: 'service-redis', label: 'redis' },
      { id: 'service-analyst', label: 'analyst (Python)' },
    ]
  },
  { id: 'troubleshooting', label: 'Troubleshooting', children: [] },
]

// Flat list of all section IDs for IntersectionObserver
const ALL_IDS = TOC.flatMap(section => [
  section.id,
  ...section.children.map(c => c.id),
])

// ─── Page component ───────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>('getting-started')

  useEffect(() => {
    const observers: IntersectionObserver[] = []

    ALL_IDS.forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      const observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) setActiveId(id)
          })
        },
        { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
      )
      observer.observe(el)
      observers.push(observer)
    })

    return () => observers.forEach(o => o.disconnect())
  }, [])

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Sticky TOC sidebar ── */}
      <aside className="w-64 shrink-0 fixed top-0 left-16 h-screen overflow-y-auto border-r border-border bg-surface z-40 hidden md:block">
        <div className="px-4 py-6">
          <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-5">Documentation</p>
          <nav className="space-y-1">
            {TOC.map(section => (
              <div key={section.id}>
                {/* Top-level section link */}
                <a
                  href={`#${section.id}`}
                  className={`block text-sm py-1.5 px-2 rounded transition-colors duration-100 font-medium ${
                    activeId === section.id
                      ? 'text-accent bg-accent/10'
                      : 'text-text-primary hover:text-accent hover:bg-accent/5'
                  }`}
                >
                  {section.label}
                </a>
                {/* Child links */}
                {section.children.length > 0 && (
                  <div className="ml-3 border-l border-border/60 pl-3 mt-0.5 mb-1 space-y-0.5">
                    {section.children.map(child => (
                      <a
                        key={child.id}
                        href={`#${child.id}`}
                        className={`block text-xs py-1 px-1.5 rounded transition-colors duration-100 ${
                          activeId === child.id
                            ? 'text-accent bg-accent/10'
                            : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                        }`}
                      >
                        {child.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="md:ml-80 pl-8 pr-8 pt-12 pb-24 max-w-4xl w-full">
        <div className="mb-12">
          <h1 className="text-text-primary text-3xl font-bold mb-2">Phonolith Documentation</h1>
          <p className="text-text-muted text-base">
            Everything you need to set up, configure, and get the most out of Phonolith — your self-hosted command centre for music.
          </p>
        </div>

        {/* ── 1. Getting Started ── */}
        <Section id="getting-started" title="Getting Started">
          <SubSection id="what-is-phonolith" title="What is Phonolith?">
            <p>
              Phonolith is a self-hosted platform for exploring music, analysing your local audio library, and tracking your listening habits over time. It runs entirely on your own hardware using Docker — your data never leaves your machine.
            </p>
            <p>
              At its core, Phonolith combines two things: rich music metadata and lyrics sourced from Genius.com, and deep technical analysis of your local audio files. Think of it as a personal music knowledge base crossed with an audiophile analysis tool.
            </p>
            <p>Key capabilities at a glance:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Search Genius.com for any artist and browse their full discography</li>
              <li>Read lyrics, production credits, and editorial annotations for any song</li>
              <li>Visualise an artist&apos;s catalogue as an interactive force-directed galaxy</li>
              <li>Index local music files (FLAC, MP3, WAV, and more) with full audio analysis</li>
              <li>Connect to network shares (SMB, NFS, iSCSI) to analyse music on a NAS</li>
              <li>Track which songs you&apos;ve read lyrics for, with weekly EchoGraph charts</li>
              <li>Apply colour-coded tags to songs and filter visualisations by tag</li>
            </ul>
            <Note>
              Phonolith requires a free Genius API key to fetch lyrics and metadata. Everything else — storage, analysis, history — runs locally with no external dependencies.
            </Note>
          </SubSection>

          <SubSection id="requirements" title="Requirements">
            <p>Before you install Phonolith, make sure you have the following:</p>
            <Table
              headers={['Requirement', 'Details']}
              rows={[
                ['Docker Desktop (Mac/Windows) or Docker Engine (Linux)', 'Version 24+ recommended. Docker Compose V2 is required (included with Docker Desktop).'],
                ['Genius API key', 'Free account at genius.com/api-clients. Create an API Client and copy the Client Access Token.'],
                ['2 GB RAM minimum', 'The analyst container uses ffmpeg and numpy for audio processing. 4 GB+ recommended for large libraries.'],
                ['1 GB disk space (base install)', 'Add ~500 KB per audio file analysed (waveform PNG + DB row). Library files themselves are not copied.'],
                ['Network share access (optional)', 'SMB/NFS/iSCSI shares must be reachable from the Docker host. SMB requires TCP port 445 open on the NAS.'],
              ]}
            />
            <Tip>
              On Linux, ensure your user is in the <code className="font-mono bg-surface-2 px-1 rounded">docker</code> group so you can run Docker commands without <code className="font-mono bg-surface-2 px-1 rounded">sudo</code>.
            </Tip>
          </SubSection>

          <SubSection id="quick-start" title="Quick Start">
            <p>Clone the repository, configure your environment, and start the stack:</p>
            <CodeBlock>{`git clone https://github.com/OldestBen/Phonolith
cd Phonolith
cp .env.example .env`}</CodeBlock>
            <p>Open <code className="font-mono bg-surface-2 px-1 rounded">.env</code> in your editor and set your Genius access token:</p>
            <CodeBlock>{`# Required
GENIUS_ACCESS_TOKEN=your_token_here

# Optional — only needed if you want to expose the DB/Redis to your host
# DB_PORT=5432
# REDIS_PORT=6379`}</CodeBlock>
            <p>Start all four services:</p>
            <CodeBlock>{`docker compose up --build`}</CodeBlock>
            <p>
              The first build takes 2–4 minutes as Docker pulls base images and installs dependencies. On subsequent starts, <code className="font-mono bg-surface-2 px-1 rounded">docker compose up</code> (without <code className="font-mono bg-surface-2 px-1 rounded">--build</code>) starts in seconds.
            </p>
            <p>Once you see <code className="font-mono bg-surface-2 px-1 rounded">Ready on http://localhost:3000</code> in the logs, open your browser:</p>
            <CodeBlock>{`http://localhost:3000`}</CodeBlock>
            <Note>
              Database migrations run automatically when the app container starts. You do not need to run any migration commands manually.
            </Note>
          </SubSection>

          <SubSection id="first-steps" title="First Steps">
            <p>Here&apos;s a suggested path for your first session with Phonolith:</p>
            <ol className="list-decimal list-inside space-y-2 pl-2">
              <li>Open <strong className="text-text-primary">http://localhost:3000</strong> — you land on the Search page.</li>
              <li>Type an artist name in the search bar and press Enter or click a result card.</li>
              <li>You are taken to the <strong className="text-text-primary">Artist page</strong> — all albums and songs fetched from Genius, grouped by album, newest first.</li>
              <li>Click <strong className="text-text-primary">Visualize</strong> (top-right of the artist page) to open the force-directed galaxy for that artist.</li>
              <li>In the galaxy, drag to pan, scroll to zoom, click a song node to see its details, and double-click an album node to enter focus mode.</li>
              <li>Click any song title (in the artist page or the galaxy detail panel) to open the <strong className="text-text-primary">Song page</strong>.</li>
              <li>On the Song page, click the <strong className="text-text-primary">Lyrics</strong> tab. Lyrics load from Genius and are stored in the database — the next visit is instant.</li>
              <li>Click <strong className="text-text-primary">Download</strong> to save lyrics as a <code className="font-mono bg-surface-2 px-1 rounded">.txt</code> file, or <strong className="text-text-primary">Mark as read</strong> to record a history event.</li>
              <li>Visit <strong className="text-text-primary">Settings → Library Sources</strong> to add a local music folder or network share and start analysing your audio files.</li>
            </ol>
          </SubSection>
        </Section>

        {/* ── 2. Search & Discovery ── */}
        <Section id="search" title="Search & Discovery">
          <SubSection id="how-search-works" title="How Search Works">
            <p>
              When you type in the search bar, Phonolith queries the Genius API in real time and returns artist results ranked by Genius&apos;s own relevance score. Results include the artist&apos;s name, profile image, and follower count.
            </p>
            <p>
              On first visit to an artist&apos;s page, Phonolith fetches their full song catalogue from the Genius API and caches it in PostgreSQL. Subsequent visits load from the local database — typically under 100ms, regardless of how large the catalogue is.
            </p>
            <p>Caching behaviour by resource type:</p>
            <Table
              headers={['Resource', 'Cache location', 'Behaviour']}
              rows={[
                ['Artist search results', 'Redis (in-memory)', '5-minute TTL — fresh searches stay fast without hammering the API'],
                ['Artist metadata', 'PostgreSQL', 'Persists indefinitely — re-fetched only if you manually refresh'],
                ['Song list', 'PostgreSQL', 'Stored on first artist page load; updated when the API returns new songs'],
                ['Lyrics', 'PostgreSQL', 'Fetched once, stored forever; the Lyrics tab loads from DB on repeat visits'],
                ['Credits & annotations', 'PostgreSQL', 'Fetched once per song, then served locally'],
              ]}
            />
            <Tip>
              If an artist has released new music since you last visited, click the refresh icon on their artist page to re-fetch their song list from Genius.
            </Tip>
          </SubSection>

          <SubSection id="artist-pages" title="Artist Pages">
            <p>
              An artist page at <code className="font-mono bg-surface-2 px-1 rounded">/artist/[id]</code> is the main hub for exploring a single artist&apos;s catalogue.
            </p>
            <p>Layout breakdown:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong className="text-text-primary">Hero header</strong>: Full-bleed background from the artist&apos;s Genius profile image, artist name, follower count, and action buttons.</li>
              <li><strong className="text-text-primary">Action buttons</strong>: Visualize (opens the galaxy), Download All Lyrics (bulk-downloads every song&apos;s lyrics as a ZIP), View in Library (jumps to your local files matching this artist).</li>
              <li><strong className="text-text-primary">Album groups</strong>: Songs grouped by album in reverse chronological order (newest album first). Each album section shows the cover art, album title, year, and track count.</li>
              <li><strong className="text-text-primary">Song rows</strong>: Within each album group, songs appear in track order. Each row shows the track number, song title, release date, and any tags you&apos;ve applied.</li>
              <li><strong className="text-text-primary">Right sidebar</strong>: Artist bio sourced from Genius, plus a tag cloud of all tags applied to this artist&apos;s songs.</li>
            </ul>
            <p>
              Click any song title to navigate to its dedicated song page. Click an album cover to open the album&apos;s page on Genius in a new tab.
            </p>
          </SubSection>

          <SubSection id="song-pages" title="Song Pages">
            <p>
              A song page at <code className="font-mono bg-surface-2 px-1 rounded">/song/[id]</code> has four tabs, each covering a different aspect of the song.
            </p>

            <p className="font-medium text-text-primary pt-1">Lyrics tab</p>
            <p>
              The main tab. Shows the song&apos;s artwork and metadata header (title, artist, album, year, duration). Lyrics are displayed in Playfair Display serif for comfortable reading.
            </p>
            <p>Actions available on the Lyrics tab:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong className="text-text-primary">Copy to clipboard</strong>: Copies the full lyrics as plain text.</li>
              <li><strong className="text-text-primary">Download as .txt</strong>: Saves a text file named <code className="font-mono bg-surface-2 px-1 rounded">{`{Artist} - {Title}.txt`}</code> containing the lyrics.</li>
              <li><strong className="text-text-primary">Mark as read</strong>: Records a <code className="font-mono bg-surface-2 px-1 rounded">mark_read</code> history event with the current timestamp. Visible in History.</li>
            </ul>
            <p>
              Loading the Lyrics tab also automatically records a <code className="font-mono bg-surface-2 px-1 rounded">lyrics_read</code> history event, so your EchoGraph chart builds up naturally as you browse.
            </p>

            <p className="font-medium text-text-primary pt-2">About tab</p>
            <p>
              The song&apos;s Genius description — rich prose covering production background, cultural context, and editorial commentary. Sourced from Genius&apos;s editorial team. Not available for all songs.
            </p>

            <p className="font-medium text-text-primary pt-2">Credits tab</p>
            <p>
              A full credits table with role on the left and contributor name(s) on the right. Common roles include: Producer, Featuring, Written By, Recorded At, Mixed By, Mastered By, Vocals, Guitar, Drums, Keyboards, and more. Click a contributor name to trigger a search for that person.
            </p>

            <p className="font-medium text-text-primary pt-2">Annotations tab</p>
            <p>
              The song lyrics with Genius annotations inline. Highlighted phrases expand when clicked to reveal the annotation text — these come directly from Genius&apos;s community and editorial contributors.
            </p>
            <p>
              At the bottom of the Annotations tab is a text input for adding your own annotations. Enter a lyric phrase and your note, then click Save. User annotations are stored locally in your PostgreSQL database and are never sent to Genius.
            </p>
          </SubSection>
        </Section>

        {/* ── 3. Visualization ── */}
        <Section id="visualization" title="Visualization">
          <SubSection id="galaxy-view" title="Galaxy View">
            <p>
              The galaxy is a force-directed canvas simulation that renders an artist&apos;s entire catalogue as a spatial map of interconnected nodes. It is accessed from any artist page via the <strong className="text-text-primary">Visualize</strong> button, or directly via the Visualize icon in the sidebar (which re-opens the last artist you visualised).
            </p>
            <p>Node types in the galaxy:</p>
            <Table
              headers={['Node type', 'Visual', 'Represents']}
              rows={[
                ['Album node', 'Large white circle with album label below', 'One per album — anchors the songs in that album'],
                ['Song node', 'Smaller violet circle', 'Individual songs, spring-connected to their album node'],
                ['Stars', 'Static white dots in the background', 'Decorative background stars for depth and atmosphere'],
              ]}
            />
            <p>
              When the galaxy first loads, the physics simulation runs for 200 ticks before the canvas is shown. This pre-computation ensures the layout has already settled into a stable configuration — you never see nodes flying around when the view appears.
            </p>
            <p>
              Album nodes repel each other via a charge force and are pulled toward the centre by a weak gravity. Song nodes are spring-connected to their album node (link force) and repel other song nodes. The result is a layout where each album occupies its own region of the canvas, with songs fanning out around it.
            </p>
          </SubSection>

          <SubSection id="viz-navigation" title="Navigation">
            <Table
              headers={['Action', 'Result']}
              rows={[
                ['Scroll wheel', 'Zoom in/out — scale range 0.3× (zoomed out) to 3× (zoomed in)'],
                ['Click and drag background', 'Pan the canvas in any direction'],
                ['Click a song node', 'Opens the song detail panel at the bottom of the screen, showing title, album, year, and tags'],
                ['Double-click an album node', 'Enters focus mode: all other album and song nodes fade to 5% opacity, and the selected album\'s songs expand into a radial fan for easy reading'],
                ['Click an album label', 'Same as double-clicking the album node — selects the album and enters focus mode'],
                ['Press Escape', 'Exits focus mode and deselects any selected node, returning all nodes to full opacity'],
                ['Click song title in detail panel', 'Navigates to that song\'s page'],
              ]}
            />
            <Tip>
              If you have a large catalogue (500+ songs), zoom in first to find the album you want, then double-click its node to enter focus mode. The radial fan makes individual song titles readable even in dense discographies.
            </Tip>
          </SubSection>

          <SubSection id="connection-types" title="Connection Types">
            <p>
              Phonolith can draw additional connection lines between song nodes based on shared attributes. These are called spider-web connections. Enable or disable each type using the checkboxes in the VizControls panel on the left side of the visualization page.
            </p>
            <Table
              headers={['Connection type', 'Colour', 'What it means']}
              rows={[
                ['Album', 'White dashed (#ffffff)', 'Default — always visible. Lines from each song node to its album node.'],
                ['Collaborator', 'Blue (#3b82f6)', 'Two songs that feature the same credited artist (from the Credits tab).'],
                ['Producer', 'Amber (#f59e0b)', 'Two songs produced by the same person.'],
                ['Era', 'Green (#34d399)', 'Two songs released within 2 years of each other, across different albums.'],
              ]}
            />
            <p>
              Connection data is pre-computed server-side when the visualization first loads and cached in Redis for one hour. For artists with large catalogues, this computation may take a moment on first load — subsequent loads within the hour are instant.
            </p>
            <Note>
              Collaborator and Producer connections require that the song&apos;s Credits tab has been loaded at least once (so the credits are stored in the database). Songs without cached credits will not appear in these connection sets.
            </Note>
          </SubSection>

          <SubSection id="timeline-view" title="Timeline View">
            <p>
              Toggle between Galaxy and Timeline using the button in the top-right corner of the visualization panel. The timeline offers a chronological view of an artist&apos;s output.
            </p>
            <p>Timeline layout:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong className="text-text-primary">X axis</strong>: Year, auto-ranged to the artist&apos;s career span (earliest to latest release).</li>
              <li><strong className="text-text-primary">Y axis</strong>: Album swim-lanes — one horizontal row per album, labelled on the left with the album title.</li>
              <li><strong className="text-text-primary">Song dots</strong>: Each song appears as a dot in its album&apos;s swim-lane, positioned at its release year. Dot size is proportional to the song&apos;s Genius pageview count — popular songs appear as larger dots.</li>
            </ul>
            <p>
              Click any dot to open the same song detail panel used in the galaxy view. The timeline is useful for spotting prolific periods in an artist&apos;s career and identifying which songs became the most popular.
            </p>
          </SubSection>

          <SubSection id="viz-controls" title="VizControls Panel">
            <p>
              The VizControls panel sits on the left side of the visualization page and provides controls for filtering and customising the view.
            </p>
            <p>Controls available:</p>
            <Table
              headers={['Control', 'Description']}
              rows={[
                ['Collaborator toggle', 'Show/hide blue connection lines between songs featuring the same artist'],
                ['Producer toggle', 'Show/hide amber connection lines between songs with the same producer'],
                ['Era toggle', 'Show/hide green connection lines between songs released within 2 years of each other'],
                ['Albums dropdown', 'Filter the galaxy to show only one album\'s songs (others fade). Useful for dense discographies.'],
                ['Decade dropdown', 'Fade out songs outside the selected decade, keeping only the relevant era visible'],
                ['Tag dropdown', 'Highlight songs that have a specific tag applied — untagged songs fade to low opacity'],
                ['Galaxy / Timeline toggle', 'Switch between the force-directed galaxy view and the chronological timeline view'],
              ]}
            />
          </SubSection>
        </Section>

        {/* ── 4. Library ── */}
        <Section id="library" title="Library">
          <SubSection id="audio-formats" title="Supported Audio Formats">
            <p>The analyst container can index and analyse the following audio formats:</p>
            <Table
              headers={['Format', 'Extension(s)', 'Notes']}
              rows={[
                ['FLAC', '.flac', 'Lossless. Full DR analysis and waveform rendering supported.'],
                ['MP3', '.mp3', 'Lossy. DR analysis reflects encoded dynamic range.'],
                ['AAC / M4A', '.aac, .m4a', 'Lossy. Common for iTunes and Apple Music downloads.'],
                ['OGG Vorbis', '.ogg', 'Lossy. Open format used by Spotify offline files and some Linux players.'],
                ['WAV', '.wav', 'Lossless uncompressed. Large files; full analysis supported.'],
                ['AIFF', '.aiff', 'Lossless uncompressed. Common on macOS and in professional workflows.'],
                ['WavPack', '.wv', 'Lossless. High-quality archival format; less common but fully supported.'],
                ['Monkey\'s Audio', '.ape', 'Lossless. Older lossless format; analysis supported.'],
                ['Opus', '.opus', 'Lossy. Modern efficient codec; common for streaming archives.'],
              ]}
            />
            <p>Files with other extensions (e.g. <code className="font-mono bg-surface-2 px-1 rounded">.pdf</code>, <code className="font-mono bg-surface-2 px-1 rounded">.jpg</code>, <code className="font-mono bg-surface-2 px-1 rounded">.cue</code>) are silently skipped during scanning.</p>
          </SubSection>

          <SubSection id="adding-sources" title="Adding Library Sources">
            <p>
              Go to <strong className="text-text-primary">Settings → Library Sources</strong> and click <strong className="text-text-primary">+ Add Source</strong>. A modal appears with four source type options:
            </p>
            <Table
              headers={['Source type', 'Best for']}
              rows={[
                ['Local Path', 'Music stored on the same machine running Docker. The ./music folder in the project root is mounted at /music inside the analyst container by default.'],
                ['SMB / Samba', 'Windows file shares or NAS devices (Synology, QNAP, TrueNAS). Credentials are entered in the modal and stored in the local database.'],
                ['NFS', 'Unix/Linux network shares. Mount the NFS share on your host first, then Docker Desktop can see the mount point.'],
                ['iSCSI', 'Block-level network storage. Mount at the OS level first, then add the resulting path as a Local Path source.'],
              ]}
            />
            <p>
              After saving a source, it appears in the source list with <strong className="text-text-primary">Test</strong> and <strong className="text-text-primary">Scan</strong> buttons. Click <strong className="text-text-primary">Test</strong> first to verify the source is reachable and readable, then click <strong className="text-text-primary">Scan</strong> to begin indexing.
            </p>
            <Note>
              Phonolith never copies or modifies your audio files. The analyst reads files in place (for local paths) or downloads them to a temporary location (for SMB), analyses them, and immediately deletes the temp file.
            </Note>
          </SubSection>

          <SubSection id="smb-setup" title="SMB Setup">
            <p>Step-by-step guide for connecting to an SMB / Samba share:</p>
            <ol className="list-decimal list-inside space-y-2 pl-2">
              <li>In the Add Source modal, select <strong className="text-text-primary">SMB / Samba</strong>.</li>
              <li>
                Paste a UNC path to auto-fill the fields:
                <CodeBlock>{`\\\\192.168.1.10\\Music\\FLAC`}</CodeBlock>
                Or fill in the fields manually:
                <Table
                  headers={['Field', 'Example', 'Description']}
                  rows={[
                    ['Host / IP', '192.168.1.10', 'Your NAS hostname or IP address'],
                    ['Share Name', 'Music', 'The top-level SMB share name, without backslashes'],
                    ['Username', 'admin', 'SMB user with read access to the share'],
                    ['Password', '••••••••', 'Stored encrypted in your local PostgreSQL database'],
                    ['Domain', '(leave blank)', 'Only needed for Windows Active Directory environments'],
                    ['Subfolder', 'FLAC/Albums', 'Optional — scan only a subdirectory within the share'],
                  ]}
                />
              </li>
              <li>Click <strong className="text-text-primary">Ping {'{host}'}</strong> to verify that TCP port 445 is reachable from inside the analyst container. This tests network connectivity before you save the source.</li>
              <li>Click <strong className="text-text-primary">Save Source</strong>.</li>
              <li>In the source list, click <strong className="text-text-primary">Test</strong> to verify SMB authentication and confirm the share is accessible.</li>
              <li>Click <strong className="text-text-primary">Scan</strong> to begin indexing. Progress is shown in the Notifications bell (top-right of the app).</li>
            </ol>
            <Warning>
              For SMB sources, the analyst downloads each audio file from the share to a temporary location, analyses it, and then deletes the temporary file. Your NAS files are never modified. However, scanning a large library over a slow network will take time proportional to total library size.
            </Warning>
          </SubSection>

          <SubSection id="analysis-pipeline" title="Analysis Pipeline">
            <p>
              When a file is scanned, the analyst runs these seven steps in order. All results are sent to the Next.js app&apos;s <code className="font-mono bg-surface-2 px-1 rounded">/api/library/ingest</code> route and stored in the <code className="font-mono bg-surface-2 px-1 rounded">library_files</code> table.
            </p>
            <Table
              headers={['Step', 'Tool / method', 'Output']}
              rows={[
                ['1. BLAKE3 hash', 'blake3 Python library', 'A unique content fingerprint. If you move a file, Phonolith recognises it by content, not path — no duplicate records.'],
                ['2. Tag extraction', 'Mutagen', 'Title, artist, album, year, track number, bitrate, sample rate, duration, and any other embedded ID3/Vorbis tags.'],
                ['3. DR score', 'Custom crest-factor analysis', 'Dynamic range in dB — the ratio of peak amplitude to RMS amplitude. See DR Score section for interpretation.'],
                ['4. Upscale detection', 'FFT spectral analysis', 'Compares energy above 18 kHz to energy in 1–18 kHz band. A very low ratio flags the file as a likely upscale from a lower-resolution source.'],
                ['5. Waveform rendering', 'numpy + PIL', '1200×200px PNG of the audio waveform, saved to the waveforms Docker volume and served at /api/waveforms/{hash}.'],
                ['6. AcoustID fingerprint', 'chromaprint / fpcalc', 'An acoustic fingerprint for matching the recording to MusicBrainz, even if the tags are missing or wrong.'],
                ['7. Ingest', 'POST to /api/library/ingest', 'All data is upserted into a library_files row in PostgreSQL.'],
              ]}
            />
            <p>
              If a file has already been indexed (same BLAKE3 hash), the ingest step updates the existing row rather than creating a duplicate. This makes re-scanning idempotent.
            </p>
          </SubSection>

          <SubSection id="dr-score" title="DR Score Explained">
            <p>
              The DR score is the crest factor of the audio — the ratio of peak amplitude to RMS (average) amplitude, expressed in decibels. A higher DR score means more variation between the loudest and quietest moments in the recording.
            </p>
            <p>
              Dynamic range compression (applied during mastering) reduces the DR score by pushing up the quieter parts and limiting the peaks. This is often done to make tracks sound louder on consumer devices, at the cost of perceived naturalness and listening fatigue on high-quality playback systems.
            </p>
            <Table
              headers={['DR Score', 'Quality label', 'Typical source']}
              rows={[
                ['DR 14+', 'Excellent', 'Classical, jazz, acoustic, audiophile pressings. Very dynamic — quiet passages are genuinely quiet.'],
                ['DR 10–13', 'Good', 'Quality rock and pop from before ~2000, or modern reissues mastered for dynamics.'],
                ['DR 7–9', 'Compressed', 'Typical modern commercial mastering. Still listenable but dynamics are noticeably flattened.'],
                ['DR 5–6', 'Very compressed', 'Loudness-war territory. Fatiguing on extended listening on revealing systems.'],
                ['DR < 5', 'Extreme', 'Heavily clipped or over-limited. Waveform approaches a solid block. Audible distortion on transients.'],
              ]}
            />
            <Tip>
              If your FLAC rip has a DR score close to the MP3 copy of the same album, the FLAC may be a transcoded lossy file (a &quot;FLAC of MP3&quot;). Use the upscale detection flag alongside the DR score to spot these cases.
            </Tip>
          </SubSection>

          <SubSection id="watcher" title="Auto-watcher">
            <p>
              The analyst container runs a filesystem watcher on the <code className="font-mono bg-surface-2 px-1 rounded">/music</code> directory — the default local source mounted from <code className="font-mono bg-surface-2 px-1 rounded">./music</code> in the project root.
            </p>
            <p>Watcher behaviour:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>When a new audio file is added or an existing file is modified, the watcher detects the change.</li>
              <li>It waits 2 seconds for the write to complete and for any burst of file activity to settle (e.g. unzipping an album).</li>
              <li>It then indexes only the changed files — not the entire directory.</li>
              <li>The waveform, DR score, and all other analysis steps run immediately.</li>
              <li>The file appears in your library within a few seconds of being saved to the <code className="font-mono bg-surface-2 px-1 rounded">./music</code> folder.</li>
            </ul>
            <Note>
              Automatic watching is only supported for the default local <code className="font-mono bg-surface-2 px-1 rounded">/music</code> source. SMB and NFS sources do not support real-time watching — use the manual <strong className="text-text-primary">Scan</strong> button in Settings → Library Sources to pick up new files on those shares.
            </Note>
          </SubSection>
        </Section>

        {/* ── 5. History & Tags ── */}
        <Section id="history" title="History & Tags">
          <SubSection id="history-tracking" title="Automatic History Tracking">
            <p>
              Phonolith records history events automatically as you use the app. You do not need to opt in — every lyrics view is tracked by default.
            </p>
            <Table
              headers={['Event type', 'When it fires']}
              rows={[
                ['lyrics_read', 'The Lyrics tab loads for a song (fires once per page load, not on every scroll)'],
                ['lyrics_download', 'You click the Download button on the Lyrics tab'],
                ['mark_read', 'You click the "Mark as read" button on the Lyrics tab'],
              ]}
            />
            <p>
              Each event is stored with: the song ID, artist ID, event type, and a UTC timestamp. Events accumulate indefinitely — there is no automatic pruning. You can view and filter all events on the History page.
            </p>
            <Note>
              History events are stored only in your local PostgreSQL database. Nothing is sent externally. There are no analytics, no telemetry, and no account required.
            </Note>
          </SubSection>

          <SubSection id="echograph" title="EchoGraph">
            <p>
              The History page (<code className="font-mono bg-surface-2 px-1 rounded">/history</code>) shows your listening and reading activity visualised as two charts plus a full event log.
            </p>
            <p>Charts:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>
                <strong className="text-text-primary">Weekly line chart</strong>: Lyrics reads per week over the past 12 weeks. Gives you a sense of how active your music exploration has been over time.
              </li>
              <li>
                <strong className="text-text-primary">Top artists bar chart</strong>: Your top 10 artists by total history events (all types combined). The bar length reflects how many times you&apos;ve read or downloaded lyrics for songs by that artist.
              </li>
            </ul>
            <p>Event log below the charts:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Chronological list of all events, newest first.</li>
              <li>Each row shows: artist name, song title, event type badge, and timestamp.</li>
              <li>Filter by artist name using the search field at the top.</li>
              <li>Filter by event type using the dropdown (lyrics_read / lyrics_download / mark_read).</li>
            </ul>
          </SubSection>

          <SubSection id="tags" title="Tags">
            <p>
              Tags are colour-coded labels you create and apply to songs. They appear on song rows in artist pages, in the song page header, and as a filter option in the visualization&apos;s VizControls panel.
            </p>
            <p>Adding a tag to a song:</p>
            <ol className="list-decimal list-inside space-y-1 pl-2">
              <li>Open any song page.</li>
              <li>Click <strong className="text-text-primary">+ Tag</strong> in the song header area.</li>
              <li>Type a new tag name or select an existing tag from the dropdown.</li>
              <li>The tag is saved immediately and appears on the song row throughout the app.</li>
            </ol>
            <p>Managing tags:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Go to <strong className="text-text-primary">/tags</strong> (the Tags icon in the sidebar) to see all your tags, how many songs each has, and edit or delete them.</li>
              <li>Rename a tag on the Tags page — the rename propagates to all songs that have it.</li>
              <li>Delete a tag to remove it from all songs at once.</li>
              <li>Change a tag&apos;s colour using the colour picker on the Tags page.</li>
            </ul>
            <p>
              Tags are stored in the <code className="font-mono bg-surface-2 px-1 rounded">tags</code> and <code className="font-mono bg-surface-2 px-1 rounded">song_tags</code> tables in PostgreSQL. Changes are reflected immediately across the app — the visualization filter updates within seconds of a new tag being applied.
            </p>
            <Tip>
              Use tags to group songs across artists — for example, &quot;90s hip-hop beats&quot;, &quot;audiophile reference&quot;, or &quot;need to annotate&quot;. The visualization&apos;s tag filter then highlights exactly those songs in the galaxy.
            </Tip>
          </SubSection>
        </Section>

        {/* ── 6. Settings ── */}
        <Section id="settings" title="Settings & Configuration">
          <SubSection id="api-keys" title="API Keys">
            <p>
              All API keys can be configured in two ways. The Settings UI (database method) takes precedence and does not require a container restart:
            </p>
            <Table
              headers={['Method', 'How to set', 'Requires restart?']}
              rows={[
                ['Environment variable', 'Edit .env and run docker compose up --build', 'Yes — the value is baked in at container start'],
                ['Settings UI (database)', 'Settings page → paste key → Save', 'No — takes effect within 60 seconds (Redis TTL)'],
              ]}
            />
            <p>Available API keys:</p>
            <Table
              headers={['Key', 'Required', 'Where to get it']}
              rows={[
                ['GENIUS_ACCESS_TOKEN', 'Yes — without this, search and lyrics will not work', 'genius.com/api-clients → Create an API Client → copy the Client Access Token (not the Client Secret)'],
                ['DISCOGS_USER_TOKEN', 'No — enhances release date data', 'discogs.com/settings/developers → Generate new token'],
                ['ACOUSTID_API_KEY', 'No — used for fingerprint lookups against MusicBrainz', 'acoustid.org/login → register an application → copy the API key'],
              ]}
            />
            <p>
              The <strong className="text-text-primary">Test</strong> button next to each key makes a live request to the relevant API (not the local database) to verify that the key is valid. If the test passes, the key is working. If it fails, the error message will tell you whether the problem is connectivity or an invalid key.
            </p>
          </SubSection>

          <SubSection id="s3-backup" title="S3 Backup">
            <p>
              Phonolith can back up your entire database to an S3 bucket on demand. Configure it in <strong className="text-text-primary">Settings → Backup</strong>:
            </p>
            <Table
              headers={['Field', 'Example', 'Description']}
              rows={[
                ['S3 Bucket', 'my-phonolith-backups', 'The name of an existing S3 bucket. The bucket must exist before the first backup.'],
                ['Region', 'us-east-1', 'The AWS region where the bucket is hosted.'],
                ['Access Key ID', 'AKIA…', 'IAM access key with s3:PutObject permission on the target bucket.'],
                ['Secret Access Key', '••••••••', 'The corresponding IAM secret key. Stored encrypted in your local database.'],
              ]}
            />
            <p>
              Click <strong className="text-text-primary">Backup Now</strong> to run a <code className="font-mono bg-surface-2 px-1 rounded">pg_dump</code> immediately. The backup is uploaded as:
            </p>
            <CodeBlock>{`s3://your-bucket/backups/phonolith-2024-01-15T14:30:00Z.sql`}</CodeBlock>
            <p>To restore from a backup:</p>
            <CodeBlock>{`# Download from S3
aws s3 cp s3://your-bucket/backups/phonolith-TIMESTAMP.sql ./restore.sql

# Restore into the running database
docker compose exec -T db psql -U postgres phonolith < restore.sql`}</CodeBlock>
            <Warning>
              Restoring a backup overwrites all current data in the database. Make a fresh backup before restoring an older one.
            </Warning>
            <Note>
              S3 backup covers the PostgreSQL database only (artists, songs, lyrics, tags, history, library metadata, settings). Waveform PNGs stored in the <code className="font-mono bg-surface-2 px-1 rounded">waveforms</code> Docker volume are not included — they will be regenerated on the next library scan.
            </Note>
          </SubSection>

          <SubSection id="ports" title="Port Configuration">
            <p>
              Default ports are defined in your <code className="font-mono bg-surface-2 px-1 rounded">.env</code> file:
            </p>
            <CodeBlock>{`# Web UI and API
APP_PORT=3000

# Audio analyst sidecar
ANALYST_PORT=8000`}</CodeBlock>
            <p>
              Change either port if something else on your machine is already listening there. The change takes effect on the next <code className="font-mono bg-surface-2 px-1 rounded">docker compose up</code>.
            </p>
            <p>
              By default, the PostgreSQL database and Redis are not exposed to your host — they communicate only between containers on Docker&apos;s internal network. To access them from host tools like TablePlus or redis-cli, uncomment the <code className="font-mono bg-surface-2 px-1 rounded">ports:</code> stanzas in <code className="font-mono bg-surface-2 px-1 rounded">docker-compose.yml</code> and add the corresponding variables to your <code className="font-mono bg-surface-2 px-1 rounded">.env</code>:
            </p>
            <CodeBlock>{`# Expose database to host (for TablePlus, pgAdmin, etc.)
DB_PORT=5432

# Expose Redis to host (for redis-cli)
REDIS_PORT=6379`}</CodeBlock>
            <Warning>
              Exposing the database port on a machine with a public IP is a security risk. Only do this on a trusted local network, or use an SSH tunnel.
            </Warning>
          </SubSection>
        </Section>

        {/* ── 7. Services Reference ── */}
        <Section id="services" title="Services Reference">
          <SubSection id="service-app" title="app — Next.js 14">
            <p>
              The main web application. Serves the React UI and handles all API requests.
            </p>
            <Table
              headers={['Property', 'Value']}
              rows={[
                ['Port', 'APP_PORT (default 3000)'],
                ['Language', 'TypeScript'],
                ['Framework', 'Next.js 14 App Router'],
                ['Image', 'node:20-alpine (built from Dockerfile)'],
              ]}
            />
            <p>Responsibilities:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Serves all pages and client-side React components</li>
              <li>All <code className="font-mono bg-surface-2 px-1 rounded">/api/*</code> routes (artist, song, lyrics, credits, annotations, library, history, tags, settings)</li>
              <li>Genius API integration — search, artist metadata, song data, lyrics, credits, annotations</li>
              <li>MusicBrainz integration — artist MBID lookup and release date enrichment</li>
              <li>Database migrations — run automatically at startup via <code className="font-mono bg-surface-2 px-1 rounded">src/instrumentation.ts</code></li>
              <li>Redis caching layer — wraps all Genius API calls with 5-minute TTL</li>
              <li>Proxies <code className="font-mono bg-surface-2 px-1 rounded">/api/waveforms/:hash</code> to the analyst sidecar</li>
            </ul>
            <p>Key environment variables:</p>
            <CodeBlock>{`GENIUS_ACCESS_TOKEN=   # Required
DATABASE_URL=          # Auto-set by docker-compose
REDIS_URL=             # Auto-set by docker-compose
ANALYST_URL=           # Auto-set by docker-compose (http://analyst:8000)`}</CodeBlock>
          </SubSection>

          <SubSection id="service-db" title="db — PostgreSQL 16">
            <p>
              The primary persistent data store for all Phonolith data.
            </p>
            <Table
              headers={['Property', 'Value']}
              rows={[
                ['Port', '5432 (internal only by default)'],
                ['Image', 'postgres:16-alpine'],
                ['Data volume', 'pgdata (survives container restarts and upgrades)'],
              ]}
            />
            <p>Database tables:</p>
            <Table
              headers={['Table', 'Contents']}
              rows={[
                ['artists', 'Genius artist data: ID, name, profile image URL, description, follower count'],
                ['albums', 'Album metadata: title, cover art URL, release year, track count, artist ID'],
                ['songs', 'Song data: title, release date, Genius pageview count, lyrics URL, album ID, artist ID'],
                ['lyrics', 'Full lyrics text, stored per song ID after first fetch'],
                ['credits', 'Song credits: role (Producer, Written By, etc.) and contributor name, linked to song ID'],
                ['annotations', 'Genius annotations and user-created annotations, linked to song ID and lyric position'],
                ['library_files', 'Audio file analysis results: hash, path, tags, DR score, upscale flag, waveform path, fingerprint'],
                ['library_sources', 'Configured library sources: type (local/SMB/NFS), connection details, credentials'],
                ['tags', 'Tag definitions: name, colour (hex), created_at'],
                ['song_tags', 'Many-to-many join table: song_id ↔ tag_id'],
                ['history', 'History events: song_id, artist_id, event_type, created_at (UTC)'],
                ['app_settings', 'Runtime configuration: API keys, S3 config, other overrideable settings'],
                ['schema_migrations', 'Tracks which migration files have been applied'],
              ]}
            />
          </SubSection>

          <SubSection id="service-redis" title="redis — Redis 7">
            <p>
              In-memory cache layer used for fast API responses and settings lookups.
            </p>
            <Table
              headers={['Property', 'Value']}
              rows={[
                ['Port', '6379 (internal only by default)'],
                ['Image', 'redis:7-alpine'],
                ['Data volume', 'redisdata (persisted — cache survives restarts)'],
              ]}
            />
            <p>What Redis caches:</p>
            <Table
              headers={['Cache key pattern', 'TTL', 'Contents']}
              rows={[
                ['genius:artist:{id}', '5 minutes', 'Genius API response for an artist (songs, metadata)'],
                ['genius:song:{id}', '5 minutes', 'Genius API response for a song detail page'],
                ['viz:connections:{artistId}', '1 hour', 'Pre-computed connection data for the galaxy visualization'],
                ['settings:{key}', '60 seconds', 'Runtime config values from app_settings table'],
              ]}
            />
            <Note>
              Flushing Redis (<code className="font-mono bg-surface-2 px-1 rounded">docker compose exec redis redis-cli FLUSHALL</code>) only clears the cache. All persistent data lives in PostgreSQL and is unaffected. The next request will simply re-fetch from Genius and re-populate the cache.
            </Note>
          </SubSection>

          <SubSection id="service-analyst" title="analyst — Python FastAPI">
            <p>
              The audio analysis sidecar. Handles all file I/O and heavy computation so the Node.js app stays responsive.
            </p>
            <Table
              headers={['Property', 'Value']}
              rows={[
                ['Port', 'ANALYST_PORT (default 8000)'],
                ['Language', 'Python 3.12'],
                ['Framework', 'FastAPI + uvicorn'],
                ['Key libraries', 'mutagen, numpy, Pillow, chromaprint, smbprotocol, blake3, watchdog'],
              ]}
            />
            <p>HTTP API endpoints:</p>
            <Table
              headers={['Endpoint', 'Method', 'Description']}
              rows={[
                ['/health', 'GET', 'Health check — returns 200 OK if the service is running'],
                ['/status', 'GET', 'Current scan status and progress (files scanned, files remaining, errors)'],
                ['/scan', 'POST', 'Scan a local path directly (body: { path: string })'],
                ['/scan-source', 'POST', 'Scan a configured library source by ID (body: { source_id: number })'],
                ['/test-source', 'POST', 'Test connectivity and authentication for a source without indexing'],
                ['/ping', 'POST', 'TCP port reachability test (body: { host: string, port: number })'],
                ['/file/{hash}', 'GET', 'Get the indexed library_file record for a given BLAKE3 hash'],
                ['/fingerprint', 'POST', 'Generate an AcoustID fingerprint for a given file path'],
                ['/waveforms/{hash}', 'GET', 'Serve the waveform PNG for a given BLAKE3 hash'],
              ]}
            />
          </SubSection>
        </Section>

        {/* ── 8. Troubleshooting ── */}
        <Section id="troubleshooting" title="Troubleshooting">
          <div className="space-y-8">

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">&quot;Genius shows connection failed&quot; in Settings</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>Check that <code className="font-mono bg-surface-2 px-1 rounded">GENIUS_ACCESS_TOKEN</code> is set in your <code className="font-mono bg-surface-2 px-1 rounded">.env</code> file and that it contains a valid token (not the Client Secret — you need the Client Access Token).</p>
                <p>Alternatively, paste your token directly in the <strong className="text-text-primary">Settings → Genius Access Token</strong> field and click Save. This takes effect immediately without a restart (within 60 seconds as the settings cache expires).</p>
                <p>To get a token: go to <strong className="text-text-primary">genius.com/api-clients</strong> → Create an API Client → copy the <strong className="text-text-primary">Client Access Token</strong> (the long one, not the short Client ID or Secret).</p>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">&quot;relation X does not exist&quot; errors in logs</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>The database migrations did not run on startup. This sometimes happens if the database container was not yet ready when the app container started.</p>
                <p>Fix: restart the app container to re-run migrations:</p>
                <CodeBlock>{`docker compose restart app`}</CodeBlock>
                <p>Then check the logs for migration errors:</p>
                <CodeBlock>{`docker compose logs app | grep -i migrat`}</CodeBlock>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">SMB source shows &quot;Cannot reach host:445&quot;</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>The analyst container cannot establish a TCP connection to your NAS on port 445. This is a network issue, not a credentials issue.</p>
                <p>Steps to diagnose:</p>
                <ol className="list-decimal list-inside space-y-1 pl-2">
                  <li>Verify the NAS is powered on and SMB is enabled in its admin panel.</li>
                  <li>Use the <strong className="text-text-primary">Ping</strong> button in the Add Source modal — it tests TCP port 445 from inside the analyst container specifically.</li>
                  <li>Check your NAS&apos;s built-in firewall or any network firewall rules blocking port 445.</li>
                  <li>On Windows hosts, check Windows Defender Firewall for rules blocking outbound SMB.</li>
                  <li>Test manually from the analyst container:</li>
                </ol>
                <CodeBlock>{`docker compose exec analyst python3 -c "import socket; socket.create_connection(('YOUR-NAS-IP', 445), 5); print('OK')"`}</CodeBlock>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">SMB source shows &quot;Auth/share error&quot;</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>The analyst can reach port 445, but authentication or share access is failing.</p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>Double-check the username, password, and share name — share names are case-sensitive on some NAS platforms.</li>
                  <li>For Windows shares, try adding the machine name or domain to the <strong className="text-text-primary">Domain</strong> field (e.g. <code className="font-mono bg-surface-2 px-1 rounded">WORKGROUP</code> or <code className="font-mono bg-surface-2 px-1 rounded">DESKTOP-ABC123</code>).</li>
                  <li>For Synology NAS: ensure the user has read permission on the shared folder in the Shared Folder settings, not just user-level permission.</li>
                  <li>For QNAP NAS: check that SMB 2.0+ is enabled — some older firmware defaults to SMB 1.0 which is not supported.</li>
                  <li>Try the <strong className="text-text-primary">Test</strong> button in the source list after saving — it gives a more specific error message than the Ping check.</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">Docker mount denied for <code className="font-mono">/music</code> or <code className="font-mono">/Volumes/…</code></h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>Docker Desktop requires explicit permission to access directories outside its default allowed paths.</p>
                <p>Fix: In <strong className="text-text-primary">Docker Desktop → Settings → Resources → File Sharing</strong>, add the directory you want to mount and click Apply.</p>
                <p>Alternatively, the simplest option for local music is to put your files inside the <code className="font-mono bg-surface-2 px-1 rounded">./music</code> folder in the Phonolith project root. This directory is always mounted inside the analyst container at <code className="font-mono bg-surface-2 px-1 rounded">/music</code> and does not require any File Sharing configuration.</p>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">Artist or song page shows empty or keeps loading</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>Open browser DevTools (F12) → Network tab and look for failing requests to <code className="font-mono bg-surface-2 px-1 rounded">/api/artist/[id]</code>, <code className="font-mono bg-surface-2 px-1 rounded">/api/song/[id]</code>, or <code className="font-mono bg-surface-2 px-1 rounded">/api/lyrics/[id]</code>.</p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>A <strong className="text-text-primary">429 response</strong> means you have hit the Genius API rate limit. Wait 60 seconds and try again.</li>
                  <li>A <strong className="text-text-primary">401 response</strong> means your Genius token is invalid — re-check it in Settings.</li>
                  <li>A <strong className="text-text-primary">500 response</strong> means a server error — check <code className="font-mono bg-surface-2 px-1 rounded">docker compose logs app</code> for the full stack trace.</li>
                </ul>
                <CodeBlock>{`docker compose logs app --tail 50`}</CodeBlock>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">Analyst shows &quot;offline&quot; in Settings</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>The app cannot reach the analyst container&apos;s health endpoint at <code className="font-mono bg-surface-2 px-1 rounded">http://analyst:8000/health</code>.</p>
                <ol className="list-decimal list-inside space-y-1 pl-2">
                  <li>Check if the analyst container is running: <CodeBlock>{`docker compose ps`}</CodeBlock></li>
                  <li>If it is not running or shows &quot;Exit&quot;, check its logs for startup errors: <CodeBlock>{`docker compose logs analyst`}</CodeBlock></li>
                  <li>Common startup failure: a Python dependency failed to install during the image build. Rebuild the image: <CodeBlock>{`docker compose build analyst && docker compose up analyst -d`}</CodeBlock></li>
                  <li>If the container is running but the app still shows offline, try restarting both: <CodeBlock>{`docker compose restart analyst app`}</CodeBlock></li>
                </ol>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">Waveforms not appearing in the Library</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>Waveform PNGs are generated by the analyst during the file indexing pipeline — they do not exist until a scan has been run for that file.</p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>Ensure you have run a <strong className="text-text-primary">Scan</strong> for the library source containing the file.</li>
                  <li>Verify the <code className="font-mono bg-surface-2 px-1 rounded">waveforms</code> Docker volume exists: <CodeBlock>{`docker volume ls | grep waveforms`}</CodeBlock></li>
                  <li>Verify the analyst is online (Settings → analyst status indicator).</li>
                  <li>If a waveform is missing for an already-indexed file, re-scan the source to regenerate it. The BLAKE3 hash check ensures re-scanning does not create duplicate records.</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-text-primary text-base font-semibold mb-2">Library scan takes very long for an SMB source</h3>
              <div className="text-text-muted text-sm leading-relaxed space-y-2">
                <p>SMB scanning works by downloading each audio file from the share to a temporary location on the analyst container, running the full analysis pipeline, then deleting the temporary file. On a slow network or a large library, this takes time.</p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>The <strong className="text-text-primary">Notifications bell</strong> (top-right of the app) shows real-time scan progress — files processed, files remaining, and any errors.</li>
                  <li>You can safely navigate around the app while a scan is running in the background.</li>
                  <li>Only supported audio formats are processed (FLAC, MP3, AAC, M4A, OGG, WAV, AIFF, WV, APE, OPUS). Other file types are counted but skipped immediately, so they do not slow the scan.</li>
                  <li>Once indexed, re-scanning is much faster — the BLAKE3 hash is checked first, and files that have not changed are skipped within milliseconds.</li>
                  <li>For very large libraries (&gt;10,000 files), consider scanning a subfolder at a time using the <strong className="text-text-primary">Subfolder</strong> field in the source configuration.</li>
                </ul>
              </div>
            </div>

          </div>
        </Section>
      </main>
    </div>
  )
}
