# Phonolith

**Command Centre for the Music Obsessive.**

Phonolith is a self-hosted music intelligence platform. It indexes your local audio library, enriches every track with metadata from MusicBrainz and Genius, gives you an annotated lyric reader, and renders your collection as an interactive galaxy visualisation. Everything runs in Docker — one `compose up` is all it takes.

---

## Features

### Library & Analysis
- Mount any local path, NFS share, or SMB/CIFS share as a library source
- Streaming BLAKE3 file hashing — no temp files, no full downloads over the network
- Automatic tag extraction (title, artist, album, year, track) via mutagen
- Dynamic Range (DR) score computed with librosa RMS/peak analysis
- Spectral upscale detection (frequency-ceiling check above 18 kHz)
- Waveform PNG rendered per file (1200 × 200 px, dark background, violet waveform)
- AcoustID acoustic fingerprinting — links files to MusicBrainz recordings
- Two-phase SMB scan: live "discovering" progress → parallel 4-worker indexing

### Metadata Enrichment
- **MusicBrainz** — canonical artist IDs (MBID), accurate release dates, ISRCs, label, recording metadata; rate-limited to 1 req/s per the MusicBrainz guidelines
- **Genius** — song descriptions, structured credits (producer, writer, featured), per-line annotations, and lyrics
- **Discogs** (optional) — additional release metadata and pressing information
- All data is cached in PostgreSQL first; external APIs are only called on a cache miss

### Lyrics & Annotations
- Full lyrics stored locally after first fetch — no repeat API calls
- Per-line Genius annotations with expandable inline view
- User annotations layered alongside Genius annotations
- Copy / Download / Mark-as-read actions per song

### Visualisation
- Force-directed galaxy: album nodes orbit an artist centre, song nodes cluster around albums
- Spider-web connection overlays: collaborator, producer, era (±2 yr)
- Double-click an album to enter focus mode — others fade, songs fan out with labels
- Zoom (0.3× – 3×) and pan on canvas; timeline view (year axis, album swim-lanes)
- Filters: album, decade, tag

### History & Tags
- Every lyrics read, download, and manual mark is recorded with a timestamp
- EchoGraph page: reads-per-week line chart, top-artists bar chart, chronological event log
- Tag any song; filter the library and discography views by tag

### Playback
- **Lucid** — bit-perfect ALSA playback daemon (Linux, Docker profile `audio`): exclusive ALSA lock via pyalsaaudio, gapless queue, frame-accurate seek, RAM pre-caching, two decode paths (soundfile for FLAC/WAV/AIFF; FFmpeg pipe for MP3/AAC/M4A)
- **Signal Path Visualizer** — fixed bottom playback bar with a full-screen "Signal Path" overlay showing the end-to-end chain (Source → Decoder → DSP → Transport → Endpoint), animated flowing pulse while playing, bit-perfect status badge per stage
- **Flux** — AirPlay endpoint discovery via zeroconf (`_raop._tcp.local.`); RTSP/ALAC streaming is a future milestone

### Settings & Backup
- In-app settings for API keys with live "Test" buttons
- Library source management (add, remove, scan, test) with real-time scan progress
- PostgreSQL backup to S3 on demand or scheduled
- AES-256-GCM encryption of SMB/NFS credentials at rest (`CREDENTIAL_KEY`)

---

## Architecture

```
Browser
  └── Next.js 14 (App Router, TypeScript)
        ├── /api/* — DB-first API routes, Redis cache
        ├── postgres.js → PostgreSQL 16
        ├── ioredis   → Redis 7
        └── HTTP      → Analyst sidecar
                     → Lucid sidecar (optional, Linux only)

Analyst sidecar (Python / FastAPI)
  ├── scanner.py     — BLAKE3 · mutagen · DR · spectral · waveform · AcoustID
  ├── accuraterip.py — CRCv1 verification for FLAC/WAV/AIFF during indexing
  ├── watcher.py     — watchdog → debounced rescan on file change
  └── POST /api/library/ingest → Next.js (internal network only)

Lucid sidecar (Python / FastAPI — Docker profile: audio — Linux only)
  ├── alsa.py        — exclusive ALSA lock via pyalsaaudio; gapless queue playback
  ├── decode.py      — soundfile (FLAC/WAV/AIFF) · FFmpeg pipe (MP3/AAC/M4A)
  ├── airplay.py     — AirPlay endpoint discovery via zeroconf (_raop._tcp.local.)
  └── signal_path    — state published to Redis key lucid:signal_path
```

Four core Docker services: `app`, `analyst`, `db` (Postgres 16), `redis` (Redis 7).
A fifth optional service `lucid` starts only with the `audio` Docker profile (Linux hosts only).

---

## Quick Start

**Prerequisites:** Docker with Compose v2.

```bash
git clone https://github.com/OldestBen/Phonolith
cd Phonolith
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
GENIUS_ACCESS_TOKEN=your_token_here   # https://genius.com/api-clients
LIBRARY_PATH=/path/to/your/music      # absolute path on the Docker host
```

Then start everything:

```bash
docker compose up -d
```

Open **http://localhost:8080** in your browser — Caddy is the single public entry point, routing media bytes and the realtime transport socket directly to Lucid and everything else to the app.

To get automatic HTTPS, point a domain's DNS at your host and set `SITE_ADDRESS=your.domain.com` in `.env` before starting — Caddy will obtain and renew a Let's Encrypt certificate and serve on 443 (`HTTPS_PORT`) with no further configuration.

---

## Lucid — Audio Transport

Lucid is a Python/FastAPI daemon (port 8001) that serves as Phonolith's playback transport, modelled on Roon's RAAT philosophy: the server resolves and (when needed) decodes, the endpoint owns the clock, and the signal path is disclosed honestly rather than hidden.

**Browser playback** (no audio hardware required) is the baseline — Lucid passes the original file bytes through `/stream/{hash}` (HTTP Range supported, no transcoding) and the browser decodes locally via the Web Audio API. This works on any host as soon as `docker compose up -d` is running.

**ALSA exclusive output** (bit-perfect, for a USB DAC or other ALSA-compatible hardware) is an optional addon on top of the same Lucid container:

**Requirements (Linux only):**
- Linux host with the ALSA sound subsystem available
- `/dev/snd` device directory exposed to the container
- Your host user must be a member of the `audio` group: `sudo usermod -aG audio $USER`

**Enable it with the ALSA overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.alsa.yml up -d
```

**Signal path state** is published to the Redis key `lucid:signal_path` on every state change and forwarded in realtime over `ws://.../ws/state` — the Playback Bar's signal path display subscribes to this socket rather than polling.

**REST API** (port 8001): `/play`, `/pause`, `/resume`, `/stop`, `/seek`, `/status`, `/devices`, `/queue/*`, `/airplay/endpoints`, `/stream/{hash}` (GET), `/ws/state` (WebSocket)

> AirPlay (Flux) is available as an alternative output path once RTSP/ALAC streaming is implemented.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GENIUS_ACCESS_TOKEN` | Yes | Genius API client access token |
| `DATABASE_URL` | Auto | Set by Compose; override for external Postgres |
| `REDIS_URL` | Auto | Set by Compose; override for external Redis |
| `ANALYST_URL` | Auto | Internal URL of the analyst sidecar |
| `LIBRARY_PATH` | Recommended | Absolute host path mounted into the analyst container as `/music` |
| `MUSICBRAINZ_APP_NAME` | Recommended | Identifies your instance in MusicBrainz User-Agent (default: `Phonolith`) |
| `MUSICBRAINZ_APP_VERSION` | Recommended | Sent with MusicBrainz requests (default: `1.0`) |
| `MUSICBRAINZ_CONTACT` | Recommended | Your email — required by MusicBrainz fair-use policy |
| `ACOUSTID_API_KEY` | Optional | AcoustID API key for fingerprint lookup |
| `DISCOGS_USER_TOKEN` | Optional | Discogs personal access token |
| `S3_BUCKET` | Optional | S3 bucket name for database backups |
| `S3_REGION` | Optional | AWS region for the S3 bucket |
| `AWS_ACCESS_KEY_ID` | Optional | AWS credentials for S3 backup |
| `AWS_SECRET_ACCESS_KEY` | Optional | AWS credentials for S3 backup |
| `HTTP_PORT` | Optional | Host port for Caddy, the public entry point (default: `8080`) |
| `HTTPS_PORT` | Optional | Host port for Caddy's HTTPS listener (default: `8443`) |
| `SITE_ADDRESS` | Optional | Domain name for automatic Let's Encrypt HTTPS via Caddy; blank serves plain HTTP |
| `APP_PORT` | Optional | Host port for the Next.js app directly, bypassing Caddy (default: `3000`) |
| `ANALYST_PORT` | Optional | Host port for the analyst sidecar (default: `8000`) |
| `LUCID_URL` | Optional | Base URL of the Lucid playback daemon (default: `http://lucid:8001`) |
| `LUCID_PORT` | Optional | Host port for Lucid directly, bypassing Caddy (default: `8001`) |
| `CREDENTIAL_KEY` | Recommended | AES-256-GCM key for encrypting SMB/NFS credentials at rest. Generate: `openssl rand -hex 32`. Falls back to a SHA-256 of `DATABASE_URL` if unset (not suitable for production). |

---

## Library Sources

Phonolith supports four source types, configurable in **Settings → Library Sources**:

| Type | Notes |
|---|---|
| **Local** | Any path accessible inside the analyst container |
| **NFS** | Pre-mount on the host; provide the mount path |
| **iSCSI** | Pre-mount on the host; provide the mount path |
| **SMB / CIFS** | Host, share, optional subfolder, optional credentials and domain |

SMB scans run in two phases:
1. **Discovering** — walks the share tree, reports file count live as it grows
2. **Indexing** — hashes and reads tags in parallel (4 workers); posts each record to the app immediately

Progress is shown in real time via the notification bell (top-right corner).

### Synology DSM
Enable SMB service in **Control Panel → File Services → SMB**. Use the NAS IP, share name (e.g. `music`), and your DSM username/password.

### TrueNAS SCALE
Enable SMB in **Shares → Windows (SMB) Shares**. Set SMB protocol minimum to SMB2 or higher.

---

## Metadata Sources

| Source | Data provided |
|---|---|
| **MusicBrainz** | Artist MBID, canonical release dates, ISRCs, label, recording IDs — the audiophile-grade open music encyclopedia |
| **Genius** | Song descriptions, structured credits (producer / writer / featured), per-line annotations, lyrics |
| **Discogs** | Additional release and pressing metadata (optional) |
| **AcoustID** | Acoustic fingerprint → MusicBrainz recording match for untagged or mis-tagged files |

MusicBrainz is always queried on first artist or song fetch and its data is stored alongside Genius data. The two sources are complementary: MusicBrainz provides authoritative identifiers and release structure; Genius provides textual commentary and lyrics.

---

## API Overview

All routes are under `/api`. Full documentation is available at `/docs` inside the running app.

| Method | Route | Description |
|---|---|---|
| GET | `/api/search?q=` | Search artists |
| GET | `/api/artist/[id]` | Artist detail |
| GET | `/api/artist/[id]/songs` | Paginated discography |
| GET | `/api/song/[id]` | Song detail |
| GET | `/api/song/[id]/lyrics` | Lyrics (fetch + cache on miss) |
| GET | `/api/song/[id]/credits` | Producer / writer / featured credits |
| GET | `/api/song/[id]/annotations` | Genius annotations |
| GET/POST | `/api/tags` | List or create tags |
| POST/DELETE | `/api/song/[id]/tags` | Add / remove tag |
| GET | `/api/history` | Event log |
| GET | `/api/library` | All indexed library files |
| GET | `/api/library/status` | Scan status and progress |
| POST | `/api/library/scan` | Trigger a full scan |
| GET | `/api/visualize/[id]` | Visualisation data for an artist |
| GET | `/api/visualize/[id]/connections` | Pre-computed connection graph |
| GET | `/api/waveforms/[hash]` | Waveform PNG (proxied from analyst) |
| POST | `/api/backup/trigger` | Dump Postgres → S3 |
| GET | `/api/versions` | Albums with multiple library versions/masters |
| GET | `/api/versions/[albumId]` | Side-by-side version comparison for an album |
| GET | `/api/engram/[hash]` | Last 50 metadata snapshots for a file (newest first) |
| POST | `/api/engram/[hash]/restore` | Restore all or a subset of fields from a prior snapshot |
| GET | `/api/lucid/status` | Lucid signal path and queue state |
| POST | `/api/lucid/play` | Start playback via Lucid |
| POST | `/api/lucid/pause` | Pause Lucid playback |
| POST | `/api/lucid/resume` | Resume Lucid playback |
| POST | `/api/lucid/stop` | Stop Lucid playback |
| POST | `/api/lucid/seek` | Seek to position in current track |
| GET | `/api/lucid/devices` | Available ALSA devices and AirPlay endpoints |

---

## Development

```bash
npm install
npm run dev        # Next.js dev server on :3000
```

Run Postgres and Redis locally (or via Docker):

```bash
docker compose up db redis -d
```

The analyst sidecar is optional for UI development — library-related pages will show empty states without it.

### Type checking

```bash
npx tsc --noEmit
```

### Building

```bash
npm run build
```

---

## Naming

The fourteen subsystems in Phonolith each have a name. You'll see these in the `/docs` page and in code comments:

| Name | Layer | Purpose |
|---|---|---|
| **ResonanceFS** | Ingestion | File system watcher and multi-source library scanner |
| **Tremor** | Ingestion | SMB/NFS streaming indexer |
| **Engram** | Metadata | Metadata lock engine (MusicBrainz canonical store) |
| **Lexicon** | Metadata | Credit and annotation aggregator (Genius + Discogs) |
| **Prism** | Sonic Lab | Spectral analysis and upscale detection |
| **Crest** | Sonic Lab | Dynamic Range computation |
| **Aegis** | Vaulting | PostgreSQL schema + S3 backup |
| **Bit-Forge** | Vaulting | Waveform renderer and fingerprint pipeline |
| **Lucid** | Playback | ALSA bit-perfect playback daemon (Implemented — basic) |
| **Flux** | Playback | AirPlay 2 routing layer (Implemented — basic) |
| **EchoGraph** | Analytics | Listening history charts and event log |
| **Cathode** | Analytics | Hardware endpoint tracker (planned) |
| **Polyphony** | Ecosystem | Cryptographic peer network for Codex sharing (planned) |
| **Sonic Codex** | Ecosystem | Portable `.codex` manifest format for verified releases |

---

## Licence

MIT
