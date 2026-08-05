# Phonolith — Architecture Overview

Phonolith is a self-hosted music library manager. It scans, catalogues, analyses,
and plays back a personal music collection (local disk and/or SMB network
shares), with optional Soulseek acquisition, LAN peer discovery, and
high-fidelity playback (browser, ALSA-exclusive, or AirPlay).

This document is the entry point for understanding the system as a whole. Each
subsystem has its own deep-dive doc (linked below and from `docs/README.md`) —
read this file first to understand how the pieces fit together, then follow
links for implementation detail.

**Read this if:** you are picking up this codebase with zero prior context —
including a fresh AI coding session with no memory of previous work on it.

## The services

Phonolith runs as a set of Docker Compose services on one internal network.
Nothing except `caddy` (and the optional `tailscale`/`cloudflared` sidecars)
is published to the host — every other service is reached by other services
using its Compose service name as a DNS hostname (`app`, `analyst`, `lucid`,
`db`, `redis`, `slskd`), never `localhost`. **This is the single most common
source of bugs in this codebase** — see "Docker networking gotchas" below.

```
                         ┌─────────────┐
                Internet │   Caddy     │  single public entry point
              ───────────▶  (reverse   │
                         │   proxy)    │
                         └──────┬──────┘
                    media bytes │ │ everything else
              + /ws/state (WS)  │ │
                    ┌───────────┘ └───────────┐
                    ▼                         ▼
             ┌─────────────┐           ┌─────────────┐
             │    lucid    │◀─────────▶│     app     │  Next.js 14
             │  (FastAPI)  │  internal │ (Next.js)   │  App Router
             │  port 8001  │  token    │  port 3000  │
             └──────┬──────┘           └──────┬──────┘
                    │ SMB (direct,            │ internal token
                    │ credentials from app)   │
                    │                  ┌───────┴───────┐
                    │                  ▼               ▼
                    │           ┌───────────┐   ┌─────────────┐
                    │           │  analyst  │   │  db (PG16)  │
                    │           │ (FastAPI) │   └─────────────┘
                    │           │ port 8000 │   ┌─────────────┐
                    │           └─────┬─────┘   │   redis     │
                    │                 │ SMB      └─────────────┘
                    ▼                 ▼          ┌─────────────┐
              /music (local)    /music (local)   │    slskd    │
              + SMB shares       + SMB shares     │ (Soulseek)  │
                                                  └─────────────┘
```

| Service | Role | Language/Framework | Port | Docs |
|---|---|---|---|---|
| `app` | Web UI, all business-logic API routes, auth, DB access | Next.js 14 (App Router), TypeScript | 3000 (internal; published via `${APP_PORT}` for direct/dev access, but normal traffic goes through Caddy) | [frontend.md](./frontend.md), [api-library-and-auth.md](./api-library-and-auth.md), [api-integrations.md](./api-integrations.md) |
| `analyst` | Library scanner: discovers files, extracts tags, computes hashes/DR/waveforms/fingerprints, writes tags back | Python, FastAPI | 8000 (internal-only in normal use) | [analyst-service.md](./analyst-service.md) |
| `lucid` | Playback transport: browser streaming, ALSA-exclusive output, AirPlay, realtime signal-path state | Python, FastAPI | 8001 (internal; Caddy routes media + `/ws/state` straight here) | [lucid-service.md](./lucid-service.md) |
| `db` | Postgres 16 — all persistent state | Postgres | 5432 (internal-only) | [db-schema.md](./db-schema.md) |
| `redis` | Pub/sub (realtime signal-path updates) + light caching | Redis 7 | 6379 (internal-only) | referenced throughout |
| `slskd` | Headless Soulseek client, REST API | slskd (.NET) | 5030/5031 (internal-only; `app` proxies to it) | [api-integrations.md](./api-integrations.md) |
| `caddy` | Single public entry point / reverse proxy | Caddy 2 | `${HTTP_PORT}`/`${HTTPS_PORT}` (published) | [infra-and-ops.md](./infra-and-ops.md) |
| `tailscale` | Optional: joins the instance to a private tailnet | — | none published | [infra-and-ops.md](./infra-and-ops.md) |
| `cloudflared` | Optional: exposes Caddy through a Cloudflare Tunnel | — | none published | [infra-and-ops.md](./infra-and-ops.md) |

## The two auth mechanisms

The app has **two parallel, independent auth mechanisms**, and understanding
the split is essential before touching any API route:

1. **Browser session cookie** (`phonolith_session`) — used by the actual human
   user in a browser. Enforced by `src/middleware.ts` (Next.js Edge
   middleware) on every non-public path, which asks the app's own
   `/api/auth/session-status` route to decide (Edge middleware can't use
   Node-only Postgres/crypto code directly, so it delegates the real check).
2. **Shared internal service token** (`X-Internal-Token` header, backed by
   the `INTERNAL_SERVICE_TOKEN` env var, with a hardcoded dev-only fallback
   value) — used by `analyst` and `lucid` to call back into `app`'s API
   *without* a browser session, since sidecars have none. Middleware has a
   blanket bypass: any request carrying the correct token skips the session
   gate entirely, regardless of path. Route handlers that accept this token
   (e.g. ingest, pending-analysis, the source-config endpoint) **must also
   re-verify the token themselves** (`verifyInternalServiceToken`) — the
   middleware bypass is only a coarse first gate, not the authorization
   check itself.

Full detail: [api-library-and-auth.md](./api-library-and-auth.md).

## The two-phase library scan (the core design decision)

Scanning a large library — especially over SMB against a NAS — naively
(hash the whole file, then extract tags, then move on) means nothing shows up
in the UI until the entire library has been fully read once, which can take
hours. Phonolith instead uses a **Plexamp-style two-phase model**:

- **Turbo pass** (fast): reads only the first ~512 KB of each file (enough
  for ID3/Vorbis/MP4 tags and embedded cover art) plus the file's total size
  via a metadata seek — never the whole file. Hashes `header + size` as a
  **provisional** BLAKE3 identity. Tracks become browsable/playable almost
  immediately. For SMB sources, discovery (`smbclient.walk`) and indexing run
  concurrently (a file gets indexed as soon as it's found, not after the
  whole directory tree has been walked).
- **Enhanced pass** (slow, backgroundable): reads the *entire* file, computes
  the **true** full-content BLAKE3 hash, DR score, spectral check, waveform
  PNG, and AcoustID fingerprint. It reports the true hash back to
  `/api/library/ingest` along with the provisional hash as `previous_hash`,
  so the app can **re-key** the existing row in place (or detect and drop a
  true duplicate) instead of creating a second row for the same file.

Full detail (with exact function names): [analyst-service.md](./analyst-service.md)
and the ingest-route deep-dive in [api-library-and-auth.md](./api-library-and-auth.md).

## Playback: three endpoints, one signal-path model

Audio can play through:
1. **This browser** — a from-scratch Web Audio API gapless player
   (`useGaplessPlayer`) that fetches whole tracks from Lucid's `/stream/{hash}`
   passthrough, decodes them client-side, and schedules playback off the
   `AudioContext` clock for sample-accurate gapless transitions.
2. **ALSA (exclusive)** — Lucid opens a physical ALSA device directly for
   bit-perfect output on real DAC hardware (needs the `docker-compose.alsa.yml`
   overlay for `/dev/snd` passthrough).
3. **AirPlay** — Lucid streams to a discovered AirPlay/RAOP receiver on the
   LAN via `pyatv`.

All three report through a shared **Signal Path** model (`SignalPathManager`
in Lucid) — source format/sample-rate/bit-depth/channels, output device,
whether the chain is bit-perfect, and any DSP applied — pushed to the browser
in realtime over Redis pub/sub → a WebSocket (`/ws/state`, routed by Caddy
directly to Lucid, bypassing the Next.js app for latency).

**SMB-sourced tracks are streamed directly by Lucid over SMB**, not proxied
through a local file — Lucid only bind-mounts the local library path, so for
network-sourced rows it fetches the source's decrypted credentials from the
app (`GET /api/library/sources/{id}/config`, internal-token only) and opens
the file itself, with full HTTP Range support so seeking still works.

Full detail: [lucid-service.md](./lucid-service.md) and [frontend.md](./frontend.md).

## SMB authentication: a real gotcha worth knowing up front

Both `analyst` and `lucid` use `smbprotocol` (a pure-Python SMB client). It
defaults to SPNEGO `auth_protocol='negotiate'`, which some NAS/Samba servers
reject with `STATUS_LOGON_FAILURE` **even with fully correct credentials** —
while kernel CIFS mounts (macOS/Windows/Linux) and libsmbclient-based clients
(Plex, Roon) default to raw NTLM and work fine against the same server. Both
services register SMB sessions through a helper that tries `negotiate` first,
then falls back to raw `ntlm`, then `kerberos`, logging whichever succeeds.
If you ever see `STATUS_LOGON_FAILURE` here despite credentials verified
working elsewhere, this is almost certainly why — it is not a wrong-password
problem.

## Branded subsystem names — what they actually are

The codebase and UI use a few internal project names for subsystems; they're
not obvious from the name alone:

| Name | What it is | Docs |
|---|---|---|
| **Lucid** | The playback/transport sidecar (see above) | [lucid-service.md](./lucid-service.md) |
| **Polyphony** | LAN discovery of other Phonolith instances (mDNS/zeroconf), with peer library browsing and cross-instance streaming | [api-integrations.md](./api-integrations.md) |
| **Soulcatcher** | The Soulseek (slskd) search/download/ingest integration | [api-integrations.md](./api-integrations.md) |
| **Engram** | Metadata version history — snapshots of a track's metadata taken on every ingest/edit | [db-schema.md](./db-schema.md) |
| **Cathode** | See [db-schema.md](./db-schema.md) / [api-integrations.md](./api-integrations.md) for what this turned out to be — investigated fresh from the code by the docs agents, since it wasn't self-evident from the name |
| **Glass-Box** | The UI's transparent signal-path detail view (is this bit-perfect end-to-end, or is something transcoding/resampling) | [frontend.md](./frontend.md) |

## Known cross-cutting gotchas

These bit real development sessions on this project and are easy to
reintroduce if you're not aware of them:

1. **Docker service DNS names, not `localhost`.** Any config value baked in
   at *build* time (e.g. a Next.js `next.config.mjs` `rewrites()` entry) will
   see build-time env vars, not runtime ones — `ANALYST_URL` isn't set when
   the Docker image builds, only when the container runs. A rewrite that
   falls back to `http://localhost:8000` at build time freezes that fallback
   into the compiled routes manifest forever, causing `ECONNREFUSED` in
   production. Fix: use a runtime Route Handler that reads `process.env` on
   every request instead of `next.config.mjs` rewrites, for anything
   env-dependent. See [infra-and-ops.md](./infra-and-ops.md).
2. **Middleware session gate vs. internal-token bypass.** Adding a new route
   that the `analyst`/`lucid` sidecars call needs to work with the
   internal-token bypass in `src/middleware.ts` *and* independently verify
   the token in the route handler itself. See
   [api-library-and-auth.md](./api-library-and-auth.md).
3. **SMB auth fallback.** See above — don't assume `STATUS_LOGON_FAILURE`
   means bad credentials.
4. **The turbo/enhanced hash re-key.** `library_files.blake3_hash` is not a
   permanently-fixed identity for SMB-sourced rows during their first scan —
   it starts as a provisional header+size hash and gets re-keyed to the true
   full-content hash once the enhanced pass completes. Code that assumes a
   row's hash never changes after insert will be wrong for freshly-scanned
   SMB content. See [db-schema.md](./db-schema.md).
5. **The browser player has no chunked/streaming decode.** `useGaplessPlayer`
   downloads and fully `decodeAudioData`s an entire track before the first
   sample plays — there's no MediaSource Extensions chunked path yet. Large
   lossless/hi-res files, especially over SMB from a slow NAS, have a real
   startup delay. This is a known limitation, not yet fixed. See
   [frontend.md](./frontend.md).

## Where to go next

Start with [docs/README.md](./README.md) for the full documentation index, or
jump straight to the subsystem you're touching using the tables above.
