/* Hardware/services are replaced; routing and response ownership are real. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "pldmgr.h"
#include "config.h"
#include "payload_mgr.h"
#include "repository.h"
#include "sources.h"
#include "history_mgr.h"
#include "process_mgr.h"
#include "ps5_launcher.h"
#include "slot.h"
#include "log_server.h"

static size_t json(char *out, size_t size, const char *value) {
    int n = snprintf(out, size, "%s", value);
    return n < 0 ? 0 : (size_t)n;
}

unsigned int test_config_saves, test_source_saves, test_imports;
size_t test_post_size;

void pldmgr_log(const char *fmt, ...) { (void)fmt; }
void log_server_set_active(void) {}
void config_read(PldmgrConfig *cfg) { memset(cfg, 0, sizeof(*cfg)); cfg->autoload_delay = 5; }
int config_read_bool(const char *key, int fallback) { (void)key; return fallback; }
int config_handle_set_json(const char *data) {
    test_config_saves++;
    test_post_size = strlen(data);
    return strcmp(data, "fail_test") == 0 ? -1 : 0;
}
int config_get_favorites_csv(char *out, size_t size, int *exists) {
    if (size) out[0] = '\0';
    *exists = 0;
    return 0;
}
void pldmgr_autoload_get_status(int *total, int *done, char *current) {
    *total = 0; *done = 0; current[0] = '\0';
}
int pldmgr_autoload_get_remaining_seconds(void) { return -1; }
long long pldmgr_autoload_get_remaining_ms(void) { return -1000; }
void pldmgr_autoload_reset(void) {}
void pldmgr_autoload_abort(void) {}
int slot_resolve(const char *key, char *out, size_t size) {
    (void)key; (void)out; (void)size; return -1;
}
int slot_local_key(const char *name, char *out, size_t size) {
    snprintf(out, size, "%s", name); return 0;
}
int ps5_launch_elf(const char *path) { (void)path; abort(); }
int payload_mgr_delete_payload(const char *key) { (void)key; return 0; }
int payload_mgr_import_to_storage_mode(const char *filename, const char *path,
    const char *mode, const char *origin, const char *detail,
    char *msg, size_t msg_size, char *slot, size_t slot_size) {
    (void)filename; (void)path; (void)mode; (void)origin; (void)detail;
    snprintf(msg, msg_size, "Test import"); snprintf(slot, slot_size, "local/test");
    test_imports++;
    if (mode && strcmp(mode, "fail_test") == 0) return -1;
    char destination[1024];
    snprintf(destination, sizeof(destination), "%s/%s", PAYLOADS_STORAGE_DIR, filename);
    return rename(path, destination);
}
int payload_mgr_check_existing(const char *filename, char *out, size_t size) {
    (void)filename; json(out, size, "{\"status\":\"ready\"}"); return 0;
}
int payload_mgr_usb_check(const char *path, char *out, size_t size) {
    (void)path; json(out, size, "{\"status\":\"ready\"}"); return 0;
}
int payload_mgr_usb_move(const char *path, const char *mode, int keep, char *out, size_t size) {
    (void)path; (void)mode; (void)keep; json(out, size, "{\"ok\":true}"); return 0;
}
size_t payload_mgr_list_json(char *out, size_t size) { return json(out, size, "{\"items\":[]}"); }
size_t process_list_json(char *out, size_t size) { return json(out, size, "{\"processes\":[]}"); }
int process_kill(int pid) { return pid == 123 ? 0 : -1; }
size_t history_mgr_to_json(char *out, size_t size) { return json(out, size, "{\"history\":[]}"); }
size_t repository_list_json(char *out, size_t size, int refresh) {
    (void)refresh; return json(out, size, "{\"payloads\":[]}");
}
size_t sources_multi_repository_list_json(char *out, size_t size, int refresh) {
    return repository_list_json(out, size, refresh);
}
int sources_repo_install(const char *url, const char *id, const char *mode,
                        const char *replace, char *out, size_t size) {
    (void)url; (void)id; (void)mode; (void)replace; json(out, size, "{\"ok\":true}"); return 0;
}
int sources_list_json(char *out, size_t size) { json(out, size, "{\"sources\":[]}"); return 0; }
int sources_save(const char *data, size_t size) {
    test_source_saves++;
    test_post_size = size;
    return strcmp(data, "fail_test") == 0 ? -1 : 0;
}
int sources_add(const char *url, char *msg, size_t size) {
    (void)url; snprintf(msg, size, "Test source"); return 0;
}
int sources_remove(int index, char *msg, size_t size) {
    (void)index; snprintf(msg, size, "Removed"); return 0;
}
size_t log_build_json(char *out, size_t size) { return json(out, size, "{\"logs\":[]}"); }
ssize_t log_stream_callback(void *cls, uint64_t pos, char *out, size_t max) {
    (void)cls; (void)pos; (void)out; (void)max; return MHD_CONTENT_READER_END_OF_STREAM;
}
void log_stream_cleanup(void *cls) { free(cls); }
