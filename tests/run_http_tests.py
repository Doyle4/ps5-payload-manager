#!/usr/bin/env python3
"""Compile the real HTTP handler with fault hooks and stubbed PS5 services.

All artifacts and storage fixtures live in a temporary directory. The network
soak uses real libmicrohttpd over loopback; no console or external service runs.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(args):
    subprocess.run(args, cwd=ROOT, check=True)


def network_tests(binary):
    server = subprocess.Popen([str(binary), "--serve"], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True)
    try:
        line = server.stdout.readline().strip()
        if not line.startswith("PORT "):
            raise RuntimeError(f"Test HTTP server did not start: {line}")
        connection = http.client.HTTPConnection("127.0.0.1", int(line.split()[1]), timeout=10)
        routes = ["/manage:check?filename=test.elf", "/history_list", "/update_check",
                  "/repository_payloads", "/sources_list", "/get_config", "/autoload_status"]
        try:
            for i in range(10000):
                connection.request("GET", routes[i % len(routes)])
                response = connection.getresponse()
                data = response.read()
                assert response.status == 200, (response.status, data)
                origins = [value for key, value in response.getheaders()
                           if key.lower() == "access-control-allow-origin"]
                assert origins == ["*"], origins
                json.loads(data)
        finally:
            connection.close()
        server.stdin.write("\n")
        server.stdin.flush()
        output = server.communicate(timeout=15)[0]
        print(output.strip())
        assert server.returncode == 0, "Unreleased responses or sanitizer failure during soak"
        print("HTTP integration: 10,000 real loopback requests passed")
    finally:
        if server.poll() is None:
            server.kill()
            server.communicate()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ownership-only", action="store_true",
                        help="Run basic ownership tests against the original source")
    parser.add_argument("--oom-only", action="store_true",
                        help="Reproduce OOM status/header bugs without deeper failure injection")
    parser.add_argument("--no-sanitize", action="store_true")
    parser.add_argument("--source", default="src/http_server.c",
                        help="Alternate HTTP source snapshot for regression reproduction")
    args = parser.parse_args()
    os.environ.setdefault("ASAN_OPTIONS", "detect_leaks=1:halt_on_error=1")
    os.environ.setdefault("UBSAN_OPTIONS", "halt_on_error=1:print_stacktrace=1")
    try:
        flags = shlex.split(subprocess.check_output(
            ["pkg-config", "--cflags", "--libs", "libmicrohttpd"], text=True))
    except (FileNotFoundError, subprocess.CalledProcessError):
        raise SystemExit("Install libmicrohttpd-dev and pkg-config, or use tests/Dockerfile.")
    compiler = shlex.split(os.environ.get("HOST_CC", "clang"))
    with tempfile.TemporaryDirectory(prefix="pldmgr-http-tests-") as temp:
        build = Path(temp)
        storage = build / "data"
        storage.mkdir()
        # Test-only header overlay: production path defaults never point here.
        header = (ROOT / "include/pldmgr.h").read_text().replace("/data/pldmgr", str(storage))
        (build / "pldmgr.h").write_text(header)
        for name, data in [("index_html", "<html>Test</html>"),
                           ("cache_appcache", "CACHE MANIFEST\n"),
                           ("favicon_svg", "<svg/>"), ("icon_png", "PNG")]:
            values = ",".join(str(byte) for byte in data.encode())
            (build / f"assets_{name}.h").write_text(
                f"static const unsigned char assets_{name}[] = {{{values}}};\n"
                f"static const unsigned int assets_{name}_len = sizeof(assets_{name});\n")
        common = compiler + ["-std=c11", "-D_DEFAULT_SOURCE", "-g", "-O1", "-Wall", "-Wextra",
                             "-I" + str(build), "-Iinclude", "-pthread"]
        if not args.no_sanitize:
            common += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
        cflags = [flag for flag in flags if flag.startswith("-I") or flag.startswith("-D")]
        object_file = build / "http_server.o"
        run(common + cflags + ["-include", "tests/http_test_hooks.h", "-c",
                               args.source, "-o", str(object_file)])
        binary = build / "http_tests"
        run(common + cflags + [str(object_file), "src/utils.c", "tests/http_backend_stubs.c",
                               "tests/http_responses_test.c", "-o", str(binary)] + flags)
        selected = ["--ownership-only"] if args.ownership_only else (["--oom-only"] if args.oom_only else [])
        run([str(binary)] + selected)
        if not selected:
            network_tests(binary)


if __name__ == "__main__":
    main()
