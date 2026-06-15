'use client'

import { useState, useEffect } from 'react'

// ─── Helper components ────────────────────────────────────────────────────────

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

function SubSubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="text-text-primary text-sm font-semibold mb-2">{title}</h4>
      <div className="text-text-muted text-sm leading-relaxed space-y-2">{children}</div>
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
    <pre className="bg-background border border-border rounded-lg p-4 text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap">
      <code>{children}</code>
    </pre>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
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

function StatusBadge({ status }: { status: 'implemented' | 'partial' | 'planned' }) {
  const cfg = {
    implemented: 'bg-success/15 text-success border-success/30',
    partial:     'bg-warning/15 text-warning border-warning/30',
    planned:     'bg-surface-2 text-text-muted border-border',
  }
  const label = { implemented: 'Implemented', partial: 'Partial', planned: 'Planned' }
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${cfg[status]}`}>
      {label[status]}
    </span>
  )
}

function SubsystemCard({
  name, layer, status, role, children,
}: {
  name: string
  layer: string
  status: 'implemented' | 'partial' | 'planned'
  role: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface-2 border border-border rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-text-primary font-bold text-base">{name}</span>
            <span className="text-text-muted text-xs border border-border rounded px-1.5 py-0.5">{layer}</span>
          </div>
          <p className="text-text-muted text-xs">{role}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="text-text-muted text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

// ─── TOC data ─────────────────────────────────────────────────────────────────

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
    id: 'architecture', label: 'Architecture', children: [
      { id: 'arch-overview', label: 'Overview' },
      { id: 'arch-layers', label: 'Layer Model' },
      { id: 'arch-data-flow', label: 'Data Flow' },
      { id: 'arch-docker', label: 'Docker Services' },
    ]
  },
  {
    id: 'subsystems', label: 'Subsystems', children: [
      { id: 'resonancefs', label: 'ResonanceFS' },
      { id: 'tremor', label: 'Tremor' },
      { id: 'engram', label: 'Engram' },
      { id: 'lexicon', label: 'Lexicon' },
      { id: 'prism', label: 'Prism' },
      { id: 'crest', label: 'Crest' },
      { id: 'aegis', label: 'Aegis' },
      { id: 'bit-forge', label: 'Bit-Forge' },
      { id: 'lucid', label: 'Lucid' },
      { id: 'flux', label: 'Flux' },
      { id: 'echograph', label: 'EchoGraph' },
      { id: 'cathode', label: 'Cathode' },
      { id: 'polyphony', label: 'Polyphony' },
      { id: 'sonic-codex', label: 'Sonic Codex' },
    ]
  },
  {
    id: 'library', label: 'Library', children: [
      { id: 'supported-formats', label: 'Supported Formats' },
      { id: 'adding-sources', label: 'Adding Sources' },
      { id: 'smb-setup', label: 'SMB / NAS Setup' },
      { id: 'scan-pipeline', label: 'Scan Pipeline' },
      { id: 'deep-analysis', label: 'Deep Analysis' },
      { id: 'watcher', label: 'Auto-watcher' },
    ]
  },
  {
    id: 'search', label: 'Search & Discovery', children: [
      { id: 'how-search-works', label: 'How Search Works' },
      { id: 'artist-pages', label: 'Artist Pages' },
      { id: 'song-pages', label: 'Song Pages' },
      { id: 'lyrics', label: 'Lyrics' },
      { id: 'credits', label: 'Credits & Annotations' },
    ]
  },
  {
    id: 'visualization', label: 'Visualization', children: [
      { id: 'galaxy-view', label: 'Galaxy View' },
      { id: 'viz-navigation', label: 'Navigation' },
      { id: 'connection-types', label: 'Connection Types' },
      { id: 'viz-controls', label: 'VizControls Panel' },
    ]
  },
  {
    id: 'history-tags', label: 'History & Tags', children: [
      { id: 'history-tracking', label: 'History Tracking' },
      { id: 'tags', label: 'Tags' },
    ]
  },
  {
    id: 'settings', label: 'Settings', children: [
      { id: 'api-keys', label: 'API Keys' },
      { id: 'runtime-keys', label: 'Runtime Key Management' },
      { id: 'backup-settings', label: 'S3 Backup' },
      { id: 'port-config', label: 'Port Configuration' },
    ]
  },
  {
    id: 'api-reference', label: 'API Reference', children: [
      { id: 'api-search', label: 'Search' },
      { id: 'api-artist', label: 'Artist' },
      { id: 'api-song', label: 'Song' },
      { id: 'api-library', label: 'Library' },
      { id: 'api-engram', label: 'Engram' },
      { id: 'api-lucid', label: 'Lucid Playback' },
      { id: 'api-versions', label: 'Versions' },
      { id: 'api-analyst', label: 'Analyst Sidecar' },
    ]
  },
  {
    id: 'deployment', label: 'Deployment', children: [
      { id: 'deploy-docker', label: 'Docker Compose' },
      { id: 'deploy-env', label: 'Environment Variables' },
      { id: 'deploy-reverse-proxy', label: 'Reverse Proxy' },
    ]
  },
  {
    id: 'troubleshooting', label: 'Troubleshooting', children: [
      { id: 'ts-smb', label: 'SMB Issues' },
      { id: 'ts-migrations', label: 'Database Migrations' },
      { id: 'ts-scan', label: 'Scan Problems' },
      { id: 'ts-genius', label: 'Genius API' },
    ]
  },
]

const ALL_IDS = TOC.flatMap(section => [section.id, ...section.children.map(c => c.id)])

// ─── Page component ───────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>('getting-started')

  useEffect(() => {
    const observers: IntersectionObserver[] = []
    ALL_IDS.forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      const observer = new IntersectionObserver(
        entries => { entries.forEach(e => { if (e.isIntersecting) setActiveId(id) }) },
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
                <a
                  href={`#${section.id}`}
                  className={`block text-sm py-1.5 px-2 rounded transition-colors duration-100 font-medium ${
                    activeId === section.id ? 'text-accent bg-accent/10' : 'text-text-primary hover:text-accent hover:bg-accent/5'
                  }`}
                >
                  {section.label}
                </a>
                {section.children.length > 0 && (
                  <div className="ml-3 border-l border-border/60 pl-3 mt-0.5 mb-1 space-y-0.5">
                    {section.children.map(child => (
                      <a
                        key={child.id}
                        href={`#${child.id}`}
                        className={`block text-xs py-1 px-1.5 rounded transition-colors duration-100 ${
                          activeId === child.id ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
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
            The self-hosted command centre for the music obsessive. Every subsystem, every setting, every wire — documented.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 1. Getting Started                                         */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="getting-started" title="Getting Started">
          <SubSection id="what-is-phonolith" title="What is Phonolith?">
            <p>
              Phonolith is a self-hosted, Docker-native music platform built for audiophiles who want total control
              over their library, metadata, and listening history. It draws on two complementary metadata authorities —
              MusicBrainz for canonical artist and release data (MBIDs, ISRCs, accurate release dates, labels) and
              Genius for lyrics, credits, and annotations — and pairs them with a local audio library analyser that
              inspects every file you own for quality, authenticity, and provenance.
            </p>
            <p>
              Unlike streaming services, Phonolith runs entirely on your own hardware. Your library, your metadata,
              your history — none of it leaves your machine. External calls go to MusicBrainz, Genius, Discogs,
              and AcoustID; all results are written to your local database on first fetch and never fetched again.
            </p>
            <p>
              Phonolith is built on a named-subsystem model: each capability is a distinct engine with a name,
              a clear responsibility, and a defined interface. This makes the system transparent, extensible, and
              easy to reason about. See the <a href="#subsystems" className="text-accent underline">Subsystems</a> section for a full breakdown.
            </p>
          </SubSection>

          <SubSection id="requirements" title="Requirements">
            <Table
              headers={['Requirement', 'Minimum', 'Recommended']}
              rows={[
                ['Docker', '24.0+', '25.0+'],
                ['Docker Compose', 'v2.0+', 'v2.20+'],
                ['RAM', '2 GB', '8 GB (for large libraries)'],
                ['Storage', '5 GB (app)', '+ your music collection'],
                ['Network', 'LAN access to NAS', 'Gigabit for SMB scanning'],
                ['OS', 'Any Docker host', 'Linux required for Lucid bit-perfect playback'],
              ]}
            />
            <Note>Phonolith is tested on macOS (Apple Silicon) and Linux (x86-64 / ARM64). Windows is supported via Docker Desktop but SMB scanning may require additional configuration.</Note>
          </SubSection>

          <SubSection id="quick-start" title="Quick Start">
            <p>Clone the repository and start all four services with a single command:</p>
            <CodeBlock>{`git clone https://github.com/OldestBen/Phonolith
cd Phonolith
cp .env.example .env
# Edit .env — at minimum set GENIUS_ACCESS_TOKEN
nano .env
docker compose up --build`}</CodeBlock>
            <p>
              On first start, the <code className="text-accent">app</code> container automatically runs all pending
              database migrations before accepting traffic. The analyst sidecar starts in parallel. When you see
              both <code className="text-accent">✓ Ready in</code> (Next.js) and{' '}
              <code className="text-accent">Application startup complete</code> (FastAPI), open{' '}
              <code className="text-accent">http://localhost:3000</code>.
            </p>
            <Tip>
              The Genius Access Token is the only credential required to start. MusicBrainz is queried automatically
              with no key (identify your instance via <code className="text-accent">MUSICBRAINZ_APP_NAME</code> and{' '}
              <code className="text-accent">MUSICBRAINZ_CONTACT</code> in <code className="text-accent">.env</code>
              — this is required by their fair-use policy). Discogs, AcoustID, and S3 can be added at any time via
              Settings → API Keys without restarting the stack.
            </Tip>
          </SubSection>

          <SubSection id="first-steps" title="First Steps">
            <p>After the stack is up:</p>
            <ol className="list-decimal list-inside space-y-2 text-text-muted">
              <li><strong className="text-text-primary">Add a Genius API key</strong> — Settings → API Keys → Genius Access Token → Save, then hit Test. A green checkmark means you&apos;re connected.</li>
              <li><strong className="text-text-primary">Search for an artist</strong> — use the home page search bar. On first lookup, Phonolith fetches from Genius and simultaneously enriches with MusicBrainz (MBID, release dates, ISRCs). Both sources are cached locally.</li>
              <li><strong className="text-text-primary">Add a library source</strong> — Settings → Library Sources → Add Source. Choose Local, SMB, NFS, or iSCSI.</li>
              <li><strong className="text-text-primary">Scan your library</strong> — press Scan on the source row. The bell icon in the top-right shows live progress.</li>
              <li><strong className="text-text-primary">Visualize an artist</strong> — open any artist page and click Visualize, or go to the Visualize section and search for an artist.</li>
              <li><strong className="text-text-primary">Enable bit-perfect playback (Linux only)</strong> — run <code className="text-accent">docker compose --profile audio up lucid</code>. Ensure your user is in the <code className="text-accent">audio</code> group and your USB DAC&apos;s ALSA device appears in Settings → Playback.</li>
            </ol>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 2. Architecture                                            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="architecture" title="Architecture">
          <SubSection id="arch-overview" title="Overview">
            <p>
              Phonolith is a four-container Docker application with an optional fifth sidecar for playback.
              The core application is a Next.js 14 monolith (App Router, TypeScript, server-side rendering)
              backed by PostgreSQL for persistent storage and Redis for caching. A Python FastAPI sidecar —
              the <strong>Analyst</strong> — handles all computationally intensive audio work: file indexing,
              spectral analysis, waveform rendering, and acoustic fingerprinting. An optional third sidecar —
              <strong> Lucid</strong> — provides bit-perfect ALSA playback and AirPlay discovery on Linux
              hosts; it starts only when you opt in via the <code className="text-accent">audio</code> Docker
              Compose profile.
            </p>
            <CodeBlock>{`┌──────────────────────────────────────────────────────────────┐
│                        Docker Network                        │
│                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│   │  app:3000    │◄───│  db:5432     │    │  redis:6379  │  │
│   │  Next.js 14  │    │  PostgreSQL  │    │  ioredis     │  │
│   │  TypeScript  │    │  16          │    │  cache+pub   │  │
│   └──────┬───────┘    └──────────────┘    └──────────────┘  │
│          │                                                   │
│          ▼ HTTP                                              │
│   ┌──────────────┐                                           │
│   │  analyst:8000│                                           │
│   │  FastAPI     │──── SMB ────► NAS/Library                │
│   │  Python 3.12 │                                           │
│   └──────────────┘                                           │
└──────────────────────────────────────────────────────────────┘`}</CodeBlock>
          </SubSection>

          <SubSection id="arch-layers" title="Layer Model">
            <p>Phonolith&apos;s functionality is organised into six named layers, each containing one or more named subsystems:</p>
            <Table
              headers={['Layer', 'Subsystems', 'Responsibility']}
              rows={[
                ['Ingestion', 'ResonanceFS, Tremor', 'Secure filesystem access and change detection'],
                ['Metadata', 'Engram, Lexicon', 'Metadata resolution, locking, and provenance tracking'],
                ['Sonic Lab', 'Prism, Crest', 'Spectral analysis, DR scoring, and authenticity checks'],
                ['Vaulting', 'Aegis, Bit-Forge', 'Immutable backup, deduplication, and content-addressed storage'],
                ['Playback', 'Lucid, Flux', 'Bit-perfect audio output and AirPlay routing'],
                ['Analytics', 'EchoGraph, Cathode', 'History tracking, visualisation, and hardware accounting'],
                ['Ecosystem', 'Polyphony, Sonic Codex', 'Peer networking and portable library manifests'],
              ]}
            />
          </SubSection>

          <SubSection id="arch-data-flow" title="Data Flow">
            <p>A typical library scan follows this path through the subsystem stack:</p>
            <CodeBlock>{`User clicks "Scan"
       │
       ▼
app → POST /api/library/sources/:id/scan
       │  fetches source config from PostgreSQL
       ▼
analyst ← POST /scan-source {type, config, name}
       │
       ├─ ResonanceFS: walk SMB/NFS share (smbprotocol)
       │    emits "discovering" progress events
       │
       ├─ Bit-Forge: BLAKE3-stream each file (no temp write)
       │
       ├─ Lexicon (fast pass): mutagen reads first 512 KB
       │    extracts title, artist, album, year, bitrate
       │
       ├─ [Deep scan only]
       │    Prism: librosa spectral analysis → upscale flag
       │    Crest: librosa crest-factor → DR score
       │    waveform PNG rendered via PIL
       │
       └─ POST /api/library/ingest → upsert library_files row
              │
              ▼
         PostgreSQL library_files table`}</CodeBlock>
          </SubSection>

          <SubSection id="arch-docker" title="Docker Services">
            <Table
              headers={['Service', 'Image', 'Exposed Port', 'Role']}
              rows={[
                ['app', 'node:20-alpine (multi-stage)', '${APP_PORT:-3000}', 'Next.js — UI, API routes, migrations'],
                ['analyst', 'python:3.12-slim', '${ANALYST_PORT:-8000}', 'FastAPI — audio analysis sidecar'],
                ['db', 'postgres:16-alpine', 'internal only', 'Primary data store'],
                ['redis', 'redis:7-alpine', 'internal only', 'API cache + pub-sub events'],
                ['lucid', 'python:3.12-slim (profile: audio)', '${LUCID_PORT:-8001}', 'FastAPI — bit-perfect ALSA playback + AirPlay discovery (Linux only)'],
              ]}
            />
            <Note>
              The database and Redis ports are not exposed to the host by default. To connect with external tools
              (pgAdmin, redis-cli), uncomment the relevant <code className="text-accent">ports</code> stanza in
              <code className="text-accent"> docker-compose.yml</code>.
            </Note>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 3. Subsystems                                              */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="subsystems" title="Subsystems">
          <p className="text-text-muted text-sm mb-6">
            Every capability in Phonolith maps to a named subsystem with a defined role.
            The table below is the canonical reference; each subsystem is expanded in detail below.
          </p>
          <Table
            headers={['Name', 'Layer', 'Role', 'Status']}
            rows={[
              ['ResonanceFS', 'Ingestion', 'Secure Virtual Filesystem (SMB/NFS/CIFS mount layer)', <StatusBadge key="r" status="implemented" />],
              ['Tremor', 'Ingestion', 'Filesystem watcher daemon (inotify / FSEvents)', <StatusBadge key="t" status="implemented" />],
              ['Engram', 'Metadata', 'Metadata lock engine & version-control guardian', <StatusBadge key="e" status="partial" />],
              ['Lexicon', 'Metadata', 'Deep-scraping metadata resolver (MusicBrainz, Discogs, ENGINEER tags)', <StatusBadge key="l" status="partial" />],
              ['Prism', 'Sonic Lab', 'Spectral analysis & fake-FLAC / upscale detector', <StatusBadge key="pr" status="partial" />],
              ['Crest', 'Sonic Lab', 'Dynamic Range (DR / Crest Factor) calculator', <StatusBadge key="cr" status="partial" />],
              ['Aegis', 'Vaulting', 'Immutable S3 backup, encryption & chunking engine', <StatusBadge key="ag" status="partial" />],
              ['Bit-Forge', 'Vaulting', 'BLAKE3 hashing service & deduplication index', <StatusBadge key="bf" status="implemented" />],
              ['Lucid', 'Playback', 'Bit-perfect ALSA-exclusive audio transport daemon', <StatusBadge key="lu" status="partial" />],
              ['Flux', 'Playback', 'AirPlay endpoint discovery & routing sidecar', <StatusBadge key="fl" status="partial" />],
              ['EchoGraph', 'Analytics', 'Scrobble history, Sankey diagrams & genre-evolution engine', <StatusBadge key="eg" status="partial" />],
              ['Cathode', 'Analytics', 'Hardware endpoint tracker & burn-in accountant', <StatusBadge key="ca" status="planned" />],
              ['Polyphony', 'Ecosystem', 'Cryptographic peer-network ("Syndicate") for trusted node cross-referencing', <StatusBadge key="po" status="planned" />],
              ['Sonic Codex', 'Ecosystem', 'Portable library manifest format (.codex) — the blueprint, not the bits', <StatusBadge key="sc" status="planned" />],
            ]}
          />

          {/* ResonanceFS */}
          <SubSection id="resonancefs" title="ResonanceFS — Ingestion">
            <SubsystemCard
              name="ResonanceFS"
              layer="Ingestion"
              status="implemented"
              role="Secure Virtual Filesystem — SMB / NFS / CIFS / local mount layer"
            >
              <p>
                ResonanceFS is the ingestion gateway. It gives the Analyst sidecar access to remote audio
                libraries without requiring OS-level mounts, kernel modules, or root privileges inside the
                container. Instead, it uses pure-Python protocol implementations to speak SMB2/SMB3, NFS, and
                iSCSI directly from userspace.
              </p>
              <SubSubSection title="SMB / CIFS (smbprotocol)">
                <p>
                  Windows shares, macOS Samba exports, Synology DSM, QNAP, TrueNAS, and any other SMB2+ target
                  are supported. The session is registered once per host with optional username, password, and
                  domain credentials. The domain, if supplied, is prepended to the username as{' '}
                  <code className="text-accent">DOMAIN\username</code> — the correct format for SMB NTLM
                  authentication.
                </p>
                <p>
                  During a scan, ResonanceFS walks the share tree with <code className="text-accent">smbclient.walk()</code>,
                  emitting a live file count (the &quot;discovering&quot; phase) while Bit-Forge streams each file
                  through a BLAKE3 hash without ever writing to local disk.
                </p>
              </SubSubSection>
              <SubSubSection title="Connectivity Test">
                <p>
                  Before any authentication is attempted, ResonanceFS performs a TCP reachability probe to
                  port 445 (SMB) using <code className="text-accent">socket.create_connection</code> with a
                  5-second timeout. This is exposed in the UI as the Ping button in the Add Source modal, and
                  as the first step of the Test button on each source row.
                </p>
              </SubSubSection>
              <SubSubSection title="Configuration">
                <Table
                  headers={['Field', 'Required', 'Description']}
                  rows={[
                    ['host', 'Yes', 'IP address or hostname of the NAS / Windows share'],
                    ['share', 'Yes', 'Share name (e.g. Music, not the full UNC path)'],
                    ['subfolder', 'No', 'Optional subfolder within the share'],
                    ['username', 'No*', 'SMB username (* required if guest auth is disabled)'],
                    ['password', 'No*', 'SMB password'],
                    ['domain', 'No', 'Windows domain / workgroup for NTLM auth'],
                  ]}
                />
              </SubSubSection>
              <Warning>
                ResonanceFS requires SMB2 or higher. SMB1 (the legacy protocol) is disabled by default on modern NAS firmware and is not supported by smbprotocol. Enable SMB2 on your NAS if you encounter &quot;dialect not supported&quot; errors.
              </Warning>
            </SubsystemCard>
          </SubSection>

          {/* Tremor */}
          <SubSection id="tremor" title="Tremor — Ingestion">
            <SubsystemCard
              name="Tremor"
              layer="Ingestion"
              status="implemented"
              role="Filesystem watcher daemon — inotify (Linux) / FSEvents (macOS)"
            >
              <p>
                Tremor monitors a local library path (the <code className="text-accent">LIBRARY_PATH</code> mount)
                for new or modified audio files and triggers an incremental re-scan automatically. It is
                implemented using the Python <code className="text-accent">watchdog</code> library, which
                adapts to the native OS event API (inotify on Linux inside the container, FSEvents on the Docker
                Desktop host via volume proxying on macOS).
              </p>
              <SubSubSection title="Debounce Behaviour">
                <p>
                  Tremor debounces file-system events by 2 seconds before triggering a scan. This prevents
                  cascading rescans when a large copy operation drops hundreds of files in quick succession.
                  The 2-second window resets on each new event, so the scan fires only after the burst settles.
                </p>
              </SubSubSection>
              <SubSubSection title="Scope">
                <p>
                  Tremor only watches the local <code className="text-accent">LIBRARY_PATH</code> mount. SMB and
                  NFS sources are not watched — they must be scanned manually or on a schedule. Native remote
                  filesystem event support (inotify over NFS, SMB oplocks) is on the roadmap for a future release.
                </p>
              </SubSubSection>
              <SubSubSection title="Status">
                <p>
                  Tremor reports its state through the <code className="text-accent">GET /status</code> endpoint
                  on the Analyst sidecar (<code className="text-accent">watching: true/false</code>). The
                  Notifications bell in the UI reflects this state in real time.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Engram */}
          <SubSection id="engram" title="Engram — Metadata">
            <SubsystemCard
              name="Engram"
              layer="Metadata"
              status="partial"
              role="Metadata lock engine & version-control guardian"
            >
              <p>
                Engram is the metadata version history layer. It records a snapshot of every file&apos;s
                metadata at ingest time and provides an API to browse the full change history and restore
                any prior snapshot — in whole or field by field.
              </p>
              <SubSubSection title="Current Implementation">
                <ul className="list-disc list-inside space-y-1">
                  <li>New Postgres table <code className="text-accent">metadata_versions</code> — stores blake3_hash, snapshot JSONB, source, note, and created_at</li>
                  <li>Every library ingest automatically snapshots the file&apos;s metadata (<code className="text-accent">source=&apos;ingest&apos;</code>)</li>
                  <li><code className="text-accent">GET /api/engram/[hash]</code> — returns the last 50 versions for a file, newest first</li>
                  <li><code className="text-accent">POST /api/engram/[hash]/restore</code> — restores all fields or a specified subset from any prior snapshot; auto-snapshots the current state before restore (<code className="text-accent">source=&apos;restore&apos;</code>) so the restore itself is reversible</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Planned: Engram v2">
                <ul className="list-disc list-inside space-y-1">
                  <li>Per-field lock flags (<code className="text-accent">locked_fields: string[]</code>) so confirmed values cannot be silently overwritten by a future scrape</li>
                  <li>External tagger interception — writes from third-party taggers are version-controlled before being applied</li>
                  <li>Conflict detection when an external scrape disagrees with a locked value</li>
                  <li>User-facing lock/unlock UI on artist and song pages</li>
                </ul>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Lexicon */}
          <SubSection id="lexicon" title="Lexicon — Metadata">
            <SubsystemCard
              name="Lexicon"
              layer="Metadata"
              status="partial"
              role="Deep-scraping metadata resolver — Genius, MusicBrainz, Discogs, ENGINEER tags"
            >
              <p>
                Lexicon resolves and enriches metadata by querying multiple external sources and merging the
                results into a canonical record. The current implementation covers Genius (search, artist info,
                song descriptions, lyrics, credits, annotations) and MusicBrainz (MBID, accurate release dates,
                ISRC codes, label information).
              </p>
              <SubSubSection title="Current Sources">
                <Table
                  headers={['Source', 'Data Obtained', 'Cache TTL', 'Status']}
                  rows={[
                    ['Genius API', 'Artist bio, song metadata, lyrics, credits, annotations', '5 min (Redis)', 'Implemented'],
                    ['MusicBrainz API', 'MBID, release dates, ISRC, label, recording info', '5 min (Redis)', 'Implemented'],
                    ['Discogs API', 'Pressing details, catalogue numbers, format info', 'Not yet', 'Planned'],
                    ['File Tags (mutagen)', 'ENGINEER, PRODUCER, MASTERED BY, embedded credits', 'N/A', 'Partial'],
                  ]}
                />
              </SubSubSection>
              <SubSubSection title="Resolution Priority">
                <p>
                  Lexicon resolves in the following order of precedence (highest first): user-confirmed values
                  (Engram-locked) → database cache → Genius API → MusicBrainz → embedded file tags. This order
                  ensures that curated data is never overwritten by a scrape.
                </p>
              </SubSubSection>
              <SubSubSection title="Rate Limiting">
                <p>
                  MusicBrainz requires a maximum of 1 request per second with a valid User-Agent string
                  (set via <code className="text-accent">MUSICBRAINZ_APP_NAME</code>,{' '}
                  <code className="text-accent">MUSICBRAINZ_APP_VERSION</code>, and{' '}
                  <code className="text-accent">MUSICBRAINZ_CONTACT</code>). Lexicon implements a sequential
                  queue with 1-second delays to honour this limit. Genius has no published rate limit but all
                  responses are Redis-cached for 5 minutes to minimise load.
                </p>
              </SubSubSection>
              <SubSubSection title="Planned: Discogs Integration">
                <p>
                  Discogs holds the most complete database of physical pressing information — catalogue numbers,
                  matrix / runout etchings, label variants, country of pressing, and release year. Lexicon will
                  use the Discogs API (authenticated via <code className="text-accent">DISCOGS_USER_TOKEN</code>)
                  to resolve pressing-level detail for files in your library that match a known release. This is
                  especially valuable for vinyl rips and physical media transfers.
                </p>
              </SubSubSection>
              <SubSubSection title="Planned: ENGINEER Tag Extraction">
                <p>
                  Many high-quality lossless files (particularly from HD Tracks, Bandcamp, and mastering studios)
                  embed rich credits in the TXXX, ENGINEER, PRODUCER, and COMMENT tags. Lexicon will parse these
                  during the deep-analysis pass and cross-reference them against MusicBrainz recording credits to
                  build a provenance chain linking every file to a specific mastering session.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Prism */}
          <SubSection id="prism" title="Prism — Sonic Lab">
            <SubsystemCard
              name="Prism"
              layer="Sonic Lab"
              status="partial"
              role="Spectral analysis & fake-FLAC / upscale detector"
            >
              <p>
                Prism analyses the frequency content of audio files to determine whether a file genuinely
                contains high-frequency information or whether it has been upsampled from a lower-resolution
                source. This is sometimes called an &quot;upscale detection&quot; or &quot;fake hi-res&quot;
                check.
              </p>
              <SubSubSection title="How It Works">
                <p>
                  Prism loads the first 30 seconds of audio via librosa and computes an FFT of the full
                  waveform. It then compares the energy in the high-frequency band (&gt;18 kHz) against the
                  energy in the mid-band (1–18 kHz). A ratio below a calibrated threshold indicates that the
                  high-frequency region is essentially empty — the hallmark of a 16-bit/44.1 kHz CD-quality
                  source that has been sample-rate-converted to 24-bit/96 kHz or higher.
                </p>
              </SubSubSection>
              <SubSubSection title="Limitations">
                <ul className="list-disc list-inside space-y-1">
                  <li>Prism cannot distinguish between a genuinely low-bandwidth recording and an upscale — some legitimate recordings (e.g. early analogue transfers) have limited high-frequency extension</li>
                  <li>The 30-second analysis window may miss high-frequency content that only appears in specific sections</li>
                  <li>Not run during the SMB fast-scan pass — requires a deep-analysis trigger</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Output">
                <p>
                  Prism writes <code className="text-accent">spectral_ok: boolean | null</code> to the
                  <code className="text-accent"> library_files</code> row. A value of{' '}
                  <code className="text-accent">false</code> should be treated as a strong indicator of an
                  upscale but not a certainty. The Library page surfaces this with a warning badge.
                </p>
              </SubSubSection>
              <SubSubSection title="AccurateRip CRC Verification">
                <p>
                  Prism now computes an AccurateRip CRCv1 checksum during indexing for FLAC, WAV, and
                  AIFF files. The algorithm iterates 32-bit samples, multiplies each by its 1-based position,
                  and sums modulo 2³². The result is stored in <code className="text-accent">library_files</code>{' '}
                  alongside the columns <code className="text-accent">accuraterip_status</code>,{' '}
                  <code className="text-accent">accuraterip_confidence</code>, and{' '}
                  <code className="text-accent">mb_release_group_id</code>. On-demand single-file verification
                  is also available via <code className="text-accent">POST /accuraterip</code> on the analyst
                  sidecar. Full disc verification (requiring a CUE sheet) is a future milestone.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Crest */}
          <SubSection id="crest" title="Crest — Sonic Lab">
            <SubsystemCard
              name="Crest"
              layer="Sonic Lab"
              status="partial"
              role="Dynamic Range (DR / Crest Factor) calculator"
            >
              <p>
                Crest calculates the dynamic range of an audio file using the crest-factor method: the
                ratio of peak amplitude to RMS amplitude, expressed in decibels. A high score indicates
                wide dynamic range (good); a low score indicates heavy limiting or brickwall compression.
              </p>
              <SubSubSection title="Methodology">
                <p>
                  Crest loads up to 60 seconds of audio via librosa, computes the RMS energy and peak amplitude
                  of the mono-mixed waveform, then calculates:
                </p>
                <CodeBlock>{'DR = 20 × log₁₀(peak / RMS)    [dB]'}</CodeBlock>
                <p>
                  This is equivalent to the crest factor used by DR Meter and the TT Dynamic Range Meter,
                  though not identical to the block-based DR offset score used by the Dynamic Range Database.
                  For a quick relative comparison within your own library it is an excellent signal.
                </p>
              </SubSubSection>
              <SubSubSection title="Interpreting DR Scores">
                <Table
                  headers={['DR Score', 'Quality', 'Typical Example']}
                  rows={[
                    ['DR 20+', 'Exceptional', 'Classical recordings, audiophile vinyl transfers'],
                    ['DR 14–20', 'Good', 'Well-mastered rock, jazz, acoustic recordings'],
                    ['DR 8–14', 'Acceptable', 'Commercial pop and rock post-2000'],
                    ['DR 5–8', 'Compromised', 'Heavily limited masters, loudness-war casualties'],
                    ['DR < 5', 'Brickwalled', 'Extreme limiting — clipping likely'],
                  ]}
                />
              </SubSubSection>
              <SubSubSection title="Current Status">
                <p>
                  Crest is fully implemented in the Analyst sidecar. It is currently skipped during the fast
                  SMB scan to avoid downloading full audio files. A <strong>Deep Analysis</strong> pass (coming
                  soon) will run Crest and Prism over all library_files rows where{' '}
                  <code className="text-accent">dr_score IS NULL</code>.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Aegis */}
          <SubSection id="aegis" title="Aegis — Vaulting">
            <SubsystemCard
              name="Aegis"
              layer="Vaulting"
              status="partial"
              role="Immutable S3 backup, encryption & chunking engine"
            >
              <p>
                Aegis provides point-in-time, immutable backups of your Phonolith database to Amazon S3 or
                any S3-compatible object store. The current implementation covers database-only backup
                (PostgreSQL dump → S3). Encryption, chunking, and library-file vaulting are planned.
              </p>
              <SubSubSection title="Current Implementation">
                <p>
                  A manual backup can be triggered from Settings → Backup. Aegis calls{' '}
                  <code className="text-accent">pg_dump</code> inside the app container, streams the output
                  through the AWS SDK v3, and uploads it to the configured S3 bucket with a timestamped key.
                </p>
                <CodeBlock>{`Key format: phonolith-backup-{ISO8601-timestamp}.sql.gz
Example:    phonolith-backup-2026-06-15T00:00:00Z.sql.gz`}</CodeBlock>
              </SubSubSection>
              <SubSubSection title="Required Environment Variables">
                <Table
                  headers={['Variable', 'Description']}
                  rows={[
                    ['S3_BUCKET', 'Target bucket name'],
                    ['S3_REGION', 'AWS region (e.g. us-east-1)'],
                    ['AWS_ACCESS_KEY_ID', 'IAM access key with s3:PutObject on the bucket'],
                    ['AWS_SECRET_ACCESS_KEY', 'Corresponding secret key'],
                  ]}
                />
              </SubSubSection>
              <SubSubSection title="Planned: Encryption & Library Vaulting">
                <p>
                  Future Aegis releases will add client-side AES-256-GCM encryption (key held locally, never
                  uploaded), content-addressed chunking of audio files via Bit-Forge hashes (so deduplication
                  happens before upload), and scheduled automatic backups via a cron-like trigger inside the app
                  container.
                </p>
              </SubSubSection>
              <Tip>All variables can be set from Settings → API Keys without restarting the stack. Aegis reads them at backup time, not at startup.</Tip>
            </SubsystemCard>
          </SubSection>

          {/* Bit-Forge */}
          <SubSection id="bit-forge" title="Bit-Forge — Vaulting">
            <SubsystemCard
              name="Bit-Forge"
              layer="Vaulting"
              status="implemented"
              role="BLAKE3 hashing service & deduplication index"
            >
              <p>
                Bit-Forge is responsible for content-addressed identification of every audio file in your
                library. It computes a BLAKE3 hash of each file&apos;s complete byte stream and uses that
                hash as the primary key for all library operations. This makes every file uniquely and
                verifiably identified regardless of filename, path, or metadata.
              </p>
              <SubSubSection title="Why BLAKE3?">
                <p>
                  BLAKE3 was chosen over SHA-256 and MD5 for three reasons: it is cryptographically secure
                  (unlike MD5), it is significantly faster than SHA-256 in software (typically 2–4× on modern
                  hardware), and it is designed for parallelism. BLAKE3 performance scales with available CPU
                  cores, which matters when hashing thousands of large FLAC files.
                </p>
              </SubSubSection>
              <SubSubSection title="Streaming Architecture">
                <p>
                  Bit-Forge never writes a file to disk to compute its hash. For SMB sources, the file is
                  streamed from the NAS in 64 KB chunks directly through the BLAKE3 hasher. The first 512 KB
                  is simultaneously buffered in memory for Lexicon&apos;s fast tag read. This means the entire
                  metadata extraction and hashing pass for a remote file touches the network exactly once and
                  writes nothing to the container&apos;s filesystem.
                </p>
              </SubSubSection>
              <SubSubSection title="Deduplication">
                <p>
                  Because the BLAKE3 hash is the primary key of <code className="text-accent">library_files</code>,
                  identical files at different paths resolve to the same row. This is the foundation for future
                  deduplication workflows: if you have a file in two locations (e.g. a backup copy on a second
                  NAS), Bit-Forge will identify them as the same content and update the row rather than creating
                  a duplicate.
                </p>
              </SubSubSection>
              <SubSubSection title="Fallback">
                <p>
                  If the <code className="text-accent">blake3</code> Python package is not available (rare — it
                  requires a Rust compiler at build time), Bit-Forge falls back to SHA-256. Both produce a
                  hex-encoded string of equal length from Phonolith&apos;s perspective.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Lucid */}
          <SubSection id="lucid" title="Lucid — Playback">
            <SubsystemCard
              name="Lucid"
              layer="Playback"
              status="partial"
              role="Bit-perfect ALSA-exclusive audio transport daemon"
            >
              <p>
                Lucid is a Python FastAPI daemon (port 8001) that provides bit-perfect audio output via
                exclusive ALSA access, bypassing the Linux kernel mixer (dmix / PulseAudio / PipeWire)
                entirely. It ships as a separate Docker service under the <code className="text-accent">audio</code> profile
                and only starts when you opt in: <code className="text-accent">docker compose --profile audio up</code>.
              </p>
              <SubSubSection title="Current Implementation">
                <ul className="list-disc list-inside space-y-1">
                  <li>Exclusive ALSA lock via <code className="text-accent">pyalsaaudio</code> — no kernel mixer involved</li>
                  <li>Two decode paths: <code className="text-accent">soundfile</code> / libsndfile for FLAC, WAV, AIFF; FFmpeg subprocess pipe for MP3, AAC, M4A</li>
                  <li>Gapless queue playback; frame-accurate seek via soundfile</li>
                  <li>RAM pre-caching — album loads to memory before playback starts</li>
                  <li>Signal path state published to Redis key <code className="text-accent">lucid:signal_path</code> on every state change, powering the Signal Path Visualizer in the web UI</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Host Requirements">
                <ul className="list-disc list-inside space-y-1">
                  <li>Linux host with <code className="text-accent">/dev/snd</code> exposed to the container</li>
                  <li>Host user must be in the <code className="text-accent">audio</code> group: <code className="text-accent">sudo usermod -aG audio $USER</code></li>
                  <li>Not available on macOS or Windows (ALSA is Linux-only)</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="REST API (port 8001)">
                <p>
                  <code className="text-accent">/play</code>, <code className="text-accent">/pause</code>, <code className="text-accent">/resume</code>, <code className="text-accent">/stop</code>, <code className="text-accent">/seek</code>, <code className="text-accent">/status</code>, <code className="text-accent">/devices</code>, <code className="text-accent">/queue/*</code>, <code className="text-accent">/airplay/endpoints</code>
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Flux */}
          <SubSection id="flux" title="Flux — Playback">
            <SubsystemCard
              name="Flux"
              layer="Playback"
              status="partial"
              role="AirPlay endpoint discovery & routing sidecar"
            >
              <p>
                Flux is the AirPlay discovery layer, running as part of the Lucid sidecar. It browses
                the local network for <code className="text-accent">_raop._tcp.local.</code> service records
                via <code className="text-accent">zeroconf</code>, discovering HomePods, Apple TVs, AirPlay
                AVRs, and any other AirPlay-capable endpoint.
              </p>
              <SubSubSection title="Current Implementation">
                <ul className="list-disc list-inside space-y-1">
                  <li>Automatic mDNS browsing for <code className="text-accent">_raop._tcp.local.</code> — discovers AirPlay and AirPlay 2 endpoints on the LAN</li>
                  <li><code className="text-accent">GET /airplay/endpoints</code> returns all discovered devices (name, host, port, model)</li>
                  <li>Discovery runs continuously in the background while Lucid is online</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Future Milestone: RTSP/ALAC Streaming">
                <p>
                  Full AirPlay streaming — RTSP session negotiation, ALAC encoding, and synchronised
                  multi-room playback — is planned for a future Flux release. The current release handles
                  discovery and logs intent; no audio is yet sent to AirPlay endpoints.
                </p>
              </SubSubSection>
              <Note>
                Flux requires the Docker container to have network visibility to AirPlay receivers. Run with
                <code className="text-accent"> network_mode: host</code> or configure mDNS reflection through
                the gateway for cross-subnet discovery.
              </Note>
            </SubsystemCard>
          </SubSection>

          {/* EchoGraph */}
          <SubSection id="echograph" title="EchoGraph — Analytics">
            <SubsystemCard
              name="EchoGraph"
              layer="Analytics"
              status="partial"
              role="Scrobble history, Sankey diagrams & genre-evolution engine"
            >
              <p>
                EchoGraph records every meaningful interaction with your library and surfaces it as rich
                analytics. The current implementation tracks lyrics reads, lyrics downloads, and manual
                &quot;mark as read&quot; events, stores them in the <code className="text-accent">history</code>{' '}
                table, and displays a chronological event log on the History page.
              </p>
              <SubSubSection title="Current Implementation">
                <ul className="list-disc list-inside space-y-1">
                  <li>Event recording: lyrics_read, lyrics_download, lyrics_marked_read</li>
                  <li>Per-artist event history</li>
                  <li>Chronological log with filter by artist and event type</li>
                  <li>Recently explored artists list (used by the Visualize landing page)</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Planned: Sankey Diagrams">
                <p>
                  EchoGraph will render Sankey flow diagrams showing how your listening has evolved: genre
                  transitions over time, how discovering one artist led to exploring collaborators, and how
                  your weekly listening patterns shift across seasons. These diagrams will use the connections
                  data already computed for the Visualize galaxy.
                </p>
              </SubSubSection>
              <SubSubSection title="Planned: Genre Evolution">
                <p>
                  By cross-referencing Genius genre tags, MusicBrainz genre data, and your listen history,
                  EchoGraph will map the evolution of your taste over time — a kind of musical autobiography.
                  The output will be a timeline view overlaid on the EchoGraph history page.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Cathode */}
          <SubSection id="cathode" title="Cathode — Analytics">
            <SubsystemCard
              name="Cathode"
              layer="Analytics"
              status="planned"
              role="Hardware endpoint tracker & burn-in accountant"
            >
              <p>
                Cathode is the hardware-awareness layer. It tracks which audio output devices have been used
                for playback, how many hours each device has accumulated, and whether tube or capacitor-coupled
                endpoints have received appropriate burn-in time. This is particularly useful for audiophiles
                who maintain multiple DACs, amplifiers, or headphones with different warm-up requirements.
              </p>
              <SubSubSection title="Planned Capabilities">
                <ul className="list-disc list-inside space-y-1">
                  <li>Device registry: name, type (DAC / amplifier / headphone / IEM), acquisition date, notes</li>
                  <li>Play-hour accounting: cumulative hours of audio played through each device</li>
                  <li>Burn-in tracking: configurable targets (e.g. &quot;100 hours for Sennheiser HD800&quot;) with progress bar</li>
                  <li>Integration with Lucid (ALSA device name) and Flux (AirPlay receiver name) for automatic accounting</li>
                  <li>Export burn-in report as PDF or CSV</li>
                </ul>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Polyphony */}
          <SubSection id="polyphony" title="Polyphony — Ecosystem">
            <SubsystemCard
              name="Polyphony"
              layer="Ecosystem"
              status="planned"
              role='Cryptographic peer-network ("Syndicate") for trusted node cross-referencing'
            >
              <p>
                Polyphony enables multiple Phonolith instances — owned by different users who trust each other —
                to form a private encrypted peer network called a <strong>Syndicate</strong>. Syndicates allow
                members to cross-reference their libraries, share metadata corrections, and broadcast quality
                assessments (DR scores, upscale detections) without exposing raw audio data.
              </p>
              <SubSubSection title="Design Principles">
                <ul className="list-disc list-inside space-y-1">
                  <li>No central server — purely peer-to-peer via WireGuard tunnels or mutual TLS</li>
                  <li>Membership requires an explicit invitation signed with the inviting node&apos;s private key</li>
                  <li>Only Bit-Forge hashes, Prism/Crest scores, and Lexicon-verified metadata are shared — no audio bytes</li>
                  <li>A Syndicate member can query: &quot;Does anyone in my trust network have a verified DR score for this BLAKE3 hash?&quot;</li>
                  <li>Metadata corrections from a trusted peer can be applied locally, subject to Engram lock rules</li>
                </ul>
              </SubSubSection>
              <SubSubSection title="Privacy Model">
                <p>
                  Polyphony is designed to be zero-trust by default. No file paths, no play history, and no
                  personal data are shared. Only content hashes and quality metrics leave your node, and only
                  to nodes you have explicitly added to your Syndicate.
                </p>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>

          {/* Sonic Codex */}
          <SubSection id="sonic-codex" title="Sonic Codex — Ecosystem">
            <SubsystemCard
              name="Sonic Codex"
              layer="Ecosystem"
              status="planned"
              role="Portable library manifest format (.codex) — the blueprint, not the bits"
            >
              <p>
                The Sonic Codex is a portable, open, signed library manifest format. A{' '}
                <code className="text-accent">.codex</code> file describes your entire music library — every
                file, its Bit-Forge hash, its Lexicon metadata, its Prism/Crest scores — without containing
                any audio. Think of it as a signed blueprint of your collection.
              </p>
              <SubSubSection title="Format Design">
                <CodeBlock>{`# Example .codex structure (MessagePack with Ed25519 signature)
{
  "version": "1.0",
  "node_id": "phonolith-abc123",
  "exported_at": "2026-06-15T00:00:00Z",
  "signature": "Ed25519:<base64>",
  "tracks": [
    {
      "hash": "blake3:<hex>",
      "path": "Artist/Album/01 Track.flac",
      "title": "Track Title",
      "artist": "Artist Name",
      "album": "Album Title",
      "year": 2001,
      "bitrate": 1411,
      "sample_rate": 44100,
      "bit_depth": 16,
      "dr_score": 14.2,
      "spectral_ok": true,
      "mbid": "recording-uuid",
      "isrc": "USRC12345678"
    }
  ]
}`}</CodeBlock>
              </SubSubSection>
              <SubSubSection title="Use Cases">
                <ul className="list-disc list-inside space-y-1">
                  <li>Share your library blueprint with a Syndicate peer so they can compare it against their own</li>
                  <li>Back up your library manifest independently of the audio files (the .codex can recreate the library_files table)</li>
                  <li>Import a .codex from another Phonolith instance to pre-populate your database</li>
                  <li>Publish a public .codex (without personal data) to the audiophile community for quality benchmarking</li>
                </ul>
              </SubSubSection>
            </SubsystemCard>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 4. Library                                                 */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="library" title="Library">
          <SubSection id="supported-formats" title="Supported Formats">
            <Table
              headers={['Format', 'Extension', 'Lossless?', 'Notes']}
              rows={[
                ['FLAC', '.flac', 'Yes', 'Preferred lossless format. Bit-depth metadata available.'],
                ['ALAC', '.m4a', 'Yes', 'Apple Lossless. Common on iTunes purchases.'],
                ['WAV', '.wav', 'Yes', 'Uncompressed PCM. Large files, limited tag support.'],
                ['AIFF', '.aiff', 'Yes', 'Apple equivalent of WAV. Good tag support.'],
                ['WavPack', '.wv', 'Yes', 'Lossless + hybrid lossy. Excellent compression.'],
                ['APE', '.ape', "Yes", 'Monkey’s Audio. CPU-intensive decode.'],
                ['MP3', '.mp3', 'No', 'Lossy. Ubiquitous. Bitrate via mutagen tags.'],
                ['AAC', '.aac', 'No', 'Lossy. Used by Apple streaming and iTunes.'],
                ['Ogg Vorbis', '.ogg', 'No', 'Open-source lossy. Common on Linux.'],
                ['Opus', '.opus', 'No', 'Modern open-source lossy. Excellent quality at low bitrates.'],
              ]}
            />
          </SubSection>

          <SubSection id="adding-sources" title="Adding Sources">
            <p>
              Library sources are added from <strong>Settings → Library Sources → Add Source</strong>. Four
              source types are supported:
            </p>
            <Table
              headers={['Type', 'Description', 'Best For']}
              rows={[
                ['Local', 'A directory mounted into the analyst container via LIBRARY_PATH', 'Direct-attached storage, USB drives, Docker volume mounts'],
                ['SMB', 'Windows / Samba share via smbprotocol (no OS mount required)', 'NAS devices: Synology, QNAP, TrueNAS, Windows shares'],
                ['NFS', 'NFS export path mounted into the container', 'Linux NFS servers, enterprise NAS'],
                ['iSCSI', 'Block device mounted as a local path', 'Advanced: dedicated storage arrays'],
              ]}
            />
            <Tip>
              For SMB, you can paste a full UNC path (<code className="text-accent">\\server\share\subfolder</code>)
              into the UNC field in the Add Source modal and it will be automatically parsed into the host,
              share, and subfolder fields.
            </Tip>
          </SubSection>

          <SubSection id="smb-setup" title="SMB / NAS Setup">
            <SubSubSection title="Prerequisites">
              <ul className="list-disc list-inside space-y-1">
                <li>SMB2 or SMB3 must be enabled on the NAS (SMB1 is not supported)</li>
                <li>The share must be accessible from the Docker network — test with the Ping button first</li>
                <li>If guest access is disabled (recommended), create a dedicated read-only user for Phonolith</li>
              </ul>
            </SubSubSection>
            <SubSubSection title="Synology DSM">
              <CodeBlock>{`Control Panel → File Services → SMB
  Enable SMB service: ON
  Minimum SMB protocol: SMB2
  Maximum SMB protocol: SMB3

Control Panel → Shared Folder → [your music folder]
  Permissions → Local users → phonolith-user → Read Only`}</CodeBlock>
            </SubSubSection>
            <SubSubSection title="TrueNAS Scale">
              <CodeBlock>{`Shares → Windows (SMB) Shares → Add
  Path: /mnt/pool/music
  Name: music
  Purpose: No presets
  Advanced → Enable SMB2/SMB3 Negotiation: ON

Credentials → Local Users → Add
  Username: phonolith
  Samba Authentication: ON
  Assign to share: music (read only)`}</CodeBlock>
            </SubSubSection>
            <Warning>
              Do not run Phonolith with an admin or root NAS account. Create a dedicated read-only account
              and grant it access only to your music share.
            </Warning>
          </SubSection>

          <SubSection id="scan-pipeline" title="Scan Pipeline">
            <p>
              When you click <strong>Scan</strong> on a source row, the following sequence runs entirely
              inside the Analyst sidecar:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-text-muted">
              <li><strong className="text-text-primary">Discovery (ResonanceFS)</strong> — walk the source tree, emit file count in real time. The Notifications bell shows &quot;Discovering files… N found&quot; with a pulsing bar.</li>
              <li><strong className="text-text-primary">Parallel fast indexing (4 workers)</strong> — for each file: stream through Bit-Forge (BLAKE3), buffer first 512 KB, parse tags via Lexicon (mutagen). No temp files written to disk.</li>
              <li><strong className="text-text-primary">Ingest</strong> — POST each record to <code className="text-accent">/api/library/ingest</code> in the Next.js app, which upserts the <code className="text-accent">library_files</code> row. Duplicate files (same hash) update the existing row rather than creating a new one.</li>
              <li><strong className="text-text-primary">Progress reporting</strong> — the Notifications bell switches to a percentage progress bar during indexing, showing the current file name.</li>
            </ol>
          </SubSection>

          <SubSection id="deep-analysis" title="Deep Analysis (Coming Soon)">
            <p>
              The fast scan (described above) intentionally skips computationally intensive operations to keep
              scan times acceptable over SMB. A separate <strong>Deep Analysis</strong> pass will be triggerable
              per-source or per-file, and will run:
            </p>
            <Table
              headers={['Subsystem', 'Operation', 'Requires']}
              rows={[
                ['Crest', 'DR / crest-factor score', 'Full audio download'],
                ['Prism', 'Upscale / fake-FLAC detection', 'Full audio download + FFT'],
                ['Bit-Forge (waveform)', 'Waveform PNG rendering (1200×200px)', 'Full audio download + librosa'],
                ['Lexicon', 'AcoustID fingerprinting', 'Full audio download'],
              ]}
            />
            <Note>
              Deep Analysis will download each file once (shared across all four operations above) and process
              them in order. For a 10,000-file library, expect 1–4 hours depending on file size and CPU speed.
              It will run in the background with full progress reporting.
            </Note>
          </SubSection>

          <SubSection id="watcher" title="Auto-watcher (Tremor)">
            <p>
              If <code className="text-accent">LIBRARY_PATH</code> is set and the path exists inside the
              analyst container, Tremor automatically starts a filesystem watcher on startup. Any new or
              modified audio file within that path triggers an incremental re-scan after a 2-second debounce
              delay.
            </p>
            <p>
              Tremor is only active for the local <code className="text-accent">LIBRARY_PATH</code>. SMB
              sources must be rescanned manually. Tremor&apos;s status is visible via the Analyst{' '}
              <code className="text-accent">GET /status</code> endpoint and surfaced in the Notifications panel.
            </p>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 5. Search & Discovery                                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="search" title="Search & Discovery">
          <SubSection id="how-search-works" title="How Search Works">
            <p>
              Phonolith uses a database-first, API-on-miss caching strategy for all data. Every search result,
              artist page, and song page is served from the local PostgreSQL database if a matching row exists.
              Only on a cache miss does Phonolith call the Genius API — and the result is immediately written
              back to the database for next time.
            </p>
            <CodeBlock>{`Search query
  → GET /api/search?q=artist+name
  → Check artists table for cached results
  → On miss: call Genius /search
  → Insert/update artists rows
  → Return from database
  → Cache result in Redis (5 min TTL)`}</CodeBlock>
          </SubSection>

          <SubSection id="artist-pages" title="Artist Pages">
            <p>
              An artist page (<code className="text-accent">/artist/[id]</code>) shows the full discography
              grouped by album in reverse-chronological order, plus a right sidebar with the artist
              description and tag counts. Clicking <strong>Visualize</strong> opens the Galaxy view for that
              artist.
            </p>
          </SubSection>

          <SubSection id="song-pages" title="Song Pages">
            <p>
              A song page (<code className="text-accent">/song/[id]</code>) has four tabs:
            </p>
            <Table
              headers={['Tab', 'Content']}
              rows={[
                ['Lyrics', 'Full lyrics in Playfair Display, with Copy and Download actions'],
                ['About', 'Genius song description, rendered as prose'],
                ['Credits', 'Producer, writer, performer, engineer credits from Genius'],
                ['Annotations', 'Per-line Genius annotations; user annotations can be added'],
              ]}
            />
          </SubSection>

          <SubSection id="lyrics" title="Lyrics">
            <p>
              Lyrics are fetched from Genius on first view and cached in the{' '}
              <code className="text-accent">lyrics</code> table. The request is recorded in the{' '}
              <code className="text-accent">history</code> table as a <code className="text-accent">lyrics_read</code> event.
              If lyrics are not available for a song, the Lyrics tab shows a &quot;Not available&quot; message.
            </p>
          </SubSection>

          <SubSection id="credits" title="Credits & Annotations">
            <p>
              Credits come from Genius&apos;s <code className="text-accent">custom_performances</code> field
              on the song object. Each credit has a role (e.g. &quot;Produced by&quot;, &quot;Written by&quot;,
              &quot;Mixed by&quot;) and one or more artist names. Credits are stored in the{' '}
              <code className="text-accent">credits</code> table and displayed in the Credits tab.
            </p>
            <p>
              Annotations are fetched by scraping the Genius web page for the song and parsing the annotated
              lyric regions. User annotations can be added from the Annotations tab and are stored locally
              in the <code className="text-accent">annotations</code> table.
            </p>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 6. Visualization                                           */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="visualization" title="Visualization">
          <SubSection id="galaxy-view" title="Galaxy View">
            <p>
              The Galaxy view (<code className="text-accent">/visualize/[artist-id]</code>) renders an
              artist&apos;s entire discography as an interactive canvas. Each song is a node whose size is
              proportional to its Genius pageviews. Songs from the same album share a colour (violet for
              album tracks, blue for singles and loosies).
            </p>
            <p>
              Nodes drift slowly across the canvas using simple Newtonian physics: constant velocity with
              elastic bouncing at the canvas edges. The drift is intentional — it makes the constellation
              feel alive rather than static.
            </p>
          </SubSection>

          <SubSection id="viz-navigation" title="Navigation">
            <p>Access the Visualization section from the sidebar (the dot-constellation icon), then search for or select an artist from your history. From any artist page, the <strong>Visualize</strong> button in the action row takes you directly to that artist&apos;s galaxy.</p>
          </SubSection>

          <SubSection id="connection-types" title="Connection Types">
            <Table
              headers={['Type', 'Colour', 'Meaning']}
              rows={[
                ['Collaborator', 'Violet (#a78bfa)', 'Two songs share at least one credited performer'],
                ['Producer', 'Green (#34d399)', 'Two songs share the same producer credit'],
                ['Era', 'Amber (#f59e0b)', 'Two songs were released within 2 years of each other'],
              ]}
            />
            <p>Connection lines are toggled in the VizControls panel. All three types can be active simultaneously.</p>
          </SubSection>

          <SubSection id="viz-controls" title="VizControls Panel">
            <p>The left panel in the Galaxy view provides:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Connections</strong> — toggles for Collaborator, Producer, and Era connection lines</li>
              <li><strong>Min. Pageviews</strong> — slider to hide songs below a certain popularity threshold (useful for artists with 500+ songs)</li>
              <li><strong>Node count</strong> — shows how many nodes are visible with the current filter</li>
            </ul>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 7. History & Tags                                          */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="history-tags" title="History & Tags">
          <SubSection id="history-tracking" title="History Tracking">
            <p>
              EchoGraph records events automatically as you use Phonolith. No opt-in is required.
            </p>
            <Table
              headers={['Event', 'Trigger']}
              rows={[
                ['lyrics_read', 'Lyrics tab is opened for a song'],
                ['lyrics_download', 'Download button is clicked on the Lyrics tab'],
                ['lyrics_marked_read', 'Mark as read button is clicked on the Lyrics tab'],
              ]}
            />
            <p>
              The History page shows a chronological log with the artist name, song title, event type, and
              timestamp. Events can be filtered by artist, event type, and date range. The same history data
              powers the &quot;Recently explored&quot; section on the home page and the artist picker on the
              Visualize landing page.
            </p>
          </SubSection>

          <SubSection id="tags" title="Tags">
            <p>
              Tags are user-defined labels that can be applied to any song. They are stored in the{' '}
              <code className="text-accent">tags</code> and <code className="text-accent">song_tags</code>{' '}
              tables. A tag has a name and an optional colour. Songs can have multiple tags.
            </p>
            <p>
              The Tags page (<code className="text-accent">/tags</code>) shows all tags and the number of songs
              with each tag. Clicking a tag filters the library to songs with that tag. Tags can be added and
              removed from song pages.
            </p>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 8. Settings                                                */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="settings" title="Settings">
          <SubSection id="api-keys" title="API Keys">
            <Table
              headers={['Key', 'Where to Get', 'Required']}
              rows={[
                ['GENIUS_ACCESS_TOKEN', 'genius.com/api-clients — create a client, copy the Access Token', 'Yes'],
                ['DISCOGS_USER_TOKEN', 'discogs.com/settings/developers — generate a Personal Access Token', 'No'],
                ['ACOUSTID_API_KEY', 'acoustid.org/login — register an application', 'No'],
                ['AWS_ACCESS_KEY_ID', 'AWS IAM console — create a user with s3:PutObject', 'No (Aegis only)'],
                ['AWS_SECRET_ACCESS_KEY', 'AWS IAM console — same user as above', 'No (Aegis only)'],
              ]}
            />
          </SubSection>

          <SubSection id="runtime-keys" title="Runtime Key Management">
            <p>
              All API keys can be updated at runtime from the Settings page without restarting the Docker stack.
              When you save a key via the UI, it is stored encrypted in the{' '}
              <code className="text-accent">app_settings</code> PostgreSQL table and cached in Redis with a
              60-second TTL. All subsequent API calls read from this cache first, then the database, then the
              environment variable.
            </p>
            <p>
              A key set via the UI takes precedence over one set in the <code className="text-accent">.env</code>{' '}
              file. To revert to the environment variable, click the <strong>Clear</strong> link next to the
              stored key. The Settings page shows whether each key is &quot;Saved in database&quot;,
              &quot;Set via environment&quot;, or &quot;Not configured&quot;.
            </p>
          </SubSection>

          <SubSection id="backup-settings" title="S3 Backup (Aegis)">
            <p>
              Fill in S3 Bucket and Region, then click <strong>Backup Now</strong>. Aegis runs a{' '}
              <code className="text-accent">pg_dump</code> inside the app container, compresses it, and uploads
              it to <code className="text-accent">s3://{'{bucket}'}/phonolith-backup-{'{timestamp}'}.sql.gz</code>.
            </p>
            <Tip>
              The S3 bucket should have Object Lock enabled (Compliance mode) for truly immutable backups.
              This prevents deletion of backup objects even by the account owner, protecting against
              ransomware or accidental bucket deletion.
            </Tip>
          </SubSection>

          <SubSection id="port-config" title="Port Configuration">
            <p>
              Default ports can be overridden in your <code className="text-accent">.env</code> file without
              modifying <code className="text-accent">docker-compose.yml</code>:
            </p>
            <CodeBlock>{`APP_PORT=3000      # Next.js web interface
ANALYST_PORT=8000  # Python analyst sidecar`}</CodeBlock>
            <p>
              The database (5432) and Redis (6379) ports are not exposed to the host by default. To expose
              them for debugging, uncomment the relevant <code className="text-accent">ports:</code> section
              in <code className="text-accent">docker-compose.yml</code>.
            </p>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 9. API Reference                                           */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="api-reference" title="API Reference">
          <SubSection id="api-search" title="Search">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/search?q=query', 'Search artists by name. Returns array of artist objects.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-artist" title="Artist">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/artist/[id]', 'Get artist by Genius ID. Fetches from Genius on cache miss.'],
                ['GET', '/api/artist/[id]/songs', 'Paginated songs for artist. ?page=1&per_page=20'],
                ['GET', '/api/artist/[id]/songs/all', 'All songs for artist (loops Genius pages). Slow on first call.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-song" title="Song">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/song/[id]', 'Get song by Genius ID.'],
                ['GET', '/api/song/[id]/lyrics', 'Get or scrape lyrics. Records history event.'],
                ['GET', '/api/song/[id]/credits', 'Get credits from Genius custom_performances.'],
                ['GET', '/api/song/[id]/about', 'Get song description.'],
                ['GET', '/api/song/[id]/annotations', 'Get Genius annotations (scraped).'],
                ['POST', '/api/song/[id]/tags', 'Add tag to song. Body: {tag_id: number}'],
                ['DELETE', '/api/song/[id]/tags/[tagId]', 'Remove tag from song.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-library" title="Library">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/library', 'List all library_files rows with match status.'],
                ['GET', '/api/library/[hash]', 'Single file detail by BLAKE3 hash.'],
                ['GET', '/api/library/sources', 'List all configured library sources.'],
                ['POST', '/api/library/sources', 'Add a new source. Body: {name, type, config}'],
                ['DELETE', '/api/library/sources/[id]', 'Delete a source.'],
                ['POST', '/api/library/sources/[id]/test', 'Test source connectivity.'],
                ['POST', '/api/library/sources/[id]/scan', 'Trigger a scan of this source.'],
                ['POST', '/api/library/ping', 'TCP ping test. Body: {host, port?}'],
                ['GET', '/api/library/status', 'Analyst scan status (proxy to analyst /status).'],
                ['POST', '/api/library/ingest', 'Internal: upsert library_files. Called by analyst.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-engram" title="Engram — Metadata Version History">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/engram/[hash]', 'Last 50 metadata snapshots for a file, newest first. Returns array of {id, snapshot, source, note, created_at}.'],
                ['POST', '/api/engram/[hash]/restore', 'Restore a prior snapshot. Body: {version_id: number, fields?: string[]}. Auto-snapshots current state before restore.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-lucid" title="Lucid — Playback Control">
            <p>
              These routes proxy to the Lucid sidecar (port 8001). They return 503 if Lucid is offline.
            </p>
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/lucid/status', 'Lucid signal path state and queue. Reads from Redis key lucid:signal_path.'],
                ['POST', '/api/lucid/play', 'Start playback. Body: {hash: string} — BLAKE3 hash of the track.'],
                ['POST', '/api/lucid/pause', 'Pause current playback.'],
                ['POST', '/api/lucid/resume', 'Resume paused playback.'],
                ['POST', '/api/lucid/stop', 'Stop playback and release the ALSA device.'],
                ['POST', '/api/lucid/seek', 'Seek within the current track. Body: {position: number} — seconds.'],
                ['GET', '/api/lucid/devices', 'Available ALSA output devices and discovered AirPlay endpoints.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-versions" title="Versions — Multi-Version Comparison">
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/api/versions', 'Albums with multiple library files (different masters/pressings). Returns albums with version count.'],
                ['GET', '/api/versions/[albumId]', 'All versions of an album with DR scores, bit-depth, sample-rate, format, and quality tier badge.'],
              ]}
            />
          </SubSection>

          <SubSection id="api-analyst" title="Analyst Sidecar (port 8000)">
            <p>
              The analyst sidecar exposes its own HTTP API. These routes are called by the Next.js app and
              are not intended for direct use, but can be useful for debugging.
            </p>
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/health', 'Health check. Returns {status: "ok"}'],
                ['GET', '/status', 'Full scan status: phase, progress, errors, watcher state.'],
                ['POST', '/scan', 'Trigger local library scan. Body: {path: string}'],
                ['POST', '/scan-source', 'Trigger source scan. Body: {source_id, type, config, name}'],
                ['POST', '/test-source', 'Test source connectivity. Body: {type, config}'],
                ['POST', '/ping', 'TCP ping. Body: {host, port?}'],
                ['GET', '/file/[hash]', 'Get indexed file record by hash.'],
                ['POST', '/fingerprint', 'AcoustID fingerprint a file. Body: {path}'],
                ['GET', '/waveforms/[hash].png', 'Serve waveform image (if rendered).'],
              ]}
            />
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 10. Deployment                                             */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="deployment" title="Deployment">
          <SubSection id="deploy-docker" title="Docker Compose">
            <p>The recommended deployment is via Docker Compose. All four services (app, analyst, db, redis) are defined in <code className="text-accent">docker-compose.yml</code> in the repository root.</p>
            <CodeBlock>{`# Start all services (rebuild images)
docker compose up --build

# Start in background
docker compose up -d --build

# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes all data)
docker compose down -v

# View logs
docker compose logs -f
docker compose logs -f app
docker compose logs -f analyst`}</CodeBlock>
          </SubSection>

          <SubSection id="deploy-env" title="Environment Variables">
            <Table
              headers={['Variable', 'Default', 'Description']}
              rows={[
                ['GENIUS_ACCESS_TOKEN', '(none)', 'Genius API access token. Required.'],
                ['DATABASE_URL', 'postgresql://phonolith:phonolith@db:5432/phonolith', 'PostgreSQL connection string.'],
                ['REDIS_URL', 'redis://redis:6379', 'Redis connection string.'],
                ['ANALYST_URL', 'http://analyst:8000', 'Analyst sidecar base URL.'],
                ['MUSICBRAINZ_APP_NAME', 'Phonolith', 'User-Agent app name for MusicBrainz.'],
                ['MUSICBRAINZ_APP_VERSION', '1.0', 'User-Agent app version for MusicBrainz.'],
                ['MUSICBRAINZ_CONTACT', '(none)', 'Your email for MusicBrainz User-Agent.'],
                ['DISCOGS_USER_TOKEN', '(none)', 'Discogs Personal Access Token. Optional.'],
                ['ACOUSTID_API_KEY', '(none)', 'AcoustID application key. Optional.'],
                ['S3_BUCKET', '(none)', 'S3 bucket name for Aegis backups.'],
                ['S3_REGION', '(none)', 'AWS region for S3 bucket.'],
                ['AWS_ACCESS_KEY_ID', '(none)', 'AWS IAM access key for S3.'],
                ['AWS_SECRET_ACCESS_KEY', '(none)', 'AWS IAM secret key for S3.'],
                ['LIBRARY_PATH', '(empty)', 'Host path mounted into analyst container as /music.'],
                ['APP_PORT', '3000', 'Host port for the Next.js app.'],
                ['ANALYST_PORT', '8000', 'Host port for the analyst sidecar.'],
                ['LUCID_URL', 'http://lucid:8001', 'Base URL of the Lucid playback sidecar (audio profile only).'],
                ['LUCID_PORT', '8001', 'Host port for Lucid (audio profile only).'],
                ['CREDENTIAL_KEY', '(none)', 'AES-256-GCM key for encrypting SMB/NFS credentials. Generate: openssl rand -hex 32. Falls back to SHA-256 of DATABASE_URL if unset (not for production).'],
              ]}
            />
          </SubSection>

          <SubSection id="deploy-reverse-proxy" title="Reverse Proxy (Nginx / Caddy)">
            <p>To expose Phonolith on a custom domain with HTTPS, put a reverse proxy in front of the app container.</p>
            <SubSubSection title="Nginx">
              <CodeBlock>{`server {
    listen 443 ssl;
    server_name phonolith.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/phonolith.crt;
    ssl_certificate_key /etc/ssl/private/phonolith.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`}</CodeBlock>
            </SubSubSection>
            <SubSubSection title="Caddy">
              <CodeBlock>{`phonolith.yourdomain.com {
    reverse_proxy localhost:3000
}`}</CodeBlock>
            </SubSubSection>
            <Warning>
              Do not expose the analyst sidecar (port 8000) to the public internet. It has no authentication.
              It should remain internal to the Docker network or your LAN.
            </Warning>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* 11. Troubleshooting                                        */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Section id="troubleshooting" title="Troubleshooting">
          <SubSection id="ts-smb" title="SMB Issues">
            <Table
              headers={['Symptom', 'Likely Cause', 'Fix']}
              rows={[
                ['Ping fails', 'Port 445 blocked or NAS offline', 'Check firewall rules; verify NAS is online and SMB service is running'],
                ['Auth/share error: dialect not supported', 'SMB1 only enabled on NAS', 'Enable SMB2 or SMB3 in NAS settings'],
                ['"Host and share name are required"', 'Empty fields in source config', 'Re-add the source and fill in all required fields'],
                ['Auth error after correct credentials', 'Domain missing', 'Add the Windows domain or workgroup in the Domain field'],
                ['Files found: 0', 'Wrong share name or subfolder', 'Share names are case-sensitive — check exact name in NAS UI'],
                ['Scan very slow', 'Running deep analysis on SMB', 'Fast scan (no librosa) is the default; deep analysis is a future separate pass'],
              ]}
            />
          </SubSection>

          <SubSection id="ts-migrations" title="Database Migrations">
            <p>
              Migrations run automatically on app startup via the instrumentation hook. If you see a{' '}
              <code className="text-accent">42P01 relation does not exist</code> error, the migration hook
              may not have run. Check:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>The app logs for <code className="text-accent">[db] applied migration:</code> lines on startup</li>
              <li>That <code className="text-accent">experimental.instrumentationHook: true</code> is set in <code className="text-accent">next.config.mjs</code></li>
              <li>That <code className="text-accent">src/instrumentation.ts</code> exists and exports <code className="text-accent">register()</code></li>
              <li>That <code className="text-accent">src/migrations/</code> was copied into the Docker image (check Dockerfile runner stage)</li>
            </ul>
          </SubSection>

          <SubSection id="ts-scan" title="Scan Problems">
            <Table
              headers={['Symptom', 'Likely Cause', 'Fix']}
              rows={[
                ['Scan starts but 0 files indexed', 'No audio files match supported extensions', 'Verify share contains .flac/.mp3/.m4a etc.'],
                ['Progress stuck at "Discovering"', 'Walk is slow on large share', 'Normal — NAS directory listings over SMB are slower than local disk'],
                ['Many errors in scan log', 'Files locked by another process', 'Ensure no other software has exclusive locks on the files'],
                ['Ingest fails with 500', 'library_files table missing', 'See Database Migrations above'],
              ]}
            />
          </SubSection>

          <SubSection id="ts-genius" title="Genius API Issues">
            <Table
              headers={['Symptom', 'Fix']}
              rows={[
                ['Test button shows "Genius API returned 401"', 'Token is invalid or expired. Regenerate at genius.com/api-clients.'],
                ['Test passes but search returns no results', 'Artist name may be too ambiguous. Try a more specific query.'],
                ['Lyrics show "Not available"', 'Genius may not have lyrics for this song, or the scraping failed. Try again later.'],
                ['GENIUS_ACCESS_TOKEN not set (after saving in UI)', 'Redis cache may still hold the old null value. Wait 60 seconds and retry, or restart Redis.'],
              ]}
            />
          </SubSection>
        </Section>
      </main>
    </div>
  )
}
