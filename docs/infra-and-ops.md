# Phonolith — Infrastructure & Operations

This document is the single source of truth for how Phonolith is built, configured,
run, tested, and deployed. It assumes zero prior context: everything you need to
operate the stack (docker-compose services, env vars, routing, CI, and the handful
of historical bugs worth knowing about) is captured here.

Phonolith is a self-hosted music library manager made of a Next.js web app plus
two Python sidecars, fronted by Caddy, and orchestrated via `docker-compose.yml`
at the repo root.

---

## 1. Service Map

The stack is defined in `/home/user/Phonolith/docker-compose.yml` (9 services) with
an optional overlay in `/home/user/Phonolith/docker-compose.alsa.yml`.

### `app` — the Next.js web application

- **Build**: `context: .`, `dockerfile: Dockerfile` (repo root, multi-stage Node build — see §5).
- **Ports**: `${APP_PORT:-3000}:3000` — **published to the host** (though in a normal
  deployment you reach it through Caddy, not directly).
- **Depends on**: `db` (waits for `service_healthy`, i.e. `pg_isready`), `redis`
  (waits only for `service_started`).
- **Volumes**: `polyphony_backups:/data/polyphony-backups` — a named volume backing
  the "Polyphony" local backup feature (`POLYPHONY_BACKUP_DIR`).
- **Key environment**: `GENIUS_ACCESS_TOKEN`, `DATABASE_URL` (hardcoded to the `db`
  service's credentials — see §2), `REDIS_URL`, `ANALYST_URL=http://analyst:8000`,
  `LUCID_URL=http://lucid:8001`, `CREDENTIAL_KEY`, `DISCOGS_USER_TOKEN`,
  `ACOUSTID_API_KEY`, `MUSICBRAINZ_APP_NAME`/`MUSICBRAINZ_APP_VERSION`/`MUSICBRAINZ_CONTACT`,
  `S3_BUCKET`/`S3_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `POLYPHONY_BACKUP_DIR`
  (hardcoded to `/data/polyphony-backups`), `SLSKD_URL=http://slskd:5030`, `SLSKD_API_KEY`,
  `INTERNAL_SERVICE_TOKEN`.
- **Role**: serves the UI, owns the Postgres schema, brokers calls to the two
  sidecars and to `slskd`, and is the thing both sidecars call back into via
  `APP_URL` + `INTERNAL_SERVICE_TOKEN` (see §2 and §3).

### `analyst` — Python audio-analysis / library-scanning sidecar

- **Build**: `./analyst/Dockerfile` (single-stage `python:3.12-slim`, installs
  `libchromaprint-tools`, `ffmpeg`, `libsndfile1`; see §5).
- **Ports**: `${ANALYST_PORT:-8000}:8000` — published to the host (mainly for
  direct debugging; in normal operation the app reaches it over the compose
  network at `http://analyst:8000`).
- **Depends on**: `redis` (`service_started`).
- **Environment**: `APP_URL=http://app:3000` (for its callbacks into the app),
  `REDIS_URL`, `LIBRARY_PATH=/music` (fixed inside the container — the *host*
  side of the mapping is controlled by the compose-level `LIBRARY_PATH` var),
  `ACOUSTID_API_KEY`, `INTERNAL_SERVICE_TOKEN`.
- **Volumes** (this is the one with real subtlety, so read closely):
  - `${LIBRARY_PATH:-./music}:/music` — **read-write**, not read-only. The
    comment in the compose file explains why: `write_tags` in `main.py` writes
    edited ID3/Vorbis/MP4 tags back to the actual library files, and the nested
    `soulcatcher_downloads` mount below needs to create its own mountpoint
    *under* `/music` — Docker can't `mkdir` a mountpoint under a read-only bind
    mount (it hits `EROFS`), so the outer mount must be read-write too.
  - `soulcatcher_downloads:/music/soulcatcher-downloads` — a **named volume**,
    mounted *nested inside* the analyst's `/music` tree specifically so a
    library rescan (or the watchdog file watcher) picks up files landing here
    as ordinary library content — see `src/app/api/soulcatcher/downloads/[id]/ingest`.
    This is the completed-Soulseek-downloads directory.
  - `waveforms:/waveforms` — named volume where generated waveform PNGs are
    written and later served back out through `app`'s `/api/waveforms/[hash]`
    route handler (§4).
- **Crucial cross-reference — why `soulcatcher_downloads` ≠ `SLSKD_INCOMPLETE_DIR`**:
  `soulcatcher_downloads` is the *same* named volume mounted into both `slskd`'s
  `SLSKD_DOWNLOADS_DIR` (`/downloads`, on the `slskd` service) and here, under
  the analyst's `/music` tree. It is **not** the same volume as
  `SLSKD_INCOMPLETE_DIR` (`/app/incomplete`, which lives inside the separate
  `slskd_config:/app` volume). That separation is deliberate: `slskd` only
  moves/renames a file into `SLSKD_DOWNLOADS_DIR` once a transfer is fully
  complete, so the analyst's file watcher — which only ever sees
  `soulcatcher_downloads` — can never observe a partially-written, in-progress
  Soulseek download. In-flight transfers are structurally invisible to the
  library scanner until slskd's atomic rename makes them appear "complete" from
  nothing.

### `lucid` — audio transport daemon (streaming + optional ALSA output)

- **Build**: `./lucid/Dockerfile` (two-stage: builder stage compiles
  `pyalsaaudio` against `libasound2-dev`/`gcc`/`g++`, then copies the installed
  packages into a slimmer runtime stage that still carries `alsa-utils` +
  `libasound2-dev` + `ffmpeg`; see §5).
- **Ports**: `${LUCID_PORT:-8001}:8001` — published to the host, though in
  normal use Caddy is what reaches it (see §3); browsers/clients talk to Lucid
  through Caddy's `/stream/*` and `/ws/*` routes, not this published port directly.
- **Depends on**: `redis` (`service_started`).
- **Environment**: `REDIS_URL`, `APP_URL=http://app:3000`, `INTERNAL_SERVICE_TOKEN`.
- **Volumes**: `${LIBRARY_PATH:-./music}:/music:ro` — **read-only**. Unlike the
  analyst, Lucid never writes to library files, it only streams from them (or,
  per the sidecar's `requirements.txt` comment, opens SMB/CIFS network sources
  directly over the wire using the same `smbprotocol` library the analyst uses,
  for credential/behavior parity).
- **Role**: the streaming/playback engine — serves media bytes over `/stream/*`
  and a realtime transport over a WebSocket (`/ws/*`), and optionally drives a
  host ALSA device for bit-perfect exclusive-mode output (see the ALSA overlay
  below and §5).

### `caddy` — reverse proxy / single public entry point

- **Image**: `caddy:2-alpine` (no custom build).
- **Ports**: `${HTTP_PORT:-8080}:80` and `${HTTPS_PORT:-8443}:443` — both
  **published to the host**; this is the intended front door for the whole stack.
- **Depends on**: `app`, `lucid`.
- **Environment**: `SITE_ADDRESS=${SITE_ADDRESS:-:80}` — the default is resolved
  *here*, in compose, not left to the Caddyfile's own placeholder syntax. See §3
  for exactly why that distinction matters.
- **Volumes**: `./Caddyfile:/etc/caddy/Caddyfile:ro` (bind-mounted config),
  `caddy_data:/data` and `caddy_config:/config` (named volumes persisting
  Caddy's state, including any obtained Let's Encrypt certificates, across restarts).
- **Role**: see §3 — routes `/stream/*` and `/ws/*` straight to `lucid:8001`,
  everything else to `app:3000`.

### `tailscale` — optional sidecar, private-network remote access

- **Image**: `tailscale/tailscale:latest`.
- **No ports published** — Tailscale doesn't use forwarded host ports; it's
  reachable at the container's Tailscale IP once authenticated.
- **Capabilities/devices**: `cap_add: [NET_ADMIN, NET_RAW]`, `/dev/net/tun:/dev/net/tun`
  (both required for it to create a WireGuard-based tun interface).
- **Environment**: `TS_AUTHKEY=${TAILSCALE_AUTHKEY:-}`, `TS_STATE_DIR=/var/lib/tailscale`,
  `TS_EXTRA_ARGS=--accept-routes`.
- **Volumes**: `tailscale_state:/var/lib/tailscale` (persists tailnet identity/auth
  across restarts).
- **Behavior if unset**: harmless — sits idle without joining a tailnet. Combine
  with `docker compose exec tailscale tailscale serve ...` / `funnel` to publish
  Caddy over the tailnet or the public internet once authenticated.

### `cloudflared` — optional sidecar, Cloudflare Tunnel exposure

- **Image**: `cloudflare/cloudflared:latest`, `command: tunnel run`.
- **No ports published** — outbound-only tunnel to Cloudflare's edge.
- **Depends on**: `caddy`.
- **Environment**: `TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN:-}`.
- **Behavior if unset**: the container fails to start cleanly. That is expected
  and harmless — just don't run `docker compose up cloudflared` (or leave it
  stopped) if you don't use Cloudflare Tunnel. Requires a tunnel token created
  in the Cloudflare Zero Trust dashboard (Networks → Tunnels).

### `slskd` — headless Soulseek client daemon

- **Image**: `slskd/slskd:latest`.
- **No host port published** — reachable only on the internal Docker network;
  the Next.js app proxies to it via `SLSKD_URL=http://slskd:5030` (`src/lib/soulcatcher.ts`).
- **Environment**: `SLSKD_REMOTE_CONFIGURATION=true`, `SLSKD_SLSK_USERNAME=${SOULSEEK_USERNAME:-}`,
  `SLSKD_SLSK_PASSWORD=${SOULSEEK_PASSWORD:-}`, `SLSKD_HTTP_PORT=5030`,
  `SLSKD_API_KEY=${SLSKD_API_KEY:-}`, `SLSKD_INCOMPLETE_DIR=/app/incomplete`
  (explicitly set, rather than relying on slskd's own default of
  `APP_DIR/incomplete`, specifically so the invisibility guarantee described
  above under `analyst` survives a future slskd version bump changing that
  default), `SLSKD_DOWNLOADS_DIR=/downloads`.
- **Volumes**: `slskd_config:/app` (slskd's own config/state, including the
  incomplete-transfers dir nested under it), `soulcatcher_downloads:/downloads`
  (the completed-downloads volume shared with `analyst`, described above).
- **Depends on**: nothing declared.

### `db` — PostgreSQL

- **Image**: `postgres:16-alpine`.
- **Ports**: none published by default — a commented-out block shows how to
  expose `${DB_PORT:-5432}:5432` for external DB tools if you need it; internal
  to the Docker network otherwise.
- **Environment**: `POSTGRES_USER=phonolith`, `POSTGRES_PASSWORD=phonolith`,
  `POSTGRES_DB=phonolith` — all hardcoded (not templated from `.env`), matching
  the hardcoded `DATABASE_URL` on `app`.
- **Volumes**: `pgdata:/var/lib/postgresql/data`.
- **Healthcheck**: `pg_isready -U phonolith`, every 5s, 5s timeout, 5 retries —
  this is what `app`'s `depends_on: db: condition: service_healthy` waits on.

### `redis` — cache / job queue

- **Image**: `redis:7-alpine`.
- **Ports**: none published by default — same commented-out pattern as `db`,
  for `${REDIS_PORT:-6379}` if you want `redis-cli` access from the host.
- **Volumes**: `redisdata:/data`.
- **Consumed by**: `app`, `analyst`, and `lucid` all connect to
  `redis://redis:6379` — used as shared cache / pub-sub / job coordination
  between the three.

### Named volumes (declared at the bottom of `docker-compose.yml`)

`pgdata`, `redisdata`, `waveforms`, `caddy_data`, `caddy_config`,
`polyphony_backups`, `tailscale_state`, `slskd_config`, `soulcatcher_downloads`.

---

## 2. Environment Variables Reference

Every `${VAR}` / `${VAR:-default}` found in `docker-compose.yml`, plus the
runtime-consumed variables baked into the Dockerfiles. "Consumed by" lists the
service(s) whose `environment:` block sets/reads it (a var can be set on one
service and used by app code for an unrelated concern — noted where relevant).

| Variable | Consumed by | Default (if any) | Purpose |
|---|---|---|---|
| `APP_PORT` | `app` (host port mapping) | `3000` | Host port that publishes the Next.js app container's port 3000. |
| `GENIUS_ACCESS_TOKEN` | `app` | — (empty) | API token for Genius (lyrics/metadata lookups) — see `src/lib/genius.ts`. |
| `DATABASE_URL` | `app` | hardcoded `postgresql://phonolith:phonolith@db:5432/phonolith` | Postgres connection string; not templated — matches `db`'s hardcoded credentials. |
| `REDIS_URL` | `app`, `analyst`, `lucid` | hardcoded `redis://redis:6379` per service | Shared Redis connection string for cache/queue/pub-sub. |
| `ANALYST_URL` | `app` | hardcoded `http://analyst:8000` | Base URL the app uses to reach the analyst sidecar (waveform/cover proxy routes, scan triggers, etc.) — see §4 for why this must be read at request time, not build time. |
| `LUCID_URL` | `app` | hardcoded `http://lucid:8001` | Base URL the app uses to reach the Lucid transport sidecar. |
| `CREDENTIAL_KEY` | `app` | empty (falls back at the code level) | AES-256-GCM key used to encrypt library-source credentials (SMB/NFS passwords, etc.) at rest, decrypted via `src/lib/crypto.ts`'s `resolveConfig`. Falls back to a SHA-256 of `DATABASE_URL` if unset — **not safe for production**; generate with `openssl rand -hex 32`. |
| `DISCOGS_USER_TOKEN` | `app` | empty | Discogs API token for release/pressing metadata lookups (`src/lib/discogs.ts`). |
| `ACOUSTID_API_KEY` | `app`, `analyst` | empty | AcoustID API key for audio fingerprint identification (`pyacoustid` in analyst; also referenced app-side). |
| `MUSICBRAINZ_APP_NAME` | `app` | `Phonolith` | Required User-Agent component for MusicBrainz API etiquette (`src/lib/musicbrainz.ts`). |
| `MUSICBRAINZ_APP_VERSION` | `app` | `1.0` | Same User-Agent requirement, app version component. |
| `MUSICBRAINZ_CONTACT` | `app` | empty | Same User-Agent requirement, contact-info component (MusicBrainz asks for a way to reach the API consumer). |
| `S3_BUCKET` | `app` | empty | Target S3 bucket for the "Aegis" backup feature (`src/app/api/backup/route.ts`); also settable at runtime via Settings → Backup. |
| `S3_REGION` | `app` | empty | AWS region for the Aegis S3 bucket. |
| `AWS_ACCESS_KEY_ID` | `app` | empty | IAM access key with `s3:PutObject` on the Aegis backup bucket. |
| `AWS_SECRET_ACCESS_KEY` | `app` | empty | Corresponding IAM secret key. |
| `POLYPHONY_BACKUP_DIR` | `app` | hardcoded `/data/polyphony-backups` | Local (non-S3) backup output directory inside the `polyphony_backups` volume — the "Polyphony" backup feature. |
| `SLSKD_URL` | `app` | hardcoded `http://slskd:5030` | Base URL the app uses to reach the `slskd` REST API (`src/lib/soulcatcher.ts`). |
| `SLSKD_API_KEY` | `app`, `slskd` | empty | Shared API key/secret between the app's Soulseek client code and the `slskd` daemon itself. |
| `SOULSEEK_USERNAME` | `slskd` | empty | Soulseek network account username, passed through as `SLSKD_SLSK_USERNAME`. |
| `SOULSEEK_PASSWORD` | `slskd` | empty | Soulseek network account password, passed through as `SLSKD_SLSK_PASSWORD`. |
| `INTERNAL_SERVICE_TOKEN` | `app`, `analyst`, `lucid` | empty in compose; **code-level fallback** `"phonolith-dev-internal-token-not-for-production"` (see `src/lib/auth.ts` and `src/middleware.ts`) | Shared secret that lets `analyst`/`lucid` call back into the app's internal API routes without a browser session. **Must be set to a real random value in any production deployment** — the dev fallback is not secret (it's in source) and shipping it means anyone can forge internal-service calls. See §8. |
| `LIBRARY_PATH` | host-side only (compose volume mapping for `analyst` and `lucid`) | `./music` | Host directory bind-mounted as `/music` into `analyst` (read-write) and `/music:ro` into `lucid` (read-only). |
| `WAVEFORM_PATH` | `analyst` (Dockerfile `ENV`) | `/waveforms` (fixed inside the container) | Directory analyst writes generated waveform PNGs to; backed by the `waveforms` named volume, later served through `app`'s `/api/waveforms/[hash]` route. |
| `TAILSCALE_AUTHKEY` | `tailscale` | empty | Auth key to join this instance to your private tailnet; passed through as `TS_AUTHKEY`. Harmless if left unset. |
| `CLOUDFLARE_TUNNEL_TOKEN` | `cloudflared` | empty | Tunnel token from Cloudflare Zero Trust dashboard; passed through as `TUNNEL_TOKEN`. Container fails to start cleanly if unset — expected if you don't use this sidecar. |
| `SITE_ADDRESS` | `caddy` | `:80` (resolved in compose's `environment:` block, not the Caddyfile) | Caddy site address / domain. Plain HTTP on `:80` by default; set to a real domain to get automatic Let's Encrypt HTTPS. See §3 for the empty-vs-unset subtlety. |
| `HTTP_PORT` | `caddy` (host port mapping) | `8080` | Host port publishing Caddy's internal port 80. |
| `HTTPS_PORT` | `caddy` (host port mapping) | `8443` | Host port publishing Caddy's internal port 443. |
| `ANALYST_PORT` | `analyst` (host port mapping) | `8000` | Host port publishing the analyst container's port 8000. |
| `LUCID_PORT` | `lucid` (host port mapping) | `8001` | Host port publishing the Lucid container's port 8001. |
| `DB_PORT` | `db` (commented-out host port mapping) | `5432` | Only takes effect if you uncomment the `ports:` block under `db` — for external DB tool access. |
| `REDIS_PORT` | `redis` (commented-out host port mapping) | `6379` | Only takes effect if you uncomment the `ports:` block under `redis` — for `redis-cli` access. |

Notes:
- `APP_URL` (`http://app:3000`), used by `analyst` and `lucid` for callbacks
  into the app, and `LIBRARY_PATH=/music` / `WAVEFORM_PATH=/waveforms` as fixed
  container-internal `ENV` in the analyst's own Dockerfile, are not
  host-configurable — they're intentionally hardcoded to the compose network's
  service names.
- All secrets/tokens above default to the empty string in compose
  (`${VAR:-}`), meaning the corresponding integration is simply disabled/no-ops
  until you supply a real value — except `INTERNAL_SERVICE_TOKEN`, which has an
  application-code fallback rather than degrading gracefully (see §8).

---

## 3. Networking & Routing

Caddy (`/home/user/Phonolith/Caddyfile`) is the **single public entry point** for
the whole stack — it's the only service in the default flow you're meant to
reach directly from outside (the `app`, `analyst`, and `lucid` host port
publishes exist mainly for direct debugging).

Routing rules, in order:

```
{$SITE_ADDRESS} {
    @stream path /stream/*
    @ws path /ws/*

    handle @stream { reverse_proxy lucid:8001 { flush_interval -1 } }
    handle @ws     { reverse_proxy lucid:8001 }
    handle         { reverse_proxy app:3000 }
}
```

- **`/stream/*`** (media bytes) and **`/ws/*`** (the realtime transport
  WebSocket) are proxied **directly to `lucid:8001`** — never through the
  Next.js app process. This is a deliberate latency/throughput decision: audio
  streaming and the realtime control socket bypass the app's request handling
  entirely. `flush_interval -1` on the stream route disables Caddy's response
  buffering so audio bytes are flushed to the client immediately rather than
  batched.
- **Everything else** falls through to the final `handle` block and is
  reverse-proxied to `app:3000`.

### The `SITE_ADDRESS` default-resolution quirk

This is a subtle and easy-to-get-wrong point, and it's the reason the default
is resolved where it is:

- Caddy's own placeholder syntax, `{$VAR:default}`, only substitutes its
  default when the environment variable is **completely unset** in the
  container's environment — not when it's *defined but empty*.
- Docker Compose, however, **always defines** the variable inside a container
  once it appears in an `environment:` list — if the shell running
  `docker compose` has no `SITE_ADDRESS` set, compose still passes
  `SITE_ADDRESS=` (present, empty string) into the container, it does not omit
  the variable.
- So if the Caddyfile were written as `{$SITE_ADDRESS:80}` and compose passed
  through `SITE_ADDRESS=${SITE_ADDRESS}` verbatim, an unset host variable would
  reach Caddy as a *defined, empty* `SITE_ADDRESS` — Caddy's own default would
  never kick in, and Caddy would try to parse an empty string as a site
  address, corrupting the whole config block.
- The fix applied here: resolve the default in `docker-compose.yml`'s
  `environment:` block instead —
  ```yaml
  environment:
    - SITE_ADDRESS=${SITE_ADDRESS:-:80}
  ```
  This uses *compose's* `${VAR:-default}` substitution (which does trigger on
  empty-or-unset) to guarantee Caddy always receives either a real domain or
  the literal string `:80`. The Caddyfile itself just references
  `{$SITE_ADDRESS}` with no fallback, because by the time Caddy sees it, it's
  never actually empty.

**General lesson**: when two layers of variable substitution are stacked
(shell → compose → Caddy, or shell → compose → application), only the
outermost layer that distinguishes "unset" from "empty" can safely apply a
default for a variable that might arrive as empty. Push default-resolution to
that layer, not the innermost one.

---

## 4. The build-time vs. run-time rewrite bug (historical, fixed)

This is a real bug that shipped and was subsequently fixed — worth understanding
in detail because the same mistake is easy to reintroduce.

**File**: `/home/user/Phonolith/next.config.mjs` (note the `.mjs` extension
specifically — not `.js`, not `.ts` — this is what Next.js expects for its ESM
config file).

**What used to be there**: `rewrites()` entries in `next.config.mjs` for
`/api/waveforms/:hash` and `/api/library/:hash/cover`, pointing at
`` `${process.env.ANALYST_URL || 'http://localhost:8000'}` ``.

**Why it broke in production**: Next.js evaluates `rewrites()` (and
`redirects()`) **at build time** — when `next build` runs, which in this
project happens inside the Docker image build (`RUN npm run build` in the
`builder` stage of the root `Dockerfile`). At that point in the Docker build,
`ANALYST_URL` is not set — it's only injected later, at container *runtime*,
via `docker-compose.yml`'s `environment:` block on the `app` service. So
`process.env.ANALYST_URL` was `undefined` during the build, the `||` fallback
kicked in, and the destination `http://localhost:8000` was permanently frozen
into the compiled `.next` routes manifest. In production, `analyst` runs as a
**separate container** — `localhost` inside the `app` container refers to the
`app` container itself, which has nothing listening on port 8000 — so every
waveform and cover-art fetch failed with `ECONNREFUSED`.

**The fix**: replace both `rewrites()` entries with actual Next.js **Route
Handlers** that read `process.env.ANALYST_URL` fresh on every incoming request
and manually proxy the response:

- `src/app/api/waveforms/[hash]/route.ts`
- `src/app/api/library/[hash]/cover/route.ts`

For example, `src/app/api/waveforms/[hash]/route.ts` does:

```ts
export const dynamic = 'force-dynamic'
const ANALYST_URL = process.env.ANALYST_URL || 'http://analyst:8000'

export async function GET(_req, { params }) {
  const upstream = await fetch(`${ANALYST_URL}/waveforms/${encodeURIComponent(params.hash)}`, { cache: 'no-store' })
  // ...stream the response body back, forwarding content-type, with a 502 on network failure
}
```

Note the fallback here is also fixed to the correct compose-network hostname
(`http://analyst:8000`, matching the `analyst` service name) rather than
`localhost:8000` — but the fallback barely matters anymore, since
`ANALYST_URL` genuinely is set at the time this code runs (request time, inside
the running container, after compose has injected env vars) — which is exactly
what a build-time rewrite could never guarantee.

**General lesson** (apply this anywhere in the codebase, not just these two
routes): any config value that legitimately differs between build time and run
time in a containerized Next.js app — anything that depends on
`docker-compose.yml`'s `environment:` block, i.e. essentially every
service-to-service URL in this project — must **not** be baked into
`next.config.mjs`'s `rewrites()` or `redirects()`, because those are evaluated
once, at build time, and frozen into the compiled output. A **Route Handler**
(`route.ts` under `src/app/api/...`) is the correct escape hatch: it reads
`process.env` fresh on every request, at actual container runtime.

---

## 5. Build & Run

### Bringing the stack up

```
docker compose up --build
```

This builds three custom images (`app` from the root `Dockerfile`, `analyst`
from `analyst/Dockerfile`, `lucid` from `lucid/Dockerfile`) and pulls the rest
(`caddy:2-alpine`, `tailscale/tailscale:latest`, `cloudflare/cloudflared:latest`,
`slskd/slskd:latest`, `postgres:16-alpine`, `redis:7-alpine`).

#### `app` image (root `Dockerfile`) — multi-stage Node build

1. `base`: `node:20-alpine`.
2. `deps`: installs `libc6-compat` (needed for some native npm deps on musl),
   copies `package.json`/`package-lock.json*`, runs `npm ci`.
3. `builder`: copies `node_modules` from `deps`, copies the full source tree,
   runs `npm run build` (this is where the `rewrites()` build-time evaluation
   from §4 happens).
4. `runner`: `NODE_ENV=production`, creates an unprivileged `nodejs`/`nextjs`
   user, copies only `public/`, the Next.js `standalone` output
   (`.next/standalone`), `.next/static`, and `src/migrations` (DB migration
   files, needed at runtime) — deliberately not the full source tree or
   `node_modules`, since `output: 'standalone'` (set in `next.config.mjs`)
   traces and bundles only what's actually needed. Runs as `nextjs`, exposes
   3000, `CMD ["node", "server.js"]`.

#### `analyst` image (`analyst/Dockerfile`) — single-stage

`python:3.12-slim` base; installs `libchromaprint-tools` (for AcoustID
fingerprinting via `pyacoustid`), `ffmpeg`, `libsndfile1` (for `librosa`
audio decoding); `pip install`s `requirements.txt`; declares `VOLUME /music`
and `VOLUME /waveforms`; sets `ENV LIBRARY_PATH=/music` and
`ENV WAVEFORM_PATH=/waveforms`; runs `uvicorn main:app --host 0.0.0.0 --port 8000`.

#### `lucid` image (`lucid/Dockerfile`) — two-stage

1. `builder`: `python:3.12-slim` + `alsa-utils`, `libasound2-dev`, `gcc`, `g++`
   — the compiler toolchain needed to build `pyalsaaudio` from source — then
   `pip install --prefix=/install` into an isolated prefix.
2. Runtime stage: fresh `python:3.12-slim` + `alsa-utils`, `libasound2-dev`,
   `ffmpeg` (no compiler toolchain — smaller final image), copies the
   `/install` prefix from the builder stage into `/usr/local`, copies source,
   exposes 8001, `CMD ["python", "main.py"]`. The comment in the Dockerfile
   notes `/dev/snd` device access is granted via docker-compose, not the
   Dockerfile itself.

### The ALSA overlay

`docker-compose.alsa.yml` is an **optional overlay**, not a separate stack:

```
docker compose -f docker-compose.yml -f docker-compose.alsa.yml up -d
```

It adds exactly two things to the `lucid` service:
```yaml
services:
  lucid:
    devices:
      - /dev/snd:/dev/snd
    group_add:
      - audio
```

- **When to use it**: only on a host with real audio hardware (a USB DAC, HAT,
  etc.) where you want Lucid to take **exclusive control of ALSA** for
  bit-perfect output — i.e., actual local speaker/DAC playback from the server
  itself, not just serving audio to browsers.
- **When you don't need it**: default browser-only playback (streaming PCM/
  compressed audio to a browser tab or other network client over `/stream/*`)
  needs no host audio hardware at all — just run `docker compose up --build`
  without the overlay.
- **Host prerequisite** (per the file's own comment): on Linux, add your user
  to the host's `audio` group before using this overlay.

---

## 6. Testing

### npm scripts (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `dev` | `next dev` | Local dev server with hot reload. |
| `build` | `next build` | Production build (this is what runs inside the Docker image build — see §4/§5). |
| `start` | `next start` | Serve a production build locally (non-Docker). |
| `lint` | `next lint` | ESLint via `eslint-config-next`. |
| `typecheck` | `tsc --noEmit` | Type-check only, no output — uses `tsconfig.json`'s `strict: true`. |
| `test` | `vitest run` | Runs the Vitest unit-test suite once (non-watch). |

### `vitest.config.ts`

- `test.include`: `['src/**/*.test.ts']` — only picks up TS unit tests under
  `src/`, never traverses `node_modules` or `.next`.
- `test.environment: 'node'` (no DOM/jsdom — these are pure backend/unit tests,
  not component tests).
- `resolve.alias`: mirrors the `tsconfig.json` path alias `@/* -> src/*`, so
  test files import the same way application code does (`@/lib/...`).

### What the TS test suite actually covers

Only two test files currently exist:

- **`src/lib/versions.test.ts`** — unit tests for `groupFileVersions` (from
  `src/lib/versions.ts`). Covers: collapsing files with identical
  format/bit-depth/sample-rate signatures into one logical "version"; keeping
  distinct signatures separate; averaging DR (dynamic range) scores across a
  version's files, rounding to one decimal, and correctly ignoring nulls;
  ranking versions by DR score, then bit depth, then sample rate; treating
  `spectral_ok` as true only when every constituent file is clean; bucketing
  files with entirely-null signature fields under `"unknown"`; and the empty-
  input edge case.
- **`src/lib/auth.test.ts`** — unit tests for `verifyInternalServiceToken`
  (constant-value/length comparison against the configured
  `INTERNAL_SERVICE_TOKEN`, including null/empty/wrong-length/wrong-value
  rejection) and for scrypt-based password hashing (`hashPassword`/
  `verifyPassword`): correct round-trip verification, rejection of wrong
  passwords, confirming each hash call salts differently yet both still
  verify, and that a malformed stored hash returns `false` rather than
  throwing. The test file notes that importing `@/lib/auth` transitively
  imports `@/lib/db` (which constructs a `postgres` client), but that client
  doesn't open a connection until a query actually runs — so these tests need
  no live database.

### `analyst/tests/test_scanner.py` (pytest)

Tests the analyst's pure tag-parsing and scanning-orchestration logic in
`analyst/scanner.py`, without needing any of the analyst's heavy dependencies
(`librosa`, `numpy`, `mutagen` are imported lazily inside functions, not at
module load, specifically so these tests stay fast and dependency-light):

- **`TestParseTrackNumber`** / **`TestParseDiscNumber`** — `_parse_track_number`
  and `_parse_disc_number` correctly handle plain integers, `"N/total"` slash
  notation, surrounding whitespace, integer inputs, and return `None` (never
  raise) for `None`, empty string, or garbage input. The test file's docstring
  notes this covers "the exact class of logic where the track_number ingest
  bug lived."
- **`TestScanLibraryUsesFastPath`** — asserts `scan_library` dispatches audio
  files through the fast tag-only indexer (`_fast_index_local`), never the
  heavy full per-file analysis path (`index_file`), for ordinary local-library
  incremental scans; also confirms non-audio files (e.g. `cover.jpg`) are
  skipped entirely.
- **`TestScanSmbPipelining`** — the most structurally interesting test: it
  verifies `scan_smb` dispatches each discovered file for indexing **as it is
  found during the walk**, rather than only after the entire directory walk
  completes (a producer/consumer pipelining guarantee, important for large SMB
  shares where a full walk before any indexing would make new tracks take a
  long time to appear). It proves this deterministically using a **fake
  `smbclient` module** injected via `monkeypatch.setitem(sys.modules,
  "smbclient", fake_smbclient)`: the fake module's `walk()` generator yields
  its first file, then — before yielding the second — blocks on a
  `threading.Event` and records whether that event was already set. The
  indexing callback sets the event as soon as it processes the first file.
  Under the old "walk everything first" design the recorded flag would be
  `False`; under the correct pipelined design it's `True` — asserted as
  `walk_saw_index_during == [True]`.

---

## 7. CI

Single workflow: `/home/user/Phonolith/.github/workflows/ci.yml`, name `CI`.

**Triggers**: `push` to any branch (`branches: ['**']`) and `pull_request`
(any target).

**Job `node`** ("Node (typecheck · lint · test · build)"), `ubuntu-latest`:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 20, `cache: npm`
3. `npm ci`
4. `npm run typecheck`
5. `npm run lint`
6. `npm test` (i.e. `vitest run`)
7. `npm run build`

**Job `python`** ("Python sidecars (lint · compile · test)"), `ubuntu-latest`:
1. `actions/checkout@v4`
2. `actions/setup-python@v5` — Python 3.12
3. `pip install ruff==0.15.8 pytest` — deliberately does **not** install the
   analyst's/lucid's actual `requirements.txt` dependencies. The workflow
   comment explains why this is safe: the analyst's heavy deps (`librosa`,
   `numpy`, `mutagen`) are imported lazily inside functions rather than at
   module scope, so linting, byte-compiling, and the pure-logic unit tests
   need none of them — keeping CI fast.
4. `ruff check analyst lucid` — lint, using the pinned rule set in
   `/home/user/Phonolith/ruff.toml` (`select = ["E4", "E7", "E9", "F"]`,
   `target-version = "py312"`). `ruff.toml`'s own comment explains the pin:
   without an explicit `select`, ruff's *default* rule set varies by version —
   a newer ruff previously enabled import-sorting (`I`) and simplify (`SIM`)
   rules the local version didn't have, so a commit that linted clean locally
   failed CI. Pinning both the rule `select` and (in this workflow) the exact
   `ruff==0.15.8` version keeps results identical everywhere.
5. `python -m py_compile analyst/*.py lucid/*.py` — byte-compile sanity check
   (catches syntax errors without needing dependencies installed).
6. `pytest analyst/tests -q` — runs `test_scanner.py` (there is no equivalent
   test directory/wiring for `lucid` yet; only the analyst has pytest tests as
   of this writing).

---

## 8. Known Gotchas / History

1. **Build-time-frozen `next.config.mjs` rewrites → `ECONNREFUSED` in
   production.** Fully covered in §4. Root cause: `rewrites()`/`redirects()`
   in `next.config.mjs` are evaluated once, at `next build` time, inside the
   Docker image build — before `ANALYST_URL` (or any other compose-injected
   runtime env var) exists. Fixed by replacing the waveform and cover-art
   rewrites with genuine Route Handlers
   (`src/app/api/waveforms/[hash]/route.ts`,
   `src/app/api/library/[hash]/cover/route.ts`) that read `process.env` at
   request time. Generalize this: never route a container's
   inter-service URL through `next.config.mjs`'s rewrite/redirect config.

2. **`.gitignore`'s `waveforms/` rule used to swallow source code.** The
   waveforms-ignore rule was originally unanchored (`waveforms/`), which in
   gitignore syntax matches a directory named `waveforms` **anywhere** in the
   tree — including `src/app/api/waveforms/`, the Route Handler source
   directory described above, not just the intended local `./waveforms`
   generated-output directory (the bind-mount target for the analyst's
   waveform PNGs in local/non-Docker dev). That silently excluded actual
   application source from version control. The fix, present in the current
   `.gitignore` (`/home/user/Phonolith/.gitignore`, line 37), anchors the rule
   to the repo root: `/waveforms/` — which only matches a top-level
   `./waveforms` directory and leaves `src/app/api/waveforms/` untouched.
   **Lesson**: any `.gitignore` rule meant to target a specific top-level
   generated-output directory should be root-anchored (leading `/`) unless you
   deliberately want it to match at every depth.

3. **`INTERNAL_SERVICE_TOKEN` has a hardcoded development fallback — this must
   never reach a real deployment.** Both `src/lib/auth.ts` and
   `src/middleware.ts` fall back to the literal string
   `"phonolith-dev-internal-token-not-for-production"` when the
   `INTERNAL_SERVICE_TOKEN` env var is unset:
   ```ts
   process.env.INTERNAL_SERVICE_TOKEN || "phonolith-dev-internal-token-not-for-production"
   ```
   This token is what lets `analyst` and `lucid` call back into the app's
   internal API routes as a trusted service, without a browser session
   (checked in `src/middleware.ts` against the `internalToken` presented on
   incoming requests). Because the fallback string is committed in source, it
   is **not a secret** the moment the repo is public/shared — any deployment
   that leaves `INTERNAL_SERVICE_TOKEN` unset is trivially impersonatable by
   anyone who has read this file. **Always set `INTERNAL_SERVICE_TOKEN` to a
   real random value** (e.g. `openssl rand -hex 32`) for any deployment beyond
   a throwaway local dev instance — compose alone will not warn you if you
   don't, since `${INTERNAL_SERVICE_TOKEN:-}` silently defaults to empty and
   the application-code fallback silently takes over from there.

4. **`SITE_ADDRESS` empty-vs-unset in Caddy.** Covered fully in §3. Compose
   always defines the variable in the container (empty string if unset on the
   host); Caddy's `{$VAR:default}` placeholder syntax only applies its default
   when the variable is genuinely absent, not merely empty. The default is
   therefore resolved in `docker-compose.yml`'s own `environment:` block
   (`SITE_ADDRESS=${SITE_ADDRESS:-:80}`), not left to the Caddyfile.

5. **`ruff` version pinning.** Not a production incident, but a real CI
   flakiness source worth keeping in mind when touching Python tooling: ruff's
   default rule set changes across versions when no explicit `select` is
   given. `ruff.toml` pins `select = ["E4", "E7", "E9", "F"]` and the CI
   workflow pins the exact installed version (`ruff==0.15.8`). If you bump one,
   keep the other in sync (the `ruff.toml` header comment says this
   explicitly).
