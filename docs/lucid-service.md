# Lucid — Audio Transport / Playback Daemon

Source: `lucid/` (Python, FastAPI). Docker service name `lucid`, port `8001`.

This document is a complete developer reference for the Lucid service, written to be understandable with zero prior context and without needing to open the source. It reflects the code as of the current `lucid/` tree (`main.py`, `flux.py`, `player.py`, `queue_manager.py`, `signal_path.py`, `polyphony_discovery.py`, `requirements.txt`, `Dockerfile`).

---

## 1. Overview

Lucid is Phonolith's **audio transport/playback daemon** — the sidecar responsible for actually moving audio bytes and driving playback state, as opposed to the Next.js app (which owns the library database, UI, and business logic) or the "analyst" scanner (which owns filesystem/library scanning, tagging, and metadata enrichment, including its own SMB access for scanning network shares).

Concretely, Lucid handles:

- **Browser streaming** of library tracks — passthrough (byte-exact, Range-seekable) or on-the-fly Opus transcode for bandwidth-constrained playback.
- **Optional ALSA exclusive-mode local audio output** — for driving a physical DAC/soundcard attached to the host, bypassing the OS mixer for bit-perfect output.
- **AirPlay / RAOP streaming** to receivers discovered on the LAN (via `pyatv`).
- **A playback queue** (ordered track list + position pointer, with gapless next-track advance).
- **Realtime signal-path/transport state**, pushed to the browser over a WebSocket instead of polled.

### Why Lucid is a separate service

Two architectural reasons, both visible directly in the code:

1. **Real-time scheduling priority.** Lucid raises its own OS scheduling priority on startup:

   ```python
   import os as _os
   try:
       _os.nice(-5)  # Lucid requests elevated scheduling priority for real-time audio
   except (AttributeError, PermissionError):
       pass  # Non-root or non-Linux — run at default priority
   ```

   This is the **opposite** of the analyst scanner, which deliberately *lowers* its priority (`analyst/scanner.py`):

   ```python
   _os.nice(10)  # Analyst runs at low priority — never compete with Lucid for CPU
   ```

   Audio I/O (ALSA writes, AirPlay RTSP timing, ffmpeg transcode pipelines) is time-sensitive: a scheduling hiccup causes an audible glitch, whereas the analyst's filesystem scanning/tagging work is a background batch job with no latency requirement. Running them as one process would mean the scanner's CPU-bound work (hashing, tag parsing, fingerprinting) competing with — and potentially starving — the playback thread. Splitting them into separate processes with opposite `nice` values lets the OS scheduler enforce the priority difference directly, and a crash or restart in one never takes down the other. (`os.nice(-5)` requires elevated privileges on most Linux setups; it's wrapped in a `try/except` so it degrades gracefully to default priority rather than crashing the process when unavailable.)

2. **Direct reachability, not proxied through the Next.js app.** Caddy (the reverse proxy, see `Caddyfile`) routes two classes of traffic straight to `lucid:8001`, bypassing the Next.js app entirely:
   - `/stream/*` — media bytes (large, must support byte-range and long-lived connections; `flush_interval -1` is set on this route so Caddy doesn't buffer chunks before forwarding, keeping streaming responsive)
   - `/ws/*` — the realtime transport WebSocket

   Everything else goes to `app:3000`. The `Caddyfile` comment states the reasoning directly: "Media bytes (`/stream/*`) and the realtime transport socket (`/ws/*`) go straight to Lucid — they must never pass through the Next.js app process." Routing multi-megabyte audio streams and a long-lived websocket through the Node process would add a hop, add memory/CPU overhead to the app container, and couple audio delivery's uptime to the web app's uptime for no benefit.

   In `docker-compose.yml`, Lucid is its own service/container:
   ```yaml
   lucid:
     build:
       context: ./lucid
       dockerfile: Dockerfile
     ports:
       - "${LUCID_PORT:-8001}:8001"
     environment:
       - REDIS_URL=redis://redis:6379
       - APP_URL=http://app:3000
       - INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN:-}
     volumes:
       - ${LIBRARY_PATH:-./music}:/music:ro
     depends_on:
       - redis
   ```
   Note the `/music` bind mount is **read-only** and is the **only** filesystem library content Lucid can see directly — this is central to the SMB streaming design described in section 3. ALSA hardware access (`/dev/snd`) is added via a separate `docker-compose.alsa.yml` overlay, not the base compose file, since browser playback needs no host audio hardware at all.

### Authenticating callbacks to the app

Lucid has no browser session (it's a headless daemon), so when it needs to call back into the Next.js app's internal API (to resolve a track hash or fetch SMB source credentials), it authenticates with a shared bearer-style header instead of a cookie:

```python
_INTERNAL_SERVICE_TOKEN = (
    os.environ.get("INTERNAL_SERVICE_TOKEN") or "phonolith-dev-internal-token-not-for-production"
)
```

sent as the `X-Internal-Token` header. This mirrors the fallback value baked into the app's own `getInternalServiceToken()` (`src/lib/auth.ts`), and is the same mechanism the analyst scanner uses for its own callbacks. In production deployments `INTERNAL_SERVICE_TOKEN` should be set to a real secret (shared across `app`, `analyst`, and `lucid` in `docker-compose.yml`); the literal fallback string only exists so a fresh `docker compose up` with no `.env` still works end-to-end in development.

---

## 2. FastAPI Endpoint Reference (`main.py`)

FastAPI app: `FastAPI(title="Lucid — Phonolith Audio Playback", version="1.0.0", lifespan=lifespan)`. The `lifespan` context manager starts `FluxManager` and `PolyphonyDiscovery` (mDNS browsers) on startup, and on shutdown stops playback (`player.stop()`), cancels any AirPlay stream, stops both mDNS managers, and closes the async Redis client.

### Pydantic request models

```python
class PlayRequest(BaseModel):
    path: str
    device: str | None = None
    endpoint_name: str | None = None

class SeekRequest(BaseModel):
    ms: int

class QueueAddRequest(BaseModel):
    path: str

class PolyphonyAnnounceRequest(BaseModel):
    enabled: bool
    peer_id: str
    name: str
    port: int = 80
```

There is no `Pydantic` model for `/status`, `/devices`, `/airplay/endpoints`, or `/polyphony/discovered` — those are plain dict/list responses typed as `dict[str, Any]` / `list[dict[str, Any]]`.

### Routes

| Method | Path | Request model | Response | Purpose |
|---|---|---|---|---|
| GET | `/health` | — | `{"status": "ok"}` | Liveness probe. |
| GET | `/status` | — | `{signal_path, queue: {length, position, current, tracks}}` | Full current playback state: signal path (`sp_manager.to_dict()`) plus queue length/position/current-track/full track list. |
| GET | `/devices` | — | `{alsa: [...], airplay: [...]}` | Lists ALSA PCM output device names (via `alsaaudio.pcms()`, falling back to `["default"]` if none/unavailable) and discovered AirPlay endpoints (`flux_mgr.list_endpoints()`). |
| POST | `/play` | `PlayRequest` | `{"status": "playing", "path", "device"|"endpoint"}` | Starts playback of `path`. If `endpoint_name` is set, routes to that AirPlay receiver via `FluxManager.stream_to()` instead of ALSA (stops any active local ALSA playback first, off the event loop via `asyncio.to_thread` — see note below). Otherwise stops any AirPlay stream, resolves the ALSA device (`req.device` → current signal-path device → `ALSA_DEVICE` env default), enqueues the path into the queue if not already present (positioning the queue at it), and calls `player.play()` in a thread. 422 if `path` missing; 404 if `endpoint_name` unknown. |
| POST | `/pause` | — | `{"status": "paused"}` | Pauses the ALSA playback thread (`player.pause()`) — no-op if nothing is playing. |
| POST | `/resume` | — | `{"status": "playing"}` | Resumes paused playback (`player.resume()`). |
| POST | `/stop` | — | `{"status": "stopped"}` | Stops ALSA playback and cancels any AirPlay stream, both off the event loop. |
| POST | `/seek` | `SeekRequest {ms}` | `{"status": "seeking", "ms"}` | Seeks the current ALSA-playing track to `ms` milliseconds (`player.seek()`). |
| POST | `/queue/add` | `QueueAddRequest {path}` | `{"status": "added", "path", "queue_length"}` | Appends `path` to the queue. 422 if `path` missing. |
| POST | `/queue/clear` | — | `{"status": "cleared"}` | Empties the queue and resets position to `-1`. |
| POST | `/queue/next` | — | `{"status": "playing", "path"}` | Advances the queue and plays the next track over ALSA. 404 if no next track. |
| POST | `/queue/prev` | — | `{"status": "playing", "path"}` | Moves the queue back and plays the previous track over ALSA. 404 if no previous track. |
| GET | `/airplay/endpoints` | — | `list[dict]` | Discovered AirPlay/RAOP endpoints (`{name, host, port, model}`), same data as the `airplay` key of `/devices`. |
| POST | `/polyphony/announce` | `PolyphonyAnnounceRequest` | `{"status": "announcing"|"stopped"}` | Starts (or stops, if `enabled=false`) broadcasting this Phonolith instance's presence on the LAN via mDNS for discovery by other Phonolith instances. |
| GET | `/polyphony/discovered` | — | `list[dict]` | Other Phonolith/"Polyphony" instances discovered on the LAN (`{peerId, name, host, port}`). |
| GET | `/stream/{track_hash}` | path param `track_hash` (BLAKE3 hash), query params `format`, `bitrate` | `FileResponse` or `StreamingResponse` | Streams a library track's audio bytes to the browser. **See section 3 — this is the most involved endpoint in the service.** |
| WS | `/ws/state` | — | JSON text frames | Realtime push of signal-path/transport state. **See section 5.** |

**Note on `/play` with `endpoint_name`:** `player.stop()` is called via `await asyncio.to_thread(player.stop)` rather than directly, because `Player.stop()` can block for up to 5 seconds on `Thread.join(timeout=5)` while waiting for the playback thread to exit. Calling it directly on the event loop would freeze *everything* Lucid does concurrently for up to that long — including the `/ws/state` pubsub-forwarding loop and `/health` checks — so it's deliberately pushed off-loop.

---

## 3. Deep Dive: `/stream/{track_hash}` and Media Resolution (SMB rework)

This is the endpoint that serves actual audio bytes to the browser, and the part of Lucid most recently reworked to correctly support tracks whose files live on an SMB/CIFS network share rather than the locally-mounted library path.

### 3.1 Track resolution: `_resolve_track()`

```python
async def _resolve_track(track_hash: str) -> dict:
    """Resolve a BLAKE3 hash to its library row (path, source_id, …) via the app API."""
```

Lucid does not have its own database connection. To turn a track hash into a file path, it calls back into the Next.js app:

```
GET {APP_URL}/api/library/{track_hash}
Header: X-Internal-Token: {INTERNAL_SERVICE_TOKEN}
```

using a 5-second-timeout `httpx.AsyncClient`. This returns the full library row as JSON — critically including `file_path` and `source_id`. Error handling: network/transport errors → 502; app returns 404 → 404 "Unknown track hash"; any other non-200 → 502 "Library lookup failed".

### 3.2 Why Lucid needs its own SMB streaming path

Lucid's Docker volume mount is:
```yaml
volumes:
  - ${LIBRARY_PATH:-./music}:/music:ro
```
This is **only the local library path**, read-only. Lucid has no filesystem access whatsoever to network shares (SMB/CIFS) that the analyst scanner may have indexed as library sources. However, `library_files` rows for SMB-sourced tracks store `file_path` as a UNC-style path such as:

```
//host/share/sub/track.flac
```

If Lucid naively tried `os.path.isfile(path)` on that string, it would never find the file — not because of a permissions or auth problem, but because Lucid's container simply doesn't have that network filesystem mounted at all. This was, in fact, the **historical bug** this endpoint was reworked to fix (see section 3.5 and section 7).

The fix: detect SMB-sourced paths and, for those, stream the bytes **directly over the SMB protocol** using the `smbprotocol`/`smbclient` library (the same library the analyst uses to scan network shares), rather than treating the path as something openable on a local filesystem.

### 3.3 Path classification and dispatch

```python
def _is_network_path(path: str) -> bool:
    """True for SMB/UNC paths (`//host/share/...` or `\\\\host\\share\\...`)."""
    return path.startswith("//") or path.startswith("\\\\")
```

In the `/stream/{track_hash}` handler, the dispatch is:

```python
if _is_network_path(path) and not os.path.isfile(path):
    # SMB path
    ...
if not os.path.isfile(path):
    raise HTTPException(status_code=404, detail="Source file not accessible to Lucid")
# Local path
```

The `_is_network_path(path) and not os.path.isfile(path)` combination is deliberate: a path that merely *looks* like a UNC path but happens to also exist as a real local file (edge case) is still served locally (fast path takes precedence); only a genuinely-inaccessible-as-local-file network path is routed to the SMB branch.

**Local-source fast path:** `FileResponse(path, media_type=media_type, filename=filename)`. FastAPI's `FileResponse` natively supports HTTP Range requests, so seeking and MSE (Media Source Extensions) pre-fetching both work for free, with no custom byte-range code needed on Lucid's side.

### 3.4 SMB-source path: fetching credentials and registering a session

For SMB-sourced tracks, Lucid needs the source's connection details (host, share, username, password, domain). It fetches these from the app, via an endpoint that is **internal-token-only** (never exposed to the browser) precisely because it returns decrypted credentials:

```python
async def _fetch_source_config(source_id: Any) -> dict:
    r = await client.get(
        f"{_APP_URL}/api/library/sources/{source_id}/config",
        headers={"X-Internal-Token": _INTERNAL_SERVICE_TOKEN},
    )
    ...
    return r.json().get("config") or {}
```

Non-200 → 502 "Source config unavailable".

The path is converted from the stored `//host/share/...` (forward-slash) form to a backslash UNC form for `smbclient`:
```python
smb_path = path.replace("/", "\\")
```

**`_register_smb(config)`** — registers an authenticated `smbclient` session for the host (blocking call):

```python
def _register_smb(config: dict) -> None:
    import smbclient
    host = config.get("host", "")
    username = config.get("username") or None
    password = config.get("password") or None
    domain = config.get("domain") or None
    user = username
    if user and domain:
        user = f"{domain}\\{user}"

    errors: list[str] = []
    for proto in ("negotiate", "ntlm", "kerberos"):
        try:
            try:
                smbclient.register_session(host, username=user, password=password, auth_protocol=proto)
            except TypeError:
                if proto != "negotiate":
                    raise
                smbclient.register_session(host, username=user, password=password)
            return
        except Exception as exc:
            errors.append(f"{proto}: {exc}")
            try:
                smbclient.delete_session(host)
            except Exception:
                pass
    raise RuntimeError(f"SMB authentication to {host} failed (negotiate/ntlm/kerberos): {'; '.join(errors)}")
```

This is a direct mirror of the analyst's `register_smb_session()` (`analyst/scanner.py`) and exists because of a real-world interoperability quirk: **`smbprotocol` defaults to SPNEGO `auth_protocol='negotiate'`**, but some NAS/Samba servers reject `negotiate` with `STATUS_LOGON_FAILURE` even when the supplied credentials are entirely correct — whereas kernel CIFS clients and `libsmbclient`-based tools (Plex, Roon, etc.) default straight to raw NTLM and connect fine against the exact same server. So Lucid tries, in order: `negotiate` → `ntlm` → `kerberos`, deleting the failed session before each retry, and only raising if all three fail. The inner `try/except TypeError` guards older `smbprotocol` builds whose `register_session()` doesn't accept an `auth_protocol` kwarg at all — those old versions get one attempt with implicit/default negotiation and then move on to `ntlm`/`kerberos` on failure exactly as if `negotiate` had failed with an auth error.

### 3.5 SMB Range streaming: `_smb_size`, `_smb_read_range`, `_stream_smb`

```python
def _smb_size(smb_path: str, config: dict) -> int:
    """Open the SMB file and return its total size in bytes (blocking)."""
    _register_smb(config)
    with smbclient.open_file(smb_path, mode="rb") as f:
        return f.seek(0, io.SEEK_END)
```

```python
def _smb_read_range(smb_path: str, config: dict, start: int, end: int, chunk_size: int = 262144):
    """Yield bytes [start, end] (inclusive) from an SMB file — a blocking generator."""
    _register_smb(config)
    with smbclient.open_file(smb_path, mode="rb") as f:
        if start:
            f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
```

`_smb_read_range` is a **blocking generator** (regular `def`, not `async def` — `smbclient` itself is synchronous). It's never called directly on the event loop; `_stream_smb` hands it to `StreamingResponse`, and FastAPI/Starlette iterates a sync generator passed to `StreamingResponse` in a thread pool automatically, so its blocking network reads never stall the event loop.

`_stream_smb()` ties it together:

```python
async def _stream_smb(smb_path: str, config: dict, request: Request, media_type: str, filename: str):
    size = await asyncio.to_thread(_smb_size, smb_path, config)   # any failure -> 404
    ...
    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        # parse "bytes=start-end"
        ...
        if start > end or start >= size:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable",
                                 headers={"Content-Range": f"bytes */{size}"})
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    headers["Content-Length"] = str(end - start + 1)
    return StreamingResponse(_smb_read_range(smb_path, config, start, end),
                              status_code=status, media_type=media_type, headers=headers)
```

Behavior:
- Getting the size (`_smb_size`) is itself run via `asyncio.to_thread` since opening the SMB session/file is blocking. Any exception (auth failure, host unreachable, share/file missing) is logged and turned into a 404 "Source file not accessible to Lucid" — deliberately opaque to the client rather than leaking SMB error internals.
- No `Range` header, or one that doesn't start with `bytes=` → serves the whole file, **200 OK**, with `Accept-Ranges: bytes` and `Content-Disposition: inline; filename="..."`.
- A well-formed `Range: bytes=start-end` header (only the first range in a comma-separated list is honored; open-ended forms like `bytes=1000-` or `bytes=-500`-style suffix ranges are handled: missing `start` defaults to 0, missing `end` defaults to `size - 1`) → **206 Partial Content** with `Content-Range: bytes {start}-{end}/{size}`.
- An unsatisfiable range (`start > end` or `start >= size`) → **416 Range Not Satisfiable** with `Content-Range: bytes */{size}`.
- `Content-Length` is always set to the exact number of bytes that will actually be streamed for the (possibly partial) response.

This gives SMB-sourced tracks the same seek behavior as local files served via `FileResponse`, just implemented by hand since `FileResponse` only works on local paths.

### 3.6 Opus transcode path (local and SMB)

`?format=opus[&bitrate=32|64|96|128]` requests an on-the-fly lossy transcode — intended for network-constrained playback (e.g. cellular), trading fidelity for bitrate.

```python
_OPUS_BITRATES = {"32", "64", "96", "128"}
_DEFAULT_OPUS_BITRATE = "96"

def _opus_bitrate(request: Request) -> str:
    bitrate = request.query_params.get("bitrate", _DEFAULT_OPUS_BITRATE)
    return bitrate if bitrate in _OPUS_BITRATES else _DEFAULT_OPUS_BITRATE
```

**Security rationale for the whitelist:** the bitrate value ends up interpolated directly into an `ffmpeg` subprocess command line (`-b:a f"{bitrate}k"`). If an arbitrary client-supplied string were allowed through, this would be an injection surface (at minimum letting a client run ffmpeg with attacker-chosen flags, at worst an obvious footgun for whatever list of args is eventually built from user input). Restricting to a fixed, checked set of four literal strings means the client can never inject anything beyond "32", "64", "96", or "128" — any unrecognized value silently falls back to the default rather than erroring, so a malformed request degrades gracefully instead of failing.

**Local-file transcode — `_transcode_opus(path, bitrate)`:**
```python
proc = await asyncio.create_subprocess_exec(
    "ffmpeg", "-nostdin", "-v", "error", "-threads", "1",
    "-i", path,
    "-map", "0:a:0",
    "-c:a", "libopus", "-b:a", f"{bitrate}k", "-vbr", "on",
    "-f", "ogg", "-",
    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
)
```
`-threads 1` is deliberate: `libopus` is multi-threaded by default and would otherwise try to claim every core, which could compete with a concurrent bit-perfect ALSA playback running on the same host. A single thread is plenty of headroom for real-time Opus encoding at these bitrates. The coroutine simply reads `proc.stdout` in 64 KiB chunks and yields them as a `StreamingResponse` body (`media_type="audio/ogg"`). On generator close/exhaustion, it kills the process if still running, drains stderr for logging, and warns if the exit code is unexpected (anything other than `0`, `None`, or `-9`/SIGKILL).

**SMB-file transcode — `_transcode_opus_smb(smb_path, config, bitrate)`:** ffmpeg cannot open a UNC path directly (it has no SMB client built in that Lucid wires up), so the SMB bytes are fed into ffmpeg's **stdin** (`-i pipe:0`) instead of a file path argument:

```python
proc = await asyncio.create_subprocess_exec(
    "ffmpeg", "-nostdin", "-v", "error", "-threads", "1",
    "-i", "pipe:0",
    "-map", "0:a:0",
    "-c:a", "libopus", "-b:a", f"{bitrate}k", "-vbr", "on",
    "-f", "ogg", "-",
    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
)
```

This creates a **producer/consumer split** across two concurrent pieces of code:

- **Producer — `_feed()`** (a background `asyncio.Task`): opens the SMB file (`_register_smb` + `smbclient.open_file`, both run via `asyncio.to_thread` since they're blocking), then loops reading 256 KiB chunks off the SMB connection (again via `asyncio.to_thread(f.read, ...)`, since `smbclient` reads block) and writing them into `proc.stdin`, `await`-ing `proc.stdin.drain()` after each write so it respects ffmpeg's backpressure rather than buffering unboundedly in memory if ffmpeg is slower to consume than SMB is to deliver. On EOF or any exception, it closes the SMB file handle and closes `proc.stdin` (signaling EOF to ffmpeg) in a `finally` block.
- **Consumer — the main coroutine**: concurrently reads `proc.stdout` in 64 KiB chunks and yields them to the `StreamingResponse`, exactly like the local-file path.

The split is necessary because ffmpeg reads its stdin and writes its stdout interleaved (it's a streaming decoder/encoder, not "read all input then write all output") — if the main coroutine tried to first push *all* input then read output, it would deadlock as soon as ffmpeg's internal stdout pipe buffer filled up while it was still waiting for more stdin. Running the feed as a separate concurrently-scheduled task lets both directions of the pipe move at once.

Cleanup: in the `finally` block, `feeder.cancel()` is called (in case the consumer side exits first — e.g., the client disconnects), the process is killed if still running, stderr is drained for logging, and an unexpected exit code is logged the same way as the local path.

**Seeking is not supported on transcoded streams.** Range requests are simply not implemented for the `?format=opus` path in either the local or SMB variant — there's no way to seek into an arbitrary offset of an ffmpeg pipe output without re-running the whole transcode from that point. The client-side contract is: to "seek" a transcoded stream, restart the HTTP request with the desired start position communicated some other way (e.g. requesting the source track again and having the player itself skip, or resuming passthrough); Lucid does not expose Range support for `format=opus` requests.

### 3.7 Summary of the resolve → stream flow

```
GET /stream/{track_hash}?format=opus&bitrate=64
        │
        ▼
_resolve_track(track_hash)          # GET {APP_URL}/api/library/{hash}, X-Internal-Token
        │  → { file_path, source_id, ... }
        ▼
path = file_path
is_network = _is_network_path(path) and not os.path.isfile(path)
        │
        ├── True (SMB) ──────────────────────────────────────────────┐
        │      _fetch_source_config(source_id)                       │
        │        GET {APP_URL}/api/library/sources/{id}/config        │
        │        (X-Internal-Token; returns decrypted creds)          │
        │      smb_path = path with "/" → "\"                        │
        │      format == "opus"?                                     │
        │        yes → _transcode_opus_smb(smb_path, config, bitrate)│
        │        no  → _stream_smb(smb_path, config, request, ...)   │
        │              (Range-aware, 206/200/416)                    │
        │                                                            │
        └── False (local) ─────────────────────────────────────────┘
               os.path.isfile(path)?  no → 404
               format == "opus"?
                 yes → _transcode_opus(path, bitrate)   (StreamingResponse, audio/ogg)
                 no  → FileResponse(path, ...)           (native Range support)
```

### 3.8 Historical bug this replaced

Before this rework, Lucid resolved a track's `file_path` from the app and called `os.path.isfile(path)` on it directly, unconditionally — there was no SMB branch at all. For any SMB-sourced track, this simply **404'd**, because Lucid's container has no network-share filesystem mounted (only `/music` from `LIBRARY_PATH`, read-only) — the UNC-style path (`//host/share/...`) is not something `os.path.isfile` could ever resolve inside Lucid's container regardless of whether the file genuinely existed and was reachable over SMB.

This was additionally confusing to debug at the time because of a **separate, since-fixed bug**: an earlier auth mismatch where Lucid's callbacks to the app used a session-cookie-based auth path instead of the internal-token header, which failed *before* ever reaching the file-existence check — making the failure look like an authentication/authorization problem first. Once that auth bug was fixed and calls to the app succeeded, the underlying "SMB paths can't be opened as local files" 404 became visible as its own distinct issue, which is what the `_is_network_path()` + direct SMB streaming design in section 3.2–3.6 was built to solve.

---

## 4. Other Modules

### 4.1 `flux.py` — AirPlay (RAOP) discovery and streaming

Docstring rationale for the design: reimplementing the AirPlay/RTSP/ALAC protocol stack by hand (including AirPlay 2 pairing/encryption) would be large and fragile with no upside over `pyatv`, a maintained library that already handles device-specific quirks.

- **`_RaopListener(ServiceListener)`** — a `zeroconf` service listener that browses `_raop._tcp.local.` (the RAOP/AirPlay mDNS service type) and maintains a shared `registry: dict[str, dict]` of discovered endpoints.
  - `add_service()`: parses the friendly device name out of the mDNS service name (format is typically `"<MAC>@<Device Name>._raop._tcp.local."` — splits on `@` then on `._`), resolves the host IP from `info.addresses[0]`, reads the port, and decodes the `am` (device model) TXT record property. Stores `{name, host, port, model}` keyed by friendly name.
  - `remove_service()`: removes the entry by friendly name (parsed the same way).
  - `update_service()`: re-runs `add_service` to refresh the entry.

- **`FluxManager`** — the class Lucid instantiates as `flux_mgr`.
  - `start()` / `stop()`: create/close a `Zeroconf` instance and attach/detach a `ServiceBrowser` for `_raop._tcp.local.`. Idempotent (`start()` no-ops if already started); exceptions are caught and logged, never raised.
  - `list_endpoints()`: returns `list(self.discovered.values())`.
  - `endpoint_info(name)`: single-endpoint lookup, or `None`.
  - `stream_to(endpoint_name, file_path)`: looks up the endpoint (raises `ValueError` if unknown — surfaced by `main.py` as an HTTP 404), then, under `self._stream_lock` (an `asyncio.Lock`), stops any in-flight stream and starts a new background task (`_do_stream`). The lock exists specifically to prevent a race: without it, two overlapping `/play?endpoint_name=...` calls could both observe "no stream running yet" and both proceed to start a stream, orphaning the first one with no reference left to cancel it.
  - `_do_stream(host, file_path, endpoint_name)`: `pyatv.scan()` for the specific host, `pyatv.connect()`, then `atv.stream.stream_file(file_path)`. Logs and returns quietly if the device doesn't respond to scan or connect fails; on cancellation, re-raises `CancelledError` after logging; always closes the `atv` connection in a `finally` block.
  - `stop_streaming()` / `_stop_streaming_locked()`: cancels `self._stream_task` if running and awaits it (swallowing `CancelledError`/other exceptions), then clears `_stream_task`/`_active_endpoint`.
  - Only one AirPlay stream is ever active at a time — Lucid does not fan out to multiple AirPlay receivers simultaneously.

### 4.2 `player.py` — ALSA exclusive-mode playback engine

Plays audio directly to a physical ALSA PCM device with no OS mixer in between, for bit-perfect output. Falls back to a no-op `StubPCM` when `pyalsaaudio` (the `alsaaudio` module) is unavailable (e.g. non-Linux dev machines), so the module still imports and the rest of Lucid still runs.

Decoding strategy (`_decoder_name(file_path)`):
- `.flac` → `"libFLAC (via soundfile)"`
- `.wav` / `.aiff` / `.aif` → `"PCM native"`
- anything else → `"FFmpeg"` (spawned as a subprocess producing raw PCM on stdout via `_open_via_ffmpeg`, for formats `soundfile` can't decode: MP3, AAC, M4A, etc.)

**`Player`** (constructed as `Player(sp_manager, queue_mgr, redis_client)` in `main.py`) — the class driving actual output:

- `play(file_path, alsa_device=None)`: stops any current playback, resolves the target device, decides soundfile-vs-ffmpeg path based on extension, and dispatches to `_play_via_soundfile` or `_play_via_ffmpeg`.
- `pause()` / `resume()`: set/clear a `threading.Event` (`_pause_event`) that the playback loop spins on; updates and publishes signal-path `status`.
- `stop()`: sets `_stop_event`, clears `_pause_event`, joins the playback thread (up to 5s timeout — captured into a local `thread` variable up front specifically because a gapless track transition can reassign `self._thread` concurrently from within the playback thread itself, so re-reading `self._thread` between the `is_alive()` check and `.join()` could join the *new* thread instead of the one being stopped), closes the PCM handle, and publishes `status="stopped", position_ms=0`.
- `seek(ms)`: stops the current playback loop, computes a target frame from `ms` and the current sample rate, then re-opens the file via `_play_via_soundfile(..., start_frame=target_frame)`. Implemented as stop-and-reopen rather than any in-place repositioning, by design, to avoid shared-state complexity — the tradeoff being that seeking only works for the soundfile path.
- `_play_via_soundfile(file_path, device, start_frame=0)`: opens the file with `sf.SoundFile`, derives sample rate/channels/frame count/duration, derives bit depth from the `subtype` string (e.g. `"PCM_24"` → 24), updates and publishes the signal path (`bit_perfect=True` since this path never resamples), seeks to `start_frame` if given, opens the ALSA PCM device (`_open_pcm`), and spawns the playback thread (`_playback_loop_sf`).
- `_playback_loop_sf`: reads `_PERIOD_SIZE` (4096) frames at a time as the appropriate numpy dtype, writes raw bytes to the PCM device, advances position, and republishes signal-path position every `_POSITION_PUBLISH_INTERVAL_S` (0.5s) rather than every chunk (rate-limiting Redis publish volume). On EOF, calls `_handle_track_end()` for gapless continuation. Honors pause by spinning in a 50ms sleep loop while `_pause_event` is set.
- `_play_via_ffmpeg` / `_playback_loop_ffmpeg`: same shape as the soundfile path, but probes metadata via `sf.info()` (falling back to 44100 Hz/2ch/16-bit defaults and logging a warning if `soundfile` can't even probe the format) and reads raw PCM bytes from an `ffmpeg` subprocess's stdout instead of via `soundfile`.
- `_handle_track_end()`: asks `queue_mgr.next()` for the next track; if present, closes the current PCM and immediately starts playing it (gapless — "the gapless gap is imperceptible for ALSA" per the code comment, since the reopen happens all in Python without hardware reinitialization delay in practice); if the queue is exhausted, publishes `status="stopped", position_ms=0`.
- `_open_pcm(device, bit_depth, channels, sample_rate)`: opens `alsaaudio.PCM(PCM_PLAYBACK, PCM_NORMAL, device=device)` with format/channels/rate/period-size set, or a `StubPCM` if ALSA is unavailable or opening fails (logged as an error, not fatal — playback effectively becomes silent/no-op rather than crashing).
- Bit depth ↔ ALSA format mapping: 16→`PCM_FORMAT_S16_LE`, 24→`PCM_FORMAT_S24_LE`, 32→`PCM_FORMAT_S32_LE` (unrecognized depths fall back to S16_LE with a warning). Bit depth ↔ numpy dtype: 16→`int16`, 24 and 32→`int32`.

### 4.3 `queue_manager.py` — playback queue

**`QueueManager`** — a simple in-memory ordered list of absolute file paths (`tracks: list[str]`) plus a zero-based `position: int` pointer (`-1` = empty/unstarted).

- `current()`: the path at `position`, or `None` if out of bounds/empty.
- `next()` / `prev()`: move the position pointer by ±1 and return the new current path, or `None` without moving if already at either end.
- `enqueue(path)`: appends to `tracks`; if the queue was empty, sets `position = 0` so the newly added track becomes current.
- `clear()`: empties `tracks`, resets `position = -1`.
- `set_tracks(paths)`: replaces the entire queue, resetting `position` to `0` (or `-1` if `paths` is empty).
- `__len__` / `__repr__`: standard container helpers.

No persistence — the queue is purely in-process memory, reset on Lucid restart.

### 4.4 `signal_path.py` — transport/signal-path state and Redis pub-sub

**`SignalPath`** (a `@dataclass`) — the full snapshot of "what is Lucid currently doing, audio-chain-wise":

```python
@dataclass
class SignalPath:
    source_file: str | None = None
    source_format: str | None = None       # "FLAC", "MP3", etc.
    source_bit_depth: int | None = None    # 16, 24, 32
    source_sample_rate: int | None = None  # 44100, 96000, etc.
    source_channels: int = 2
    decoder: str | None = None             # "libFLAC (via soundfile)", "FFmpeg", "PCM native"
    dsp_chain: list[str] = field(default_factory=list)  # e.g. ["Volume: 100%"]
    transport: str = "ALSA Exclusive"
    alsa_device: str = "default"
    endpoint_name: str | None = None       # User-friendly name e.g. "Chord Hugo TT2"
    status: str = "stopped"               # "playing"|"paused"|"stopped"|"buffering"|"error"
    position_ms: int = 0
    duration_ms: int = 0
    volume: float = 1.0                   # 0.0 – 1.0 (software volume; ideally 1.0 always)
    bit_perfect: bool = True              # False if any resampling/conversion happened
```

**`SignalPathManager`** — wraps a single `SignalPath` instance (`sp_manager` in `main.py`):

- `REDIS_KEY = "lucid:signal_path"` — where the latest state snapshot is stored (as JSON, no expiry).
- `REDIS_CHANNEL = "lucid:signal_path:update"` — the pub-sub channel notified on every update.
- `signal_path` property: the live `SignalPath` instance.
- `to_dict()`: `dataclasses.asdict()` of the current state.
- `update(**kwargs)`: sets arbitrary fields by name (warns and ignores unknown field names rather than raising). Has one piece of derived logic: if `source_sample_rate` or `source_bit_depth` is changed to a value different from what was already stored (and a prior value existed), it automatically sets `bit_perfect = False` — i.e., any resample/bit-depth conversion mid-stream is recorded truthfully rather than left at whatever the caller happened to pass.
- `publish(redis_client)`: serializes `to_dict()` to JSON, `SET`s it at `REDIS_KEY`, and `PUBLISH`es it to `REDIS_CHANNEL`, using a **synchronous** `redis.Redis` client (this is the `redis_client` built from `redis_lib.from_url(...)` in `main.py`, distinct from the async client used for the websocket's subscribe side — see section 5). Publish failures are caught and logged, never raised (a Redis hiccup must not crash playback).

`Player` calls `sp_manager.update(...)` then `sp_manager.publish(self._redis)` every time meaningful state changes (track start, pause/resume/stop, periodic position ticks, errors). `main.py`'s `/play` and `/stop` handlers for the AirPlay path also call `sp_manager.update(endpoint_name=..., alsa_device=...)` directly (without an explicit `publish()` call in those branches — the next `Player`-driven publish, or the next status poll, picks it up implicitly through `to_dict()`/`/status`).

### 4.5 `polyphony_discovery.py` — LAN discovery of other Phonolith instances

"Polyphony" is Phonolith's peer-discovery/pairing feature. This module implements only the **LAN/mDNS discoverability** half of it — broadcasting a bare peer id + display name (never library contents) and browsing for other instances doing the same. The module docstring is explicit that this is not a public/WAN discovery service (no rendezvous server, no larger trust model) — actual pairing still requires a human-entered one-time code from the target's admin, so discovery only ever saves typing a hostname; it never grants trust by itself.

- **`_PolyphonyListener(ServiceListener)`** — browses `_polyphony._tcp.local.`.
  - `add_service()`: reads `peer_id`, `name`, `port` from the mDNS TXT record properties (falling back to the raw mDNS port if the `port` property is absent), resolves the host IP, and stores `{peerId, name, host, port}` keyed by `peer_id`. Silently ignores services with no `peer_id` TXT property.
  - `remove_service()`: intentionally a no-op — the code comment explains that entries are keyed by `peer_id`, which can't be recovered from the mDNS `name` alone on removal, so stale entries are left in place as harmless (they get overwritten on rediscovery).
  - `update_service()`: re-runs `add_service`.

- **`PolyphonyDiscovery`** — instantiated as `polyphony_mgr` in `main.py`.
  - `start()` / `stop()`: create/close the `Zeroconf` instance and browser; `stop()` also unannounces this instance first.
  - `list_discovered()`: returns discovered peers.
  - `announce(peer_id, name, port)`: unannounces any previous announcement, resolves the local IP (`socket.gethostbyname(socket.gethostname())`, falling back to `127.0.0.1` on failure), and registers a `ServiceInfo` under `_polyphony._tcp.local.` with `{peer_id, name, port}` as TXT properties. This is what backs the `POST /polyphony/announce` endpoint.
  - `unannounce()` / `_unannounce_locked()`: unregisters the previously-announced `ServiceInfo`, if any.
  - All mutation is guarded by a `threading.Lock` (`self._lock`).

---

## 5. `/ws/state` — Realtime Transport WebSocket

```python
@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
```

Purpose: push signal-path/transport state to the browser the instant it changes, replacing what would otherwise be HTTP polling of `/status`.

Sequence:
1. `await websocket.accept()`.
2. Subscribe to Lucid's existing Redis pub-sub channel: `pubsub = redis_async_client.pubsub(); await pubsub.subscribe(sp_manager.REDIS_CHANNEL)` (i.e. `"lucid:signal_path:update"`).
3. **Immediately send the current state**: `await websocket.send_text(json.dumps(sp_manager.to_dict()))` — this happens *before* subscribing to any new updates conceptually matters because it guarantees the UI has something to render the instant it connects, rather than showing a blank/loading state until the next playback event happens to fire. (The subscribe call itself happens just before this in the code, but no messages can have been missed between subscribe and this initial send in a way that matters, since `to_dict()` is read fresh at send time.)
4. Two concurrent tasks are raced against each other with `asyncio.wait(..., return_when=asyncio.FIRST_COMPLETED)`:
   - `listen_task = asyncio.create_task(_forward_pubsub(pubsub, websocket))` — forwards every pub-sub message to the browser.
   - `recv_task = asyncio.create_task(websocket.receive_text())` — waits for the client to send anything (Lucid doesn't actually expect client-sent messages; this call's real purpose is to detect a client disconnect, since `receive_text()` raises/resolves when the connection closes).
5. Whichever finishes first "wins": if the server has a new state update, it's forwarded and the loop below exits (note: the handler does **not** loop back around — this is a fire-once wait, not a persistent forward loop; in practice the connection lifetime is one `send_text` from `_forward_pubsub` for the whole session **unless** more state changes have already been enqueued in the pubsub iterator, since `_forward_pubsub` itself contains its own `async for` loop that keeps running until the task is cancelled — see below). If the client disconnects, `recv_task` resolves/raises and the wait ends.
6. Whichever task did *not* finish is cancelled (`for task in pending: task.cancel()`).
7. `WebSocketDisconnect` is caught and swallowed.
8. `finally`: unsubscribes from the Redis channel and closes the `pubsub` object, regardless of how the loop ended.

**`_forward_pubsub`:**
```python
async def _forward_pubsub(pubsub: Any, websocket: WebSocket) -> None:
    async for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        await websocket.send_text(message["data"])
```
This runs as a task and loops indefinitely over `pubsub.listen()` (an async generator that yields both control messages like `"subscribe"` and actual `"message"` events; only `"message"` type events are forwarded — `sp_manager.publish()`'s payload, since `redis_async_client` was constructed with `decode_responses=True`, `message["data"]` is already a `str`, which is why it can be passed straight to `send_text()` with no `.decode()`). Because this is a task that keeps running until explicitly cancelled, in the actual `asyncio.wait(..., FIRST_COMPLETED)` above, the *first* Redis-published state change causes `_forward_pubsub`'s task to... actually continue running (the `async for` loop inside it doesn't return after one message) — what ends the `asyncio.wait` is `recv_task` completing (client disconnect) in the common case, since `listen_task` only ever completes if `pubsub.listen()` itself terminates (e.g., on unsubscribe/connection error). In other words: `asyncio.wait(FIRST_COMPLETED)` here is really watching for *either* "the pubsub forwarding loop ended for some reason" *or* "the client disconnected" — both are terminal conditions for the connection, so the wait+cancel+cleanup pattern cleanly tears down whichever side is still active once either side ends.

---

## 6. Environment Variables Reference

| Variable | Default | Used for |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | Connection URL for both the synchronous (`redis_lib.from_url`, used for publishing signal-path state) and async (`redis.asyncio.from_url`, used for the `/ws/state` pub-sub subscribe/forward) Redis clients. |
| `ALSA_DEVICE` | `"default"` | Default ALSA PCM device name, used to seed `sp_manager.signal_path.alsa_device` at startup and as the fallback device for `/play`, `/queue/next`, `/queue/prev` when no explicit device is given. |
| `APP_URL` | `http://app:3000` | Base URL Lucid calls back into for the Next.js app's internal API — track resolution (`GET /api/library/{hash}`) and SMB source config (`GET /api/library/sources/{id}/config`). |
| `INTERNAL_SERVICE_TOKEN` | `"phonolith-dev-internal-token-not-for-production"` (dev-only fallback) | Shared secret sent as `X-Internal-Token` on every callback to the app, since Lucid has no browser session to authenticate with. Must be set to a real secret (shared with `app` and `analyst`) in production. |

Additionally, per `docker-compose.yml`, `${LIBRARY_PATH:-./music}` is bind-mounted read-only at `/music` inside the Lucid container — not an env var Lucid's Python code reads directly, but the filesystem precondition that makes local-source `/stream` serving and ALSA local playback of local-source files possible at all.

---

## 7. Known Gotchas / History

1. **SMB streaming rework (the big one).** Lucid originally treated every `file_path` returned by the app as a local path and called `os.path.isfile()` on it directly. Any SMB-sourced track (stored as a UNC-style `//host/share/...` path) simply 404'd, because Lucid's container only ever mounts the local `/music` tree — it has no network-share filesystem access at all, regardless of whether the file genuinely existed and was reachable over the network. The fix (documented in full in section 3) added `_is_network_path()` detection plus a full parallel SMB code path: `_register_smb`/`_smb_size`/`_smb_read_range`/`_stream_smb` for passthrough streaming with Range support, and `_transcode_opus_smb` (stdin-pipe producer/consumer) for the Opus transcode case.

2. **The auth-bug red herring.** Before the SMB fix, there was a *separate*, now-fixed bug where Lucid's callbacks to the app used session-cookie-based auth instead of the `X-Internal-Token` header. That bug made *every* callback fail with what looked like an auth/permission error, which masked the fact that even after fixing auth, SMB-sourced tracks would still fail — just with a different symptom (plain 404 from the local-file-existence check) once the callback itself started succeeding. Both bugs are fixed now; the SMB path is exercised on every request with a UNC-style `file_path` that isn't also coincidentally present locally.

3. **SMB NTLM auth fallback.** `_register_smb()` tries `auth_protocol="negotiate"`, then `"ntlm"`, then `"kerberos"`, in that order, because `smbprotocol`'s default SPNEGO negotiation is rejected (`STATUS_LOGON_FAILURE`) by some NAS/Samba servers even with fully correct credentials — while kernel CIFS clients and `libsmbclient`-based apps (Plex, Roon, etc.) default straight to raw NTLM against the same servers and work without issue. This is the exact same root cause and the exact same fix shape as `register_smb_session()` in the analyst scanner (`analyst/scanner.py`) — Lucid's version is a direct mirror, kept in its own module because Lucid and the analyst are separate services/processes with no shared Python runtime to import a common helper from. The `TypeError` guard around the `auth_protocol` kwarg exists for older `smbprotocol` versions whose `register_session()` signature predates that parameter.

4. **Why Lucid runs at elevated OS priority (opposite of the analyst).** `main.py` calls `os.nice(-5)` at import time (wrapped in `try/except (AttributeError, PermissionError)` to degrade gracefully when not permitted, e.g. non-root or non-Linux). This is the mirror image of the analyst's `os.nice(10)`. The reasoning is architectural: Lucid does time-sensitive audio I/O (ALSA writes that must keep up with the hardware's playback clock, AirPlay RTSP timing, live ffmpeg transcode pipelines) where a scheduling delay is audible as a glitch/dropout; the analyst does bulk background filesystem/tagging work with no such deadline. Giving Lucid higher scheduling priority and the analyst lower priority lets the two compete for CPU on the same host without the batch job ever starving the realtime one.

5. **Opus bitrate whitelist.** `_OPUS_BITRATES = {"32", "64", "96", "128"}` (default `"96"`) exists purely as a security boundary: the bitrate is interpolated directly into the `ffmpeg` command-line arguments (`-b:a f"{bitrate}k"`). Restricting client input to four known-safe literal strings — falling back silently to the default for anything else, rather than erroring — guarantees a client can never smuggle arbitrary content into the subprocess invocation via this query parameter.

6. **Transcoded streams are not seekable.** Neither `_transcode_opus` nor `_transcode_opus_smb` implement Range support; only the passthrough paths (`FileResponse` for local, `_stream_smb` for SMB) do. A client that needs to seek while playing a `?format=opus` stream must restart the request at the desired position rather than sending a `Range` header, since there is no cheap way to seek into an ffmpeg pipe's output mid-transcode.
