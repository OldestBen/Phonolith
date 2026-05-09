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

## License

GNU Affero General Public License v3.0 — see [`LICENSE`](LICENSE).
