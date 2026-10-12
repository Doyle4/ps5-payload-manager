#include <assert.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <arpa/inet.h>
#include <microhttpd.h>
#include "http_server.h"

static int serving;
static int fail_malloc, fail_create, fail_queue, fail_cors;
static unsigned int queued_status, cors_count;
static char body[256];
static _Atomic unsigned int created, destroyed;
static struct MHD_Response *outstanding[32];

struct Argument { const char *key; const char *value; };
struct Request {
    const char *url;
    const char *method;
    unsigned int status;
    struct Argument args[4];
};

void *http_test_malloc(size_t size) {
    if (fail_malloc) return NULL;
    return malloc(size);
}

static void remember(struct MHD_Response *response) {
    if (!response) return;
    created++;
    if (!serving) {
        for (size_t i = 0; i < 32; i++) {
            if (!outstanding[i]) { outstanding[i] = response; return; }
        }
        abort();
    }
}

struct MHD_Response *http_test_create_response(size_t size, void *buffer,
                                              enum MHD_ResponseMemoryMode mode) {
    if (fail_create) return NULL; /* MHD leaves the buffer with its caller on failure. */
    struct MHD_Response *response = MHD_create_response_from_buffer(size, buffer, mode);
    remember(response);
    if (!serving && response) {
        size_t n = size < sizeof(body) - 1 ? size : sizeof(body) - 1;
        if (n) memcpy(body, buffer, n);
        body[n] = '\0';
    }
    return response;
}

struct MHD_Response *http_test_create_callback(uint64_t size, size_t block_size,
    MHD_ContentReaderCallback reader, void *cls, MHD_ContentReaderFreeCallback cleanup) {
    if (fail_create) return NULL;
    struct MHD_Response *response = MHD_create_response_from_callback(
        size, block_size, reader, cls, cleanup);
    remember(response);
    return response;
}

static enum MHD_Result count_header(void *cls, enum MHD_ValueKind kind,
                                  const char *key, const char *value) {
    (void)cls; (void)kind;
    if (strcasecmp(key, "Access-Control-Allow-Origin") == 0) {
        assert(strcmp(value, "*") == 0);
        cors_count++;
    }
    return MHD_YES;
}

enum MHD_Result http_test_add_header(struct MHD_Response *response,
                                    const char *name, const char *value) {
    if (fail_cors && strcmp(name, "Access-Control-Allow-Origin") == 0)
        return MHD_NO;
    return MHD_add_response_header(response, name, value);
}

enum MHD_Result http_test_queue(struct MHD_Connection *connection,
                               unsigned int status, struct MHD_Response *response) {
    assert(response); /* A failed response allocation must never be queued. */
    if (serving) return MHD_queue_response(connection, status, response);
    queued_status = status;
    cors_count = 0;
    MHD_get_response_headers(response, count_header, NULL);
    return fail_queue ? MHD_NO : MHD_YES;
}

void http_test_destroy(struct MHD_Response *response) {
    assert(response);
    if (!serving) {
        int found = 0;
        for (size_t i = 0; i < 32; i++) {
            if (outstanding[i] == response) { outstanding[i] = NULL; found = 1; break; }
        }
        assert(found); /* Detect double destruction. */
    }
    destroyed++;
    MHD_destroy_response(response);
}

const char *http_test_lookup(struct MHD_Connection *connection,
                            enum MHD_ValueKind kind, const char *key) {
    if (serving) return MHD_lookup_connection_value(connection, kind, key);
    struct Request *request = (struct Request *)connection;
    for (size_t i = 0; i < 4; i++) {
        if (request->args[i].key && strcmp(request->args[i].key, key) == 0)
            return request->args[i].value;
    }
    return NULL;
}

static int failures, checks;

static void run_request(struct Request request, int oom, int creation_failure, int queue_failure) {
    created = destroyed = 0;
    queued_status = cors_count = 0;
    body[0] = '\0';
    fail_malloc = oom;
    fail_create = creation_failure;
    fail_queue = queue_failure;
    void *context = NULL;
    size_t upload_size = 0;
    enum MHD_Result result = http_on_request(NULL, (struct MHD_Connection *)&request,
        request.url, request.method, "HTTP/1.1", "", &upload_size, &context);
    if (strcmp(request.method, "OPTIONS") != 0 && result == MHD_YES) {
        result = http_on_request(NULL, (struct MHD_Connection *)&request,
            request.url, request.method, "HTTP/1.1", "", &upload_size, &context);
    }
    unsigned int expected_status = oom ? MHD_HTTP_INTERNAL_SERVER_ERROR : request.status;
    int failed = (created != destroyed);
    if (creation_failure || fail_cors || (oom && strcmp(request.url, "/events") == 0)) {
        failed |= result != MHD_NO || queued_status != 0;
    } else {
        failed |= result != (queue_failure ? MHD_NO : MHD_YES);
        failed |= queued_status != expected_status || cors_count != 1;
        if (oom) failed |= strstr(body, "memory") == NULL;
    }
    checks++;
    if (failed) {
        fprintf(stderr, "FAIL %s %s [malloc=%d create=%d queue=%d]: result=%d status=%u cors=%u created=%u released=%u\n",
            request.method, request.url, oom, creation_failure, queue_failure,
            result, queued_status, cors_count, created, destroyed);
        failures++;
    }
    /* Permit running against the original leaking source without exhausting RAM. */
    for (size_t i = 0; i < 32; i++) {
        if (outstanding[i]) { MHD_destroy_response(outstanding[i]); outstanding[i] = NULL; }
    }
    fail_malloc = fail_create = fail_queue = 0;
}

static int unit_tests(int ownership_only, int oom_only) {
    struct Request requests[] = {
        {"/", "OPTIONS", 200, {{0}}},
        {"/", "GET", 200, {{0}}},
        {"/cache.appcache", "GET", 200, {{0}}},
        {"/favicon.svg", "GET", 200, {{0}}},
        {"/icon.png", "GET", 200, {{0}}},
        {"/update_check", "GET", 200, {{0}}},
        {"/manage:check", "GET", 400, {{0}}},
        {"/manage:check", "GET", 400, {{"filename", "../bad.elf"}}},
        {"/manage:check", "GET", 200, {{"filename", "test.elf"}}},
        {"/list_payloads", "GET", 200, {{0}}},
        {"/processes_list", "GET", 200, {{0}}},
        {"/history_list", "GET", 200, {{0}}},
        {"/process_kill", "GET", 400, {{0}}},
        {"/process_kill", "GET", 200, {{"pid", "123"}}},
        {"/process_kill", "GET", 500, {{"pid", "-1"}}},
        {"/repository_payloads", "GET", 200, {{0}}},
        {"/repository_refresh", "GET", 200, {{0}}},
        {"/repository_install", "GET", 400, {{0}}},
        {"/repository_install", "GET", 200, {{"id", "test"}}},
        {"/repository_install", "GET", 200, {{"filename", "test.elf"}}},
        {"/sources_list", "GET", 200, {{0}}},
        {"/sources_add", "GET", 400, {{0}}},
        {"/sources_add", "GET", 200, {{"url", "http://example.test/repo.json"}}},
        {"/sources_remove", "GET", 400, {{0}}},
        {"/sources_remove", "GET", 200, {{"index", "1"}}},
        {"/usb_move_check", "GET", 400, {{0}}},
        {"/usb_move_check", "GET", 200, {{"path", "/mnt/usb0/test.elf"}}},
        {"/usb_move_perform", "GET", 400, {{0}}},
        {"/usb_move_perform", "GET", 200, {{"path", "/mnt/usb0/test.elf"}}},
        {"/loadpayload:missing.elf", "GET", 400, {{0}}},
        {"/loadpayload:pldmgr.elf", "GET", 400, {{0}}},
        {"/manage:delete", "GET", 400, {{0}}},
        {"/manage:delete", "GET", 200, {{"slot", "local/test"}}},
        {"/log", "GET", 200, {{0}}},
        {"/version", "GET", 200, {{0}}},
        {"/getip", "GET", 200, {{0}}},
        {"/autoload_status", "GET", 200, {{0}}},
        {"/autoload_clear", "GET", 200, {{0}}},
        {"/abort", "GET", 200, {{0}}},
        {"/get_config", "GET", 200, {{0}}},
        {"/events", "GET", 200, {{0}}},
        {"/set_config", "POST", 200, {{0}}},
        {"/sources_set", "POST", 500, {{0}}},
        {"/manage:upload", "POST", 500, {{0}}},
        {"/shutdown", "GET", 200, {{0}}},
    };
    for (size_t i = 0; i < sizeof(requests) / sizeof(requests[0]); i++) {
        if (oom_only) break;
        run_request(requests[i], 0, 0, 0);
        run_request(requests[i], 0, 0, 1);
        if (!ownership_only) {
            run_request(requests[i], 0, 1, 0);
            fail_cors = 1;
            run_request(requests[i], 0, 0, 0);
            fail_cors = 0;
        }
    }
    if (!ownership_only) {
        struct Request allocated[] = {
            {"/manage:check", "GET", 200, {{"filename", "test.elf"}}},
            {"/list_payloads", "GET", 200, {{0}}},
            {"/processes_list", "GET", 200, {{0}}},
            {"/history_list", "GET", 200, {{0}}},
            {"/repository_payloads", "GET", 200, {{0}}},
            {"/repository_refresh", "GET", 200, {{0}}},
            {"/repository_install", "GET", 200, {{"id", "test"}}},
            {"/sources_list", "GET", 200, {{0}}},
            {"/usb_move_check", "GET", 200, {{"path", "test"}}},
            {"/usb_move_perform", "GET", 200, {{"path", "test"}}},
            {"/log", "GET", 200, {{0}}},
            {"/autoload_status", "GET", 200, {{0}}},
            {"/get_config", "GET", 200, {{0}}},
            {"/events", "GET", 200, {{0}}},
        };
        for (size_t i = 0; i < sizeof(allocated) / sizeof(allocated[0]); i++) {
            if (oom_only && strcmp(allocated[i].url, "/events") == 0) continue;
            run_request(allocated[i], 1, 0, 0);
            if (!oom_only) run_request(allocated[i], 1, 1, 0);
        }
    }
    printf("HTTP response tests: %d checks, %d failures (libmicrohttpd %s)\n",
           checks, failures, MHD_get_version());
    return failures ? 1 : 0;
}

static int serve(void) {
    serving = 1;
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    struct MHD_Daemon *daemon = MHD_start_daemon(MHD_USE_INTERNAL_POLLING_THREAD,
        0, NULL, NULL, http_on_request, NULL,
        MHD_OPTION_SOCK_ADDR, &address, MHD_OPTION_END);
    if (!daemon) return 1;
    const union MHD_DaemonInfo *info = MHD_get_daemon_info(daemon, MHD_DAEMON_INFO_BIND_PORT);
    printf("PORT %u\n", info->port);
    fflush(stdout);
    (void)getchar();
    MHD_stop_daemon(daemon);
    printf("Application response references: created=%u released=%u\n", created, destroyed);
    return created == destroyed ? 0 : 1;
}

int main(int argc, char **argv) {
    if (argc > 1 && strcmp(argv[1], "--serve") == 0) return serve();
    return unit_tests(argc > 1 && strcmp(argv[1], "--ownership-only") == 0,
                      argc > 1 && strcmp(argv[1], "--oom-only") == 0);
}
