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
response-creation, CORS-header, and queue failures, then sends 10,000 requests
through a real loopback HTTP server. ASan (including leak detection) and UBSan
are enabled by default. Test files, storage paths, and binaries are temporary;
the suite does not connect to a console or launch payloads.

On a host with Clang, its sanitizer runtime, Python 3, pkg-config, and
libmicrohttpd development files installed:

```bash
make test-host
make test-frontend
```

The container option builds libmicrohttpd **1.0.1**, matching `build_deps.sh`:

```bash
docker build -f tests/Dockerfile -t ps5-payload-manager-tests .
docker run --rm --network=none -v "$(pwd):/src:ro" ps5-payload-manager-tests
```

The build downloads test dependencies; the test container itself has external
networking disabled. Linux sanitizer support is included in the image. The
optional `--no-sanitize` argument is for hosts without sanitizer support; use
the default sanitizer run for verification.

`.github/workflows/verify.yml` runs the HTTP suite, existing frontend tests,
and frontend build without publishing or deploying. Frontend lint still reports existing errors. The host suite tests response
ownership/status handling; it does not yet cover aborted request cleanup,
storage transactions, autoload concurrency, or PS5 firmware behavior.

Native compilation remains a separate gate. To preserve the previous ELF,
build a candidate under `scratch/` rather than run `make clean`:

```bash
mkdir -p scratch
docker run --rm --network=none -v "$(pwd):/src" -w /src \
  ps5-payload-sdk-pldmgr make ELF=scratch/pldmgr-candidate.elf
```

This command assumes the SDK image, frontend distribution, and embedded CA
header already exist. For a new checkout, follow the normal build setup first.
The ELF target currently does not track ordinary header dependencies; use a new
candidate filename or force the ELF target to rebuild after header-only edits.
