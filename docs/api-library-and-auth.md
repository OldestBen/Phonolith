# Phonolith: Library API + Auth Subsystem

This document covers the Next.js 14 App Router surface for two things that are
tightly coupled in this codebase: the **Library API** (`src/app/api/library/**`,
plus the sibling `src/app/api/waveforms/[hash]`) and the **Auth system**
(`src/app/api/auth/**`, `src/lib/auth.ts`, `src/middleware.ts`), along with the
supporting lib modules `src/lib/crypto.ts`, `src/lib/db.ts`, and
`src/lib/redis.ts`.

It is written so a developer who has never opened these files can understand
what every route does, how auth is enforced, and the non-obvious business
logic (especially the hash re-keying dance in `POST /api/library/ingest`)
without reading the source.

## 1. Overview: two parallel auth mechanisms

Phonolith's Next.js app ("the app") is the hub of a docker-compose stack. Two
Python FastAPI sidecars call back into it over the internal Docker network:

- **analyst** — scans music sources (local disk, SMB/NFS/iSCSI shares),
  extracts metadata/waveforms/DR scores/AcoustID fingerprints, and POSTs the
  results back to the app at `POST /api/library/ingest`. It also reads
  `GET /api/library/known-files` and `GET /api/library/pending-analysis` to
  decide what still needs work.
- **lucid** — the playback sidecar. It looks up a track's on-disk (or
  on-share) path via `GET /api/library/[hash]`, and for SMB-backed sources it
  fetches the *decrypted* connection credentials via
  `GET /api/library/sources/[id]/config` so it can open the network share
  itself and stream the audio.

Neither sidecar has a browser, so neither can hold a `phonolith_session`
cookie. That's the reason Phonolith has **two independent auth mechanisms**
layered on the same route tree:

1. **Browser session cookie (`phonolith_session`)** — set by
   `POST /api/auth/login` or `POST /api/auth/setup`, verified by
   `getUserFromSessionCookie()` in `src/lib/auth.ts`, and enforced globally by
   `src/middleware.ts` for every non-public path. This is what gates the
   Library UI (search, browsing, editing metadata, managing sources, etc.).
2. **Shared internal-service token (`X-Internal-Token` header)** — a single
   shared secret, `INTERNAL_SERVICE_TOKEN` (env var), with a hardcoded
   development fallback `"phonolith-dev-internal-token-not-for-production"`
   baked into both `src/lib/auth.ts` (`getInternalServiceToken()`) and
   `src/middleware.ts` (duplicated, see §8). This is what analyst and lucid
   send instead of a cookie. It is checked with a **timing-safe** comparison
   (`crypto.timingSafeEqual`) in `verifyInternalServiceToken()`.

### How middleware decides which request is which

`src/middleware.ts` runs on the Next.js **Edge runtime**, which cannot import
`src/lib/auth.ts` (it depends on Postgres via `postgres.js` and Node's
`crypto` module — neither is Edge-compatible in this Next.js version). So the
cookie-name and the internal-token fallback string are **duplicated**
verbatim in middleware, with comments cross-referencing `auth.ts` so the two
copies are kept in sync by hand.

Middleware makes its decision in three layers, checked in this order:

1. **`isPublicPath(pathname)`** — a coarse allow-list checked first, made of
   three separate lists:
   - `PUBLIC_PATH_PREFIXES`: prefix-matched, always public — `/_next`,
     `/favicon.ico`, and the auth routes that must work before a session
     exists (`/api/auth/setup`, `/api/auth/login`, `/api/auth/logout`,
     `/api/auth/me`, `/api/auth/session-status`).
   - `INTERNAL_SERVICE_PATHS`: an **exact-match** list —
     `/api/library/ingest`, `/api/library/known-files`,
     `/api/library/pending-analysis`. These are always let through
     regardless of headers, because they're only ever called by analyst and
     enforce the token themselves in the route handler. Kept as exact
     matches (not a prefix) deliberately, "to keep the exemption tight to
     exactly these routes."
   - `PUBLIC_PAGES`: `/setup`, `/login` — the actual browser pages (not API
     routes) that must render without a session.
2. **Blanket internal-token bypass** — added *after* the exact-match list
   above, as a general fallback: if the request carries an
   `X-Internal-Token` header whose value equals `INTERNAL_SERVICE_TOKEN`
   (plain `===` compare, not timing-safe — see below for why that's OK here),
   middleware lets it through **no matter what the path is**. This is what
   allows `/api/library/sources/[id]/config`, `/api/library/[hash]`,
   `/api/library/deep-scan-pending`, and any *other* internal-only route to
   work without also being hand-added to `INTERNAL_SERVICE_PATHS`.
3. **Session check via `/api/auth/session-status`** — if neither of the
   above applied, middleware calls the app's own
   `GET /api/auth/session-status` route (a real Node.js runtime route, so it
   *can* touch Postgres/crypto) to ask "does this cookie represent a valid
   session, and has setup even been completed yet?" It forwards the
   `session-status` result into a redirect to `/setup` (no users exist yet)
   or `/login` (not authenticated), or lets the request through.

**Why both the exact-match list *and* the blanket bypass exist:** the
exact-match list (`INTERNAL_SERVICE_PATHS`) was the *original* mechanism —
tight and explicit. The blanket token bypass was added *later* as a
generalization, per the comments in `middleware.ts` and `lib/auth.ts`,
because new internal-only routes kept needing this exemption (e.g.
`sources/[id]/config` for Lucid) and hand-adding every one to an exact-match
list is easy to forget. The blanket bypass is a coarse "any correct token
gets past the front gate" rule; the exact-match list still exists (probably
for historical/defense-in-depth reasons) but is now largely redundant with
the bypass for the three paths it lists.

**Important nuance:** middleware's token check (`internalToken ===
INTERNAL_SERVICE_TOKEN`) is a **plain string comparison**, not timing-safe.
This is intentional and explained in-code: middleware is only a coarse "let
it reach the handler" gate. The route handler itself is expected to call
`verifyInternalServiceToken()` — the timing-safe check in `lib/auth.ts` — as
the actual authorization decision. Every internal-only or dual-mode route in
this codebase does call `verifyInternalServiceToken()` directly; middleware
passing a request through is not sufficient authorization by itself.

## 2. Endpoint reference table

| Method & Path | Auth model | Purpose |
|---|---|---|
| `GET /api/library` | session | Search/list `library_files` (fuzzy `pg_trgm` search or full listing) |
| `POST /api/library/scan` | session | Trigger analyst to scan all enabled sources (or legacy default path) |
| `GET /api/library/status` | session | Proxy analyst's `/status` (files indexed, last scan, watching) |
| `GET /api/library/albums` | session | Grouped album listing (search or full), for the albums grid |
| `GET /api/library/sources` | session | List configured library sources, config decrypted + password masked |
| `POST /api/library/sources` | session | Create a new library source (config encrypted before storing) |
| `PATCH /api/library/sources/[id]` | session | Update a source's `enabled`/`name`/`config` |
| `DELETE /api/library/sources/[id]` | session | Delete a source |
| `POST /api/library/sources/[id]/test` | session | Test connectivity of a *stored* (decrypted) source via analyst `/test-source` |
| `POST /api/library/sources/[id]/scan` | session | Trigger analyst `/scan-source` for one specific stored source |
| `GET /api/library/sources/[id]/config` | **internal-token only** | Returns a source's type + **decrypted** credentials, for Lucid to stream from SMB/NFS directly. Sensitive — never session-gated. |
| `GET /api/library/[hash]` | internal-token OR session | Fetch one file row (with song/artist/track join) by BLAKE3 hash |
| `PATCH /api/library/[hash]/metadata` | session | User edits title/artist/album/year/track/disc/engineer; optional ID3 write-back via analyst |
| `POST /api/library/[hash]/deep-scan` | session | Trigger analyst `/deep-scan` for one file (passes SMB config if needed) |
| `GET /api/library/[hash]/cover` | public* | Proxies analyst's extracted cover art PNG/JPEG (no auth check in the route itself; reached only if middleware's session/setup check passes) |
| `POST /api/library/[hash]/match` | session | AcoustID fingerprint lookup + match to a `songs` row by MusicBrainz recording id |
| `GET /api/library/[hash]/pressing` | session | Discogs pressing/release lookup for a file's artist/album, Redis-cached 24h |
| `GET /api/library/pending-analysis` | **internal-token only** | List files with no `dr_score` yet, needing a deep-scan pass; SMB paths excluded unless `source_id` given |
| `GET /api/library/known-files` | **internal-token only** | List `(inode, mtime, file_size)` of all already-fully-indexed local files, for the analyst's scan to skip unchanged files |
| `POST /api/library/deep-scan-pending` | session | Ask analyst to deep-scan whatever it currently considers pending |
| `POST /api/library/test-source` | session | Test connectivity of an *unsaved* source config (Add Source dialog, pre-save) via analyst `/test-source` |
| `POST /api/library/ping` | session | Reachability/latency probe of a host:port via analyst `/ping` |
| `POST /api/library/ingest` | **internal-token only** | The analyst's write-back endpoint: upserts a scanned/analyzed file into `library_files` + `tracks` + `metadata_versions`, with hash re-keying logic (see §4) |
| `GET /api/waveforms/[hash]` | public* | Proxies analyst's waveform PNG |
| `GET /api/waveforms/[hash]/cover` | public* | Proxies analyst's cover art (duplicate of `library/[hash]/cover`, same rationale) |
| `POST /api/auth/setup` | public | First-boot: create the sole admin user (only if no users exist yet) |
| `GET /api/auth/setup` | public | Check whether setup is still needed |
| `POST /api/auth/login` | public | Verify username/password, create session, set cookie |
| `POST /api/auth/logout` | public | Destroy session row + clear cookie |
| `GET /api/auth/me` | session | Return the current user (id/username/role) |
| `GET /api/auth/session-status` | public (used internally by middleware) | The single source of truth for "needs setup?" / "authenticated?" |

\* These routes have no explicit auth check of their own — they're only
reachable at all because `middleware.ts`'s matcher runs for all paths except
`_next/*`, and they are not in `PUBLIC_PATH_PREFIXES`/`INTERNAL_SERVICE_PATHS`
— so in practice a browser must already have passed the session gate (or
carry the internal token) to reach them, purely as a side effect of
middleware ordering, not an explicit check in the handler itself.

## 3. Endpoint-by-endpoint detail

### `GET /api/library`
- **Query params:** `q` (optional, trimmed string).
- **Auth:** session (`getUserFromSessionCookie`).
- **Behavior:** If `q` is present, uses Postgres `pg_trgm` similarity
  (`lf.title % q OR lf.artist % q OR lf.album % q`, ordered by
  `GREATEST(similarity(...))` desc) for fuzzy search. Otherwise returns all
  rows ordered by `indexed_at DESC`.
- **Reads:** `library_files` joined to `songs`, `artists`, `tracks`.
- **Writes:** none.
- **Downstream calls:** none.

### `POST /api/library/scan`
- **Body:** none required.
- **Auth:** session.
- **Behavior:** Reads `getSetting('auto_deep_analysis')` (defaults to on
  unless explicitly `'false'`). Loads all `library_sources WHERE enabled =
  true`. If there are none, falls back to `triggerScan()` (from
  `src/lib/analyst.ts`) which POSTs `{ path: '/music', deep_analysis }` to
  analyst's `/scan` — the legacy single-default-path behavior. Otherwise,
  for each enabled source, decrypts its config via `resolveConfig()` and
  POSTs to analyst `POST /scan-source` with `{ source_id, type, config,
  name, deep_analysis }`, then stamps `library_sources.last_scanned_at =
  NOW()`. Failures per-source are swallowed so remaining sources still run.
- **Reads/writes:** `library_sources` (read all enabled; write
  `last_scanned_at`).
- **Downstream:** `POST {ANALYST_URL}/scan-source` (or `/scan` fallback).

### `GET /api/library/status`
- **Auth:** session.
- **Behavior:** Calls `getStatus()` (`src/lib/analyst.ts`), which is
  `GET {ANALYST_URL}/status`. If analyst is unreachable, returns a
  zeroed/offline placeholder (`files_indexed: 0, last_scan: null, watching:
  false, online: false`) rather than erroring. If reachable, returns the
  analyst payload plus `online: true`.
- **Downstream:** `GET {ANALYST_URL}/status`.

### `GET /api/library/albums`
- **Query params:** `q` (optional).
- **Auth:** session.
- **Behavior:** Groups `library_files` by `(album, artist)` (nulls coalesced
  to `'Unknown Album'`/`'Unknown Artist'`), computing `MIN(year)`,
  `track_count`, a representative `cover_hash` (first `blake3_hash` when
  ordered so rows with a `cover_art_path` sort first), and `has_cover`
  (`BOOL_OR(cover_art_path IS NOT NULL)`). With `q`, filters via `ILIKE` on
  album or artist.
- **Reads:** `library_files`.

### `GET /api/library/sources` / `POST /api/library/sources`
- **Auth:** session (both methods).
- **GET:** Returns all `library_sources`, each with `config` run through
  `resolveConfig()` (decrypt) then `sanitiseConfig()` (masks
  `config.password` as `'••••••••'` — the only field explicitly redacted).
- **POST body:** `{ name: string, type: 'local'|'smb'|'nfs'|'iscsi', config:
  Record<string,string> }`. Validates `name` and `type` are present. Encrypts
  `config` via `encryptConfig()` before insert, returns the row with config
  decrypted-then-masked again for the response (status 201).
- **Reads/writes:** `library_sources` (SELECT all / INSERT).

### `PATCH /api/library/sources/[id]` / `DELETE /api/library/sources/[id]`
- **Auth:** session (both).
- **PATCH body:** `{ enabled?, name?, config? }` — each field is
  `COALESCE`d against the existing DB value (partial update). If `config` is
  present, it's re-wrapped with `sql.json()` — note this route does **not**
  call `encryptConfig()` on the incoming config, unlike `POST
  /api/library/sources`. (Flagged as worth double-checking if source configs
  edited via PATCH are meant to go through encryption too — as written, a
  PATCH-supplied config is stored via `sql.json(body.config)`, i.e. as plain
  JSON, not encrypted.)
- **DELETE:** removes the row by id.
- **Reads/writes:** `library_sources`.

### `POST /api/library/sources/[id]/test`
- **Auth:** session.
- **Behavior:** Loads the source row by id, decrypts its config via
  `resolveConfig()`, and proxies to analyst `POST /test-source` with `{
  type, config }` (15s timeout). Returns whatever analyst returns.
- **Reads:** `library_sources`.
- **Downstream:** `POST {ANALYST_URL}/test-source`.

### `POST /api/library/sources/[id]/scan`
- **Auth:** session.
- **Behavior:** Loads the source, decrypts config, POSTs to analyst
  `/scan-source` with `{ source_id, type, config, name }` (no
  `deep_analysis` flag here, unlike the bulk `/api/library/scan` route),
  stamps `last_scanned_at = NOW()`.
- **Reads/writes:** `library_sources`.
- **Downstream:** `POST {ANALYST_URL}/scan-source`.

### `GET /api/library/sources/[id]/config` — SENSITIVE, see §5

### `GET /api/library/[hash]`
- **Auth:** internal-token OR session — tries the internal token first
  (`verifyInternalServiceToken`); if that fails, falls back to the session
  cookie. Rejects only if *both* fail.
- **Behavior:** Returns one `library_files` row joined to `songs` (title,
  genius id), `artists` (name), `tracks` (track_number), matched by
  `blake3_hash`.
- **Reads:** `library_files`, `songs`, `artists`, `tracks`.
- **Callers:** Library UI (session) and Lucid (internal token, to resolve a
  hash to its `file_path`/`source_id` before deciding whether to stream
  locally or over SMB).

### `PATCH /api/library/[hash]/metadata`
- **Auth:** session.
- **Body:** any of `title, artist, album, year, track_number, disc_number,
  engineer` (only the keys present in the request are applied — `undefined`
  vs explicit `null` matters, checked via `body[field] !== undefined`).
  Rejects with 400 if no editable field is present.
- **Behavior:** Loads the file's `file_path`, `source_id`, joined
  `source_type`, and existing `metadata_overrides`. Merges the new overrides
  into `metadata_overrides` (JSONB) and sets `metadata_locked = TRUE`
  (marking these fields as user-pinned so future automated re-scans won't
  clobber them). Updates the named columns conditionally per-field using
  `CASE WHEN <field present> THEN <value> ELSE <existing column> END` so
  omitted fields are left untouched. Determines `isLocal` as: source type is
  not `'smb'` AND path doesn't start with `\\` or `//`. If
  `getSetting('id3_writeback_enabled') === 'true'` AND the file is local,
  best-effort POSTs to analyst `/write-tags/[hash]` with `{ path, ...overrides
  }` (10s timeout); a failure here is reported back as a non-fatal
  `writeback_warning` string, not an error response.
- **Reads/writes:** `library_files` (read + update), `library_sources`
  (read, for `source_type`).
- **Downstream:** `POST {ANALYST_URL}/write-tags/[hash]` (conditional).

### `POST /api/library/[hash]/deep-scan`
- **Auth:** session.
- **Behavior:** Loads `file_path`, `source_id`, joined source `type` +
  `config`. Determines `isSmb` (source type `'smb'` or path starts with
  `\\`/`//`). If SMB, decrypts the source config via `resolveConfig()`; if
  `host`/`share` are missing, returns `{ ok: false, error: 'SMB source
  configuration not found for this file.' }` without calling analyst. Then
  POSTs to analyst `/deep-scan` with `{ path, [source_type, config,
  source_id if SMB] }` (10s timeout).
- **Reads:** `library_files`, `library_sources`.
- **Downstream:** `POST {ANALYST_URL}/deep-scan`.

### `GET /api/library/[hash]/cover`
- **Auth:** none in-handler (relies on middleware's blanket pass-through, see
  table footnote).
- **Behavior:** Streams-proxies `GET {ANALYST_URL}/waveforms/[hash]/cover`.
  Comment notes this is a route handler (not a `next.config.js` rewrite)
  because build-time rewrites bake in a fallback host that breaks at
  runtime in Docker (see §7/gotchas discussion in the waveforms route).
- **Downstream:** `GET {ANALYST_URL}/waveforms/[hash]/cover`.

### `POST /api/library/[hash]/match`
- **Auth:** session.
- **Behavior:** Loads `id, file_path, fingerprint` for the file. If no
  fingerprint stored yet, calls `getFingerprint(file_path)` (`lib/analyst.ts`
  → analyst `POST /fingerprint`); 502 if that fails. Reads
  `getSetting('ACOUSTID_API_KEY')`; 500 if unset. Queries AcoustID's public
  API (`https://api.acoustid.org/v2/lookup`) directly via `axios` (this is
  the one route in this file set that calls an *external* third-party API,
  not a sidecar) with `{ client: apiKey, fingerprint, meta: 'recordings' }`.
  Takes `results[0].recordings[0].id` as `mb_recording_id`. If a `songs` row
  with that `mb_id` exists, links `library_files.song_id` to it and reports
  `matched: true`; otherwise reports `matched: false` (with the MB id if one
  was found but no local song matched).
- **Reads/writes:** `library_files` (read + `song_id` update),
  `songs` (read by `mb_id`).
- **Downstream:** analyst `/fingerprint` (conditional), AcoustID public API.

### `GET /api/library/[hash]/pressing`
- **Auth:** session.
- **Behavior:** Loads `artist, album, year` for the file; 400 if either
  artist or album is missing. Checks Redis cache key
  `discogs:pressing:[hash]` via `rget`; returns cached result if present.
  Requires `DISCOGS_USER_TOKEN` env var (500 if unset). Calls
  `searchRelease(artist, album, year)` then `getRelease(best.id)` from
  `src/lib/discogs.ts`, caches the detail in Redis for 86400s (24h) via
  `rset`, returns `{ pressing: detail }`.
- **Reads:** `library_files`.
- **Cache:** Redis key `discogs:pressing:{hash}`, 24h TTL.
- **Downstream:** Discogs API (via `lib/discogs.ts`).

### `GET /api/library/pending-analysis` — see §6

### `GET /api/library/known-files`
- **Auth:** internal-token only (`verifyInternalServiceToken` against
  `X-Internal-Token` header — note this route reads the header name as
  `'X-Internal-Token'` while most others read `'x-internal-token'`; HTTP
  headers are case-insensitive so this is not a functional difference, just
  an inconsistency worth knowing about if grepping).
- **Behavior:** Returns `{ inode, mtime, file_size }` for every
  `library_files` row that has all three of `inode`, `mtime`, `file_size`
  set AND `waveform_path IS NOT NULL` (i.e. rows considered "fully done").
  Used by analyst at scan start to build an in-memory set of already-indexed
  files so unchanged files (same inode/mtime/size) are skipped without
  needing to re-read or re-hash them.
- **Reads:** `library_files`.

### `POST /api/library/deep-scan-pending`
- **Auth:** session.
- **Behavior:** Simple proxy — POSTs to analyst `/deep-scan-pending` (10s
  timeout) and returns whatever it responds. (Contrast with
  `pending-analysis`, which is the *Next.js app's own* DB query for pending
  files — this route instead asks the analyst sidecar to run its own
  pending-scan sweep.)
- **Downstream:** `POST {ANALYST_URL}/deep-scan-pending`.

### `POST /api/library/test-source`
- **Auth:** session.
- **Body:** `{ type: 'local'|'smb'|'nfs'|'iscsi', config: Record<string,string>
  }` — the config comes straight from the (unsaved) Add Source dialog, not
  from the DB. 400 if `type` missing.
- **Behavior:** Proxies to analyst `POST /test-source` with `{ type, config
  ?? {} }` (20s timeout — longer than the `sources/[id]/test` variant's 15s).
  Distinguishes itself from `sources/[id]/test`, which loads and decrypts a
  *stored* source instead of taking config directly from the request.
- **Downstream:** `POST {ANALYST_URL}/test-source`.

### `POST /api/library/ping`
- **Auth:** session.
- **Body:** `{ host: string, port?: number = 445 }`. 400 if `host` missing.
- **Behavior:** Proxies to analyst `POST /ping` with `{ host, port }` (10s
  timeout) — a reachability probe, default port 445 (SMB), used by the
  Add Source UI before a full test-source call.
- **Downstream:** `POST {ANALYST_URL}/ping`.

### `POST /api/library/ingest` — see §4

### `GET /api/waveforms/[hash]` / `GET /api/waveforms/[hash]/cover`
- **Auth:** none in-handler (same as `library/[hash]/cover`).
- **Behavior:** Streaming proxy to analyst's `GET
  /waveforms/[hash]`/`/waveforms/[hash]/cover`. The code comment explains
  why this is a runtime route handler rather than a `next.config.js`
  `rewrites()` entry: rewrites are resolved at **build time**, and
  `ANALYST_URL` isn't set at build time inside the Docker image, so a
  rewrite would freeze to the `http://localhost:8000` fallback and every
  waveform/cover fetch would hit `ECONNREFUSED` at runtime. Reading
  `process.env.ANALYST_URL` inside a route handler re-evaluates it per
  request, so the same built image works in any deployment.
- **Downstream:** `GET {ANALYST_URL}/waveforms/[hash]` /
  `{ANALYST_URL}/waveforms/[hash]/cover`.

### `POST /api/auth/setup` / `GET /api/auth/setup`
- **Auth:** public (must work with zero users in the DB).
- **GET:** `{ needsSetup: !hasAnyUsers() }`.
- **POST body:** `{ username, password }`. Rejects if setup already
  completed (409, `hasAnyUsers()` true), if username is blank (400), or
  password is under 8 characters (400). Hashes the password with
  `hashPassword()` (scrypt), inserts into `users` with `role = 'admin'`,
  creates a session (`createSession`), sets the `phonolith_session` cookie,
  returns `{ ok: true }`. Comment notes the `hasAnyUsers()` re-check is only
  a partial guard against a race between two concurrent setup requests (not
  a transaction).
- **Reads/writes:** `users` (read count, insert), `sessions` (insert via
  `createSession`).

### `POST /api/auth/login`
- **Auth:** public.
- **Body:** `{ username, password }`.
- **Behavior:** Looks up the user by username. To avoid leaking via timing
  whether a username exists, it **always** calls `verifyPassword()` — even
  when no user was found, it hashes against a cached dummy hash
  (`DUMMY_HASH()`, computed once and memoized) so the scrypt cost is paid on
  every request regardless. Returns the same generic error (`"Invalid
  username or password."`, 401) either way. On success, creates a session
  and sets the `phonolith_session` cookie; response body is `{ user: { id,
  username, role } }` (password_hash never leaves this module — it's typed
  out via the `UserWithHash` extension type used only internally).
- **Reads/writes:** `users` (read), `sessions` (insert via `createSession`).

### `POST /api/auth/logout`
- **Auth:** public (acts on whatever cookie is present, if any).
- **Behavior:** Reads the raw cookie value, calls `destroySessionCookie()`
  (deletes the `sessions` row for that session id, if the cookie unpacks
  validly), then clears the cookie on the response regardless.
- **Reads/writes:** `sessions` (delete).

### `GET /api/auth/me`
- **Auth:** session.
- **Behavior:** Returns `{ user: { id, username, role } }` for the current
  session, or 401 if none.

### `GET /api/auth/session-status`
- **Auth:** effectively public, but this route is not meant to be called
  directly by end users — it exists specifically to be the thing
  `middleware.ts` calls internally (see §1/§8), because middleware (Edge
  runtime) cannot run `hasAnyUsers()`/`getUserFromSessionCookie()` itself
  (both hit Postgres and Node `crypto`).
- **Behavior:** `{ needsSetup: !hasAnyUsers(), authenticated: false }` if no
  users exist yet (short-circuits before even checking the cookie). Otherwise
  `{ needsSetup: false, authenticated: Boolean(user) }` based on the cookie.

## 4. Deep dive: `POST /api/library/ingest`

This is the write path the **analyst** sidecar uses to report every file it
scans/analyzes. It's gated purely by `verifyInternalServiceToken()` against
the `X-Internal-Token` header (401 if missing/wrong) — there is no session
fallback on this route, since only analyst ever calls it.

### Why "previous_hash" exists

Analyst's SMB scanning has two passes with very different costs:

1. **Turbo pass** — runs first, fast. For files on a slow network share, it
   does *not* read the whole file. Instead it computes a cheap **provisional
   hash** from header bytes + file size. This lets a file appear in the
   library (playable, browsable) almost immediately after a scan starts,
   long before the expensive full-content hash could be computed.
2. **Enhanced (deep-scan) pass** — runs later (either chained automatically
   or triggered per-file/per-source), reads the full file content and
   computes the **true BLAKE3 hash** (`blake3_hash`). Because the true hash
   differs from the provisional one, this pass POSTs both: `blake3_hash`
   (the new, true, permanent identity) and `previous_hash` (the old
   provisional hash that the row is currently keyed under).

### The exact re-key logic (current code, `src/app/api/library/ingest/route.ts`)

```ts
if (data.previous_hash && data.previous_hash !== data.blake3_hash) {
  const [dup] = await sql`SELECT 1 FROM library_files WHERE blake3_hash = ${data.blake3_hash} LIMIT 1`
  if (dup) {
    await sql`DELETE FROM library_files WHERE blake3_hash = ${data.previous_hash}`
  } else {
    await sql`UPDATE library_files SET blake3_hash = ${data.blake3_hash} WHERE blake3_hash = ${data.previous_hash}`
  }
}
```

This runs **before** the main upsert, and only when `previous_hash` is
present and actually differs from the reported `blake3_hash`. There are
exactly two branches:

- **A row with the true hash already exists** (`dup` found) — this means the
  *same content* was already indexed under its correct hash, discovered from
  some other path or source (e.g. the same album already scanned locally, or
  found via a different share). In this case the provisional row (keyed on
  `previous_hash`) is a genuine duplicate of already-correct data, so it is
  simply **deleted**. The subsequent `INSERT ... ON CONFLICT (blake3_hash) DO
  UPDATE` then folds the newly-reported enhanced-pass data (waveform, DR
  score, fingerprint, etc.) into the *pre-existing, correctly-keyed* row.
- **No row with the true hash exists yet** — the provisional row is the only
  copy of this file, just under the wrong (provisional) key. The fix is an
  **in-place `UPDATE`** of `blake3_hash` on that row, re-pointing its primary
  identity to the true hash. All prior work already attached to that row
  (indexed_at history, any user metadata overrides, its `track_id` link,
  etc.) is preserved because the row itself is never deleted — only its key
  column changes. The subsequent upsert then matches this same
  (now-correctly-keyed) row via `ON CONFLICT (blake3_hash)` and updates it
  with the enhanced-pass fields.

**Why this is not simply "always overwrite with the newest data":** a naive
approach — just upsert on whatever hash is reported, or always keep the row
from the most recent report — would either orphan the provisional row (if a
plain insert under the new hash were done instead of a rename, you'd get two
rows for one physical file: the stale provisional one and a fresh one with
none of the provisional row's accumulated state) or silently pick the wrong
survivor when a true duplicate is found elsewhere. The two-branch check
(`SELECT 1 ... true hash` → DELETE-old vs. UPDATE-in-place) is what
guarantees exactly one row survives, and that it's the *correct* one to keep:
- if content already exists correctly-keyed elsewhere, the provisional
  stand-in is dropped (delete);
- if this is the first time this content's true identity is known, the
  existing row's identity is corrected in place (rename), not replaced.

### The rest of the route, in order

1. **Validation:** 401 if `verifyInternalServiceToken` fails; 400 if
   `blake3_hash` missing.
2. **Re-key** (above).
3. **Track find-or-create:** looks up `tracks` by `acoustid = fingerprint`
   first, then by `mb_recording_id`, in that priority order. If neither
   matches an existing row, inserts a new `tracks` row with `acoustid,
   mb_recording_id, title, artist_name, album_name, year, disc_number
   (default 1), track_number, duration_ms`. The resulting `track_id` is
   attached to the file below.
4. **Upsert `library_files`:** a single `INSERT ... ON CONFLICT
   (blake3_hash) DO UPDATE` covering essentially every scanned/analyzed
   column: `blake3_hash, file_path, source_id, relative_path, format,
   bitrate, sample_rate, bit_depth, duration_ms, dr_score, spectral_ok,
   waveform_path, fingerprint, accuraterip_status, track_id, title, artist,
   album, year, track_number, disc_number, engineer, inode, file_size,
   mtime, cover_art_path, indexed_at (NOW())`. Note the `DO UPDATE SET`
   clause also references `accuraterip_confidence = EXCLUDED.accuraterip_confidence`
   even though that column is not part of the `INSERT` column list — this
   relies on `accuraterip_confidence` having a default/being nullable in the
   table (worth confirming against the actual migration if this route is
   touched — the code as written does compile/run against `postgres.js`
   because `EXCLUDED` refers to the *proposed* row, but no
   `accuraterip_confidence` value is ever explicitly supplied in this route,
   so it will just re-write whatever the column's default is on insert).
5. **Metadata version snapshot:** inserts a row into `metadata_versions`
   (`blake3_hash, snapshot (JSONB via sql.json), source = 'ingest'`)
   capturing every analyzed field as a point-in-time snapshot — this is an
   audit/history trail separate from the live `library_files` row.
6. **Pub/sub notification:** best-effort `redis.publish('library:indexed',
   JSON.stringify({ hash, track_id }))`, wrapped in try/catch so a Redis
   outage doesn't fail the ingest itself.
7. **Response:** `{ ok: true, track_id }`.

### Tables touched by `ingest`
- **Reads:** `library_files` (dup-hash check), `tracks` (acoustid /
  mb_recording_id lookup).
- **Writes:** `library_files` (delete-on-dup, rename-on-rekey, upsert),
  `tracks` (insert if new), `metadata_versions` (insert).
- **Redis:** publishes to channel `library:indexed`.

## 5. `GET /api/library/sources/[id]/config` — sensitive, internal-only

This route is **internal-token-only** — it has no session fallback at all,
unlike `GET /api/library/[hash]`. That's deliberate: its entire purpose is to
return a source's **decrypted** connection config (host, share name,
username, password, etc. — whatever the source type's config shape holds),
run through `resolveConfig()` from `src/lib/crypto.ts` (AES-256-GCM decrypt).

**Why it needs to exist at all:** Lucid (the playback sidecar) only has a
bind-mounted local `/music` directory — it has no visibility into SMB/NFS
shares mounted (or not mounted) inside the analyst container. When a track's
`library_files.file_path` is a UNC/SMB path (`//host/share/...` or
`\\host\share\...`), Lucid can't just open it as a local file — it needs the
same connection details analyst used to reach that share, and it needs them
in the clear (not encrypted), since it's going to hand them straight to its
own SMB client.

**Why session auth would be wrong here:** unlike every other library route,
returning this payload to a logged-in *browser* would leak plaintext
credentials to client-side JS/network tab. There is no legitimate browser
use case for this endpoint — only Lucid calls it — so it is deliberately
excluded from ever accepting a session cookie, even though other endpoints
serving similar data (e.g. `sources/[id]/test`) run under session auth
because they only pass config to the *analyst* server-to-server, never back
to the browser.

**Treat this endpoint as sensitive** for any future change: never add a
session-auth fallback to it, never log its response body, and never expose
its port outside the Docker-internal network.

## 6. `GET /api/library/pending-analysis` and the `source_id` scoping

This route (internal-token only) lists files that still need a deep-scan
pass — specifically, rows where `dr_score IS NULL AND file_path IS NOT
NULL`, capped at 500, newest-first (`indexed_at DESC`).

The behavior forks on whether a `source_id` query parameter is supplied:

- **Without `source_id`** (used by the generic/manual local
  "Analyse Unscanned" flow): the SQL adds
  `AND file_path NOT LIKE '\\%' AND file_path NOT LIKE '//%'` — i.e. it
  **excludes** any SMB/UNC network path. The reasoning, per the route's own
  comment: a local, unscoped deep-scan sweep has no share credentials in
  hand, so it can only actually reach files on paths it can open directly
  (local disk). Returning SMB paths here would just produce failures.
- **With `source_id`** (used when the analyst itself chains a deep-scan pass
  immediately after finishing an SMB source's turbo scan): the SQL instead
  adds `AND source_id = $sourceId`, with **no** path-type exclusion — SMB
  paths *are* included. This is safe because the caller in this case is the
  analyst mid-scan of that exact source, and it already holds that source's
  `smb_config` in memory (it just used it to do the turbo pass), so it can
  pass that same config through when it later calls `POST
  /api/library/[hash]/deep-scan` (or its own internal deep-scan pass) for
  each of these paths.

In short: `source_id` present ⇒ "I already have credentials for this
specific source's shares, give me everything including SMB." `source_id`
absent ⇒ "I have no credentials in hand, only give me things I can actually
open."

## 7. Environment variables

| Variable | Used in | Purpose / fallback |
|---|---|---|
| `CREDENTIAL_KEY` | `src/lib/crypto.ts`, `src/lib/auth.ts` | 64-char hex AES-256-GCM key used to encrypt/decrypt `library_sources.config` (`encryptConfig`/`decryptConfig`/`resolveConfig`), and also used to derive the session-cookie HMAC signing key (`getSigningKey()` in `auth.ts`, mirroring the same "if 64 hex chars, use directly; else SHA-256 of `DATABASE_URL`" convention). If unset, both modules fall back to `SHA-256(DATABASE_URL || 'phonolith-dev-key-not-for-production')` — never hard-crashes, but is explicitly **not** production-safe. |
| `INTERNAL_SERVICE_TOKEN` | `src/lib/auth.ts` (`getInternalServiceToken`), `src/middleware.ts` (duplicated constant) | Shared secret for the `X-Internal-Token` header used by analyst/Lucid → app calls. Falls back to the hardcoded dev string `"phonolith-dev-internal-token-not-for-production"` if unset. |
| `DATABASE_URL` | `src/lib/db.ts`, indirectly `crypto.ts`/`auth.ts` fallback seeds | Postgres connection string. Falls back to `postgresql://phonolith:phonolith@localhost:5432/phonolith`. |
| `REDIS_URL` | `src/lib/redis.ts` | Redis connection string. Falls back to `redis://localhost:6379`. |
| `ANALYST_URL` | Nearly every library route, `src/lib/analyst.ts` | Base URL of the analyst sidecar. Falls back to `http://analyst:8000` in route handlers (Docker service name) — but to `http://localhost:8000` inside `src/lib/analyst.ts` specifically (inconsistent fallback host between the two, though in practice `ANALYST_URL` is always set in docker-compose so this rarely matters). |
| `COOKIE_SECURE` | `src/lib/auth.ts` (`createSession`) | If `"true"`, sets the `Secure` flag on the `phonolith_session` cookie. |
| `DISCOGS_USER_TOKEN` | `src/app/api/library/[hash]/pressing/route.ts` | Required for Discogs pressing lookups; 500 if unset. |
| `ACOUSTID_API_KEY` (via `getSetting`) | `src/app/api/library/[hash]/match/route.ts` | AcoustID API client key; read through `getSetting()` so it can also be set via the `app_settings` DB table/admin UI, not just env. |
| Session cookie name | `phonolith_session` — defined once in `src/lib/auth.ts` as `SESSION_COOKIE_NAME`, and **duplicated as a literal string** in `src/middleware.ts` (Edge runtime can't import `auth.ts`) | The browser session cookie. HMAC-signed (`sessionId.hexSignature`), `httpOnly`, `sameSite: 'lax'`, 30-day TTL, `path: '/'`. |

## 8. Known Gotchas

**(a) Middleware redirecting internal-service calls to `/login`.** Before the
blanket internal-token bypass existed in `middleware.ts`, any sidecar call to
a path not in the (hand-maintained, exact-match) `INTERNAL_SERVICE_PATHS`
list would fail the session check and get redirected to `/login` — which,
since analyst/Lucid have no cookie jar and don't follow redirects into a
login flow, meant the call silently failed (scanning/ingest/streaming would
just stop working with no useful error). **If you add a new internal-only
route today**, you have two options, and you should understand both:
  - Rely on the blanket bypass: as long as the caller sends the correct
    `X-Internal-Token` header, middleware lets any path through automatically
    — no middleware edit needed.
  - Additionally/alternatively add the exact path to `INTERNAL_SERVICE_PATHS`
    if you want the route to be reachable *without* the token at the
    middleware layer too (rare — normally you don't want this, since it would
    mean the path is public at the network level and relies entirely on the
    route's own check).
  In **either** case, the route handler itself **must** still call
  `verifyInternalServiceToken()` (the timing-safe check) as its actual
  authorization gate — middleware passing a request through is only ever a
  coarse routing decision, never proof of authorization. Every existing
  internal-only route in this codebase (`ingest`, `known-files`,
  `pending-analysis`, `sources/[id]/config`) does this; a new route that
  skips this check would be reachable by anyone who can reach the app's
  port at all, since the blanket middleware bypass activates on the header
  value alone.

**(b) The cookie name and `session-status` route are the single source of
truth for gating, on purpose.** `src/middleware.ts` cannot import
`src/lib/auth.ts` because that module pulls in `postgres.js` (a real TCP
Postgres client) and Node's `crypto` module (`scrypt`, `timingSafeEqual`),
neither of which run in the Next.js 14 Edge runtime that middleware executes
in. Rather than reimplement session verification in Edge-compatible code (or
try to smuggle the already-computed auth result past the boundary via a
request header — the code comment notes an earlier approach *did* try
something like this, forwarding pathname info for a layout to redo the
check, and it could fall back to treating any pathname as `/`, creating a
redirect loop back to `/setup`), middleware instead makes an internal `fetch`
call to `GET /api/auth/session-status`, a normal Node.js-runtime route that
*can* use `auth.ts` directly. This keeps exactly one implementation of "is
setup needed / is this session valid" in the codebase. The tradeoff: the
session cookie name (`phonolith_session`) still has to be duplicated as a
literal string in `middleware.ts` (to forward the cookie header into that
internal fetch), and the `INTERNAL_SERVICE_TOKEN` fallback string is
similarly duplicated — both are marked with comments pointing back to
`auth.ts` as the canonical definition, so if either ever changes in
`auth.ts`, `middleware.ts` must be updated by hand or the two auth paths
will silently diverge.

**Other things noticed while reading, worth flagging for anyone working in
this area:**
- `PATCH /api/library/sources/[id]` stores an updated `config` via
  `sql.json(body.config)` directly — it does **not** call `encryptConfig()`
  the way `POST /api/library/sources` does on create. If credential rotation
  via PATCH is a real workflow, stored `config` could end up as plaintext
  JSON instead of the encrypted blob `resolveConfig()` expects, until
  overwritten again via a path that does encrypt.
- `known-files`'s header check uses the literal string `'X-Internal-Token'`
  while every other route in this set reads `'x-internal-token'` (lowercase).
  HTTP header lookups in the Fetch API `Headers` object are case-insensitive,
  so this isn't currently a bug, but it's an inconsistency to be aware of if
  ever refactoring header names.
- `src/lib/analyst.ts`'s own `ANALYST_URL` fallback is `http://localhost:8000`
  while every route file's local fallback is `http://analyst:8000` (the
  Docker Compose service name). In practice `ANALYST_URL` is always set by
  docker-compose, so this discrepancy hasn't caused an incident, but a
  future dev running `lib/analyst.ts` helpers outside Docker without the env
  var set would get a different fallback host than a route handler would.
- The `library:indexed` Redis channel (published from `ingest`) had no
  subscriber found anywhere else under `src/` at the time of writing this
  doc — it's presumably intended for a real-time UI feature (e.g. an SSE
  route) that either lives outside this doc's scope or hasn't been wired up
  to a consumer yet.
