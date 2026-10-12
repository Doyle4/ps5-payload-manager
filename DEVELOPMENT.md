# Development

This document describes how to build and deploy the **Payload Manager**.

## How to Build

### 1. Build the Frontend
You must build the React UI first. This converts the JSX into the `dist/index.html` file that gets embedded.
```bash
make frontend-build
```

### 2. Build the SDK Docker Image
If you haven't already, build the SDK environment:
```bash
docker build -t ps5-payload-sdk -f Dockerfile.sdk .
```

### 3. Build the ELF
Use the Docker container to compile the Payload Manager. It is recommended to run `make clean` if you updated the frontend.
```bash
docker run --rm -v $(pwd):/src -w /src ps5-payload-sdk make clean all
```

The resulting `pldmgr.elf` will be created in the root directory.

## Automated Deploy

For a quick build & deploy cycle, use the `deploy.sh` script. It will automatically call `/shutdown` on the PS5, run the docker build, and send the new ELF via `socat`.

```bash
./deploy.sh [PS5_IP]
```
(Requires PS5 IP as the first argument).

## Manual Deploy
1. Upload `pldmgr.elf` to your PS5 (e.g., via port 9021).
2. The menu will be available at `http://[PS5_IP]:8084`.

## Automated Verification

The HTTP response suite compiles the actual `src/http_server.c` with stubbed
PS5 services and real libmicrohttpd response objects. It injects response-buffer,
response-creation, CORS-header, queue, reallocation, and file I/O failures, then
sends 10,000 requests through a real loopback HTTP server. It also checks
disconnected/chunked requests, concurrent uploads, and server-stop cleanup in
thread-per-connection mode. ASan (including leak detection) and UBSan
are enabled by default. Test files, storage paths, and binaries are temporary;
the suite does not connect to a console or launch payloads.

On a host with Clang, its sanitizer runtime, Python 3, pkg-config, and
libmicrohttpd/libcurl development files installed:

```bash
make test-host
make test-frontend
```

The container option builds libmicrohttpd **1.0.1**, matching `build_deps.sh`:

```bash
docker build -f tests/Dockerfile -t ps5-payload-manager-tests .
docker run --rm --network=none -v "$(pwd):/src:ro" ps5-payload-manager-tests make test-host
```

The build downloads test dependencies; the test container itself has external
networking disabled. Linux sanitizer support is included in the image. The
optional `--no-sanitize` argument is for hosts without sanitizer support; use
the default sanitizer run for verification.

The JSON encoder suite compiles actual `src/utils.c` and checks its output with
Python's independent JSON and UTF-8 decoders. It covers Unicode, all non-NUL
control bytes, invalid UTF-8 replacement, every small escape/scalar boundary,
truncation status, and guarded destination bounds, with ASan/UBSan enabled.
C strings cannot represent embedded NUL. The decoder rejects decoded NUL in the
requested value, while accepting valid escaped NUL in unrelated fields.

The decoder suite passes exact, non-NUL-terminated buffers to actual
`src/json_helpers.c`; it checks bounds, direct-member selection, all escapes,
UTF-8, surrogate pairs, malformed input, and strict/prefix overflow contracts.
Objects are validated completely with a nesting limit of 64. Strict extraction
clears the result on overflow; descriptions/release notes explicitly opt into
UTF-8-safe prefixes. The backend suite uses real repository, source save/load,
and slot metadata read/write code inside temporary storage. It parses their
results independently with Python. Unused network/PS5 code is discarded at
link time, and no download or payload launch occurs. `make test-host` runs all
eight host suites with sanitizers.

The serializer suite exercises actual history/log/payload/process/repository
output at small and large capacities, sixfold escape expansion, failed format
calls, and metadata/source preservation on serialization failure. Repository
fixtures use fresh temporary caches and a recording download function that
aborts if called. Process records use a host fixture; this checks serialization,
not the PS5 kernel ABI. The existing unused SSE `pos` parameter produces a host
`-Wextra` warning; the native build has no new warnings.

The allocation suite executes actual repository parsing, managed-slot discovery,
cached-source serialization, and all USB discovery branches. It faults every
observed growth/read/path-copy allocation in its current fixtures and verifies
that failure clears results and releases partial collections. USB paths are
redirected to temporary fixtures using `PLDMGR_USB_ROOT_FORMAT`; production
defaults remain `/mnt/usb%d`. No fixture payload is launched.

The storage suite executes real uploads, USB imports, and repository installations
with local recorded download bytes. It checks conflicts, concurrent keys, complete
payload/metadata publication, I/O faults, media changes, and process-interruption
recovery. Storage uses unique staging directories and a journal/backup; startup
recovers interrupted commits before migration or serving requests. Public slot
layout is preserved. File syncing is checked; unsupported directory syncing limits
power-loss durability. Configuration remaps and migration are tested separately.

The integrity suite uses local HTTP/HTTPS servers and generated trusted,
untrusted, expired, and wrong-host certificates. It tests protocol restrictions,
body/size/I/O failures, strict optional checksum policy, refreshed manifest entry
validation, and preservation of installed data on failed retries. The actual
launcher runs against a recorded socket, covering canonical roots, regular files,
self guards, and symlink substitutions during descriptor-based opening. No real
loader is contacted.

API actions now require POST and a matching browser Origin/Referer, or an explicit
`X-PLDMGR-Request: 1` header when both are absent. Foreign origins cannot use that
marker to bypass checks. GET remains available for reads; anonymous/foreign reads
do not activate browser-mode autoload. API CORS/preflights are restricted to the
matching Host. This is browser CSRF protection, not LAN authentication or DNS
rebinding protection.

The frontend uses shared marked request helpers and same-origin unload beacons
with keepalive fallback. The Vite proxy preserves the frontend Host, and the mock
server mirrors action policy. Public mock README/JSON fixtures retain ordinary
cross-origin GET compatibility. The verification workflow also runs actual Chrome
against a native stub server and Vite, checking hostile requests, real pagehide
beacons, and zero rejected-request effects. Run `node tests/run_browser_mutation_tests.mjs` for these checks.

Settings now accept validated partial updates. Saves atomically replace individual
files, preserve unspecified fields/timestamps, and return errors on failed writes.
The UI sends only the fields it edits. Settings/favorites/autoload remaps and
source edits serialize read-modify-write; history reads serialize a snapshot of
the 20 most recent entries. The new `run_config_tests.py` covers actual persistence,
injected I/O failures and concurrent history/settings/source operations.

Run `python3 tests/run_config_tests.py --thread-sanitize` on a host supporting
Clang ThreadSanitizer; local macOS verification passed and CI has a macOS job.
A multi-file settings request validates fully first, publishes lists before scalar
settings, and reports 500 if any publication fails. Earlier completed files stay
published; per-file atomicity does not provide an all-or-nothing transaction.

Autoload now owns one joinable worker and returns a coherent locked snapshot.
Active reset preserves waiting/countdown/execution; terminal reset cannot rerun
it. Abort/stop interrupt delays and loader waits. Sequences are parsed once from
one regular file (4095 bytes, entries up to 511 bytes, delays up to one hour);
status retains that running sequence if the file is edited. Processed counts and
per-entry outcomes distinguish success/failure/skip. Anonymous/foreign status
reads remain passive; an authorized read explicitly signals frontend readiness.

Loader connects time out after five seconds, and full transfers after thirty;
nonblocking/poll loops handle partial sends and cooperative cancellation. A
cancel cannot undo a payload already executed or bytes already sent. The actual
worker, socketpair loader recorder and real HTTP worker fixtures are part of
`make test-host`; `run_autoload_tests.py --thread-sanitize` covers concurrent
status/reset/start paths. The PS-button detector remains the existing headless
per-read implementation.

Startup lookup and process listing now share a bounded, validated sysctl snapshot.
Record sizes must advance within the returned bytes, all consumed fields must
fit, and names must terminate inside their SDK field. A malformed snapshot is
rejected in full before exposing a PID/list. Queries retry ENOMEM up to three
attempts and allocate at most 16 MiB. Failed listings become HTTP 500 through
the existing response-error path. SDK assertions preserve the current PID/RSS/
process-name offsets; offset 447 is `ki_comm`, rather than the startup code's
previously misnamed `ki_tdname`. `python3 tests/run_process_tests.py` runs the
actual listing/lookup with synthetic kernel bytes and sanitizers; `--baseline`
reproduces the previous bounds reads and startup loop from `9ffd392`.

SSE log clients now retain independent sequence cursors and partially delivered
frames. Catch-up and live delivery preserve retained ring order even with a
one-byte callback buffer. Multiline text stays one EventSource message; a named
`gap` event reports overwritten entries and is shown in the log UI. Valid
`Last-Event-ID` resumes after a delivered entry within this daemon's log sequence;
invalid/future IDs replay retained history. The ring holds 100 entries in memory,
and cannot recover overwritten logs or logs from a previous process lifetime.
HTTP restarts retain the ring, but old response contexts terminate on generation
change. Every production MHD stop first wakes blocked SSE callbacks, including
standby/network restart and shutdown. Run `python3 tests/run_log_stream_tests.py`
for decoded/bounded callback tests, `--baseline` to reproduce the previous bugs,
or `--thread-sanitize` for shared-state checks. The actual HTTP/SSE fixture is
`python3 tests/run_http_tests.py --logs-only`. Both are part of CI.

The autoload editor waits for both persisted autoload fields before showing
controls or saving. The initial empty config, failed fetches, and incomplete
responses cannot enable autoload or flush an empty list. Run
`node tests/run_autoload_editor_browser_tests.mjs` with Chrome installed
(`CHROME_BIN` overrides the default path). It tests the real React editor with
controlled delayed responses, reloads, navigation, exit saves and list retention;
CI runs this regression too. `--baseline` reproduces the destructive behavior
using the editor from `bfbe474` without changing workspace files.

Collected arrays are limited to **4,096 items** and **64 MiB** of allocated array
capacity, whichever is smaller for the item type. Repository parsing accepts up
to **16 MiB** of input text. These bounds apply to the parser/scanner collections;
they do not impose download-stream limits or an aggregate daemon memory budget.
Collection failures become explicit errors rather than successful partial lists.

`.github/workflows/verify.yml` runs all host suites, existing frontend tests,
and frontend build without publishing or deploying. Frontend lint still reports existing errors. The host suite tests response
ownership/status handling, request cleanup, and autoload-list bounds. Storage
transactions, autoload worker concurrency, and PS5 firmware behavior remain
separate validation scopes. The main HTTP fixture stubs backend storage/services; the separate
`--config-only` HTTP fixture uses actual config persistence. Successful mock imports move actual files inside temporary fixtures.

The HTTP server accepts config/source bodies up to **1 MiB** and streamed uploads
up to **512 MiB**. Larger declared or accumulated bodies return HTTP 413; empty
request bodies return HTTP 400. Upload staging files use private, unique
`.upload-*` names and are removed by request teardown if uncommitted. This does
not purge older orphan files or guarantee cleanup after power loss/SIGKILL.
Autoload and favorites CSV responses allow 4,095 bytes; larger, unreadable, or
NUL-containing lists return explicit HTTP 500 JSON. Favorites preserve long
lines rather than splitting them into extra CSV entries. JSON builders discard
the complete output after any formatting/escape/capacity error; HTTP converts
serialization failures into complete HTTP 500 JSON.

Response buffer budgets include the terminator: payload/repository lists **4 MiB**,
source lists **512 KiB**, process/history/config **64 KiB**, and logs **154,032
bytes** (enough for the full ring at maximum escape expansion). Metadata uses
64 KiB; source saves allocate a bound derived from `MAX_SOURCES` and field sizes.
These are per-response/serialization budgets; scanner/parser arrays and total
connection concurrency are separate scopes. No unbounded response growth or
automatic repeated scan is introduced.

Native compilation remains a separate gate. To preserve the previous ELF,
build a candidate under `scratch/` rather than run `make clean`:

```bash
mkdir -p scratch
docker run --rm --network=none -v "$(pwd):/src" -w /src \
  ps5-payload-sdk-pldmgr make ELF=scratch/pldmgr-step7.elf
```

This command assumes the SDK image, frontend distribution, and embedded CA
header already exist. For a new checkout, follow the normal build setup first.
The ELF target currently does not track ordinary header dependencies; use a new
candidate filename or force the ELF target to rebuild after header-only edits.
