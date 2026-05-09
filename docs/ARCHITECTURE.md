# Phonolith — Architecture & Subsystem Reference

This document is the canonical reference for every named microservice, daemon, and tool in the Phonolith platform. Each entry covers: its name, the origin or rationale for that name, its responsibility, its primary interfaces, and its dependencies within the stack.

---

## Layer 1 — Ingestion Engine ("The Tentacles")

### ResonanceFS

> *The secure virtual filesystem module.*

**Responsibility:** Mounts SMB/CIFS and NFS network shares as a virtual drive that Phonolith can read and analyze without copying files to local OS storage. Credentials are stored in the system's secure credential vault (Libsecret on Linux, Windows Credential Manager on Windows).

**Key behaviours:**
- Presents remote shares through a unified virtual path namespace to all other subsystems.
- Enforces read-only mounts by default; write access requires explicit per-share authorization.
- Exposes a health endpoint that other subsystems poll to verify mount liveness before queuing work.

**Primary consumers:** Tremor, Bit-Forge, Prism, Crest, Lucid.

---

### Tremor

> *The background watcher daemon.*

**Name rationale:** Detects the faintest "tremor" — a single tag change or a new file drop — before anything else in the system knows about it.

**Responsibility:** A low-resource background service that watches all registered library paths (local and ResonanceFS-mounted) using `inotify` (Linux) or `FSEvents` (macOS) for filesystem events. When an event fires, Tremor enqueues a job into the ingestion pipeline.

**Key behaviours:**
- Debounces rapid successive events (e.g., a tagger writing multiple tags to one file) into a single pipeline job.
- Differentiates between `CREATE`, `MODIFY`, `DELETE`, and `RENAME` events to route work correctly.
- On `RENAME` / `MOVE`, hands the old path + new path to Bit-Forge so the BLAKE3 identity of the file is preserved and history follows the hash.
- Publishes events over an internal message bus (NATS / Redis Streams) so all downstream consumers react independently.

**Primary consumers:** Bit-Forge (hashing), Engram (metadata lock check), Lexicon (metadata enrichment queue).

---

## Layer 2 — Metadata Scanner & Guardian

### Engram

> *The metadata lock engine.*

**Name rationale:** An *engram* is the neurological term for a permanent change in the brain that accounts for the existence of a memory — the physical substrate of a stored experience. Engram locks in your metadata permanently.

**Responsibility:** Before any external service (Roon, a third-party tagger, a bulk-rename script) is permitted to write tags to a file, Engram intercepts the write, snapshots the current tag state as a "Restore Point," and logs the change to a versioned metadata journal. A single UI action can roll the file back to any prior snapshot.

**Key behaviours:**
- Maintains a per-file tag history log in DuckDB, keyed by BLAKE3 hash (not path).
- Exposes a "Restore Point" API: roll back one version, roll back to a specific timestamp, or restore only a subset of fields.
- Granular metadata recovery: if Roon destroys tags, the original audio file does not need to be re-fetched from S3; Engram injects the correct tag payload from its journal directly into the local file.
- Optionally enforces a tag lock on nominated fields (e.g., `PERFORMER`, `VENUE`, `RECORDINGDATE`) so external tools physically cannot overwrite them.

**Primary consumers:** Lexicon (reads Engram's journal before writing), Aegis (backs up the journal), UI restoration workflows.

---

### Lexicon

> *The deep-scraping metadata resolver.*

**Name rationale:** A lexicon is a comprehensive catalogue of words and their meanings — the definitive reference. Lexicon is the definitive reference for every piece of metadata in your library.

**Responsibility:** Performs deep metadata enrichment by querying MusicBrainz, Discogs, AccurateRip, and AcoustID. Maps obscure credits (`ENGINEER`, `MIXER`, `REMIXEDBY`, `MASTERED BY`, `COMPOSER`, `LYRICIST`) into the DuckDB metadata database. Cross-references `MUSICBRAINZ_RELEASEGROUPID` to surface the full mastering lineage of a release.

**Key behaviours:**
- "Valence Killer" logic: given a `MUSICBRAINZ_RELEASEGROUPID`, pulls the complete release history and identifies which master your specific file corresponds to (e.g., "1987 Japanese Master, not the 2011 Remaster").
- Aggregates ratings from embedded tags (`POPM`, `RATING`), Plex/Tautulli API, Last.fm API, and `.nfo` files. Computes a weighted "Internal Rating" combining Last.fm play count and manual 5-star rating.
- Builds the "Mastering Engineer Matrix": tracks `ENGINEER` and `MASTERED BY` credits from Discogs/MusicBrainz, correlates them with Crest's DR scores, and surfaces quality statistics per engineer in EchoGraph.
- Worker-pool architecture: the user configures how many CPU cores Lexicon may consume during enrichment passes.

**Primary consumers:** EchoGraph (analytics), UI version-manager, Sonic Codex exporter.

---

## Layer 3 — Sonic & Acoustic Lab

### Prism

> *The spectral analysis and fraud detection tool.*

**Name rationale:** A glass prism splits white light into its constituent frequencies, making the invisible visible. Prism splits the audio signal to reveal what the file's metadata claims vs. what the audio actually contains.

**Responsibility:** During ingestion, Prism generates a spectral heat map of every newly added file. It detects "Fake FLACs" — files encoded in a lossless container that actually originate from a lossy source — by identifying frequency hard-cut artefacts.

**Key behaviours:**
- Automated spectrogram generation: renders a low-res spectral image of the first 30 seconds of every track and stores it alongside the file record.
- Hard-cut detection: if a file's declared sample rate implies a Nyquist ceiling (e.g., 48 kHz for a 96 kHz file) but the spectral energy ends at 22 kHz, Prism flags: `⚠️ Potential Upscale Detected`.
- AccurateRip cross-checking: for CD rips, compares the file's CRC against the AccurateRip database to confirm zero read errors and verify the rip is bit-for-bit identical to the global reference.
- Acoustic fingerprinting via AcoustID / Chromaprint to identify the track independent of metadata.

**Primary consumers:** UI library health dashboard, Aegis (marks suspect files in the vault index), EchoGraph.

---

### Crest

> *The Dynamic Range calculator.*

**Name rationale:** The *crest factor* is the precise engineering term for the ratio of the peak value of a waveform to its RMS value — the mathematical definition of dynamic range.

**Responsibility:** Calculates the official DR value (as defined by the Dynamic Range Database methodology) for every track and album in the library. Stores DR scores in DuckDB indexed by BLAKE3 hash.

**Key behaviours:**
- Generates a per-library "Loudness War" heat map: a visual grid of DR scores across the collection.
- Version comparison: when multiple masters of the same release exist, Crest's DR scores are the primary metric in the Version Manager UI for ranking them.
- Exposes DR data to Lexicon for the Mastering Engineer Matrix correlations.
- Flags albums where a "Remaster" is acoustically a volume-boosted or clipping version of the original.

**Primary consumers:** UI version manager, EchoGraph, Lexicon (engineer matrix), smart playlist engine.

---

## Layer 4 — Enterprise-Grade Vaulting Engine

### Aegis

> *The overarching immutable backup, encryption, and chunking engine.*

**Name rationale:** Aegis was the mythological shield of Zeus — impenetrable protection. Your music library deserves the same.

**Responsibility:** The top-level orchestrator for all vaulting operations against S3-compatible endpoints (AWS S3, Backblaze B2, Cloudflare R2, Wasabi). Manages the full lifecycle: ingestion, tiering, retention, verification, and recovery.

**Key behaviours:**
- **Continuous Data Protection (CDP):** Reacts to Tremor events. When a file is added or modified, Aegis immediately chunks, compresses, and streams it to S3. There is no scheduled "full backup" after the initial seed — synthetic fulls are constructed from the hash-addressed chunk store.
- **Zero-Knowledge Encryption:** Every chunk is encrypted with AES-256 using a key held only by the user before it leaves the local network. S3 stores opaque encrypted blobs.
- **S3 Object Lock (WORM):** Configurable immutability periods. Even a fully compromised local network or a ransomware event cannot alter or delete vaulted objects within the retention window.
- **Audio-Aware Tiered Lifecycle:**
  - *Hot tier* (Standard S3 / R2): metadata database, waveforms, 256 kbps Opus proxy files.
  - *Cold tier* (Glacier Deep Archive / equivalent): raw 192kHz/24-bit FLACs, DSD rips.
- **"SurePlay" Automated Verification:** Monthly, Aegis pulls random chunks from S3, reconstructs them in an isolated container, and runs `flac -t` (or equivalent) to prove the backup is intact. Sends a signed health report to the user.
- **Granular Item-Level Recovery:** Restore an entire directory, a single deleted FLAC, or just the metadata payload without touching the audio bytes.
- **"Golden Copy" Deduplication:** When a user owns both a 16/44.1 CD rip and a 24/192 download of the same album, Aegis vaults both to the cold tier. The local NAS can then safely purge the lower-quality version, with Aegis able to restore it on demand.

**Primary consumers:** Bit-Forge (provides hashes and chunk manifests), Engram (backs up the metadata journal), Prism (stores spectrograms).

---

### Bit-Forge

> *The hashing and deduplication index service.*

**Name rationale:** Every file that enters the system is "forged" into a unique cryptographic identity — hammered from raw bytes into a permanent BLAKE3 fingerprint.

**Responsibility:** Computes BLAKE3 hashes for every file and chunk in the system. Maintains the deduplication index that allows Aegis to avoid re-uploading data that is already in the vault.

**Key behaviours:**
- Computes file-level BLAKE3 hashes on ingestion (triggered by Tremor).
- Computes chunk-level hashes for the Aegis CDP pipeline (content-defined chunking, similar to Restic / Bup).
- Maintains the deduplication manifest in DuckDB: a map of `chunk_hash → S3_object_key`.
- On file `RENAME`/`MOVE` events (from Tremor), updates the path index while preserving the hash identity, so EchoGraph's play history and Engram's tag journal remain intact.
- Exposes the "Acoustic Fingerprint Diff" API: given two file paths, compares their audio stream hashes (ignoring metadata headers) to detect acoustically identical files in different containers (e.g., a FLAC and a WAV of the same recording).

**Primary consumers:** Aegis (chunk manifests), Engram (hash-keyed journal), Lexicon (hash-keyed metadata records), EchoGraph (hash-keyed play history).

---

## Layer 5 — Playback & Signal Transport Engine

### Lucid

> *The bit-perfect ALSA-exclusive audio transport daemon.*

**Name rationale:** "Lucid" implies perfect, unobstructed clarity — a completely transparent signal path with nothing added and nothing removed.

**Responsibility:** The core playback engine. When a high-end USB DAC is physically connected to the server, Lucid bypasses the Linux kernel audio mixer entirely, takes exclusive control of the ALSA interface, and feeds the audio device native DSD or untouched PCM at full resolution.

**Key behaviours:**
- Exclusive ALSA device access: no OS mixer, no resampling, no volume normalisation.
- Supports Native DSD (DoP and native DSD over USB) and PCM up to 32-bit / 768kHz.
- RAM pre-caching ("Memory Play"): on album playback start, Lucid loads the entire album from NAS/HDD into server RAM, allowing the physical drives to spin down immediately. Gapless transitions are handled in memory.
- Publishes real-time signal path metadata (source format → decoder → DSP chain → transport → endpoint) over MQTT for the UI's "Glass-Box" Signal Path Visualizer.
- Validates the BLAKE3 hash of each file at playback time to detect bit-rot before the audio reaches the DAC.

**Primary consumers:** Flux (delegates AirPlay routing), UI web dashboard (remote control), "Glass-Box" visualizer.

---

### Flux

> *The downsampling and AirPlay 2 routing sub-routine.*

**Name rationale:** *Flux* refers to continuous flow and change — the stream of audio moving across the network, adapting to each endpoint's capabilities.

**Responsibility:** Handles all network audio transport. Discovers AirPlay and AirPlay 2 endpoints on the local network and routes audio from Lucid to them, performing any format conversion required by the protocol or the endpoint's capabilities.

**Key behaviours:**
- **AirPlay Sender:** Discovers HomePods, Apple TVs, and AirPlay-enabled AVRs. Automatically encodes the PCM stream to ALAC at the correct bit depth / sample rate for AirPlay (16/44.1 for AirPlay 1, up to 24/48 for AirPlay 2) on the fly.
- **AirPlay Receiver (shairport-sync integration):** Broadcasts the server as an AirPlay target on the local network. Guest devices can cast to it; Flux relays the incoming stream to Lucid and pushes metadata to the UI via MQTT, treating the guest phone as a "Live Input" source in the Signal Path.
- **Virtual Zone Groups:** Binds multiple AirPlay 2 endpoints into named zones (e.g., "Whole House"). Manages per-device latency offsets to eliminate inter-room echo.
- **Secure Remote AirPlay (Exit Node):** Via Tailscale / ZeroTier integration, the user can cast high-res audio from their home server to AirPlay endpoints on a remote network from a mobile web UI — the server acts as a private, high-res streaming source.
- The Signal Path Visualizer shows per-endpoint format: e.g., the main DAC receives 24/192, the kitchen speaker receives 16/44.1.

**Primary consumers:** Lucid (audio source), UI Signal Path Visualizer, Zone Manager UI.

---

## Layer 6 — Analytics & Hardware Dashboard

### EchoGraph

> *The scrobble history, Sankey diagram, and genre-evolution engine.*

**Name rationale:** An echo is the return of a sound — the record of every listening session, bouncing back to you as insight. EchoGraph maps those echoes into a graph of your listening life.

**Responsibility:** The analytics backbone of Phonolith. Ingests play events from Lucid, Flux, Plex/Tautulli, and Last.fm, and stores them in DuckDB to power every analytics view in the UI.

**Key behaviours:**
- **Scrobble ingestion:** accepts events from local playback (Lucid/Flux), Plex/Tautulli API, and Last.fm historical import.
- **Genre Evolution Sankey Diagram:** shows how listening shifted between genres over configurable time windows.
- **"Ghost" Report:** surfaces tracks rated 5 stars not played in over 365 days.
- **Completeness Matrix:** cross-references your library against MusicBrainz to identify missing albums, discs, or tracks in a discography.
- **Label Deep-Dive:** aggregates ownership statistics by record label.
- **Lossy vs. Lossless Audit:** visual breakdown of library health; flags tracks where a FLAC version exists on a streaming platform but your local copy is a 128 kbps MP3.
- **Mastering Engineer Matrix:** powered by Lexicon's credit data and Crest's DR scores — surfaces quality statistics per engineer and mastering studio.
- **"Proxy-aware" play counting:** play events from the Opus proxy (remote listening) are attributed to the correct BLAKE3-keyed master record, keeping analytics accurate regardless of which format was actually streamed.

**Primary consumers:** UI dashboard, Sonic Codex exporter, Polyphony (shares anonymised stats with trusted peers if opted in).

---

### Cathode

> *The hardware endpoint tracker and burn-in accountant.*

**Name rationale:** A cathode is the terminal through which current flows in a vacuum tube — the endpoint of the signal chain. Cathode tracks every endpoint the signal has ever passed through.

**Responsibility:** Extends EchoGraph's play data with hardware-awareness. Logs which playback endpoint (DAC, headphone amp, speaker system, DAP) was used for each session, enabling equipment-specific analytics and burn-in hour accounting.

**Key behaviours:**
- **Endpoint registration:** user defines hardware profiles (e.g., "Chord Hugo TT2 → Sennheiser HD800S", "KEF LS50W2 — Living Room").
- **Signal-chain scrobbling:** each play event is tagged with the active Lucid / Flux endpoint, matched to the registered hardware profile.
- **Hardware Analytics tab:** in the UI, shows listening habits correlated with equipment — e.g., "80% of Jazz listening is on the Sennheiser HD800S; Electronic is almost exclusively on the KEF LS50W2."
- **Burn-in Hour Tracking:** accumulates playback hours per hardware profile. Useful for tracking vacuum tube hours, headphone driver break-in, and DAC operating hours.
- **S.M.A.R.T. Drive Health monitoring:** polls S.M.A.R.T. data from local HDDs/SSDs and NAS health via SNMP. Triggers Aegis to prioritise emergency evacuation of a drive reporting early failure indicators (`Reallocated_Sector_Ct`, etc.).

**Primary consumers:** UI Hardware tab, EchoGraph (enriches play event records), push notification engine.

---

## Layer 7 — Ecosystem & Community Tools

### Polyphony

> *The cryptographic peer-network ("Syndicate") for trusted node cross-referencing.*

**Name rationale:** *Polyphony* is the simultaneous combination of two or more independent melodic parts — distinct voices working together in harmony. Each node in the Syndicate is an independent voice; together they form a richer, more accurate picture of the music.

**Responsibility:** Enables trusted, privacy-preserving library cross-referencing between Phonolith nodes run by different users. No audio files are ever exchanged — only BLAKE3 hashes, MusicBrainz IDs, and signed metadata payloads.

**Key behaviours:**
- **Secure node peering:** nodes link via built-in WireGuard tunnels (or Tailscale/ZeroTier). Peering requires explicit mutual authorization.
- **Hash-only data exchange:** the system exchanges lists of BLAKE3 hashes and MusicBrainz IDs, never audio content.
- **"Venn Diagram" Dashboard:** shows shared files between nodes and what each peer has that the other lacks (e.g., "Dave has 14 John Martyn albums you don't. You have 3 higher-DR masters of 'Solid Air' than Dave.").
- **"Bounty" List:** flag items from a peer's library; the system exports a structured "Bounty List" — a manifest you can use to acquire the music through your own legal channels.
- **Collaborative Metadata ("Syndicate Tagging"):** a user who manually corrects messy metadata can publish a cryptographically signed metadata fix to their peers. When a peer imports the same album (matched by BLAKE3 hash), Phonolith prompts: "Your friend Dave has a verified metadata fix for this album. Apply Dave's tags?" The truth is crowd-sourced within the trusted circle.
- **Sonic Codex import as "Ghost Library":** a peer can share their `.codex` export; you can browse their entire collection — ratings, DR scores, version notes — without accessing any audio.

**Primary consumers:** UI Syndicate tab, Lexicon (receives peer metadata fixes), Sonic Codex importer/exporter.

---

### Sonic Codex (`.codex`)

> *The portable Universal Library Manifest.*

**Name rationale:** A *codex* is a handwritten manuscript — the most authoritative record of knowledge in its time. The Sonic Codex is the authoritative record of your library's intelligence, not its content.

**Responsibility:** A highly compressed, structured export format (SQLite-based) that encapsulates the complete intelligence of a library without containing a single byte of audio. It is the architectural blueprint of the collection.

**Contents of a `.codex` file:**
- Folder structure and relative paths
- BLAKE3 hash for every file
- AcoustID acoustic fingerprints
- Crest DR scores per track and album
- Prism spectral fraud flags
- Lexicon metadata: full tag sets including `ENGINEER`, `MASTERED BY`, `VENUE`, and MusicBrainz IDs
- Engram metadata version history (anonymised)
- EchoGraph play counts, ratings, and "Ghost" flags
- Crest version-comparison tables (all known masters of each release)

**Key use cases:**
- **Disaster recovery blueprint:** if local storage and S3 are both lost, the `.codex` (small enough to email) tells you exactly what your library contained so you can rebuild it.
- **Taste portability:** send your `.codex` to a friend. They import it as a "Ghost Library" — they can browse your collection, read your ratings, and study your DR comparisons without touching any audio.
- **Polyphony peering seed:** a `.codex` is the initial handshake document when establishing a new Syndicate peer connection.
- **Aegis cold-start:** if you provision a new server from scratch, import your `.codex` and Aegis knows exactly what to restore from S3 and in what order.

**Format:** Compressed SQLite database (`.codex` extension). Optionally signed with the user's Ed25519 key for authenticity verification by peers.

---

## Data & Processing Stack

| Concern | Technology |
|---|---|
| Analytical queries (DR heat maps, Sankey, engineer matrix) | DuckDB |
| Full-text metadata search | SQLite FTS5 |
| Real-time event bus | NATS / Redis Streams |
| Acoustic analysis (BPM, key, mood, timbre) | Essentia / Librosa |
| Hashing | BLAKE3 (via `blake3` crate / Python binding) |
| Audio decode / transcode | FFmpeg, libflac, libopus |
| AirPlay transport | forked-daapd / shairport-sync |
| ALSA exclusive access | libasound (ALSA native API) |
| Credential vault | Libsecret (Linux) / Windows Credential Manager |
| Secure tunnel | WireGuard / Tailscale / ZeroTier |
| Encryption | AES-256-GCM (zero-knowledge S3 chunks) |
| Container runtime | Docker / Podman |
| UI | Dark-mode web interface (accessible from any device on the network) |

---

## Inter-Service Dependency Map

```
Tremor
  └─► Bit-Forge ──────────────────────────────► Aegis
        └─► Engram ──► Lexicon ──► EchoGraph ──► UI
  └─► Prism ─────────────────────────────────► UI
  └─► Crest ──────────► EchoGraph ────────────► UI

ResonanceFS
  └─► [provides path namespace to all services above]

Lucid
  └─► Flux ────────────────────────────────────► AirPlay endpoints
  └─► EchoGraph ──► Cathode ───────────────────► UI Hardware tab

Polyphony
  └─► [peers with remote Phonolith nodes via WireGuard]
  └─► Sonic Codex ─────────────────────────────► Polyphony / local export
```

---

*This document is the canonical reference. Code-level interface contracts live in each subsystem's own module directory.*
