# Phonolith Frontend — Developer Reference

This document describes the entire frontend UI layer of Phonolith: every page route, every
component, every hook/context, the design tokens, and the realtime data-flow patterns used for
playback. It is written so a developer can understand the frontend without opening the source.

Phonolith itself is a self-hosted, Docker-native music library manager. The frontend is one of
several containers (see `app/docs` for the full subsystem architecture); this document covers only
`src/app`, `src/components`, `src/contexts`, `src/hooks`, and the Tailwind design tokens.

---

## 1. Overview

- **Framework**: Next.js 14, App Router (`src/app/**/page.tsx`, one `layout.tsx` at the root).
- **Language**: TypeScript throughout, strict-ish typing via `src/lib/types.ts` (shared interfaces
  for `Artist`, `Song`, `LibraryFile`, `SignalPathState`, `LucidStatus`, etc.).
- **Styling**: Tailwind CSS with a small custom dark-theme palette (see §6).
- **Rendering model**: Almost every page and component in this codebase is a **client component**
  (`'use client'` at the top of the file). There is no server-rendered data fetching via React
  Server Components / `fetch` in the page bodies — every page mounts, then fetches its data from
  Next.js API routes (`/api/**`) with plain `fetch()` inside `useEffect`, and renders a skeleton
  (`animate-pulse` placeholder blocks) while loading. This is a fully client-rendered SPA-style
  pattern layered on top of the App Router, not a server-rendering-heavy Next.js app.
  - The only server-side gating is authentication, which happens in `middleware.ts` (not part of
    this document's scope) calling `/api/auth/session-status`; `layout.tsx` itself is a plain
    shared UI shell and contains no auth logic.
  - Pages that read the URL query string (`/`, `/library`, `/visualize`) wrap their real content in
    a `<Suspense>` boundary because `useSearchParams()` requires it under the App Router.
  - Dynamic route params are read with `useParams()` from `next/navigation` (client-side), e.g.
    `const { hash } = useParams<{ hash: string }>()`.
- **State management**: No Redux/Zustand/etc. State is local `useState`/`useRef` per page, plus two
  purpose-built app-wide pieces of shared state:
  - `BrowserPlayerContext` (`src/contexts/BrowserPlayerContext.tsx`) — one shared instance of the
    in-browser gapless audio player (`useGaplessPlayer`), so playback started from any page is
    visible/controllable from the global `PlaybackBar`.
  - `src/lib/endpoint.ts` — a tiny module-level pub/sub store (not React context) for "which output
    endpoint is selected" (browser / ALSA / AirPlay), persisted to `localStorage`.
- **Data fetching pattern**: plain `fetch()` to same-origin `/api/*` Next.js route handlers, almost
  always wrapped in try/catch/finally with a `loading` boolean and an `animate-pulse` skeleton.
  Several pages combine this with:
  - **Debounced search-as-you-type** (`setTimeout`/`clearTimeout` in a ref), e.g. the home page
    artist search, the Library files search, the Soulcatcher-adjacent visualize search.
  - **Polling** for background jobs: library scan progress (`/api/library/status` every 2–3s),
    Soulcatcher downloads (`/api/soulcatcher/downloads` every 4s while anything is queued), the
    Polyphony peer feed (every 15s), and the Lucid playback bar (every 2s, see §5).
  - **Optimistic UI updates** with rollback on failure, e.g. tag deletion in `/tags`, the
    auto-deep-analysis toggle in `/library`.

---

## 2. Page Map

All pages live under `src/app` and are client components unless noted. Layout: `src/app/layout.tsx`
wraps every page in `<BrowserPlayerProvider>`, and renders `<Sidebar>`, `<Notifications>`, and the
global `<PlaybackBar>` around `{children}` (main content gets `ml-16 pb-16` to clear the fixed
sidebar and bottom playback bar). There are no nested `layout.tsx` files — this is the only layout
in the app.

| Route | File | Renders | Calls | Notes |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Artist search home page: hero search box, result grid, "Recently Explored" chips | `GET /api/history?limit=50`, `GET /api/search?q=` | Debounced (300 ms) search-as-you-type; wrapped in `<Suspense>` for `useSearchParams()`; seeds `q` from the URL |
| `/library` | `src/app/library/page.tsx` | Library browser: Albums grid / Files table toggle, format/DR/match filters, scan controls, live scan-progress popover | `GET /api/library`, `GET /api/library/status`, `GET /api/library/albums`, `GET /api/settings/scan`, `POST /api/library/scan`, `POST /api/library/deep-scan-pending`, `PUT /api/settings/scan` | Renders `AlbumTile` for the albums grid; polls `/api/library/status` every 3s while a scan is active; play/pause buttons per file use `useBrowserPlayer()` |
| `/library/[hash]` | `src/app/library/[hash]/page.tsx` | Single file detail: metadata form, DR/spectral badges, waveform image, Engram version history tab, pressing lookup, play/queue/deep-scan actions | `GET /api/library/:hash`, `PATCH /api/library/:hash/metadata`, `POST /api/library/:hash/match`, `POST /api/library/:hash/deep-scan`, `GET /api/library/:hash/pressing`, `GET /api/engram/:hash`, `POST /api/engram/:hash/restore`, `POST /api/lucid/play`, `POST /api/lucid/queue/add`, `GET /api/waveforms/:hash` (as an `<img>`) | Has both a "Play" (Lucid/ALSA) button and a "Play in Browser" button (`useBrowserPlayer().playQueue([hash])`); shows the live `signalPath` (source/output sample rate, bit-perfect flag) when this file is the browser player's current track |
| `/artist/[id]` | `src/app/artist/[id]/page.tsx` | Artist hero (blurred background image), Albums/Songs toggle, collapsible album sections, About sidebar | `GET /api/artist/:id`, `GET /api/artist/:id/songs?all=true`, per-song `GET /api/song/:id/lyrics` (bulk "Download All Lyrics") | Groups songs client-side by `album_name`; "Download All Lyrics" builds a text blob client-side and triggers a browser download |
| `/artist/[id]/library` | `src/app/artist/[id]/library/page.tsx` | Table of library files whose matched song artist matches this artist | `GET /api/artist/:id`, `GET /api/library` (filtered client-side by `song_artist`) | Simple read-only table with DR/format/match columns |
| `/song/[id]` | `src/app/song/[id]/page.tsx` | Song detail with 4 tabs: Lyrics, About, Credits, Annotations | `GET /api/song/:id`, `GET /api/song/:id/lyrics`, `GET /api/song/:id/about`, `GET /api/song/:id/credits`, `GET /api/song/:id/annotations`, `POST /api/song/:id/annotations`, `POST /api/history` (mark-as-read) | Annotations tab does fragment-matching of Genius + user annotations against lyric lines client-side; lyrics can be copied or downloaded as `.txt` |
| `/versions` | `src/app/versions/page.tsx` | List of albums with multiple library "versions" (different masters/pressings/formats) | `GET /api/versions` | Read-only list linking into the per-album comparison page |
| `/versions/[albumId]` | `src/app/versions/[albumId]/page.tsx` | Per-album version comparison: quality tiers, DR badges, expandable per-version track lists | `GET /api/versions/:albumId` | Client-side "recommendation" logic picks the best version by format/bit-depth/DR |
| `/visualize` | `src/app/visualize/page.tsx` | Landing page: artist search + recently-explored grid, links into the galaxy view | `GET /api/history`, `GET /api/search?q=` | Debounced search; wrapped in the page (no explicit `<Suspense>` needed since it doesn't read `useSearchParams`) |
| `/visualize/[id]` | `src/app/visualize/[id]/page.tsx` | Full-screen force-directed "galaxy" canvas of an artist's songs plus a left-hand `VizControls` filter panel | `GET /api/artist/:id`, `GET /api/visualize/:id`, `GET /api/visualize/:id/connections` | Defines its own inline `VizControls` and `ArtistViz` (canvas physics sim with drift+bounce, `requestAnimationFrame` loop); **not** the same component as `src/components/ArtistViz.tsx` / `VizControls.tsx` (see §3 note on unused components) |
| `/history` | `src/app/history/page.tsx` | Tabbed analytics: Overview (Recharts area/bar charts), Ghost Report, Completeness, Log | `GET /api/history/stats`, `GET /api/history/ghost`, `GET /api/history/completeness`, `GET /api/history?limit=200` | Each tab lazy-loads its data once, on first visit to that tab (tracked via a `useRef<Set<Tab>>`); uses the `recharts` library for the Overview charts |
| `/tags` | `src/app/tags/page.tsx` | Tag pill grid, colour picker + create form, optimistic delete | `GET /api/tags`, `POST /api/tags`, `DELETE /api/tags/:id` | Fixed 6-colour palette; deleting is optimistic with rollback on failure |
| `/settings` | `src/app/settings/page.tsx` | Multi-section settings: API Keys, Playback, Library Sources, Backup, Remote Access, Soulcatcher, Metadata write-back, Polyphony, Appearance | Many endpoints — `/api/settings/keys`, `/api/settings/genius`, `/api/lucid/devices`, `/api/lucid/status`, `/api/library/sources*`, `/api/backup`, `/api/polyphony/*` | Largest page; each section is its own sub-component (`ApiKeyField`, `PlaybackSection`, `LibrarySourcesSection` which renders `AddLibrarySource`, `BackupSection`, `MetadataSection`, `PolyphonySection`) |
| `/cathode` | `src/app/cathode/page.tsx` | Hardware profile tracker: list/add/edit/delete audio-chain profiles with burn-in hours | `GET/POST/PUT/DELETE /api/cathode/profiles[/:id]` | Inline inline-editable cards; components/roles use a `<datalist>` of preset roles |
| `/polyphony` | `src/app/polyphony/page.tsx` | Feed of paired peer instances and what they're currently playing | `GET /api/polyphony/feed`, `GET /api/polyphony/peers` | Polls every 15s |
| `/polyphony/[id]/library` | `src/app/polyphony/[id]/library/page.tsx` | Browsable file list of a single peer's shared library | `GET /api/polyphony/peers/:id/library` | Playback uses a plain `new Audio(...)` element pointed at `/api/polyphony/peers/:id/stream/:hash` — **not** the gapless player |
| `/soulcatcher` | `src/app/soulcatcher/page.tsx` | Soulseek (via slskd sidecar) search + download queue manager | `GET /api/soulcatcher/status`, `GET /api/soulcatcher/search?q=`, `POST /api/soulcatcher/download`, `GET /api/soulcatcher/downloads`, `POST /api/soulcatcher/downloads/:id/ingest` | Polls downloads every 4s while anything is queued/downloading |
| `/docs` | `src/app/docs/page.tsx` | Long-form static documentation page (this is Phonolith's *in-app* user/admin manual, distinct from this developer doc) | none (fully static content) | Sticky table-of-contents sidebar with `IntersectionObserver`-driven active-section highlighting; content covers architecture, all named subsystems (ResonanceFS, Tremor, Engram, Lexicon, Prism, Crest, Aegis, Bit-Forge, Lucid, Flux, EchoGraph, Cathode, Polyphony, Sonic Codex), library setup, deployment, troubleshooting |
| `/login` | `src/app/login/page.tsx` | Username/password sign-in form | `GET /api/auth/setup` (redirects to `/setup` if no admin exists yet), `POST /api/auth/login` | On success, `router.push('/')` + `router.refresh()` |
| `/setup` | `src/app/setup/page.tsx` | First-run admin account creation form | `GET /api/auth/setup`, `POST /api/auth/setup` | Client-side password length/match validation before submit |

---

## 3. Component Reference

All components live under `src/components/`. Unless noted, each is a client component
(`'use client'`).

### Playback components (core focus)

#### `PlaybackBar.tsx`
The single global playback bar, rendered once in `layout.tsx` below `{children}` (`fixed bottom-0
left-16 right-0`). It renders **two structurally different UIs** depending on which output endpoint
is selected (via `useSelectedEndpoint()` from `src/lib/endpoint.ts`) and whether the browser player
actually has a track loaded:

- **Browser-active UI** (`isBrowserActive = endpoint.type === 'browser' && browserPlayer.currentHash !== null`):
  driven entirely by `useBrowserPlayer()` (the shared `useGaplessPlayer` instance from
  `BrowserPlayerContext`). Shows a `SeekBar` bound to `browserPlayer.currentTime` /
  `browserPlayer.duration`, calling `browserPlayer.seek` on scrub; a play/pause button calling
  `pause()`/`resume()`; a stop button calling `stop()`; a **quality selector**
  (`<select>` of `lossless / opus-128 / opus-96 / opus-64 / opus-32`) bound to
  `browserPlayer.quality` → `browserPlayer.setQuality(...)`; and the endpoint-picker button.
  The track name is resolved separately (the player only knows the file hash) by fetching
  `GET /api/library/:hash` whenever `browserPlayer.currentHash` changes.
- **Lucid-driven UI** (ALSA/AirPlay, i.e. `!isBrowserActive`): driven by `LucidStatus` state
  (`signal_path` + `queue`) obtained via **WebSocket `/ws/state` with an HTTP polling fallback**
  (see §5 for the full mechanism). Renders a `SeekBar` bound to `sp.position_ms`/`sp.duration_ms`
  that calls `cmd('seek', { ms })` (a `POST /api/lucid/seek`) on scrub; prev/play-pause/next/stop
  buttons that call `POST /api/lucid/queue/prev`, `/pause` or `/resume`, `/queue/next`, `/stop`
  respectively (each followed by a `setTimeout(poll, 300)` to refresh state quickly rather than
  waiting for the next scheduled poll); a bit-depth/sample-rate badge coloured by `sp.bit_perfect`;
  and a **"Signal Path" (Glass-Box) toggle button** that opens a full-screen modal overlay
  (`showSignalPath` state) containing the `<SignalPath>` diagram plus a technical detail grid
  (sample rate, bit depth, channels, format, decoder, transport, device, endpoint) and, if
  `sp.dsp_chain.length > 0`, a warning callout listing the active DSP chain. The always-visible
  (non-modal) `<SignalPath>` mini-diagram is also shown inline above the transport controls
  whenever a track is loaded (`hidden lg:block`).
  A compact non-modal signal-path strip is shown above the controls on large screens even without
  opening the Glass-Box overlay.
- Both UIs share the same **endpoint picker button** (opens `<EndpointPickerModal>`) showing
  `endpointLabel(endpoint)` (e.g. "This Browser", "ALSA: hw:0,0", "AirPlay: Living Room").
- **Polyphony "now playing" presence beacon**: a local `postNowPlaying(title, artist)` helper
  (module-level `lastNowPlayingTitle` dedupe so it doesn't spam identical values) fires
  `POST /api/polyphony/now-playing` whenever the currently-playing title changes, whether the
  source is the browser player (resolved via the `/api/library/:hash` fetch above) or Lucid
  (resolved from `status.queue.current`, basenamed).
- Returns `null` entirely if nothing is playing/active on either path (`!isBrowserActive && (!online || !status)`).

#### `SeekBar.tsx`
A generic, endpoint-agnostic scrub bar used by **both** playback UIs in `PlaybackBar`. Props:
```ts
{ positionMs: number; durationMs: number; onSeek: (ms: number) => void; className?: string }
```
Everything is in **milliseconds**. It renders a thin visual track (`h-1`) inside a taller invisible
hit-area (`h-4`, so it's easy to grab, unlike a bare 2px bar) and supports both click-to-seek and
click-and-drag via the Pointer Events API (`onPointerDown`/`onPointerMove`/`onPointerUp`, with
`setPointerCapture`/`releasePointerCapture` so drags tracked outside the element still register).
Position is computed purely from `clientX` vs. the bar's `getBoundingClientRect()`, clamped to
`[0, durationMs]`, and passed to `onSeek`. It has no internal notion of *which* player it's
controlling — the caller passes different `onSeek` callbacks (`browserPlayer.seek` for the browser
path, `ms => cmd('seek', { ms })` → `POST /api/lucid/seek` for the Lucid path).

#### `SignalPath.tsx`
The "Glass-Box" bit-perfect / format-conversion visualizer. Takes a `SignalPathState` (Lucid's
current playback state) and renders a horizontal chain of `PathNode` cards — **Source → Decoder →
[DSP, only if `dsp_chain.length > 0`] → Transport → Endpoint** — connected by animated `Connector`
lines. Each node shows a stage label, a detail line (e.g. source bit-depth/sample-rate/format,
decoder name, transport type, endpoint name), and, where relevant, a "● Bit-perfect" (green) or
"● Converted" (amber) badge. When `status === 'playing'`, the connectors animate a small dot
sliding left-to-right via a CSS `@keyframes signal-flow` animation (`1.6s linear infinite`) to
visually suggest audio actually flowing through the chain; when paused/stopped, everything renders
dimmed/static (`opacity-30`, no animation). This is a pure, side-effect-free presentational
component — all its data comes from props (no independent fetching).

#### `EndpointPickerModal.tsx`
A full-screen modal (`onClose` prop) letting the user choose the active output endpoint: **This
Browser**, or any **ALSA device** / **AirPlay receiver** discovered from Lucid. On mount it fetches
`GET /api/lucid/devices`; if Lucid is offline or errors, it shows "Lucid is offline — only browser
playback is available" and only the Browser row is selectable. It reads/writes the selection via
`useSelectedEndpoint()` from `src/lib/endpoint.ts` — selecting a row calls `setEndpoint(e)` then
`onClose()`. Each row (`EndpointRow`) shows a label, a one-line description of what that endpoint
means (Web Audio API / "bit-perfect on supported hardware" / "Streamed over AirPlay (RAOP)"), and a
filled dot if currently selected.

### Library / browsing components

#### `AlbumTile.tsx`
Grid tile for the Library page's Albums view. Props are spread directly from `AlbumSummary`
(`album, artist, year, track_count, cover_hash, has_cover`). Links to
`/library?album=…&artist=…` (i.e. switches the Library page into its filtered Files view). Shows
the cover via `GET /api/library/:cover_hash/cover`, falling back to a music-note placeholder SVG on
load error (`imgError` state) or when `has_cover` is false.

#### `LibraryTable.tsx` *(currently unused — see note below)*
A self-contained library file table with its own format/DR/match `<select>` filters, DR badges, and
quality checkmarks. Not imported by any page — `src/app/library/page.tsx` implements an equivalent
table inline instead. Kept here as documented in case it is wired back in.

#### `Waveform.tsx` *(currently unused — see note below)*
Renders `<img src="/api/waveforms/:hash">` with an error fallback ("Waveform not available").
`src/app/library/[hash]/page.tsx` renders the same `/api/waveforms/:hash` image inline rather than
importing this component.

### Artist / song / lyrics components

#### `ArtistCard.tsx` *(currently unused)*
Simple artist grid tile (image, name, "View discography →"). `src/app/page.tsx` (home search)
implements its own equivalent tile inline instead of importing this.

#### `AlbumGroup.tsx` *(currently unused)*
Renders an album header (cover, name, year, track count) plus a list of `SongRow` components for
its songs. Only consumer in the codebase is a demonstration of the pattern — no page imports it;
`src/app/artist/[id]/page.tsx` implements its own inline `AlbumSection`/`SongRow` instead.

#### `SongRow.tsx` *(currently unused by any page — only consumed by `AlbumGroup.tsx`, which is itself unused)*
Single song row: track number, art thumbnail, title, `TagBadge` list, year, "Lyrics" link. Props:
`{ id, geniusId, title, releaseDate?, songArtUrl?, trackNumber?, tags? }`.

#### `TagBadge.tsx` *(currently unused by any page — only consumed by `SongRow.tsx`)*
Small coloured pill for a tag: `{ name, color?, onRemove?, variant?: 'accent' | 'muted' }`. The
actual `/tags` page and `/artist/[id]` page each implement their own inline tag-pill markup instead.

#### `CreditsTable.tsx` *(currently unused)*
Groups a `Credit[]` list by role into a two-column table, with a "Primary Artist" row prepended if
supplied. `src/app/song/[id]/page.tsx`'s `CreditsTab` implements the same grouping logic inline.

#### `LyricsView.tsx` *(currently unused)*
Copy/download/mark-as-read toolbar plus a `<pre>` lyrics block. `src/app/song/[id]/page.tsx`'s
`LyricsTab` implements the same behaviour inline (with additional artwork/metadata layout).

#### `AnnotationsView.tsx` *(currently unused)*
Click-a-line-to-expand-its-annotation UI with an inline "add note" form, matching annotation
fragments against lyric lines via substring matching. `src/app/song/[id]/page.tsx`'s
`AnnotationsTab` implements the same interaction pattern inline (with a slightly different, exact
`line.includes(fragment)` match rather than this component's lower-cased 20-char-prefix match).

> **Note on unused components**: `ArtistCard`, `AlbumGroup`, `SongRow`, `TagBadge`, `CreditsTable`,
> `LyricsView`, `AnnotationsView`, `LibraryTable`, `Waveform`, `ArtistViz`, and `VizControls` (the
> two under `src/components/`, as opposed to the inline versions defined directly inside
> `src/app/visualize/[id]/page.tsx`) are **not imported by any page route** in the current codebase
> (confirmed by grepping for their import paths across `src/app` and `src/components`). Every page
> that needs equivalent functionality currently reimplements it inline instead. These files appear
> to be an earlier, more "reusable component library"-style iteration of the UI that the page-level
> code has since diverged from. They are still valid, working components — just currently dead code
> from the router's perspective. A future refactor could either delete them or migrate the pages to
> use them instead of their inline duplicates.

### Visualization components

#### `ArtistViz.tsx` (component file — *unused*, distinct from the inline version in `visualize/[id]/page.tsx`)
A more elaborate force-directed graph than the inline version actually used by the page: it models
**two node types** (album nodes + song nodes, songs spring toward their album's node), draws a
starfield background, supports pan (drag) and zoom (wheel, mouse-position-anchored), hit-testing
for click/hover, a double-click "focus album" mode that dims all other nodes, and an Escape-key
handler to exit focus. Physics: pairwise charge-repulsion + spring-to-album + center gravity,
pre-simulated 200 ticks synchronously on data change before the animation loop starts. The page
actually mounted at `/visualize/[id]` (`src/app/visualize/[id]/page.tsx`) defines its own simpler
single-node-type `ArtistViz` inline (random drift + edge-bounce physics, no pan/zoom, no album
nodes) — the two are unrelated implementations that happen to share a name.

#### `VizControls.tsx` (component file — *unused*, distinct from the inline version in the page)
Left-hand filter panel supporting a Galaxy/Timeline view-mode toggle, four connection-type
checkboxes (Album/Collaborators/Producer/Era, each with its own colour swatch), and Album/Decade
`<select>` filters. The inline `VizControls` actually used by `visualize/[id]/page.tsx` is simpler:
three checkboxes (Collaborator/Producer/Era, no Album toggle) and a "Min. Pageviews" range slider
instead of Album/Decade dropdowns.

### Chrome / shell components

#### `Sidebar.tsx`
Fixed left navigation rail (desktop, `hidden md:flex`, `w-16`) plus a bottom tab bar on mobile
(`md:hidden`). Renders one icon-only link per top-level route (`NAV_ITEMS`: Search, Library,
Versions, Visualize, History, Tags, Cathode, Polyphony, Soulcatcher, Docs, Settings) using
`usePathname()` to highlight the active route, a hover tooltip on desktop, and a sign-out button
(`POST /api/auth/logout`, then `router.push('/login')` + `router.refresh()`).

#### `Notifications.tsx`
Fixed top-right bell icon with a dropdown panel. Polls `GET /api/library/status` every 2s
independently of any other component (this is separate from the Library page's own polling and
from the `PlaybackBar`'s polling). Shows an animated dot on the bell while a scan is active, and
inside the panel: live discovering/indexing progress (with a progress bar and current-file name
during the indexing phase), or the last-scan summary, or an empty state. Closes on outside click.

### Settings / library-management components

#### `AddLibrarySource.tsx`
Modal form for adding a Local / SMB / NFS / iSCSI library source (`onClose`, `onSaved` props).
Type-specific fields (SMB gets host/share/username/password/domain/subfolder with a UNC-path
auto-parser; local/NFS/iSCSI get a single path field). Two independent verification actions before
saving: **"Test reachability"** (`POST /api/library/ping` — TCP port-445 probe only, no auth) and
**"Test credentials"/"Test path"** (`POST /api/library/test-source` — actually authenticates/lists
the share or resolves the path). Saves via `POST /api/library/sources`.

---

## 4. Hooks & Contexts Reference

### `useGaplessPlayer.ts` (`src/hooks/useGaplessPlayer.ts`)

A from-scratch Web Audio API player — the browser output endpoint, architecturally parallel to
Lucid's ALSA/AirPlay endpoints (the file's own header comment calls it "the RAAT model applied to
the Web Audio API"). It does **not** use an `<audio>` element.

**Mechanism**: tracks are fetched *whole* from Lucid's streaming passthrough
(`/stream/{hash}`, or `/stream/{hash}?format=opus&bitrate=N` for the transcoded quality tiers),
turned into an `ArrayBuffer`, and decoded with `AudioContext.decodeAudioData()` into a full
in-memory `AudioBuffer`. Playback is scheduled with a single shared `AudioContext` + `GainNode`:
each track plays through an `AudioBufferSourceNode` started with `node.start(when, offset)`, where
`when` is an **`AudioContext.currentTime`-relative timestamp**, not a JS `setTimeout`. Gapless
transitions work because the *next* track's `AudioBufferSourceNode` is scheduled to start at
exactly the sample where the current one ends (`ctx.currentTime` at the moment `onended` fires),
rather than reacting to the `ended` event and then doing a fresh fetch — there is no timer jitter in
the critical path. The next track is **pre-fetched and pre-decoded** (`prefetchNext`) as soon as the
current one starts playing, so (network permitting) it's already sitting in memory as an
`AudioBuffer` before the boundary is reached; if the pre-decode didn't finish in time (slow
network), `onended` falls back to a synchronous best-effort fetch+decode+schedule rather than
silently stopping.

**Public API** (`GaplessPlayer` interface):
```ts
interface GaplessPlayer {
  isPlaying: boolean
  currentHash: string | null
  currentTime: number        // ms, derived from the AudioContext clock, not a timer
  duration: number            // ms
  signalPath: BrowserSignalPath | null
  error: string | null
  quality: StreamQuality       // 'lossless' | 'opus-32' | 'opus-64' | 'opus-96' | 'opus-128'
  playQueue: (hashes: string[]) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  seek: (ms: number) => void
  setVolume: (v: number) => void
  setQuality: (q: StreamQuality) => void
}
```

- **`playQueue(hashes)`**: resets the queue to the given hash list, clears any pending
  pre-fetched-next track, **clears the outgoing source node's `onended` handler before calling
  `.stop()` on it** (see Known Gotchas, §7), fetches+decodes the first hash, schedules it at
  `ctx.currentTime`, sets `isPlaying = true`, then immediately kicks off `prefetchNext`.
- **`pause()` / `resume()`**: suspend/resume the shared `AudioContext` directly (`ctx.suspend()` /
  `ctx.resume()`) — this pauses/resumes audio without touching the scheduled source node at all,
  which is why pause/resume have zero latency and don't disturb the gapless scheduling.
- **`stop()`**: clears `onended` on the current source node before calling `.stop()` on it (same
  race-avoidance pattern as `playQueue`), clears the whole queue and pre-fetch state, and resets all
  playback state (`currentHash`, `signalPath`, `isPlaying`) to empty/false/null.
- **`seek(ms)`** *(newer addition)*: because an `AudioBufferSourceNode`'s playback position cannot
  be changed once started (the Web Audio API only allows starting a node once), seeking works by
  stopping the current node (`onended` cleared first, same pattern) and starting a **fresh**
  `AudioBufferSourceNode` on the **same already-decoded `AudioBuffer`** at the requested offset
  (`scheduleNext(ctx, track, ctx.currentTime, offset)`) — no network round-trip, since the whole
  track is already in memory. It explicitly preserves play/pause state across the seek: it captures
  `wasPlaying` before stopping, and if the player was paused, it re-suspends the context
  immediately after the new node starts (`scheduleNext` always starts the node running, so a paused
  seek has to re-pause it) so a seek while paused doesn't secretly resume playback.
- **`setQuality(q)`**: re-fetches the **current** track only (not the whole queue) at the new
  quality/bitrate and resumes from the same elapsed playback position — it computes
  `elapsed = ctx.currentTime - startedAtCtxTimeRef.current`, fetches+decodes at the new quality,
  stops the old node, and calls `scheduleNext(ctx, {hash, buffer}, ctx.currentTime, elapsed)`. This
  is the mechanism behind the PlaybackBar's quality `<select>` (lossless / opus-128 / opus-96 /
  opus-64 / opus-32) — intended for constrained links (e.g. cellular), trading fidelity for
  bandwidth via Lucid's on-the-fly Opus transcode.
- **`signalPath`**: describes what's actually happening — source format (OPUS if transcoded, else
  the file extension), source vs. output (AudioContext) sample rate, and a `bitPerfect` flag that is
  only `true` when *not* transcoded *and* the source sample rate equals the AudioContext's output
  sample rate (i.e. the OS/browser isn't silently resampling). A transcoded stream is never reported
  bit-perfect regardless of sample-rate match.
- Position (`currentTime`) is computed live from `ctx.currentTime - startedAtCtxTimeRef.current`
  rather than accumulated via `setInterval`, so it stays accurate even if the tab is backgrounded
  and timers are throttled; a `setInterval(..., 250)` merely forces a ~4 Hz re-render so the UI
  (seek bar, time readout) visibly advances.

**Known current limitation (not yet fixed as of this writing)**: the **entire track is downloaded
and fully decoded** via `decodeAudioData` before the first sample plays — there is no chunked or
streaming decode (no MediaSource Extensions / MSE). For large lossless or hi-res files, or on slow
links (for example, tracks streamed by Lucid from a NAS over SMB), this produces a real, noticeable
startup delay before playback begins. This is a known limitation and a candidate for a future
improvement (e.g. MSE-based progressive decode), not something this codebase currently addresses.

### `BrowserPlayerContext.tsx` (`src/contexts/BrowserPlayerContext.tsx`)

A thin React context wrapping a **single, app-wide instance** of `useGaplessPlayer()`. Exports
`BrowserPlayerProvider` (mounted once, in `layout.tsx`, wrapping the whole app) and
`useBrowserPlayer()` (throws if called outside the provider). Without this, every component calling
`useGaplessPlayer()` directly would get its own independent `AudioContext`/queue — playback started
from, say, the file detail page (`/library/[hash]`) wouldn't be visible or controllable from the
global `PlaybackBar`. This context is what makes "this browser tab" behave as a real, singular
output endpoint alongside ALSA/AirPlay.

### `useSelectedEndpoint` / `src/lib/endpoint.ts`

Not a React context — a **module-level pub/sub store** backed by `localStorage`:

```ts
export type Endpoint =
  | { type: 'browser' }
  | { type: 'alsa'; device: string }
  | { type: 'airplay'; name: string }
```

- `getSelectedEndpoint()` reads and JSON-parses `localStorage['phonolith:endpoint']`, defaulting to
  `{ type: 'browser' }` on the server (`typeof window === 'undefined'`), on a missing key, or on a
  parse error.
- `setSelectedEndpoint(endpoint)` writes it back to `localStorage` and synchronously notifies every
  registered listener (a module-level `Set<Listener>`) — this is what lets `EndpointPickerModal`
  (which calls `setEndpoint`) and `PlaybackBar` (which reads the current value) stay in sync within
  the same tab without React context, since both may be mounted independently.
  `subscribeEndpoint(fn)` registers a listener and returns an unsubscribe function.
- `useSelectedEndpoint()` is the hook wrapper: on mount it reads the current value into local state
  (avoiding SSR/client hydration mismatches — the module can't touch `localStorage` during SSR) and
  subscribes to future changes, cleaning up the subscription on unmount. It returns a
  `[endpoint, setEndpoint]` tuple, mirroring `useState`'s shape.
- `endpointLabel(endpoint)` formats a human-readable label ("This Browser", "ALSA (default)" /
  "ALSA: hw:0,0", "AirPlay: <name>") used by both `PlaybackBar` and `EndpointPickerModal`.
- Persistence is **`localStorage` only** — there is no cookie and no server round-trip; the
  selection is per-browser, not per-account, and does not sync across devices/tabs of different
  origins (it does, however, propagate live across components in the same tab via the listener set,
  and would be picked up by a hard reload of the same browser via `localStorage`).

---

## 5. Data Flow — Realtime Playback Status

The `PlaybackBar` needs to reflect Lucid's playback state (position, track, signal path) in close
to real time without hammering the Next.js API layer. It uses a **dual-path** approach:

1. **WebSocket (`/ws/state`)** — primary path. On mount, `PlaybackBar` opens
   `new WebSocket(`${proto}//${window.location.host}/ws/state`)` (`wss:` if the page is served over
   HTTPS). This path is proxied by Caddy **directly to Lucid**, bypassing the Next.js app entirely,
   for the lowest possible latency on state pushes. Every message is a JSON-encoded
   `SignalPathState`; on receipt, `PlaybackBar` sets `online = true` and merges it into `LucidStatus`
   (preserving whatever `queue` data it already had, since the socket only pushes `signal_path`).
   Malformed frames are caught and ignored — the next push self-heals the state. On `onclose`, it
   schedules a reconnect after 2 seconds (`reconnectTimer`); on `onerror`, it force-closes the
   socket (which triggers the same `onclose` → reconnect path). The reconnect loop keeps retrying
   indefinitely until the component unmounts (`cancelled` flag) or the effect is cleaned up.
2. **HTTP polling (`/api/lucid/status`) fallback** — runs unconditionally every 2 seconds
   (`setInterval(poll, 2000)`) for as long as `PlaybackBar` is mounted, **independent of the
   WebSocket's connection state**. This is what covers the socket while it's still connecting on
   first mount, and re-covers state if the socket drops and hasn't reconnected yet. Each poll has a
   3-second `AbortSignal.timeout`; a non-OK response, a thrown error, or a payload with
   `online === false` / an `error` field all set `online = false` (hiding the Lucid-driven bar, but
   not the browser-driven one — see `PlaybackBar`'s `isBrowserActive` short-circuit).
   Any user-initiated Lucid command (play/pause/seek/etc., via the `cmd()` helper) also triggers an
   immediate one-off `setTimeout(poll, 300)` so the UI reflects the new state quickly rather than
   waiting for the next scheduled tick.

Because both paths write into the same `status`/`online` state, whichever arrives most recently
"wins" — there's no explicit precedence logic, just last-write. In steady state with a healthy
socket, the WebSocket pushes are far more frequent/immediate than the 2s poll, so in practice the
socket dominates the visible update rate, while the poll acts purely as a safety net.

Separately, `Notifications.tsx` runs its own independent 2-second poll of `/api/library/status`
(scan progress), and the Library page (`/library`) runs a 3-second poll of the same endpoint while
a scan is active — these are unrelated to the playback WebSocket/poll described above.

---

## 6. Design System

Defined in `tailwind.config.ts`. Content globs cover `src/pages`, `src/components`, and `src/app`.

**Colour tokens** (`theme.extend.colors`):

| Token | Hex | Typical usage |
|---|---|---|
| `background` | `#08080a` | Page background, canvas fills (visualize) |
| `surface` | `#111113` | Card / panel backgrounds, sidebar, playback bar |
| `surface-2` | `#1a1a1e` | Nested/hover surfaces, skeleton placeholders, input backgrounds |
| `border` | `#27272a` | All borders/dividers (`border-border`, often at reduced opacity `border-border/50`) |
| `accent` | `#a78bfa` (violet) | Primary interactive colour — buttons, active nav state, links, focus rings, "bit-perfect"/selected indicators |
| `accent-dim` | `#7c3aed` | Darker accent variant (hover states on accent-filled buttons in a couple of legacy components) |
| `text-primary` | `#fafafa` | Primary foreground text |
| `text-muted` | `#71717a` | Secondary/label text, placeholders, timestamps |
| `success` | `#34d399` (green) | High DR scores, "clean"/verified/online indicators, bit-perfect badges |
| `warning` | `#f59e0b` (amber) | Mid DR scores, format-conversion/DSP-active warnings, "not configured" states |
| `danger` | `#f87171` (red) | Low DR scores, failed tests, destructive actions, mismatch/error states |

Colours are frequently used with Tailwind's alpha-suffix shorthand (e.g. `bg-accent/10
border-accent/20 text-accent` for a soft pill, `border-success/30` for a subtle success outline).

**Typography** (`theme.extend.fontFamily` / `fontSize`):
- `font-sans` → `var(--font-geist-sans)` (actually Google's **Inter**, loaded via
  `next/font/google` in `layout.tsx` as `--font-geist-sans`), the default body font.
- `font-serif` → `var(--font-playfair)` (**Playfair Display**, italic+normal), used specifically for
  lyrics rendering (`<pre className="font-serif italic ...">` in the Song page and
  `AnnotationsView`) to visually distinguish lyric text from UI chrome.
- Custom `fontSize` scale: `xs` 11px, `sm` 13px, `base` 15px, `lg` 18px, `xl` 22px, `3xl` 30px,
  `5xl` 48px — all with explicit line-heights, slightly smaller/denser than Tailwind's stock scale
  (e.g. stock `text-base` is 16px; here it's 15px), consistent with the compact, information-dense
  layouts throughout (library tables, settings forms).

**Other conventions observed across components** (not config-driven, just consistent usage):
- Rounded corners: `rounded-lg`/`rounded-xl` almost everywhere; `rounded-full` for pills/badges/dots.
- Status dots: a small `w-1.5 h-1.5`/`w-2 h-2 rounded-full` coloured dot (`bg-accent`, `bg-success`,
  `bg-danger`, or `bg-text-muted`, sometimes `animate-pulse`) is the standard way of indicating
  online/offline/active/idle state (Lucid status, scan-active, S3-configured, discovery toggle, etc).
- Skeleton loading: `animate-pulse` + `bg-surface-2` blocks sized to approximate the eventual
  content, used on essentially every page during initial data fetch.
- `transition-colors`/`transition-all duration-150` on nearly all interactive elements for hover
  states.

---

## 7. Known Gotchas

- **Source-node `onended` race during stop/switch (fixed via explicit ordering)**: an
  `AudioBufferSourceNode.onended` handler is how `useGaplessPlayer` normally advances to the next
  queued track. But calling `.stop()` on a node *also* fires its `onended` callback. This means a
  deliberate `stop()` call, a `playQueue()` call that replaces the queue mid-playback, a `seek()`,
  or a `setQuality()` swap — all of which stop the *current* node on purpose — could otherwise race
  with that same node's "track ended, advance the queue" logic and incorrectly schedule the *wrong*
  track (e.g. advancing into whatever was in the *old* queue right as a brand new queue is being
  loaded). The fix, applied consistently at every call site that stops a node
  (`playQueue`, `stop`, `seek`, and the quality-switch path inside `setQuality`), is to **set
  `node.onended = null` before calling `node.stop()`** — never the reverse order. The `onended`
  handler installed in `scheduleNext` also defensively checks `if (sourceRef.current !== node)
  return` as a second line of defense, in case a node's callback fires after it's already been
  superseded.
- **No chunked/streaming decode (no MSE)**: as detailed in §4, `useGaplessPlayer` fetches and fully
  `decodeAudioData()`s an entire track before playback starts. There is no MediaSource Extensions
  integration and no partial/progressive decode path. This is the primary source of playback
  startup latency for large lossless/hi-res files or slow network paths (e.g. Lucid streaming a
  file from a NAS over SMB) and is a known, currently-unaddressed limitation — flagged here as a
  candidate for future work, not as something already mitigated in this codebase.
- **Two unrelated `ArtistViz`/`VizControls` implementations**: `src/components/ArtistViz.tsx` and
  `src/components/VizControls.tsx` are considerably more elaborate than, and are **not** used by,
  the inline `ArtistViz`/`VizControls` actually rendered by `src/app/visualize/[id]/page.tsx`. A
  developer searching for "the" visualize component by name should check the page file directly,
  not assume the `components/` file is what's live. See the note under §3.
- **Several `components/*.tsx` files are dead code from the router's perspective**: `ArtistCard`,
  `AlbumGroup`, `SongRow`, `TagBadge`, `CreditsTable`, `LyricsView`, `AnnotationsView`,
  `LibraryTable`, and `Waveform` are not imported by any page (verified by grepping import paths
  across `src/app` and `src/components`); the pages that need this functionality reimplement it
  inline with slightly different logic in each case (e.g. `AnnotationsView`'s fuzzy 20-char-prefix
  fragment match vs. the Song page's exact substring match). Treat the inline versions in the page
  files as the source of truth for current behaviour.
- **Endpoint selection is per-browser, not per-account**: `src/lib/endpoint.ts` persists to
  `localStorage` only — there is no server-side/cookie persistence, so the selected output endpoint
  does not follow a user across browsers or devices.
- **`/polyphony/[id]/library` playback bypasses the gapless player entirely**: it plays peer-shared
  tracks via a plain `new Audio(...)` element pointed at the peer-streaming proxy endpoint, not via
  `useBrowserPlayer()`/`useGaplessPlayer()` — so peer playback does not get gapless transitions,
  quality switching, or a Signal Path readout, and won't appear driving the global `PlaybackBar`.
