# Phonolith Developer Documentation

This is the complete developer documentation for Phonolith, written to let
anyone — including an AI coding session with zero memory of prior work —
pick the project back up from scratch.

**Start here:** [ARCHITECTURE.md](./ARCHITECTURE.md) — the system overview,
service map, and the handful of cross-cutting concepts (dual auth, the
two-phase scan, SMB auth fallback, Docker build-vs-runtime env vars) that
every other doc assumes you already understand.

## Documentation map

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System overview, service map, cross-cutting concepts and gotchas. Read first. |
| [db-schema.md](./db-schema.md) | Every Postgres table, column, relationship — the full current schema across all migrations. |
| [api-library-and-auth.md](./api-library-and-auth.md) | The Next.js app's library-scanning API routes, the auth system (session cookie + internal service token), and `src/middleware.ts`. |
| [api-integrations.md](./api-integrations.md) | Soulcatcher (Soulseek/slskd), Polyphony (LAN peer discovery), the Lucid proxy, and metadata-provider integrations (Genius/Discogs/MusicBrainz/AcoustID) as used by the app's other API routes. |
| [frontend.md](./frontend.md) | Every page, component, hook, and context in the Next.js UI — especially the browser gapless audio player and the playback bar. |
| [analyst-service.md](./analyst-service.md) | The Python FastAPI scanner sidecar: turbo/enhanced scan passes, SMB support, tag/fingerprint/waveform extraction. |
| [lucid-service.md](./lucid-service.md) | The Python FastAPI playback sidecar: browser/ALSA/AirPlay output, SMB streaming, the realtime signal-path WebSocket. |
| [infra-and-ops.md](./infra-and-ops.md) | Docker Compose service definitions, environment variables, Caddy routing, build/run/test/CI. |

## Reading order for a fresh start

1. [ARCHITECTURE.md](./ARCHITECTURE.md) — always first.
2. [infra-and-ops.md](./infra-and-ops.md) — how the pieces are wired and configured; get the stack running.
3. [db-schema.md](./db-schema.md) — the data model everything else operates on.
4. [api-library-and-auth.md](./api-library-and-auth.md) and [analyst-service.md](./analyst-service.md) together — how content gets discovered, scanned, and ingested (these two are two halves of one pipeline: analyst produces, the app's ingest route consumes).
5. [lucid-service.md](./lucid-service.md) and [frontend.md](./frontend.md) together — how content gets played back (same relationship: Lucid serves, the browser player consumes).
6. [api-integrations.md](./api-integrations.md) — the surrounding features (Soulseek acquisition, LAN peer discovery, metadata enrichment) once the core scan/play loop makes sense.

## Keeping this documentation current

These docs describe the system as of the session that wrote them. If you make
a structural change (new service, new auth mechanism, schema change, a fix for
a gotcha class described here), update the relevant doc in the same change —
don't let this drift into describing a system that no longer exists. Each doc
has a "Known Gotchas / History" section; add to it rather than deleting past
entries, since the *reason* a fix exists is often as valuable as the fix
itself when someone later wonders "why is this written so strangely?"
