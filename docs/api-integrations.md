# Phonolith API Integrations

This document covers every Next.js API route under `src/app/api/` **except** core
library scanning (`/api/library/**`) and authentication (`/api/auth/**`), which
have their own documentation. If you're new to Phonolith: it's a self-hosted
music library manager built from a Next.js 14 App Router web app, a Python
FastAPI "analyst" sidecar (file scanning/fingerprinting/tagging), a Python
FastAPI "lucid" sidecar (audio playback transport), Postgres, Redis, a
Soulseek client daemon (`slskd`), and Caddy as the single public entry point —
all wired together with `docker-compose.yml`.

Every route in this document, unless stated otherwise, requires a valid
Phonolith session: the browser sends the `phonolith_session` cookie (set by
`/api/auth/login`), and each handler calls
`getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)` and
returns `401 { error: 'Not authenticated.' }` if that fails. This document
calls that pattern "**session-cookie auth**" and only calls out routes that
deviate from it.

Two other auth models appear:

- **Peer HMAC auth** (Polyphony's peer-to-peer routes): the caller is another
  Phonolith instance, not a browser. It signs the request with a shared
  secret established at pairing time and sends `X-Polyphony-Peer-Id` /
  `X-Polyphony-Signature` headers; there is no session cookie because there is
  no browser involved.
- **Public/unauthenticated** (`POST /api/polyphony/pair` only): the only route
  in this document with neither session-cookie nor peer-HMAC auth. Trust is
  established by possessing a valid, unexpired, single-use pairing code
  instead.

## Table of contents

1. [Soulcatcher — Soulseek search & download](#soulcatcher--soulseek-search--download)
2. [Polyphony — LAN peer discovery, streaming & backup mirroring](#polyphony--lan-peer-discovery-streaming--backup-mirroring)
3. [Lucid proxy — browser-to-playback-sidecar bridge](#lucid-proxy--browser-to-playback-sidecar-bridge)
4. [Metadata & credits providers — Genius, MusicBrainz, LRCLIB, Discogs](#metadata--credits-providers--genius-musicbrainz-lrclib-discogs)
5. [Cathode — hardware equipment & burn-in hour tracking](#cathode--hardware-equipment--burn-in-hour-tracking)
6. [Waveforms proxy](#waveforms-proxy)
7. [Backup & disaster recovery](#backup--disaster-recovery)
8. [Known gotchas](#known-gotchas)

---

## Soulcatcher — Soulseek search & download

**Problem it solves**: Phonolith's library is built from files you already
have, but sometimes you're missing a track or want a better-quality rip.
Soulcatcher lets you search the Soulseek P2P network (via a headless
`slskd` daemon running as a docker-compose service) from inside Phonolith,
queue a download, and — once it lands on disk — fold it straight into your
library without ever leaving the app.

### How it talks to slskd

All of this lives in `src/lib/soulcatcher.ts`, a thin `axios` client pointed
at slskd's REST API:

- `SLSKD_URL` (default `http://slskd:5030`) — slskd is not published to the
  host at all in `docker-compose.yml`; it's reachable only over the internal
  Docker network, so the Next.js app is the sole gateway to it.
- `SLSKD_API_KEY` — sent as an `X-API-Key` header on every call, when set.

The client has an 8s axios timeout. Nearly every function in
`soulcatcher.ts` swallows its own errors and returns an empty/false/offline
result rather than throwing — see [Known Gotchas](#known-gotchas).

### Endpoint reference

All routes below require session-cookie auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/soulcatcher/search?q=<query>` | Search Soulseek. Returns `{ results: SoulseekFile[] }`. Empty `q` returns `{ results: [] }` without calling slskd. |
| `POST` | `/api/soulcatcher/download` | Enqueue a download. Body: `{ username, filename, size, query }` (all required). Returns `{ download }` (the inserted `soulcatcher_downloads` row) or `502` if slskd rejects/is unreachable. |
| `GET` | `/api/soulcatcher/downloads` | List all tracked downloads, reconciling their status against slskd's live transfer list first. Returns `{ downloads }`. |
| `POST` | `/api/soulcatcher/downloads/[id]/ingest` | Tell the analyst sidecar to rescan the soulcatcher subtree so a completed download joins the library. See [download flow](#end-to-end-download-flow) below. |
| `GET` | `/api/soulcatcher/status` | Lightweight slskd connectivity check. Returns `{ online: boolean, version?: string }`. |

`searchSoulseek(query)` (used by `/search`) POSTs to slskd's
`/api/v0/searches`, then polls `GET /api/v0/searches/{id}` every 750ms for up
to 10 seconds waiting for the search `state` to contain `"completed"`; if it
times out it just returns whatever results have accumulated so far rather
than an error. Results are flattened from slskd's
`{ responses: [{ username, files: [...] }] }` shape into a flat
`SoulseekFile[]` (`username`, `filename`, `size`, `bitRate`, `length`,
`sampleRate`, `bitDepth`, `extension`).

`downloadFile(username, filename, size)` POSTs to
`/api/v0/transfers/downloads/{username}` with a one-element array
`[{ filename, size }]` — that's slskd's API shape for "start this transfer
from this user."

`getDownloadStatus()` GETs `/api/v0/transfers/downloads`, which slskd
returns nested as `[{ username, directories: [{ files: [...] }] }]`; the
lib flattens it to a `SlskdTransfer[]` with `username`, `filename`, `size`,
`state`, `bytesTransferred`.

### DB tables

- `soulcatcher_downloads` — one row per requested download (`query`,
  `username`, `filename`, `size_bytes`, `status`, `requested_at`,
  `completed_at`, `local_path`). Schema details live in the library/DB doc;
  this doc only needs the column names above to explain the flow.

### End-to-end download flow

1. **Search** — browser calls `GET /api/soulcatcher/search?q=...`, which
   proxies to slskd and returns files from many Soulseek peers.
2. **Enqueue** — user picks a file; browser calls
   `POST /api/soulcatcher/download` with that peer's `username`/`filename`/
   `size`. The route calls `downloadFile()`, which tells slskd to start
   pulling bytes from that peer, and inserts a `soulcatcher_downloads` row
   with `status = 'queued'`.
3. **slskd writes to disk** — as the transfer progresses, slskd writes bytes
   under `SLSKD_INCOMPLETE_DIR` (`/app/incomplete`, inside the `slskd_config`
   volume — **not** shared with any other container). Only once the transfer
   completes does slskd rename/move the finished file into
   `SLSKD_DOWNLOADS_DIR` (`/downloads`, inside the `soulcatcher_downloads`
   volume).
4. **Poll for completion** — the UI polls `GET /api/soulcatcher/downloads`,
   which cross-references slskd's live transfer states (via
   `getDownloadStatus()`) against the pending DB rows and flips `status` to
   `completed` or `failed` once slskd reports it (`mapSlskdState()` buckets
   slskd's verbose states like `"Completed, Succeeded"` /
   `"Completed, Errored"` / `"InProgress"` / `"Queued, Remotely"` into
   `completed` / `failed` / `downloading`).
5. **Ingest** — once `status = 'completed'`, the user (or UI) calls
   `POST /api/soulcatcher/downloads/[id]/ingest`. This route does **not**
   move any files itself — see the docker-compose note below for why it
   doesn't need to — it just calls `triggerScan('/music/soulcatcher-downloads')`
   against the analyst sidecar (`src/lib/analyst.ts`, `POST {ANALYST_URL}/scan`)
   so the analyst's existing recursive library scanner walks that subtree,
   fingerprints/tags the new file, and matches it into the catalog like any
   other library file. It then records a sanitized `local_path` on the
   `soulcatcher_downloads` row (`path.basename()` is applied to the
   Soulseek-supplied `filename` first, since it comes from an untrusted
   remote peer and could contain `../` path-traversal sequences).

### Why in-progress downloads are invisible to the analyst

This is the key architectural trick, visible in `docker-compose.yml`:

```yaml
slskd:
  environment:
    - SLSKD_INCOMPLETE_DIR=/app/incomplete   # slskd_config volume
    - SLSKD_DOWNLOADS_DIR=/downloads         # soulcatcher_downloads volume
  volumes:
    - slskd_config:/app
    - soulcatcher_downloads:/downloads

analyst:
  volumes:
    - ${LIBRARY_PATH:-./music}:/music
    - soulcatcher_downloads:/music/soulcatcher-downloads   # same volume, mounted read-write into /music
```

`soulcatcher_downloads` is a **named Docker volume mounted into two different
containers at two different paths**: as `/downloads` in `slskd`, and as
`/music/soulcatcher-downloads` inside the analyst's `/music` tree. Because
`SLSKD_INCOMPLETE_DIR` lives in the *other*, unshared `slskd_config` volume,
a partially-written transfer physically cannot appear anywhere under the
analyst's `/music` tree — slskd only writes into the shared volume by
renaming a file into it atomically once the transfer is fully complete. The
analyst's file watcher therefore can never observe a half-downloaded file,
without needing any application-level "is this file still being written"
check. `SLSKD_INCOMPLETE_DIR`/`SLSKD_DOWNLOADS_DIR` are set explicitly
(rather than relying on slskd's own defaults) so this guarantee survives a
future slskd version changing its default incomplete-dir path.

---

## Polyphony — LAN peer discovery, streaming & backup mirroring

**Problem it solves**: if you run more than one Phonolith instance (e.g. one
at home, one at a family member's house, or a laptop and a home server),
Polyphony lets those instances discover each other, see what's currently
playing on each other, stream a track from one instance's library through
another, and mirror database backups to a trusted peer for off-site
redundancy — all without any central server, using direct instance-to-instance
HTTP calls authenticated by a shared secret set up during a manual "pairing"
step.

Core logic lives in `src/lib/polyphony.ts`.

### Identity, pairing & trust

Each instance has a stable random `peer_id` (UUID) and a display name,
persisted via `app_settings` (`polyphony_peer_id`, `polyphony_instance_name`)
and lazily created on first access by `getOwnPeerId()`.

Pairing is a manual, human-mediated handshake:

1. Admin on instance A calls `POST /api/polyphony/pairing-code` to mint an
   8-hex-character, single-use code with a 10-minute TTL (stored in
   `peer_pairing_codes`), and reads it aloud/sends it to whoever is pairing.
2. Admin on instance B calls `POST /api/polyphony/peers` (the "initiator"
   side) with `{ host, code }`. Instance B's server itself makes an
   outbound call to `POST {host}/api/polyphony/pair` (the "responder" side)
   with `{ code, peerId, name, host }`.
3. `/api/polyphony/pair` on instance A is the **one Polyphony route with no
   auth at all** — by design, since there's no existing trust relationship
   yet. It validates the code via `redeemPairingCode()` (deletes it from
   `peer_pairing_codes`, so it can never be reused), generates a random
   32-byte shared secret, and upserts a row into `peers` with
   `trust_status = 'trusted'`. It returns that shared secret to B.
4. Instance B stores the same shared secret in its own `peers` table. Both
   sides now hold the same secret under each other's `peer_id`.

Every subsequent peer-to-peer call is authenticated by
`signPeerRequest(secret, method, path, body)` — an HMAC-SHA256 over the
canonical string `"METHOD\npath\nbody"` — sent as
`X-Polyphony-Signature`, alongside `X-Polyphony-Peer-Id` identifying the
caller. `verifyIncomingPeer()` looks up the claimed peer by id, confirms
`trust_status = 'trusted'`, and does a timing-safe comparison of the
signature before touching any peer's data; it also bumps `last_seen_at`.

Each peer row also carries three independent boolean toggles the *receiving*
side checks before serving anything: `share_library`, `share_presence`,
`share_backup`. A peer being "trusted" only means its signature is
accepted — each capability must additionally be enabled by
`PATCH /api/polyphony/peers/[id]`.

### mDNS/LAN discovery

Separately from pairing, Lucid runs mDNS-based announce/discover on the LAN
so instances can *find* each other's host/port before a human types in a
hostname. Next.js doesn't implement mDNS itself; it delegates to Lucid:

- `GET /api/polyphony/discovery` returns `{ enabled, discovered }`, where
  `discovered` is whatever Lucid's `GET {LUCID_URL}/polyphony/discovered`
  reports (empty array if Lucid is offline), and `enabled` reflects the
  `polyphony_public_discovery_enabled` setting.
- `POST /api/polyphony/discovery` with `{ enabled }` persists that setting
  and tells Lucid to start/stop announcing via
  `POST {LUCID_URL}/polyphony/announce` with
  `{ enabled, peer_id, name, port }` (port from `HTTP_PORT`, default `80`).
  If Lucid is unreachable the setting is still saved and takes effect once
  Lucid comes back.

### Endpoint reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/polyphony/identity` | session cookie | This instance's `peerId`, `name`, `publicDiscoveryEnabled`. |
| `GET` / `POST` | `/api/polyphony/discovery` | session cookie | Read/toggle mDNS announce+discovery (proxies to Lucid). |
| `POST` | `/api/polyphony/pairing-code` | session cookie | Mint a pairing code (responder/"generate a code for someone to use") . |
| `POST` | `/api/polyphony/pair` | **none (public)** | Responder side: redeem a code, establish trust, return a shared secret. |
| `GET` / `POST` | `/api/polyphony/peers` | session cookie | List paired peers / initiate pairing as the client holding someone else's code. |
| `PATCH` / `DELETE` | `/api/polyphony/peers/[id]` | session cookie | Update trust/sharing toggles, or unpair (deletes the `peers` row). |
| `GET` | `/api/polyphony/peers/[id]/library` | session cookie | Fetch a peer's shared library listing (signs the request server-side with the stored secret — the browser never sees the secret). |
| `GET` | `/api/polyphony/peers/[id]/stream/[hash]` | session cookie | Stream a track *from* a peer's library, proxied through this instance. |
| `GET` | `/api/polyphony/library` | peer HMAC | Serve this instance's own library listing to a trusted, `share_library`-enabled peer. |
| `GET` | `/api/polyphony/stream/[hash]` | peer HMAC | Serve this instance's own audio bytes (via Lucid) to a trusted peer. |
| `POST` | `/api/polyphony/now-playing` | session cookie | Browser beacon: publish/clear what's currently playing (Redis, 120s TTL). |
| `GET` | `/api/polyphony/presence` | peer HMAC | Expose this instance's name/online/now-playing to a trusted, `share_presence`-enabled peer. |
| `GET` | `/api/polyphony/feed` | session cookie | Aggregate presence from every trusted, presence-sharing peer (10s Redis cache). |
| `GET` | `/api/polyphony/backup` | session cookie | List backup snapshots this instance is mirroring *for* peers. |
| `POST` | `/api/polyphony/backup/receive` | peer HMAC | Accept a streamed `pg_dump` from a trusted, `share_backup`-enabled peer. |
| `POST` | `/api/polyphony/backup/mirror/[id]` | session cookie | Trigger a local `pg_dump` and push it to peer `[id]` for off-site mirroring. |

### Streaming a track from a peer, end to end

1. Browser calls `GET /api/polyphony/peers/[id]/stream/[hash]`. This route
   (session-cookie auth) looks up the peer, then itself signs a
   peer-authenticated request to `{peer.host}/api/polyphony/stream/{hash}`
   (forwarding any `Range` header for seeking) and streams the response body
   straight back to the browser, copying through `content-type`,
   `content-length`, `content-range`, `accept-ranges` headers.
2. On the peer's side, `GET /api/polyphony/stream/[hash]` verifies the
   inbound peer signature, checks `peer.share_library`, then fetches
   `{LUCID_URL}/stream/{hash}` from its **own** Lucid sidecar and streams
   that back.

This is called out in the code as the one deliberate exception to "Lucid
media never passes through Next.js": for local playback, Caddy routes
`/stream/*` directly to Lucid so the Next.js process never touches audio
bytes. Lucid has no concept of peer trust, though, so proxying cross-instance
streams through this route (after verifying the peer signature) is the only
way to keep "never serve the library to an unauthenticated caller" true for
peer-to-peer playback.

`/api/polyphony/library` and `/api/polyphony/peers/[id]/library` deliberately
expose only `blake3_hash` + display metadata (title/artist/album/year/track
number/duration/format) — never the local filesystem path — so a peer
learns nothing about the other machine's directory layout.

### "Now playing" presence beacon

`POST /api/polyphony/now-playing` is a lightweight, fire-and-forget beacon:
the browser's `PlaybackBar` component calls it every time the current track
changes, with `{ title, artist }` (or no `title` to clear it). It's stored in
Redis under `polyphony:now_playing` with a 120-second TTL — short enough that
if the browser tab closes/crashes without clearing it, the presence data
expires on its own rather than showing a stale "now playing" forever.
Trusted peers read it (subject to `share_presence`) via
`GET /api/polyphony/presence`, and `GET /api/polyphony/feed` fans that out
across every trusted peer at once (with its own 10s cache) so the UI can show
"what's playing on all my other instances" in one call.

### Backup mirroring

`POST /api/polyphony/backup/mirror/[id]` spawns `pg_dump` locally and streams
its stdout directly as the request body of a signed
`POST {peer.host}/api/polyphony/backup/receive` call (using Node's
`Readable.toWeb()` to bridge a child-process stream into `fetch`'s
`ReadableStream` body, with `duplex: 'half'`). The receiving peer hashes the
incoming bytes (SHA-256) as they arrive, writes them to
`{POLYPHONY_BACKUP_DIR}/{peer_id}/{timestamp}.sql`, records a `peer_backups`
row (`peer_id`, `size_bytes`, `storage_path`, `checksum`), and prunes
anything beyond the 5 most recent snapshots per peer so a chatty or
misbehaving peer can't fill the disk. Note this is a **separate** mechanism
from the S3-based `/api/backup` route described below — this one mirrors to
another Phonolith instance, not to cloud storage. `pg_dump` stderr (which can
contain the DB connection string) is logged server-side only, never returned
to the client, in both this route and `/api/backup`.

### DB tables

`peers`, `peer_pairing_codes`, `peer_backups`. Redis keys:
`polyphony:now_playing` (also exported as `NOW_PLAYING_KEY`), `polyphony:feed`.

---

## Lucid proxy — browser-to-playback-sidecar bridge

**Problem it solves**: Lucid is the FastAPI sidecar that owns the actual
audio transport (decoding, DSP chain, ALSA/AirPlay output, the play/pause/
seek/queue state machine — see `SignalPathState`/`LucidStatus` in
`src/lib/types.ts`). It listens on `lucid:8001` inside the Docker network.
Caddy routes raw media bytes and the realtime transport WebSocket straight
to Lucid so the app server never touches audio data — but everything else
(status polling, transport control) needs to come from an authenticated
Phonolith session, and the browser has no business holding Lucid's internal
address or talking to an internal-only service directly.

### Endpoint reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` / `POST` | `/api/lucid/[...slug]` | session cookie | Catch-all proxy: forwards to `{LUCID_URL}/{slug.join('/')}`. |

The route handler (`src/app/api/lucid/[...slug]/route.ts`) is intentionally
generic: it does not know or care about individual Lucid endpoints like
`/status`, `/play`, `/pause`, `/resume`, `/stop`, `/seek`, `/devices` — it
just joins the catch-all `slug` segments back into a path, forwards the
method, and (for non-GET) forwards the request body verbatim as JSON with
an 8-second timeout. On any fetch failure it returns
`{ online: false, error: 'Lucid sidecar unreachable' }` with `503` rather
than throwing, so the UI can render "playback backend offline" gracefully.

`src/lib/lucid.ts` provides typed, purpose-built helpers over the same
Lucid API for server-side code that wants to call Lucid directly rather than
via this proxy (`getLucidStatus`, `lucidPlay`, `lucidPause`, `lucidResume`,
`lucidStop`, `lucidSeek`, `getDevices` — each with its own 5s
`AbortSignal.timeout`). The browser only ever goes through
`/api/lucid/[...slug]`; these direct helpers are for other server-side
routes (e.g. Cathode's hour-tracking, mentioned below, is driven by Lucid
reporting when a track finishes).

### Env vars

`LUCID_URL` (default `http://lucid:8001`).

---

## Metadata & credits providers — Genius, MusicBrainz, LRCLIB, Discogs

**Problem it solves**: your audio files only carry filesystem paths and
whatever tags are embedded in them. This group of routes enriches your
library with artist bios, album art, lyrics, songwriting/production credits,
crowd-sourced annotations, and cross-references to canonical IDs (MusicBrainz
MBIDs) — pulling from external metadata APIs and caching the results in
Postgres (permanently) and Redis (short-lived, to absorb repeat requests).

### External services and env vars

| Service | Used for | Env var(s) | Client |
|---|---|---|---|
| **Genius** | Artist bios, song metadata, credits (featured/producer/writer/custom performances), lyrics scraping, annotation scraping | `GENIUS_ACCESS_TOKEN` | `src/lib/genius.ts` |
| **MusicBrainz** | Cross-referencing an artist/recording to a canonical MBID | `MUSICBRAINZ_APP_NAME`, `MUSICBRAINZ_APP_VERSION`, `MUSICBRAINZ_CONTACT` (used to build the required `User-Agent` string) | `src/lib/musicbrainz.ts` |
| **LRCLIB** | Primary lyrics source (plain + synced/LRC lyrics), preferred over Genius scraping | none (no API key required); still sends the same `MUSICBRAINZ_APP_*`/`MUSICBRAINZ_CONTACT`-derived `User-Agent` | `src/lib/lrclib.ts` |
| **Discogs** | Release/pressing metadata (label, catalog number, format) | `DISCOGS_USER_TOKEN` | `src/lib/discogs.ts` |

`getSetting()` (`src/lib/settings.ts`) is the shared plumbing behind all of
these tokens: it checks the `app_settings` DB table first (so the UI's
Settings page can override a token without a restart), falls back to the
environment variable of the same name, and caches whichever it finds in
Redis for 60 seconds. `GENIUS_ACCESS_TOKEN` and `DISCOGS_USER_TOKEN` are
both readable/writable this way via `/api/settings/keys` (see below).

`ACOUSTID_API_KEY` is configured as an env var and is manageable through
`/api/settings/keys`, but it is consumed by the **analyst sidecar** (audio
fingerprinting against AcoustID), not by any route in this document — it's
passed straight through as a container env var in `docker-compose.yml`
(`analyst.environment.ACOUSTID_API_KEY`). Mentioned here only because it's
configured through the same settings UI as the other provider tokens.

MusicBrainz calls are globally rate-limited to 1 request/second in-process
(`rateLimited()` in `musicbrainz.ts`) to respect MusicBrainz's API etiquette
policy.

### Endpoint reference

All routes below use session-cookie auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/search?q=<query>` | Search Genius for artists matching `q`; upserts stubs into `artists`. Returns `502` on Genius failure, `500` specifically if the token isn't configured. |
| `GET` | `/api/artist/[id]` | Fetch/cache an artist by Genius id. DB-first (returns cached row if `description` is already populated); otherwise calls Genius `getArtist()`, opportunistically enriches with a MusicBrainz `mb_id` via `searchArtist()` (non-fatal if that fails), and upserts `artists`. |
| `GET` | `/api/artist/[id]/songs?all=true\|false` | List an artist's songs. DB-first; otherwise calls Genius `getAllSongs()`, upserting `albums` and `songs` along the way. |
| `GET` | `/api/song/[id]` | Fetch/cache a song by Genius id (`s.genius_id`). DB-first (if `description` present); otherwise calls Genius `getSong()`, upserts `artists`/`albums`/`songs`, and rebuilds that song's `credits` rows from the featured/producer/writer/custom-performance artist lists Genius returns. |
| `GET` | `/api/song/[id]/about` | Just the cached `description` column for a song — no external call. |
| `GET` | `/api/song/[id]/credits` | List `credits` rows (`role`, `name`, `genius_id`) for a song, 5-minute Redis cache. Read-only — credits are populated as a side effect of `GET /api/song/[id]`, not by this route. |
| `GET` | `/api/song/[id]/lyrics` | Fetch lyrics: DB cache first (`lyrics` table) → **LRCLIB** (`getLrclibLyrics`, matched by artist/title/album/duration) → Genius page-scrape fallback (`scrapeLyrics`, lower confidence, logged with a `console.warn`) if LRCLIB has no match. Persists to `lyrics` (upsert) and appends a `history` row with `event = 'lyrics_read'`. Returns `404` if the song hasn't been fetched via `/api/song/[id]` yet (no `path`/artist/title to search with) or no source has a match. |
| `GET` / `POST` | `/api/song/[id]/annotations` | List/add Genius-style line annotations (`annotations` table: `fragment`, `body`, `source: 'genius'\|'user'`). `POST` always inserts with `source = 'user'`. |
| `GET` | `/api/tags` / `POST /api/tags` | List all `tags`, or create one (`name`, `color`, default `#a78bfa`; upsert on name conflict). |
| `POST` | `/api/song/[id]/tags` | Attach an existing tag to a song (`song_tags` junction row, `ON CONFLICT DO NOTHING`). |
| `DELETE` | `/api/song/[id]/tags/[tagId]` | Detach a tag from a song. |
| `GET` | `/api/history?artist_id=&event=&limit=` / `POST /api/history` | List/append raw `history` events (`event` is one of `lyrics_read`, `lyrics_download`, `play`; see `HistoryEvent` in `src/lib/types.ts`). |
| `GET` | `/api/history/stats` | Dashboard rollup: reads/week for the last 12 weeks, top 10 artists by event count over 90 days, and total event/artist/song counts. |
| `GET` | `/api/history/ghost` | "Songs you haven't touched in a year (or ever)" — up to 100 songs with no `history` row in the last 365 days, joined with their DR score if scanned into the library. |
| `GET` | `/api/history/artist/[id]` | Recent `history` events for one artist (by Genius id), newest first, capped at 100. |
| `GET` | `/api/history/completeness` | For every artist you have *any* history with, what percentage of their known Genius catalog is actually present in your `library_files` — a "how complete is my collection of artists I actually listen to" report. |
| `GET` | `/api/visualize/[id]` | Node data for an artist's song/album relationship graph (`VizNode`-shaped rows: title, release date, pageviews, album cover), 1-hour Redis cache. |
| `GET` | `/api/visualize/[id]/connections` | Edge data for the same graph: `collaborator` (songs sharing a featured-artist credit), `producer` (songs sharing a producer credit), and `era` (songs by the same artist released within 2 years of each other) — each an array of `[songIdA, songIdB]` pairs, capped at 500 per category, 1-hour Redis cache. |
| `GET` | `/api/settings/genius` | Connectivity/credential check: confirms `GENIUS_ACCESS_TOKEN` is set and does a live `GET https://api.genius.com/search?q=test` to verify it's valid. Returns `{ ok: false, error }` (never throws/500s) rather than an HTTP error status on failure — see [Known Gotchas](#known-gotchas). |
| `GET` / `PUT` / `DELETE` | `/api/settings/keys?key=<KEY>` | Read (masked, last 4 chars only, plus `source: 'db'\|'env'\|'unset'`), set, or clear one setting from a fixed whitelist (`ALLOWED_KEYS` in the route file) that includes `GENIUS_ACCESS_TOKEN`, `DISCOGS_USER_TOKEN`, `ACOUSTID_API_KEY`, S3/AWS credentials, `MUSICBRAINZ_CONTACT`, `LUCID_DEVICE`/`LUCID_ENDPOINT_NAME`, `id3_writeback_enabled`, `TAILSCALE_AUTHKEY`, `CLOUDFLARE_TUNNEL_TOKEN`, and slskd/Soulseek credentials. Any key outside that whitelist is rejected with `400`. |

`GET /api/settings/scan` and `PUT /api/settings/scan` also exist
(`auto_deep_analysis` toggle) but they configure the analyst's scanning
behavior, which is squarely core library-scanning territory — see the
library-scanning doc for that subsystem; it's only mentioned here because it
lives in `/api/settings/` alongside the routes above.

### DB tables

`artists`, `albums`, `songs`, `credits`, `annotations`, `lyrics`, `tags`,
`song_tags`, `history`, `library_files` (joined, read-only, from
`history/ghost` and `history/completeness`), `app_settings` (via
`getSetting`/`setSetting`).

Discogs (`src/lib/discogs.ts`, `searchRelease()`/`getRelease()` against
`https://api.discogs.com`) is **not** called from any route in this document
— its only callers are `/api/library/[hash]/pressing` and
`/api/library/[hash]/match`, which belong to the library-scanning doc. It's
documented here only because its env var (`DISCOGS_USER_TOKEN`) is managed
through the same `/api/settings/keys` whitelist as the Genius token.

---

## Cathode — hardware equipment & burn-in hour tracking

**Problem it solves**: audiophile/hi-fi equipment (DACs, amps, headphones,
tube gear, etc.) is often tracked by cumulative "burn-in" hours — how long a
component has been run — which listeners use to judge when a component has
settled into its final sound signature, or simply to log wear over time.
Cathode lets you define named hardware profiles (a DAC, an amp, a pair of
headphones, or a whole system made of several components), tag each with a
`device_type`, list its physical `components`, and accumulate playback hours
against it — driven by Lucid reporting how long a track played on that
profile's associated device.

### Endpoint reference

All routes below use session-cookie auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cathode/profiles` | List all `hardware_profiles`, ordered by name. |
| `POST` | `/api/cathode/profiles` | Create a profile. Body: `{ name, description?, device_type?, components?: [{role, model}], lucid_device? }`. `device_type` defaults to `'system'`; must otherwise be one of `dac`, `amp`, `speaker`, `headphone`, `dap`, `system` (see `HardwareProfile` in `src/lib/types.ts`). |
| `GET` | `/api/cathode/profiles/[id]` | Fetch one profile, including `total_hours`. |
| `PUT` | `/api/cathode/profiles/[id]` | Partial update of any field (name/description/device_type/components/lucid_device). |
| `DELETE` | `/api/cathode/profiles/[id]` | Delete a profile. |
| `POST` | `/api/cathode/profiles/[id]/hours` | Body: `{ hours: number }` (must be non-negative) — adds to `total_hours`. Called when a track finishes playing on the endpoint associated with this profile (`lucid_device`). |

### DB tables

`hardware_profiles` (`id`, `name`, `description`, `device_type`,
`components` jsonb, `total_hours`, `lucid_device`, `created_at`).

Cathode has no direct external-service dependency of its own — it's fed by
Lucid (via `lucid_device` linking a profile to a specific ALSA/AirPlay
output) rather than any third-party API. See `Endpoint`/`endpointLabel()` in
`src/lib/endpoint.ts` for how the browser tracks which output ("This
Browser" / `ALSA: <device>` / `AirPlay: <name>`) is currently selected — the
`device` string it stores is the same identifier a Cathode profile's
`lucid_device` would reference.

---

## Waveforms proxy

**Problem it solves**: waveform PNGs are generated and stored by the analyst
sidecar, not the Next.js app, but browsers need a same-origin (or at least
Caddy-routed) URL to fetch them from, and `ANALYST_URL` isn't known at Docker
build time (only at container runtime).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/waveforms/[hash]` | none (no session check in this handler) | Streams `{ANALYST_URL}/waveforms/{hash}` straight through, preserving `content-type` and setting `Cache-Control: public, max-age=3600`. Returns `502` if the analyst is unreachable. |

The code comment in the route file explains why this exists as a runtime
route handler rather than a `next.config.js` rewrite: rewrites are resolved
at *build* time, so baking in `ANALYST_URL` at build time would freeze it to
whatever default was present in the build environment (`http://analyst:8000`
fallback), breaking at runtime in any deployment where the real value differs.
A route handler re-reads `process.env.ANALYST_URL` on every request instead.

### Env vars

`ANALYST_URL` (default `http://analyst:8000`).

---

## Backup & disaster recovery

**Problem it solves**: back up the Postgres database (which holds nearly
everything except audio files and waveform images) to off-site S3-compatible
storage on demand.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/backup` | session cookie | Reports whether S3 is configured (`S3_BUCKET` + `AWS_ACCESS_KEY_ID` both set) and the last backup's metadata (`{ timestamp, s3_key, size_bytes }`, persisted under the `aegis_last_backup` setting key). |
| `POST` | `/api/backup` | session cookie | Runs `pg_dump {DATABASE_URL}`, streams its stdout directly into an S3 multipart upload (`@aws-sdk/lib-storage` `Upload`) at `backups/phonolith-{timestamp}.sql`, counting bytes in-flight via a passthrough `Transform` stream rather than buffering the whole dump to measure its size. Persists the result to `aegis_last_backup`. |

Env vars: `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` (all read through `getSetting`, so they're overridable
via `/api/settings/keys` without a restart), `DATABASE_URL`.

This is a **different mechanism** from Polyphony's
`/api/polyphony/backup/mirror/[id]` (documented above): this route pushes to
your own S3 bucket; Polyphony's pushes to a paired peer instance's disk.
Both spawn `pg_dump` against the same `DATABASE_URL` and both are careful to
log `pg_dump`'s stderr server-side only (never return it to the client),
since it can include the DSN — and therefore DB credentials — the process
was invoked with.

---

## Known gotchas

- **Soulseek calls silently degrade instead of erroring.** Every function in
  `src/lib/soulcatcher.ts` (`searchSoulseek`, `downloadFile`,
  `getDownloadStatus`, `getSlskdStatus`) catches its own exceptions and
  returns an empty array / `false` / `{ online: false }` rather than
  throwing. This means "slskd is offline" and "there are genuinely zero
  search results" look identical from `/api/soulcatcher/search`'s response
  shape — callers that need to distinguish the two must separately check
  `/api/soulcatcher/status`.
- **Inconsistent error-reporting convention across routes.** Some routes
  return a `{ ok: false, error }` body with **200** status on failure
  (`/api/settings/genius`), some return a JSON error body with a non-2xx
  status (`{ error }` + `401`/`400`/`404`/`502`, the majority pattern), and
  Lucid's own proxy returns `{ online: false, error }` with `503`. There is
  no single convention — always check both the HTTP status and the response
  shape when consuming these routes from new client code.
- **Fixed timeouts everywhere, tuned per backend's expected latency**: slskd
  calls use an 8s axios timeout (plus `searchSoulseek`'s own ~10s polling
  loop on top, so a search can take up to ~18s worst case); Lucid calls use
  5-8s (`AbortSignal.timeout`); peer-to-peer Polyphony calls use 8s (15s for
  streaming, to allow for larger initial buffering); the peer backup push
  uses 120s (a full `pg_dump` stream can be large). None of these are
  currently configurable via environment variables — they're hardcoded in
  each lib/route file.
- **`/api/polyphony/pair` is intentionally the one unauthenticated route** in
  this entire document. Its only gate is possession of a valid, unexpired,
  single-use pairing code (10-minute TTL, deleted on first use). Don't
  "fix" this by adding a session check — the whole point is that the
  *initiating* side has no prior relationship with this instance yet.
- **Peer backup signatures cover only the request line, not the (potentially
  multi-megabyte) body** (`/api/polyphony/backup/receive`) — called out in
  the code as an accepted tradeoff because the signature is already bound to
  a vetted peer identity from pairing, and the body is stored as opaque SQL
  text, never executed by the receiving instance.
- **`/api/waveforms/[hash]` has no auth check** at all (unlike almost every
  other route in this document) — it's a bare proxy to the analyst's PNG
  output with no session-cookie gate in the handler itself.
- **Untrusted filenames from remote Soulseek peers**: `download.filename` in
  the soulcatcher ingest route originates from another Soulseek user's file
  listing and is explicitly treated as attacker-controlled —
  `path.basename(filename.replace(/\\/g, '/'))` strips both `/`- and
  `\`-style path separators before it's used to build `local_path`, to
  prevent a crafted `../../etc/passwd`-style filename from escaping the
  soulcatcher-downloads subtree.
- **Hardcoded internal ports/hosts** appear as fallback defaults throughout
  (`http://slskd:5030`, `http://lucid:8001`, `http://analyst:8000`,
  `postgresql://phonolith:phonolith@db:5432/phonolith`), all overridable by
  the corresponding env var but functional out of the box against the
  service names defined in `docker-compose.yml`.
- **`GENIUS_ACCESS_TOKEN` / `DISCOGS_USER_TOKEN` / etc. resolve DB-over-env,
  cached 60s in Redis** (`getSetting()` in `src/lib/settings.ts`). If you set
  one of these in the Settings UI right after changing the corresponding
  environment variable (or vice versa), you may observe up to a 60-second
  window where the stale cached value is still served.
