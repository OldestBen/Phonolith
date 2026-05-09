# Phonolith

**The Command Center for the Music Obsessive.**

Phonolith is a self-hosted Local Music Intelligence Engine — an open-source, modular platform that treats a music library the way a high-frequency trading floor treats data: real-time, hyper-granular, and cross-referenced with every available external signal.

It is not a player. It is not a tagger. It is the operating system beneath your entire music collection.

---

## Core Philosophy

- **Hash-first identity** — every file is a BLAKE3 hash, not a path.
- **Bit-perfect or bust** — the signal chain is fully observable and mathematically transparent.
- **Zero trust, zero knowledge** — encrypted at rest before a single byte leaves your network.
- **Metadata is truth** — you wrote those tags. Phonolith guards them.

---

## Named Subsystems

Phonolith is composed of discrete, independently deployable microservices. Each has a name that reflects its purpose precisely.

| Name | Layer | Role |
|---|---|---|
| **ResonanceFS** | Ingestion | Secure Virtual Filesystem (SMB/NFS/CIFS mount layer) |
| **Tremor** | Ingestion | Filesystem watcher daemon (inotify / FSEvents) |
| **Engram** | Metadata | Metadata lock engine & version-control guardian |
| **Lexicon** | Metadata | Deep-scraping metadata resolver (MusicBrainz, Discogs, ENGINEER tags) |
| **Prism** | Sonic Lab | Spectral analysis & fake-FLAC / upscale detector |
| **Crest** | Sonic Lab | Dynamic Range (DR / Crest Factor) calculator |
| **Aegis** | Vaulting | Immutable S3 backup, encryption & chunking engine |
| **Bit-Forge** | Vaulting | BLAKE3 hashing service & deduplication index |
| **Lucid** | Playback | Bit-perfect ALSA-exclusive audio transport daemon |
| **Flux** | Playback | Downsampling & AirPlay 2 routing sub-routine |
| **EchoGraph** | Analytics | Scrobble history, Sankey diagrams & genre-evolution engine |
| **Cathode** | Analytics | Hardware endpoint tracker & burn-in accountant |
| **Polyphony** | Ecosystem | Cryptographic peer-network ("Syndicate") for trusted node cross-referencing |
| **Sonic Codex** | Ecosystem | Portable library manifest format (`.codex`) — the blueprint, not the bits |

Full architectural detail for every subsystem lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start

### Prerequisites

- Docker 24+ and Docker Compose v2
- A host directory containing your music files (FLAC, MP3, AAC, DSF, WAV…)

### 1 — Configure

```bash
cp .env.example .env
# Optional: set LIBRARY_PATH to your music directory, or leave blank
# and add sources later via the Sources page in the UI.
nano .env
```

### 2 — Boot

```bash
docker compose up -d
```

The stack will be ready once NATS is healthy and EchoGraph has created the JetStream streams (a few seconds). Open the web UI at **http://localhost:3000**.

### 3 — Watch ingestion

```bash
docker compose logs -f tremor bitforge echograph
```

Tremor detects new files → Bit-Forge computes BLAKE3 hashes → EchoGraph writes tracks to DuckDB. The UI reflects new tracks within seconds.

---

## Service Overview

| Service | What it does |
|---|---|
| **nats** | JetStream message bus — internal backbone for all events |
| **tremor** | inotify filesystem watcher; emits `phonolith.hash.*` events |
| **bitforge** | BLAKE3 content-hash worker; hash follows file across renames |
| **resonancefs** | FUSE virtual filesystem for SMB/NFS library mounts |
| **engram** | Tag journal — captures every metadata edit with full diff history |
| **lexicon** | Metadata resolver — enriches tracks via MusicBrainz + Discogs |
| **prism** | Spectral analysis + fake-FLAC / bitrate-upscale detector |
| **crest** | Dynamic range (DR / crest factor) scorer |
| **aegis** | S3/WORM vault — AES-256 chunked backup with SurePlay integrity checks |
| **lucid** | Bit-perfect ALSA audio transport daemon |
| **flux** | AirPlay 2 receiver + zone routing (multiroom fan-out) |
| **echograph** | Exclusive DuckDB writer — persists all analytics events |
| **cathode** | Hardware endpoint tracker; logs burn-in hours per device |
| **polyphony** | WireGuard peer mesh; propagates Ed25519-signed metadata corrections |
| **sonic-codex** | Generates portable `.codex` library snapshots (gzip SQLite) |
| **semantic** | Computes BPM, key, and audio embeddings for similarity search |
| **opus-proxy** | Transcodes lossless files to Opus 128k on-demand for web playback |
| **waveform** | Pre-renders peak/RMS waveform arrays for the UI player |
| **accuraterip** | Verifies rips against the AccurateRip CRC database |
| **smart** | S.M.A.R.T. drive health monitor (requires privileged container) |
| **api** | FastAPI gateway — REST + WebSocket; reads DuckDB in read-only mode |
| **ui** | React web interface served via nginx |

---

## Hardware Requirements

### Audio playback (Lucid)

Lucid needs access to the ALSA sound device. The compose file maps `/dev/snd`.
Ensure your music library host has an ALSA-capable sound card, or remove the
`lucid` service if you only use AirPlay output.

```yaml
# docker-compose.yml (already configured)
devices:
  - /dev/snd:/dev/snd
group_add: [audio]
```

### AirPlay output (Flux)

Flux uses `network_mode: host` so mDNS advertisements reach your LAN.
This means it binds directly to the host network stack.

### S.M.A.R.T. monitoring (smart)

The `smart` service runs privileged with `/dev` mounted read-only so `smartctl`
can query raw device registers. Set `SMART_DEVICES=/dev/sda,/dev/sdb` in `.env`,
or leave it empty to auto-detect via `smartctl --scan`.

### ResonanceFS (optional)

ResonanceFS is only needed if you want to mount a remote NFS/SMB share as your
library root. It requires `CAP_SYS_ADMIN` and `apparmor:unconfined`. If your
music is on a locally mounted path you can disable this service entirely.

---

## Optional Services

The following services are safe to disable if you don't need them:

```bash
# Disable S3 vaulting (leave S3_BUCKET empty in .env, or comment out in compose)
# Disable AirPlay:
docker compose stop flux

# Disable drive monitoring:
docker compose stop smart

# Disable ResonanceFS (if library is locally mounted):
docker compose stop resonancefs
```

---

## Data Persistence

All persistent data lives in named Docker volumes:

| Volume | Contents |
|---|---|
| `phonolith-data` | DuckDB analytics DB + per-service SQLite files |
| `nats-data` | JetStream message store |
| `phonolith-waveforms` | Pre-rendered waveform JSON |
| `phonolith-proxies` | Opus proxy transcodes |
| `polyphony-keys` | WireGuard keys for peer mesh |

---

## License

GNU Affero General Public License v3.0 — see [`LICENSE`](LICENSE).
