# Analyst Service

The **analyst** is a Python FastAPI sidecar that does all the heavy, CPU/IO-bound
library work for Phonolith so the main Next.js app never has to: walking the
filesystem (and SMB network shares) for audio files, reading embedded tags and
cover art, computing content hashes, decoding audio to derive DR (dynamic
range) scores and waveform images, computing AcoustID audio fingerprints, and
checking AccurateRip CRCs. It reports everything it finds back to the main app
over HTTP; it does not talk to the app's database directly and has no
persistent database of its own.

Source: `analyst/main.py`, `analyst/scanner.py`, `analyst/fingerprint.py`,
`analyst/accuraterip.py`, `analyst/watcher.py`, `analyst/tests/test_scanner.py`.

## 1. Overview

- **Docker service name:** `analyst`
- **Port:** `8000` (FastAPI via `uvicorn`, see `analyst/main.py:472`)
- **Framework:** FastAPI, single process, `asyncio` event loop + a
  `ThreadPoolExecutor` for CPU/IO-bound work (`asyncio.to_thread` throughout
  `main.py`).

### How it's reached / how it reaches back

- The main app calls the analyst's HTTP API directly (e.g. to kick off a scan,
  fetch a waveform image, or request a deep scan of one file).
- The analyst calls back into the main app to persist what it finds — it never
  writes to Postgres itself. Two routes are used:
  - `POST {APP_URL}/api/library/ingest` — push one file's record (fast-pass or
    deep-pass) so the app can insert/update the `library_files` row.
  - `GET {APP_URL}/api/library/known-files` — bulk-fetch `(inode, mtime,
    file_size)` triples for already fully-indexed local files, used to skip
    unchanged files on a rescan.
  - `GET {APP_URL}/api/library/pending-analysis` — fetch files that only have
    a fast-pass record (`dr_score IS NULL`) so the deep pass can catch them up.
- All three app-side calls are authenticated with a shared secret header:
  `X-Internal-Token: <INTERNAL_SERVICE_TOKEN>`. There is no browser session
  involved on either side of this call, so this static token is the only
  authentication. The app's `verifyInternalServiceToken()` (in
  `src/lib/auth.ts`) checks it with a timing-safe comparison. The **fallback
  default** value, used if the env var isn't set, is
  `"phonolith-dev-internal-token-not-for-production"` — hardcoded identically
  in both `analyst/scanner.py` and `src/lib/auth.ts`'s
  `getInternalServiceToken()`; the two must always agree since they're really
  one shared secret expressed in two places.

### Filesystem layout

- `LIBRARY_PATH` (default `/music`) — where the local music library is
  mounted read-only-ish inside the container (Docker volume). `os.walk()`
  starts here for local scans.
- `WAVEFORM_PATH` (default `/waveforms`) — a Docker volume shared with the
  main app's container, where rendered waveform PNGs and extracted cover-art
  JPEGs are written, sharded by hash prefix (`<hash[0:2]>/<hash[2:4]>/…`) so a
  single directory never gets too many entries. The main app serves these by
  proxying to the analyst's `/waveforms/{hash}` and `/waveforms/{hash}/cover`
  endpoints (or by reading the shared volume directly, depending on
  deployment).

### CPU priority — deliberately low

`analyst/scanner.py` calls `os.nice(10)` at import time (wrapped in
`try/except (AttributeError, PermissionError): pass` so it's a no-op on
non-Linux or non-root setups):

```python
import os as _os
try:
    _os.nice(10)  # Analyst runs at low priority — never compete with Lucid for CPU
except (AttributeError, PermissionError):
    pass
```

This is intentional and symmetric with the **Lucid** service (`lucid/main.py`),
which does the opposite — `_os.nice(-5)` — to request *elevated* scheduling
priority for real-time audio playback. The two nice values are chosen so that
if the analyst is mid-scan (hashing files, decoding audio with librosa,
rendering waveforms) at the exact moment the user hits play, the OS scheduler
always favors Lucid's real-time audio thread over the analyst's batch work,
avoiding audio glitches/underruns caused by a background scan.

### Other environment variables

See [§6 Environment variables](#6-environment-variables-reference) for the
full list, including `ACOUSTID_API_KEY` (consumed indirectly via the
`pyacoustid`/`acoustid` library's own env lookup, used for fingerprinting) and
`INTERNAL_SERVICE_TOKEN`.

## 2. FastAPI Endpoint Reference

All endpoints are defined in `analyst/main.py`. Request/response bodies use
Pydantic models where noted.

| Method | Path | Request body | Response | Purpose |
|---|---|---|---|---|
| GET | `/health` | — | `{"status": "ok"}` | Liveness check. |
| GET | `/status` | — | `STATUS` dict (see below) | Current scan/watcher state, used by the app to poll scan progress. |
| POST | `/scan` | `ScanRequest {path: str = "/music", deep_analysis: bool = True}` | `{"message": "Scan started"}` | Kick off a fast-pass scan of a local path (default `/music`), then (if `deep_analysis`) chain the deep pass. Runs as a tracked background task; returns immediately. |
| POST | `/ping` | `PingRequest {host: str, port: int = 445}` | `{"reachable": bool, "latency_ms"?: int, "port": int, "error"?: str}` | Raw TCP reachability probe (used by the "Add SMB source" UI to sanity-check a host before full auth). Default port 445 = SMB. |
| POST | `/test-source` | `SourceConfig {type: str, config: dict, name: str = ""}` | `{"ok": bool, "files_found"?: int, "error"?: str}` | Validate a source config without scanning: for `local`/`nfs`/`iscsi`, checks the path exists and counts audio files by extension; for `smb`, does a TCP check on port 445, then `register_smb_session` + `smbclient.scandir` to confirm auth and share access. |
| POST | `/scan-source` | `ScanSourceRequest {source_id: int \| None, type: str, config: dict, name: str = "", deep_analysis: bool = True}` | `{"message": str, "ok": bool}` | Kick off a fast-pass scan against an arbitrary configured source (local or SMB), tagging every ingested row with `source_id`. Returns `{"ok": false}` immediately (no task started) if a scan is already running. Chains the deep pass afterward; for SMB sources the deep pass is scoped to that `source_id` and given the SMB `config` so it can download files. |
| GET | `/file/{hash}` | — | File record dict, or 404 | Look up a file's in-memory record (from the process-local `FILE_DB` cache) by content hash. **Note:** `FILE_DB` is only populated for files indexed since the analyst process last started — it is not a durable store; the source of truth is the app's Postgres `library_files` table. |
| POST | `/fingerprint` | `FingerprintRequest {path: str}` | `{"fingerprint": str}` or 502 | Compute an AcoustID/Chromaprint fingerprint for an arbitrary local path via `fingerprint.get_fingerprint`. |
| POST | `/accuraterip` | `AccurateRipRequest {path: str, duration_ms: int \| None}` | AccurateRip result dict (see §5) | Compute/verify an AccurateRip CRC for a local file via `accuraterip.verify_track`. |
| POST | `/deep-scan` | `DeepScanRequest {path: str, source_type: str = "local", config: dict = {}, source_id: int \| None}` | `{"ok": bool, "message"?: str, "error"?: str}` | Run the full analysis pass (Phase 2) on a single already fast-indexed file. For `source_type == "smb"`, `path` is the file's stored *display* path (e.g. `//host/share/sub/track.flac`) and `config` carries the SMB connection info; the file is downloaded to a temp file first. For local, `path` must already exist on disk. Dispatches to a tracked background task (`_run_deep_scan` / `_run_deep_scan_smb`). |
| POST | `/deep-scan-pending` | — | `{"ok": bool, "message": str}` | Trigger the deep pass over *every* file still missing analysis (`dr_score IS NULL`), i.e. the manual "Analyse Unscanned" action. Refuses (`{"ok": false}`) if a scan is already in progress. Delegates to `_run_pending_deep_scans()`. |
| POST | `/write-tags/{hash}` | `WriteTagsRequest {path, title?, artist?, album?, year?, track_number?, disc_number?, engineer?}` | `{"ok": true}` or 400/404/500 | Rewrite embedded tags on disk for a local file (opt-in metadata edit from the app's UI). Only usable for files under `LIBRARY_PATH` — the path is realpath-resolved and checked with `os.path.commonpath` against the realpath of `LIBRARY_PATH`; a path outside the library root (e.g. an SMB/NFS mount path string that happens to look local) is rejected with 400. Delegates to `scanner.write_tags`. |
| GET | `/waveforms/{hash}` | — | PNG file or 404 | Serve a rendered waveform image. Tries the sharded path first (`<WAVEFORM_PATH>/<hash[0:2]>/<hash[2:4]>/<hash>.png`), then falls back to a legacy flat path (`<WAVEFORM_PATH>/<hash>.png`) for images rendered before sharding was introduced. |
| GET | `/waveforms/{hash}/cover` | — | JPEG file or 404 | Serve extracted cover art, sharded path only: `<WAVEFORM_PATH>/<hash[0:2]>/<hash[2:4]>/<hash>_cover.jpg`. |

`STATUS` shape (module-level dict in `main.py`, mutated in place and returned
by `/status`):

```python
STATUS = {
    "files_indexed": 0,
    "last_scan": None,             # ISO timestamp, set after each fast pass
    "watching": False,             # True if the filesystem watcher started
    "scanning": False,             # True while any scan/deep-scan is running
    "scan_progress": {
        "phase": "idle",           # "idle" | "discovering" | "indexing"
        "total": 0,
        "done": 0,
        "current_file": None,
        "errors": [],
        "source_name": None,
    },
}
```

`scan_progress.phase == "discovering"` with `total == -1` (passed through
`progress_cb`) is the SMB-walk-in-progress signal described in §3 — the UI
should treat `total: 0` there as "count not known yet," not "zero files."

### Background task bookkeeping (`_track`)

Every long-running endpoint (`/scan`, `/scan-source`, `/deep-scan`,
`/deep-scan-pending`) returns to the HTTP caller immediately and does the real
work in an `asyncio.Task` created via a `_track()` helper rather than a bare
`asyncio.create_task()`. This exists because asyncio silently drops any
exception raised in a fire-and-forget task whose result is never awaited, and
can even garbage-collect the task early if nothing keeps a reference to it.
`_track()` keeps the task in a module-level `_background_tasks: set[Task]` and
logs (`log.error(..., exc_info=...)`) any exception once the task finishes,
so scan failures are visible in the logs instead of vanishing silently.

## 3. The Two-Phase Scan Model (core architecture)

This is the single most important design decision in the analyst. It exists to
solve one concrete problem: **a naive single-pass scanner that fully reads
every file before it becomes visible in the library makes a large library —
especially an SMB share on a slow NAS — take "ages" before anything shows up
at all.** The fix is modeled explicitly on Plexamp's "discover fast, analyze
later" behavior: get every track visible and *playable* almost immediately,
then do the expensive audio-analysis work in the background afterward.

### Phase 1 — the "turbo pass" (fast index)

Entry points: `scan_library()` (local sources) and `scan_smb()` /
`_smb_fast_index()` (SMB sources), in `scanner.py`.

The turbo pass never reads a full file. For every candidate audio file
(extension in `AUDIO_EXTENSIONS`) it:

1. Reads only the **first `HEADER_LIMIT` bytes** — `524288` (512 KB),
   defined inline in `_smb_fast_index` — which is enough to cover virtually
   any real-world ID3/Vorbis/MP4 tag block *and* embedded cover art, since
   both live at (or very near) the start of the file for essentially all
   real-world files.
2. Gets the **total file size** via a seek-to-end (`f.seek(0, io.SEEK_END)`),
   which is a metadata operation, not a data read — no extra bytes are
   pulled over the wire for this.
3. Computes a **provisional identity hash**: `blake3(header_bytes +
   b"|" + str(file_size))`. This is *not* a hash of the file's true content —
   it's a fast fingerprint good enough to detect "this looks like the same
   file as before" without reading the whole thing. (Falls back to
   `hashlib.sha256` if the `blake3` package isn't importable — same fallback
   used everywhere hashing happens in this module.)
4. Parses tags from the buffered header (`_read_tags`, via `mutagen`,
   `easy=True`) and extracts embedded cover art from that same buffer
   (`_render_cover_art`), all without ever touching the rest of the file.
5. POSTs the resulting record to the app's `/api/library/ingest` immediately
   (`_post_to_app`) — with `dr_score`, `spectral_ok`, `waveform_path`,
   `fingerprint`, `accuraterip_crc`/`accuraterip_status` all `None`. The row
   exists in the app's DB and the track is browsable and playable right away;
   the "enhanced" columns just haven't been filled in yet.

Why this matters specifically for SMB: reading every file in full over the
network just to hash it means effectively downloading the *entire* remote
library merely to index it — on a real NAS this is the single biggest cost of
a scan (e.g. a ~19,000-track library). Deriving identity from header+size
instead turns an SMB scan from "download everything" into "read a few hundred
KB per file," which is orders of magnitude cheaper and is what makes tracks
appear in the UI within seconds instead of after the entire share has been
pulled down.

#### Local scanning is pipelined too (discovery + indexing run concurrently)

`scan_library()` still uses `os.walk()` to discover files, but does **not**
wait for the walk to finish before indexing starts: it first collects the
full file list (`os.walk` is comparatively cheap for a local disk — no
network round trip per directory), fetches the set of already-known
`(inode, mtime, size)` identities in one bulk call
(`_fetch_known_identities()`, hitting `/api/library/known-files`) so unchanged
files can be skipped outright, then dispatches every remaining file to a
**`ThreadPoolExecutor`** (`workers = min(4, os.cpu_count() or 1)`) via
`pool.submit(process_one, p)` for every path, and drains results with
`as_completed(futures)` — a classic producer/consumer pool where all files are
in flight together and results stream back in completion order rather than
walk order. `process_one()` does the fast-path stat-based skip check, then
calls `_fast_index_local()`. Progress callbacks fire per completed file, not
per discovered file, since discovery here is not the bottleneck.

#### SMB scanning pipelines discovery *and* indexing (true producer/consumer)

`scan_smb()` goes further, because for SMB the discovery walk itself
(`smbclient.walk()`) is network-bound and can be slow, so waiting for it to
finish before indexing anything would reintroduce the "blank UI" problem. It
instead:

1. Opens one `ThreadPoolExecutor(max_workers=4)`.
2. Iterates `smbclient.walk(smb_root)` (`os.walk`-equivalent over SMB) and,
   for every matching audio file **as soon as it's discovered**, immediately
   calls `pool.submit(process_one, ...)` and appends the future to a list —
   it does not wait for the walk to finish before submitting work.
3. Calls `progress_cb(-1, discovered, fname, None)` after each dispatch —
   the sentinel `total=-1` tells `main.py`'s `make_progress_cb` to report
   `phase: "discovering"` with `total: 0` (count not yet known) while
   `done` still climbs, so the UI can show "N files found so far..." during
   the walk.
4. Only *after* the walk generator is exhausted does it know the final
   count (`total = len(futures)`), switch `progress_cb` reporting to
   `phase: "indexing"`, and drain the futures with `as_completed(futures)`,
   updating `done`/`indexed` as each finishes.

This means indexing genuinely overlaps discovery — file #1 can be fully
indexed and already posted to the app while the walk is still three
directories away from finishing. `analyst/tests/test_scanner.py`'s
`TestScanSmbPipelining.test_indexes_during_walk` proves this deterministically
(see §7).

### Phase 2 — the "enhanced pass" (deep scan)

Entry points: `index_file()` (local files, and — via a downloaded temp file —
SMB files too), `deep_scan_smb()` / `deep_scan_smb_file()` (SMB-specific
wrappers around `index_file`).

The deep pass is where all the expensive, "must read the whole file" work
happens:

- **True full-content BLAKE3 hash** (`_hash_file`, reads the entire file in
  64 KB chunks) — replacing the turbo pass's provisional header+size hash
  with the real thing.
- **Full tag re-read** (`_read_tags`) directly against the full file.
- **Audio decode** via `librosa.load(path, sr=None, mono=True,
  duration=120.0)` (`_load_audio`) — decoded once and the result (`y, sr`)
  is shared across everything downstream so the same audio isn't decoded
  three times:
  - **DR score** (`_compute_dr`): `20 * log10(peak / rms)` over the decoded
    samples.
  - **Spectral / upscale check** (`_detect_upscale`): compares FFT energy
    above 18 kHz against energy in the 1–18 kHz band to flag likely
    upsampled/fake-hi-res files.
  - **Waveform PNG** (`_render_waveform`): a 1200×200 peak-envelope image,
    written to the sharded `WAVEFORM_PATH` location.
- **Cover art** (`_render_cover_art`) — re-extracted here too (in case the
  turbo pass's header buffer didn't happen to catch it).
- **AcoustID/Chromaprint fingerprint** via `acoustid.fingerprint_file(path)`.
- **AccurateRip CRC verification** (`accuraterip.verify_track`) — only for
  `flac`/`wav`/`aiff` formats, since it needs uncompressed PCM access.

For **SMB**, none of this can run against the file in place — `librosa`
needs a complete, seekable, local decoded audio stream, not a network
handle — so `deep_scan_smb()` first downloads the entire file to a local
temp file (`tempfile.mkstemp`, streamed in 1 MB chunks via
`smbclient.open_file`), then calls `index_file()` against that temp path, and
always removes the temp file afterward (`finally: os.remove(tmp_path)`), even
on failure.

The deep pass then POSTs its record to `/api/library/ingest` exactly like the
fast pass — same endpoint, richer payload, plus one field the fast pass never
sends: **`previous_hash`**.

#### Why `previous_hash` exists: reconciling two different hashes for the same file

The turbo pass keyed the row by a *provisional* hash (header+size). The deep
pass computes the *true* full-content hash, which will almost always differ
from the provisional one (different bytes go into each). Without telling the
app about this, the deep pass's ingest would look like a brand-new,
never-seen file and create a **second row** for the same physical track,
rather than upgrading the first row in place.

So `index_file()` always computes the true hash, and if it differs from the
`previous_hash` argument it was given, includes it in the outgoing record as
`"previous_hash": <provisional hash>` (`None` if they match or no previous
hash was supplied):

```python
"previous_hash": previous_hash if previous_hash and previous_hash != h else None,
```

This lets the app's `/api/library/ingest` route (documented separately,
alongside the rest of the Next.js API surface) re-key the existing row from
the provisional hash to the true one — or, if the true hash already matches
some *other* existing row (a genuine duplicate), detect and drop it — instead
of blindly trusting whatever hash shows up and letting duplicates pile up.
The analyst's job here is only to *report* both identities faithfully; the
decision of "re-key vs. dedupe vs. insert" is deliberately left to the app,
which owns the single source of truth (Postgres) and can see the rest of the
library to make that call correctly. The analyst never overwrites blindly.

### Function signatures for Phase 2 entry points (exact, current)

```python
def index_file(
    path: str,
    waveform_path: str,
    display_path: str | None = None,
    source_id: int | None = None,
    source_root: str | None = None,
    relative_path_override: str | None = None,
    use_path_stat: bool = True,
    previous_hash: str | None = None,
) -> dict | None
```
- `path`: the file to actually read/decode (for SMB, a local temp file).
- `display_path`: the path to report to the app as `file_path` (e.g. the
  original SMB display path), when it differs from `path`.
- `source_root` / `relative_path_override`: two ways to derive the
  library-relative path — `source_root` when `path` is a real path under a
  known root, `relative_path_override` when `path` is a temp file that
  doesn't reflect the original layout (SMB) so the true relative path must be
  passed in directly.
- `use_path_stat`: when `False`, skips `os.stat(path)` for
  inode/size/mtime — required for SMB temp files, since stat-ing the temp
  file would report the temp file's inode/size/mtime, not the real remote
  file's, corrupting the fast-path identity check used by future scans.
- `previous_hash`: the turbo pass's provisional hash, forwarded so the
  ingest can re-key as described above.

```python
def deep_scan_smb(
    smb_path: str,
    display: str,
    waveform_path: str,
    config: dict,
    source_id: int | None = None,
    smb_root: str | None = None,
    previous_hash: str | None = None,
) -> dict | None
```
Downloads `smb_path` (SMB UNC form, e.g. `\\host\share\sub\track.flac`) to a
temp file, computes `relative_path` from `smb_root`, then calls `index_file`
with `use_path_stat=False` and `relative_path_override=relative_path`.

```python
def deep_scan_smb_file(
    display_path: str,
    config: dict,
    waveform_path: str,
    source_id: int | None = None,
    previous_hash: str | None = None,
) -> dict | None
```
The entry point used by `main.py` — takes the *display* path form (e.g.
`//host/share/sub/track.flac`, forward slashes) as stored in the app's DB,
rebuilds the UNC path/`smb_root` the same way `scan_smb()` does from
`config` (`host`, `share`, `subfolder`), and delegates to `deep_scan_smb`.

### `_run_pending_deep_scans` (in `main.py`) — dispatch by path shape

```python
async def _run_pending_deep_scans(
    manage_status: bool = True,
    source_id: int | None = None,
    smb_config: dict | None = None,
)
```

This is what actually drives the deep pass over a batch of files. It:

1. `GET`s `{APP_URL}/api/library/pending-analysis`, optionally with
   `?source_id={source_id}` appended.
   - **Without `source_id`** (the default — used for the manual local
     "Analyse Unscanned" action and for the automatic chain after a plain
     `/scan`), the app-side route excludes SMB paths at the SQL level
     entirely (`file_path NOT LIKE '\\\\%'` and `NOT LIKE '//%'`), because a
     network path can't be deep-scanned without that source's connection
     config (host/share/credentials) — which this call doesn't have.
   - **With `source_id`** (used when chaining after `/scan-source` for an
     SMB source), the app scopes the query to that source and *does*
     include its SMB paths, since the caller in this case (`scan-source`'s
     handler) has that source's `config` in hand and passes it through as
     `smb_config`.
2. For each pending file (`{blake3_hash, file_path}`), inspects
   `file_path` and branches purely on its string shape:
   - Starts with `"//"` or `"\\\\"` → **network path** → if `smb_config` was
     provided, calls `deep_scan_smb_file(path, smb_config, WAVEFORM_PATH,
     source_id, f.get("blake3_hash"))` — note the pending item's
     `blake3_hash` (the provisional turbo-pass hash already stored in the DB)
     is threaded through as `previous_hash` here.
   - Otherwise, and if `os.path.isfile(path)` → **local path** → calls
     `index_file(path, WAVEFORM_PATH)` (no `previous_hash` passed for local
     files — a local file's provisional and true hash are the same value
     from the very first pass, since `_fast_index_local` already computes the
     real full-file hash for local files; see the Gotchas section below for
     why this distinction matters).
3. `manage_status` controls whether this function owns `STATUS["scanning"]`:
   `True` when hit directly via `/deep-scan-pending`, `False` when it's being
   chained immediately after a fast pass whose caller (`run_scan` /
   `_run_source_scan`) already set `STATUS["scanning"] = True` — this avoids
   the UI flickering to "idle" between the fast and deep passes of what the
   user perceives as one continuous scan.

## 4. SMB Support Deep-Dive

SMB access goes through **`smbprotocol`**'s high-level `smbclient` module (a
pure-Python SMB2/3 client — no kernel CIFS mount, no Samba/`libsmbclient`
binding required), imported lazily inside the functions that need it so the
rest of the module has no hard dependency on it.

### Config dict shape

Every SMB source config (`SourceConfig.config` / `ScanSourceRequest.config` /
`DeepScanRequest.config`) is a plain dict with these keys, all read with
`.get(...)` so any of them may be absent:

| Key | Meaning |
|---|---|
| `host` | SMB server hostname/IP. |
| `share` | Share name (e.g. `Music`). |
| `username` | SMB username, or `None`. |
| `password` | SMB password, or `None`. |
| `domain` | Windows domain, prefixed onto the username as `DOMAIN\user` if present. |
| `subfolder` | Optional path under the share to scan, stripped of leading/trailing slashes. |

### `register_smb_session()` — the NTLM auth fallback

```python
def register_smb_session(config: dict) -> str
```

**The bug this fixes:** SMB credentials that work perfectly fine against the
same NAS/Samba server from macOS Finder, Windows Explorer, a Linux kernel CIFS
mount, or `libsmbclient`-based clients like Plex or Roon, were being rejected
by this pure-Python client with `STATUS_LOGON_FAILURE` — even though the
credentials were correct. The root cause: `smbprotocol`'s
`smbclient.register_session()` defaults to SPNEGO-negotiated auth
(`auth_protocol='negotiate'`), while those other clients authenticate with
raw NTLM directly. Some NAS/Samba server configurations mishandle the SPNEGO
path, or enforce Extended Protection for Authentication on it in a way that
rejects otherwise-valid credentials.

**The fix:** try authentication protocols in order — `"negotiate"` (the
correct choice for AD/Kerberos-joined environments — tried first so nothing
regresses for setups that need it), then `"ntlm"` (raw NTLM, matching what
the kernel/`libsmbclient` clients do), then `"kerberos"` — logging which one
actually succeeded (`log.info(...)`) so a working-but-non-default protocol
choice is visible in the logs rather than silently masked:

```python
for proto in ("negotiate", "ntlm", "kerberos"):
    try:
        try:
            smbclient.register_session(host, username=user, password=password, auth_protocol=proto)
        except TypeError:
            # Ancient smbprotocol without the auth_protocol kwarg — only the
            # default negotiate path exists; nothing else to try.
            if proto != "negotiate":
                raise
            smbclient.register_session(host, username=user, password=password)
        if proto != "negotiate":
            log.info("SMB auth for %s succeeded via auth_protocol=%s (negotiate was rejected)", host, proto)
        return proto
    except Exception as exc:
        errors.append(f"{proto}: {exc}")
        try:
            smbclient.delete_session(host)
        except Exception:
            pass
raise RuntimeError(f"SMB authentication to {host} failed for every method (negotiate, ntlm, kerberos): {'; '.join(errors)}")
```

Two details worth calling out:

- The `TypeError` guard exists for older `smbprotocol` builds whose
  `register_session()` doesn't accept an `auth_protocol` kwarg at all — in
  that case there's only ever the one (default/negotiate) code path to try,
  and the loop re-raises immediately rather than pretending `ntlm`/`kerberos`
  are options.
- Between attempts, `smbclient.delete_session(host)` is called (itself
  wrapped in a swallow-everything `try/except`) to drop any half-open
  connection state before the next protocol is tried, so a failed
  `negotiate` attempt can't leave stale session state that corrupts the
  `ntlm` retry.

This function is called from three places: `deep_scan_smb()` (before
downloading a file), `scan_smb()` (before walking the share), and
`_test_source_sync()` in `main.py` (the `/test-source` endpoint's SMB
validation path).

### Where `smbclient` calls happen

- `smbclient.scandir(smb_path)` — used only by `/test-source` to confirm the
  share is listable.
- `smbclient.walk(smb_root)` — the SMB-side `os.walk()` equivalent, used by
  `scan_smb()` for discovery.
- `smbclient.open_file(smb_path, mode="rb")` — used by `_smb_fast_index()`
  (read just the header + seek-to-end for size) and `deep_scan_smb()` (stream
  the entire file to a temp file in 1 MB chunks).

## 5. `scanner.py` — Function-by-Function Reference

Module-level state:

- `AUDIO_EXTENSIONS = {'.flac', '.mp3', '.aac', '.m4a', '.ogg', '.wav', '.aiff', '.wv', '.ape', '.opus'}`
  — the set of file extensions (lower-cased) treated as audio. Shared
  (duplicated, not imported) with the same constant in `watcher.py`.
- `FILE_DB: dict[str, dict] = {}` — an in-process, non-persistent cache of
  every file record produced by this process, keyed by content hash. Backs the
  `GET /file/{hash}` endpoint only; it is **not** the source of truth (the
  app's Postgres `library_files` table is) and is empty again after any
  restart of the analyst process.
- `ProgressCb = Callable[[int, int, str | None, str | None], None] | None`
  — the callback signature used throughout scanning: `(total, done,
  current_file, error)`. `total == -1` is the sentinel meaning "still
  discovering, count unknown" (see §3).
- `APP_URL` (env, default `http://app:3000`) and `INTERNAL_SERVICE_TOKEN` (env,
  falls back to the shared dev default) are read at import time here and
  re-exported for `main.py` to import.
- `os.nice(10)` is applied at import time (see §1).

Functions, in the order they appear in the file:

- **`register_smb_session(config: dict) -> str`** — see §4.
- **`_hash_file(path: str) -> str`** — full-file BLAKE3 (or SHA-256 fallback)
  hash, streamed in 64 KB chunks from an open file handle. Used by the deep
  pass (`index_file`) and by local fast-pass identity (`_fast_index_local`,
  which — despite being the "fast" path — reads and hashes the *entire* local
  file, since local disk reads are cheap; only the SMB fast path skips full
  reads).
- **`_hash_fileobj(fileobj) -> str`** — same hashing logic but against an
  already-open file-like object rather than a path (chunked 64 KB reads).
  Present for symmetry/reuse; not directly called elsewhere in this file at
  present but shares the hash-fallback logic with `_hash_file`.
- **`_parse_disc_number(raw: str | None) -> int | None`** — parses tag values
  like `"1"` or `"1/2"` into an integer disc number, returning `None` on any
  parse failure or empty input. Never raises.
- **`_parse_track_number(raw: str | None) -> int | None`** — same logic for
  track numbers (`"3"`, `"3/12"` → `3`); feeds `library_files.track_number`.
  Covered extensively by unit tests (§7) since this is exactly the class of
  logic where a real ingest bug (malformed/missing track numbers) previously
  lived.
- **`_read_engineer_tag(fileobj_or_path) -> str | None`** — reads the
  `ENGINEER` credit, which has no easy/portable mutagen accessor and needs
  format-specific frame/key access: ID3 `TXXX:ENGINEER` user-text frame (or
  `TIPL`/`TMCL` involved-people-list frames, matched by role name
  `"engineer"`), FLAC/Vorbis plain `engineer` field, or MP4/AAC freeform
  `----:com.apple.iTunes:ENGINEER` atom. Returns `None` on any failure or if
  not found — never raises.
- **`_read_tags(fileobj_or_path) -> dict`** — the main tag-reading entry
  point, via `mutagen.File(..., easy=True)`. Returns a dict with keys
  `title`, `artist`, `album`, `year` (first 4 chars of the `date` tag),
  `track` (raw, unparsed — parsing happens later via
  `_parse_track_number`), `disc_number` (parsed, preferring Vorbis
  `discnumber` then easy-tag `disk`), `engineer` (via
  `_read_engineer_tag`), `bitrate`, `sample_rate`, `length` (seconds), all
  pulled from `audio.info`/`audio.get(...)`. Returns `{}` on any exception —
  never raises.
- **`write_tags(path: str, fields: dict) -> None`** — writes fields back to
  embedded tags, format-specific: `.mp3` via `mutagen.easyid3.EasyID3` (plus a
  raw `ID3`/`TXXX` write for the `engineer` field, which isn't an easy-tag
  key), `.flac` via `mutagen.flac.FLAC`, `.m4a`/`.aac` via `mutagen.mp4.MP4`
  (engineer via the freeform atom), `.ogg`/`.opus` via `OggVorbis`/`OggOpus`.
  Any other mutagen-supported format falls back to a generic easy-tag write
  (with `ValueError` if mutagen can't open it at all). Raises on failure —
  callers (the `/write-tags/{hash}` endpoint) are expected to catch and
  report the error rather than let the process crash.
- **`_apply_easy_fields` / `_apply_vorbis_fields` (dict, dict) -> None** —
  near-identical helpers that copy `title`/`artist`/`album`/`year` (→ `date`)
  /`track_number` (→ `tracknumber`)/`disc_number` (→ `discnumber`) from the
  `fields` dict onto an easy-tag-style mutagen object, skipping any field
  that's `None` (only fields explicitly provided are overwritten).
- **`_apply_mp4_fields(audio, fields: dict) -> None`** — same idea for MP4
  atoms (`\xa9nam`, `\xa9ART`, `\xa9alb`, `\xa9day`), plus special handling
  for `trkn`/`disk` atoms which MP4 stores as `(number, total)` tuples — the
  existing `total` is preserved when only the number is being updated.
- **`_detect_bit_depth(path: str) -> int | None`** — FLAC-only, reads
  `FLAC(path).info.bits_per_sample`; returns `None` for any other format or
  on error.
- **`_load_audio(path: str, duration: float = 120.0)`** — decodes up to the
  first 120 seconds of audio via `librosa.load(path, sr=None, mono=True,
  duration=duration)`, returning `(y, sr)` (numpy sample array, sample rate)
  or `(None, None)` on failure. Decoded once per deep-scan and the result is
  shared across DR, upscale detection, and waveform rendering so the same
  audio isn't decoded three separate times.
- **`_compute_dr(y, sr) -> float | None`** — dynamic range as
  `20 * log10(peak / rms)` over the decoded samples; `None` if the array is
  empty or effectively silent (`rms < 1e-10`).
- **`_detect_upscale(y, sr) -> bool | None`** — FFT-based heuristic: compares
  mean squared magnitude above 18 kHz to the 1–18 kHz band; a ratio above
  `1e-6` is treated as evidence of real high-frequency content (i.e. probably
  not a fake upsampled file). Returns `None` if there isn't enough spectral
  data to judge.
- **`_render_waveform(y, file_hash: str, waveform_path: str) -> str | None`**
  — draws a 1200×200 peak-envelope PNG (dark background `#08080a`, purple
  waveform `#a78bfa`) to the sharded path
  `<waveform_path>/<hash[0:2]>/<hash[2:4]>/<hash>.png`; skips rendering (and
  just returns the existing path) if the file already exists, so a rescan
  doesn't redo finished work.
- **`_render_cover_art(path_or_fileobj, file_hash, waveform_path) -> str | None`**
  — extracts embedded cover art from either a local path or an in-memory
  `BytesIO` header buffer (seeking to 0 first if it's a file-like object),
  handling three tag conventions: ID3 `APIC` frames, FLAC/Vorbis
  `pictures`/`METADATA_BLOCK_PICTURE`, and MP4 `covr` atoms — then re-encodes
  whatever image data it finds as a JPEG (quality 85) at
  `<waveform_path>/<hash[0:2]>/<hash[2:4]>/<hash>_cover.jpg`. Skips work if
  the output already exists.
- **`_fast_index_local(path, waveform_path, source_id=None, source_root=None) -> dict | None`**
  — Phase 1 for **local** files: full-file hash (yes, the entire local file
  is hashed here — cheap on local disk, unlike the SMB header+size shortcut),
  tags, cover art, `os.stat` for inode/size/mtime, no `librosa`/DR/waveform.
  Builds the record dict, stores it in `FILE_DB`, POSTs it via
  `_post_to_app`, returns the record (or `None` on any exception).
- **`_post_to_app(data: dict) -> bool`** — `httpx.post` to
  `{APP_URL}/api/library/ingest` with the `X-Internal-Token` header, 10s
  timeout. Returns `True` only on a 2xx response; any 4xx/5xx or transport
  exception is printed (`[analyst] ingest failed (...)` / `[analyst] ingest
  POST error ...`) and returns `False` — deliberately never silently
  swallowed, since a file that fails to ingest is invisible in the library.
- **`_fetch_known_identities() -> frozenset`** — one bulk `httpx.get` to
  `{APP_URL}/api/library/known-files`, returning a `frozenset` of
  `(inode, mtime, file_size)` int triples for every fully-indexed local file,
  used by `scan_library`'s fast-path skip check. Returns an empty `frozenset`
  on any error (fails open — an unreachable app just means nothing gets
  skipped, not that the scan aborts).
- **`ensure_root_marker(source_root: str, marker_uuid: str) -> bool`** —
  writes a `.phonolith_id` file containing `marker_uuid` at the source root
  if one doesn't already exist. Returns whether the root is writable/marker
  is present. Used so a later online/offline check (`check_root_marker`) can
  tell "this share is just empty" from "this share went offline / got
  reattached to a different mount," which matters for `watcher.py` deciding
  whether to trust a filesystem event.
- **`check_root_marker(source_root, expected_uuid) -> bool`** — returns
  whether the source root is currently accessible and, if `expected_uuid` is
  given, whether the marker file's contents match it.
- **`index_file(...)`** — Phase 2 for local files (and, via a temp file, SMB
  files). Full signature and behavior documented in §3.
- **`_smb_fast_index(smb_path, display, waveform_path="", source_id=None, smb_root=None) -> dict | None`**
  — Phase 1 for **SMB** files. Documented in full in §3.
- **`scan_library(library_path, waveform_path, progress_cb=None, source_id=None, marker_uuid=None) -> int`**
  — top-level local Phase-1 driver. Documented in §3. Returns the count of
  files successfully indexed (skipped/unchanged files still count toward
  `indexed` since `process_one` returns `True` for them).
- **`deep_scan_smb(smb_path, display, waveform_path, config, source_id=None, smb_root=None, previous_hash=None) -> dict | None`**
  — documented in §3.
- **`scan_smb(config, waveform_path, progress_cb=None, source_id=None) -> int`**
  — top-level SMB Phase-1 driver. Documented in §3. Returns 0 immediately (no
  futures drained) if the walk turned up zero matching files.
- **`deep_scan_smb_file(display_path, config, waveform_path, source_id=None, previous_hash=None) -> dict | None`**
  — documented in §3; the entry point `main.py` actually calls.
- **`scan_source_config(src_type, config, waveform_path, progress_cb=None, source_id=None) -> int`**
  — dispatch shim used by `/scan-source`: routes `"local"`/`"nfs"`/`"iscsi"`
  to `scan_library` (after checking `config["path"]` exists), `"smb"` to
  `scan_smb`, and prints + returns `0` for anything else.
- **`get_file_record(hash: str) -> dict | None`** — `FILE_DB.get(hash)`,
  backing `GET /file/{hash}`.

### `fingerprint.py`

- **`get_fingerprint(path: str) -> str | None`** — thin wrapper around
  `acoustid.fingerprint_file(path)` (Chromaprint via `pyacoustid`), decoding
  bytes to `str` if needed. Returns `None` on any exception. Backs
  `POST /fingerprint`; the deep pass in `scanner.index_file` calls
  `acoustid.fingerprint_file` directly rather than importing this helper (a
  small duplication between the two).

### `accuraterip.py`

- **`compute_accuraterip_crc(path: str) -> str | None`** — reads the file as
  32-bit PCM via `soundfile`, averages stereo channels to mono, computes the
  AccurateRip CRCv1 (`sum(sample[i] * (i+1))` as an unsigned 32-bit
  accumulator), returns it as an 8-hex-digit string. `None` on error.
- **`lookup_single_track(path, crc_hex, duration_ms) -> dict`** — builds an
  AccurateRip disc-ID (assuming a **single-track disc** — frame count from
  `duration_ms` at 75 frames/sec CD rate, `disc_id1`/`disc_id2`/`cddb_id`
  derived from that), fetches
  `http://www.accuraterip.com/accuraterip/{c1}/{c2}/{c3}/dBAR-001-*.bin`, and
  parses the binary response (13-byte header per pressing: track count + two
  disc IDs + cddb ID; then 9 bytes per track: 1 confidence byte + CRCv1 +
  CRCv2) looking for a track-1 CRC match. Returns
  `{'status': 'verified'|'mismatch'|'not_found'|'error', 'crc': ..., ...}`.
- **`verify_track(path, duration_ms=None) -> dict`** — the entry point used
  by `POST /accuraterip` and by `index_file`'s deep pass. Computes the CRC;
  if `duration_ms` is given (or derivable via `soundfile.info(path)`), also
  attempts the single-track AccurateRip lookup; otherwise returns
  `{'status': 'no_disc_context', 'crc': ..., 'note': '...'}` — CRC computed,
  but full verification needs disc/CUE context this function doesn't have.

### `watcher.py`

Wraps the `watchdog` library to auto-rescan the local library on filesystem
changes.

- `AUDIO_EXTENSIONS` — duplicated from `scanner.py` (not imported), same
  extension set.
- `_source_roots: dict[str, str | None]` — module-level map of watched
  library path → expected root marker UUID (or `None`), set via
  `set_source_info()`.
- **`set_source_info(library_path, marker_uuid) -> None`** — registers the
  expected marker for a watched path.
- **`AudioFileHandler(FileSystemEventHandler)`** — on `on_created`/`on_modified`
  for any path with an audio extension, adds it to a pending set and
  (re)schedules a 2-second debounce `threading.Timer`. When the timer fires
  (`_flush`), it checks `check_root_marker(library_path, marker_uuid)` first
  — if the source root looks offline/gone (e.g. an SMB mount got
  disconnected and the OS is now showing a stale/empty directory), it skips
  the rescan and logs `"source {path} appears offline, skipping rescan"`
  rather than triggering a scan against a phantom empty mount. Otherwise
  calls the registered `callback()`.
- **`start_watcher(library_path, on_file_changed=None, marker_uuid=None)`** —
  idempotent (no-ops if already running); starts a `watchdog.Observer`
  recursively on `library_path`.
- **`stop_watcher()`** — stops and joins the observer.

In `main.py`, the watcher's callback is `schedule_scan()`, which uses
`asyncio.run_coroutine_threadsafe(run_scan(...), _main_loop)` rather than
`asyncio.create_task()` — necessary because the callback fires from the
`watchdog` observer's debounce `Timer` thread, not the asyncio event loop
thread, and `create_task()` requires a running loop *in the calling thread*
(it would silently fail here, with the exception only printed to stderr by
`threading.Timer` — live filesystem changes would otherwise never trigger a
rescan at all).

## 6. Environment Variables Reference

| Variable | Default | Read in | Purpose |
|---|---|---|---|
| `APP_URL` | `http://app:3000` | `scanner.py` | Base URL of the main Next.js app, for all call-back POSTs/GETs (`/api/library/ingest`, `/known-files`, `/pending-analysis`). |
| `INTERNAL_SERVICE_TOKEN` | `"phonolith-dev-internal-token-not-for-production"` | `scanner.py` | Shared secret sent as `X-Internal-Token` on every call to the app. Must match the app's own `INTERNAL_SERVICE_TOKEN` (`src/lib/auth.ts`'s `getInternalServiceToken()`, same default fallback). |
| `LIBRARY_PATH` | `/music` | `main.py` | Local library mount point; root for `os.walk` in local scans and the watcher, and the root local writes (`/write-tags`) are checked against. |
| `WAVEFORM_PATH` | `/waveforms` | `main.py` | Shared volume where waveform PNGs and cover-art JPEGs are written and served from (`GET /waveforms/{hash}`, `GET /waveforms/{hash}/cover`). Created on startup (`os.makedirs(..., exist_ok=True)`). |
| `ACOUSTID_API_KEY` | — | not read directly by this codebase | Consumed by the `pyacoustid`/`acoustid` library's own environment lookup (used internally by `acoustid.fingerprint_file`, and implicitly by any AcoustID *lookup* — as opposed to local fingerprint *computation* — calls it makes); needed for full AcoustID metadata matching against the AcoustID web service. |

Both `LIBRARY_PATH` and `WAVEFORM_PATH` are additionally set as `ENV` defaults
in the `Dockerfile` and declared as `VOLUME /music` / `VOLUME /waveforms`.

## 7. Testing

`analyst/tests/test_scanner.py` is the only test file. It targets
`scanner.py`'s pure helpers and its concurrency/pipelining guarantees — it
does not spin up the FastAPI app or hit real network/filesystem/librosa
paths, so it has no dependency on `mutagen`/`httpx`/`librosa` actually doing
real work (those are imported lazily inside `scanner.py`'s functions, so
importing `scanner` itself is cheap).

- **`TestParseTrackNumber`** / **`TestParseDiscNumber`** — table of cases for
  `_parse_track_number`/`_parse_disc_number`: plain integers, `"N/total"`
  notation, whitespace, `None`, empty string, and garbage input, asserting
  every malformed case returns `None` rather than raising. The docstring at
  the top of the file explicitly notes this is "the exact class of logic
  where the track_number ingest bug lived" — i.e. these tests exist because
  of a real past bug, not proactively.
- **`TestScanLibraryUsesFastPath.test_scan_library_calls_fast_indexer_not_full`**
  — builds a small nested `Artist/Album/*.flac` tree (plus one non-audio
  `.jpg`), monkeypatches `_fast_index_local` and `index_file` to just count
  calls, and asserts `scan_library()` routes both audio files through
  `_fast_index_local` (`fast == 2`) and **never** through the heavy
  `index_file` path (`full == 0`), with the non-audio file ignored entirely
  (`indexed == 2`). This locks in the Phase 1/Phase 2 separation so a future
  refactor can't accidentally send local scans back down the slow path.
- **`TestScanSmbPipelining.test_indexes_during_walk`** — the key concurrency
  proof for §3's SMB pipelining claim. It injects a **fake `smbclient` module
  directly into `sys.modules`** (via `monkeypatch.setitem(sys.modules,
  "smbclient", fake_smbclient)`) whose `walk()` is a generator that yields a
  first file (`a.flac`), then **blocks** (`first_indexed.wait(timeout=5)` on a
  `threading.Event`) before yielding a second file (`b.flac`). It patches
  `scanner._smb_fast_index` to set that same `Event` the moment it's called.
  It then runs `scanner.scan_smb(...)` for real (using the real
  `ThreadPoolExecutor`/`as_completed` code path, only `smbclient` and
  `_smb_fast_index` are faked) and asserts:
  - `indexed == 2` — both files were eventually indexed.
  - `walk_saw_index_during == [True]` — the walk observed the *first* file
    already indexed **before** it yielded the *second* file. Under the old
    (hypothetical) "walk fully first, then index" design this would be
    `False` (nothing indexed until the walk finishes); under the real
    pipelined design, indexing of file #1 races ahead concurrently with the
    walk producing file #2, so it's `True`. This is a deterministic,
    non-flaky proof of the producer/consumer overlap (no sleeps/timing
    guesses — an `Event.wait` with a generous 5s timeout).

Run via `pytest analyst/tests/` (or `pytest` from `analyst/`, given the
`sys.path.insert` shim at the top of the test file that adds the parent
directory so `import scanner` resolves without a package install).

## 8. Known Gotchas / History

**(a) The turbo-pass full-file-hash bug (large SMB scans "took ages").**
Before the header+size provisional hash existed, SMB indexing necessarily
read/hashed the entire remote file just to compute an identity — meaning a
"fast" pass over a large NAS share was, bandwidth-wise, indistinguishable
from downloading the whole library. The fix, described in full in §3, derives
identity from the first 512 KB (`HEADER_LIMIT`) plus a metadata-only
seek-to-end for size, cutting the fast pass's network cost by orders of
magnitude and making tracks appear in the UI within seconds rather than after
the whole share has been pulled down. This is why `_smb_fast_index` and
`scan_library`/`_fast_index_local` are asymmetric: local disk reads are cheap
enough that hashing the whole file locally is fine, while the same approach
over SMB was the actual bottleneck.

**(b) `pending-analysis` originally excluded SMB paths at the SQL level with
no way back in.** The app's `/api/library/pending-analysis` route filters out
any `file_path` matching `\\\\%` or `//%` (SMB/network path prefixes) by
default, because the deep pass needs a source's connection config
(host/share/credentials) to download and analyze a network file — a plain
path string alone isn't enough, unlike a local path. With no way to opt back
in, this meant SMB files' `dr_score` stayed `NULL` forever: the "deep pass"
step silently never ran for any SMB-sourced track, even when the app or user
explicitly asked for deep analysis. The fix is the `source_id` (+ `smb_config`)
scoping threaded through `_run_pending_deep_scans()` (§3): when the analyst is
chaining a deep pass right after scanning a *specific* SMB source, it already
has that source's connection config in hand, so it passes `source_id` on the
`pending-analysis` request, and the app's route switches to a query scoped to
that source that *does* include SMB paths — while the default, config-less
call path (manual "Analyse Unscanned", or the deep pass chained after a plain
local `/scan`) still excludes them, since there's genuinely no way to deep-scan
a network path without a config.

**(c) The SMB NTLM auth fallback (`register_smb_session`).** Documented fully
in §4 — `smbprotocol`'s default SPNEGO `auth_protocol='negotiate'` was
rejected (`STATUS_LOGON_FAILURE`) by some NAS/Samba servers that other
clients (kernel CIFS, `libsmbclient`-based Plex/Roon) reach fine via raw
NTLM. Fixed by trying `negotiate` → `ntlm` → `kerberos` in order and logging
which one actually worked.

**(d) Content-hash reconciliation is deliberately not "just always
overwrite."** The analyst never assumes its own hash is authoritative over
what the app already has stored — it only ever *reports* both the true
content hash and (when it changed) the prior provisional hash via
`previous_hash`, and lets the app's `/api/library/ingest` route (owning the
actual Postgres state, and able to see the whole library at once) decide
whether that means "update this row's key" or "this is actually a duplicate
of some other already-fully-hashed row, drop it." Doing this reconciliation
analyst-side would require the analyst to also have visibility into the rest
of the library's hashes — which it deliberately doesn't; it's a stateless
sidecar by design (`FILE_DB` is only ever a same-process cache, never
consulted for this decision). Sending `previous_hash` at all, rather than
just posting the new hash and letting two rows silently coexist, is what
makes the two-phase model safe to run against the same file twice without
duplicating it in the library.
