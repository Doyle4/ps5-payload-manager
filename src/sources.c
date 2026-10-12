#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>
#include <errno.h>
#include <pthread.h>

#include "sources.h"
#include "repository.h"
#include "slot.h"
#include "sha256.h"
#include "json_helpers.h"
#include "config.h"
#include "pldmgr.h"
#include "payload_mgr.h"
#include "autoload.h"

/* ── Source entry type ─────────────────────────────────────── */

typedef struct {
    char id[64];
    char name[256];
    char url[1024];
    int  removable;
} SourceEntry;

/* ── Load / Save sources from SOURCES_CONFIG_PATH ──────────── */

static pthread_mutex_t sources_mutex = PTHREAD_MUTEX_INITIALIZER;
typedef struct { SourceEntry *entries; int count; int found; } SourceParse;
static void default_source(SourceEntry *out) {
    memset(out, 0, sizeof(SourceEntry) * MAX_SOURCES);
    snprintf(out[0].id, sizeof(out[0].id), "default");
    snprintf(out[0].name, sizeof(out[0].name), "Official Repository");
    snprintf(out[0].url, sizeof(out[0].url), "%s", REPOSITORY_SOURCE_URL);
}
static int source_item(const char *start, const char *end, void *context) {
    SourceParse *parse = context;
    SourceEntry entry = {.removable = 1};
    if (json_extract_string(start, end, "id", entry.id, sizeof(entry.id)) ||
        json_extract_string(start, end, "name", entry.name, sizeof(entry.name)) ||
        json_extract_string(start, end, "url", entry.url, sizeof(entry.url)) ||
        !entry.id[0] || !entry.name[0] || !entry.url[0]) return -1;
    if (!strcmp(entry.id, "default")) return 0;
    if (parse->count >= MAX_SOURCES) return -1;
    for (int i = 0; i < parse->count; i++)
        if (!strcmp(parse->entries[i].id, entry.id)) return -1;
    parse->entries[parse->count++] = entry;
    return 0;
}
static int source_member(const char *key, const char *start, const char *end, void *context) {
    SourceParse *parse = context;
    if (strcmp(key, "sources")) return 0;
    if (parse->found++) return -1;
    return json_visit_array(start, end, source_item, context);
}
static int parse_sources(const char *json, size_t size, SourceEntry *out, int *out_count) {
    default_source(out);
    SourceParse parse = {.entries=out, .count=1};
    if (json_visit_object(json, json + size, source_member, &parse) || !parse.found) return -1;
    *out_count = parse.count; return 0;
}
static int load_sources(SourceEntry *out, int *out_count) {
    default_source(out); *out_count = 1;
    char *json = NULL; size_t size = 0;
    if (read_file_text(SOURCES_CONFIG_PATH, &json, &size)) return errno == ENOENT ? 0 : -1;
    int result = parse_sources(json, size, out, out_count);
    free(json); return result;
}

static int save_sources(SourceEntry *sources, int count) {
    size_t size = MAX_SOURCES * (6 * sizeof(SourceEntry) + 128) + 64;
    char *buf = malloc(size);
    if (!buf) return -1;
    JsonListBuilder jb = { buf, size, 0, 1, 0 };

    ensure_dir_recursive(BASE_DATA_DIR);

    json_append(&jb, "{\"sources\":[\n");
    for (int i = 0; i < count; i++) {
        char id_e[6 * 128], name_e[6 * 256], url_e[6 * 1024];
        json_escape_checked(&jb, sources[i].id, id_e, sizeof(id_e));
        json_escape_checked(&jb, sources[i].name, name_e, sizeof(name_e));
        json_escape_checked(&jb, sources[i].url, url_e, sizeof(url_e));
        if (json_append(&jb, "  {\"id\":\"%s\",\"name\":\"%s\",\"url\":\"%s\",\"removable\":%s}%s\n",
            id_e, name_e, url_e,
            sources[i].removable ? "true" : "false",
            (i < count - 1) ? "," : "") != 0) {
            break;
        }
    }
    json_append(&jb, "]}\n");

    int result = jb.error ? -1 : write_file_text(SOURCES_CONFIG_PATH, buf, jb.pos);
    free(buf);
    return result;
}

/* ── Public API ────────────────────────────────────────────── */

int sources_list_json(char *buf, size_t size) {
    if (!buf || !size) return -1;
    buf[0] = '\0';
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) return -1;
    int count = 0;
    if (load_sources(sources, &count)) { free(sources); return -1; }

    JsonListBuilder jb = { buf, size, 0, 1, 0 };
    buf[0] = '\0';

    json_append(&jb, "{\"sources\":[\n");
    for (int i = 0; i < count; i++) {
        char id_e[6 * 128], name_e[6 * 256], url_e[6 * 1024];
        json_escape_checked(&jb, sources[i].id, id_e, sizeof(id_e));
        json_escape_checked(&jb, sources[i].name, name_e, sizeof(name_e));
        json_escape_checked(&jb, sources[i].url, url_e, sizeof(url_e));
        if (json_append(&jb, "  {\"id\":\"%s\",\"name\":\"%s\",\"url\":\"%s\",\"removable\":%s}%s\n",
            id_e, name_e, url_e,
            sources[i].removable ? "true" : "false",
            (i < count - 1) ? "," : "") != 0) {
            break;
        }
    }
    json_append(&jb, "]}\n");
    free(sources);
    return jb.error ? -1 : 0;
}

int sources_save(const char *json, size_t len) {
    if (!json || !len) return CONFIG_INVALID;
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) return -1;
    int count = 0;
    if (parse_sources(json, len, sources, &count)) { free(sources); return CONFIG_INVALID; }
    pthread_mutex_lock(&sources_mutex);
    int result = save_sources(sources, count);
    pthread_mutex_unlock(&sources_mutex);
    free(sources); return result;
}

static int merge_source(const char *url, const char *source_name, char *msg_buf, size_t msg_size) {
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        snprintf(msg_buf, msg_size, "Memory allocation failed");
        return -1;
    }
    int src_count = 0;
    if (load_sources(sources, &src_count)) { free(sources); snprintf(msg_buf, msg_size, "Failed to read sources"); return -1; }

    if (src_count >= MAX_SOURCES) {
        free(sources);
        snprintf(msg_buf, msg_size, "Maximum number of sources (%d) reached", MAX_SOURCES);
        return -1;
    }

    for (int i = 0; i < src_count; i++) {
        if (strcmp(sources[i].url, url) == 0) {
            free(sources);
            snprintf(msg_buf, msg_size, "Source already added");
            return -1;
        }
    }

    char new_id[64];
    char hash[16]; slot_source_hash(url, hash, sizeof(hash));
    snprintf(new_id, sizeof(new_id), "source_%s", hash);
    for (int suffix = 1;; suffix++) {
        int found = 0;
        for (int i = 0; i < src_count; i++) if (!strcmp(sources[i].id, new_id)) found = 1;
        if (!found) break;
        snprintf(new_id, sizeof(new_id), "source_%s_%d", hash, suffix);
    }

    strncpy(sources[src_count].id,   new_id,      sizeof(sources[src_count].id) - 1);
    strncpy(sources[src_count].name, source_name, sizeof(sources[src_count].name) - 1);
    strncpy(sources[src_count].url,  url,         sizeof(sources[src_count].url) - 1);
    sources[src_count].removable = 1;
    src_count++;

    if (save_sources(sources, src_count) != 0) {
        free(sources);
        snprintf(msg_buf, msg_size, "Failed to save sources");
        return -1;
    }

    free(sources);
    snprintf(msg_buf, msg_size, "%s", source_name);
    return 0;
}

int sources_add(const char *url, char *msg_buf, size_t msg_size) {
    char tmp_path[512];
    char *json = NULL;
    size_t json_size = 0;
    RepoPayload *items = NULL;
    size_t count = 0;
    char source_name[256] = "";

    if (!url || !url[0]) {
        snprintf(msg_buf, msg_size, "URL is empty");
        return -1;
    }

    ensure_dir_recursive(BASE_DATA_DIR);
    snprintf(tmp_path, sizeof(tmp_path), "%s/.source-XXXXXX", BASE_DATA_DIR);
    int fd = mkstemp(tmp_path);
    if (fd < 0) { snprintf(msg_buf, msg_size, "Failed to create validation file"); return -1; }
    if (close(fd)) { remove(tmp_path); snprintf(msg_buf, msg_size, "Failed to close validation file"); return -1; }
    if (strlen(url) >= sizeof(((SourceEntry *)0)->url)) {
        remove(tmp_path); snprintf(msg_buf, msg_size, "URL is too long"); return -1;
    }

    if (download_to_file_limited(url, tmp_path, PLDMGR_MANIFEST_DOWNLOAD_LIMIT) != 0) {
        snprintf(msg_buf, msg_size, "URL unreachable or download failed");
        remove(tmp_path);
        return -1;
    }

    if (read_file_text(tmp_path, &json, &json_size) != 0 || !json || json_size == 0) {
        snprintf(msg_buf, msg_size, "Failed to read downloaded JSON");
        remove(tmp_path);
        if (json) free(json);
        return -1;
    }
    remove(tmp_path);

    /* Decode the actual top-level name, including escaped Unicode/quotes. */
    json_extract_string_prefix(json, json + json_size, "name", source_name, sizeof(source_name));
    if (!source_name[0]) {
        const char *host = strstr(url, "://");
        host = host ? host + 3 : url;
        size_t pos = 0;
        while (*host && *host != '/' && *host != ':' && pos < sizeof(source_name) - 1)
            source_name[pos++] = *host++;
        source_name[pos] = '\0';
    }

    if (parse_repository_payloads(json, &items, &count) != 0 || count == 0) {
        free(json);
        if (items) free(items);
        snprintf(msg_buf, msg_size, "No valid payloads found in source JSON");
        return -1;
    }
    free(items);
    free(json);

    pthread_mutex_lock(&sources_mutex);
    int result = merge_source(url, source_name, msg_buf, msg_size);
    pthread_mutex_unlock(&sources_mutex);
    return result;
}

static int remove_source(int index, char *msg_buf, size_t msg_size) {
    if (index <= 0) {
        snprintf(msg_buf, msg_size, "Cannot remove the default source");
        return -1;
    }

    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        snprintf(msg_buf, msg_size, "Memory allocation failed");
        return -1;
    }
    int count = 0;
    if (load_sources(sources, &count)) { free(sources); snprintf(msg_buf, msg_size, "Failed to read sources"); return -1; }

    if (index >= count) {
        free(sources);
        snprintf(msg_buf, msg_size, "Invalid source index");
        return -1;
    }

    for (int i = index; i < count - 1; i++) {
        sources[i] = sources[i + 1];
    }
    count--;

    if (save_sources(sources, count) != 0) {
        free(sources);
        snprintf(msg_buf, msg_size, "Failed to save sources");
        return -1;
    }

    free(sources);
    snprintf(msg_buf, msg_size, "OK");
    return 0;
}

int sources_remove(int index, char *msg_buf, size_t msg_size) {
    pthread_mutex_lock(&sources_mutex);
    int result = remove_source(index, msg_buf, msg_size);
    pthread_mutex_unlock(&sources_mutex);
    return result;
}

/* ── Hash-based cache paths ────────────────────────────────── */

static void get_cache_paths(const char *url, char *cache_path, size_t csize,
                            char *ts_path, size_t tsize) {
    char h8[16];
    slot_source_hash(url, h8, sizeof(h8));
    snprintf(cache_path, csize, "%s/repo_cache_%s.json", BASE_DATA_DIR, h8);
    snprintf(ts_path, tsize, "%s/repo_cache_%s.json.ts", BASE_DATA_DIR, h8);
}

int sources_ensure_fresh(const char *url, int force_refresh) {
    if (!url || !url[0]) return -1;

    char cache_path[512], ts_path[512];
    get_cache_paths(url, cache_path, sizeof(cache_path), ts_path, sizeof(ts_path));

    long last_update = 0;
    time_t now = time(NULL);

    ensure_dir_recursive(BASE_DATA_DIR);

    FILE *tf = fopen(ts_path, "r");
    if (tf) {
        fscanf(tf, "%ld", &last_update);
        fclose(tf);
    }

    if (!force_refresh && access(cache_path, F_OK) == 0) {
        long delta = (long)now - last_update;
        if (delta >= 0 && delta < REPOSITORY_REFRESH_INTERVAL_SEC) {
            return 0;
        }
    }

    char tmp_path[512];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp-XXXXXX", cache_path);
    int fd = mkstemp(tmp_path);
    if (fd < 0) return -1;
    if (close(fd)) { remove(tmp_path); return -1; }
    if (download_to_file_limited(url, tmp_path, PLDMGR_MANIFEST_DOWNLOAD_LIMIT) != 0) {
        remove(tmp_path); return -1;
    }

    char *json = NULL;
    size_t json_size = 0;
    if (read_file_text(tmp_path, &json, &json_size) != 0 || !json || json_size == 0) {
        if (json) free(json);
        remove(tmp_path);
        return -1;
    }

    RepoPayload *items = NULL;
    size_t count = 0;
    if (parse_repository_payloads(json, &items, &count) != 0 || count == 0) {
        free(items);
        free(json);
        remove(tmp_path);
        return -1;
    }
    free(items);
    free(json);

    if (rename(tmp_path, cache_path) != 0) {
        remove(tmp_path);
        return -1;
    }

    char timestamp[64];
    int timestamp_size = snprintf(timestamp, sizeof(timestamp), "%ld", (long)now);
    if (timestamp_size < 0 || (size_t)timestamp_size >= sizeof(timestamp) ||
        write_file_text(ts_path, timestamp, (size_t)timestamp_size)) return -1;
    if (!strcmp(url, REPOSITORY_SOURCE_URL) && config_write_last_update((long)now)) return -1;

    return 0;
}

size_t sources_multi_repository_list_json(char *buf, size_t size, int force_refresh) {
    if (!buf || !size) return 0;
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        if (buf && size > 0) buf[0] = '\0';
        return 0;
    }
    int src_count = 0;
    if (load_sources(sources, &src_count)) { free(sources); buf[0] = 0; return 0; }

    /* Single-source mode: if multi_sources is off, only use source 0 */
    PldmgrConfig cfg;
    config_read(&cfg);
    if (!cfg.multi_sources_enabled && src_count > 1) {
        src_count = 1;
    }

    JsonListBuilder jb = { buf, size, 0, 1, 0 };
    buf[0] = '\0';

    json_append(&jb, "{\"sources\":[\n");

    for (int si = 0; si < src_count; si++) {
        int fetch_ok = (sources_ensure_fresh(sources[si].url, force_refresh) == 0);

        char cache_path[512], ts_path[512];
        get_cache_paths(sources[si].url, cache_path, sizeof(cache_path), ts_path, sizeof(ts_path));

        char id_e[6 * 128], name_e[6 * 256], url_e[6 * 1024];
        json_escape_checked(&jb, sources[si].id, id_e, sizeof(id_e));
        json_escape_checked(&jb, sources[si].name, name_e, sizeof(name_e));
        json_escape_checked(&jb, sources[si].url, url_e, sizeof(url_e));

        long last_update = 0;
        FILE *tf = fopen(ts_path, "r");
        if (tf) { fscanf(tf, "%ld", &last_update); fclose(tf); }

        if (json_append(&jb, "  {\"id\":\"%s\",\"name\":\"%s\",\"url\":\"%s\",\"last_update\":%ld,\"error\":%s,\"payloads\":[\n",
            id_e, name_e, url_e, last_update, fetch_ok ? "false" : "true") != 0) {
            break;
        }

        if (fetch_ok) {
            char *cached = NULL;
            size_t cached_size = 0;
            RepoPayload *items = NULL;
            size_t count = 0;

            if (read_file_text(cache_path, &cached, &cached_size) != 0 || !cached) {
                free(cached); free(sources);
                json_builder_fail(&jb);
                return 0;
            }
            int parsed = parse_repository_payloads(cached, &items, &count);
            free(cached);
            if (parsed != 0) {
                free(items); free(sources);
                json_builder_fail(&jb);
                return 0;
            }

            size_t icon_capacity = 6 * sizeof(items[0].icon);
            char *icon_e = (char *)malloc(icon_capacity);
            if (!icon_e) {
                if (items) free(items);
                free(sources);
                json_builder_fail(&jb);
                return 0;
            }

            int first_payload = 1;
            for (size_t pi = 0; pi < count; pi++) {
                if (is_pldmgr_name(items[pi].id) ||
                    is_pldmgr_name(items[pi].filename) ||
                    is_pldmgr_name(items[pi].name)) {
                    continue;
                }

                char id_pe[6 * 128], name_pe[6 * 256], filename_e[6 * 256], desc_e[6 * 1024];
                char ver_e[6 * 64], url_e[6 * 1024], src_id_e[6 * 128], src_name_e[6 * 256];
                char last_upd_e[6 * 64], cat_e[6 * 128], csum_e[6 * 65];
                char auth_e[6 * 128], det_url_e[6 * 1024], rn_e[6 * 2048];
                char src_pe[6 * 1024], sd_pe[6 * 1024];

                json_escape_checked(&jb, items[pi].id, id_pe, sizeof(id_pe));
                json_escape_checked(&jb, items[pi].name, name_pe, sizeof(name_pe));
                json_escape_checked(&jb, items[pi].filename, filename_e, sizeof(filename_e));
                json_escape_checked(&jb, items[pi].description, desc_e, sizeof(desc_e));
                json_escape_checked(&jb, items[pi].version, ver_e, sizeof(ver_e));
                json_escape_checked(&jb, items[pi].url, url_e, sizeof(url_e));
                json_escape_checked(&jb, items[pi].source, src_pe, sizeof(src_pe));
                json_escape_checked(&jb, items[pi].source_direct, sd_pe, sizeof(sd_pe));
                json_escape_checked(&jb, items[pi].checksum, csum_e, sizeof(csum_e));
                json_escape_checked(&jb, items[pi].last_update, last_upd_e, sizeof(last_upd_e));
                json_escape_checked(&jb, items[pi].category, cat_e, sizeof(cat_e));
                json_escape_checked(&jb, sources[si].id, src_id_e, sizeof(src_id_e));
                json_escape_checked(&jb, sources[si].name, src_name_e, sizeof(src_name_e));
                json_escape_checked(&jb, items[pi].author, auth_e, sizeof(auth_e));
                json_escape_checked(&jb, items[pi].details_url, det_url_e, sizeof(det_url_e));
                json_escape_checked(&jb, items[pi].release_notes, rn_e, sizeof(rn_e));
                json_escape_checked(&jb, items[pi].icon, icon_e, icon_capacity);

                if (json_append(&jb, "%s    {\"id\":\"%s\",\"name\":\"%s\",\"filename\":\"%s\",\"description\":\"%s\","
                    "\"version\":\"%s\",\"checksum\":\"%s\",\"last_update\":\"%s\",\"url\":\"%s\","
                    "\"source\":\"%s\",\"source_direct\":\"%s\","
                    "\"source_id\":\"%s\",\"source_name\":\"%s\",\"category\":\"%s\","
                    "\"author\":\"%s\",\"details_url\":\"%s\",\"release_notes\":\"%s\",\"icon\":\"%s\"}",
                    first_payload ? "" : ",\n",
                    id_pe, name_pe, filename_e, desc_e, ver_e, csum_e, last_upd_e, url_e,
                    src_pe, sd_pe,
                    src_id_e, src_name_e, cat_e, auth_e, det_url_e, rn_e, icon_e) != 0) {
                    break;
                }
                first_payload = 0;
            }
            if (!first_payload) {
                json_append(&jb, "\n");
            }

            free(icon_e);
            if (items) free(items);
        }

        if (json_append(&jb, "  ]}%s\n", (si < src_count - 1) ? "," : "") != 0) {
            break;
        }
    }

    json_append(&jb, "]}\n");
    free(sources);
    return jb.pos;
}

int sources_repo_install(const char *source_url, const char *id,
                         const char *mode, const char *replace_slot,
                         char *out_json, size_t out_size) {
    JsonListBuilder jb = { out_json, out_size, 0, 1, 0 };
    if (!slot_mode_valid(mode)) {
        json_append(&jb, "{\"ok\":false,\"message\":\"Invalid storage mode\"}"); return -1;
    }
    char safe_id[128];
    slot_slug(id, safe_id, sizeof(safe_id));
    if (safe_id[0] == '\0') {
        json_append(&jb, "{\"ok\":false,\"message\":\"Missing payload id\"}");
        return -1;
    }
    if (is_pldmgr_name(safe_id)) {
        json_append(&jb,
                 "{\"ok\":false,\"message\":\"Payload Manager cannot be installed as a payload\"}");
        return -1;
    }

    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        json_append(&jb, "{\"ok\":false,\"message\":\"Memory error\"}");
        return -1;
    }
    int src_count = 0;
    if (load_sources(sources, &src_count)) { free(sources); json_append(&jb, "{\"ok\":false,\"message\":\"Failed to read sources\"}"); return -1; }

    /* Match source */
    SourceEntry src;
    memset(&src, 0, sizeof(src));
    if (source_url && source_url[0]) {
        int found = 0;
        char h_req[16];
        slot_source_hash(source_url, h_req, sizeof(h_req));
        for (int i = 0; i < src_count; i++) {
            if (strcmp(sources[i].url, source_url) == 0 || strcmp(sources[i].id, source_url) == 0) {
                src = sources[i];
                found = 1;
                break;
            }
            char h_src[16];
            slot_source_hash(sources[i].url, h_src, sizeof(h_src));
            if (strcmp(h_req, h_src) == 0) {
                src = sources[i];
                found = 1;
                break;
            }
        }
        if (!found) {
            strncpy(src.id, "custom", sizeof(src.id) - 1);
            strncpy(src.name, "Custom Repository", sizeof(src.name) - 1);
            strncpy(src.url, source_url, sizeof(src.url) - 1);
        }
    } else {
        src = sources[0];
    }
    free(sources);

    char h8[16];
    slot_source_hash(src.url, h8, sizeof(h8));

    char target_slot[128];
    slot_repo_key(safe_id, src.url, target_slot, sizeof(target_slot));

    /* Conflict check if mode not specified */
    int is_mode_replace = (mode && strcmp(mode, "replace") == 0);
    int is_mode_keep_both = (mode && strcmp(mode, "keep_both") == 0);

    if (!is_mode_replace && !is_mode_keep_both) {
        SlotMeta *existing_slots = NULL;
        size_t existing_count = 0;
        if (slot_list_all(&existing_slots, &existing_count) != 0) {
            json_append(&jb, "{\"ok\":false,\"message\":\"Failed to scan installed slots\"}");
            return -1;
        }
        if (existing_slots) {
            for (size_t i = 0; i < existing_count; i++) {
                if (strcmp(existing_slots[i].kind, SLOT_KIND_REPO) == 0 &&
                    strcmp(existing_slots[i].id, safe_id) == 0 &&
                    strcmp(existing_slots[i].slot_key, target_slot) != 0) {
                    char existing_hash[16];
                    slot_source_hash(existing_slots[i].source_url, existing_hash, sizeof(existing_hash));
                    if (!strcmp(existing_hash, h8)) continue;
                    /* Conflict found with another source! */
                    char c_slot[6 * 128], c_name[6 * 256], c_ver[6 * 64];
                    json_escape_checked(&jb, existing_slots[i].slot_key, c_slot, sizeof(c_slot));
                    json_escape_checked(&jb, existing_slots[i].source_name, c_name, sizeof(c_name));
                    json_escape_checked(&jb, existing_slots[i].version, c_ver, sizeof(c_ver));

                    json_append(&jb,
                             "{\"ok\":false,\"conflict\":{\"slot\":\"%s\",\"source_name\":\"%s\",\"version\":\"%s\"}}",
                             c_slot, c_name, c_ver);
                    slot_free_all(existing_slots);
                    return jb.error ? -1 : 0; /* Handled conflict, return 200 JSON with conflict object */
                }
            }
            slot_free_all(existing_slots);
        }
    }

    /* Load cached repository */
    char cache_path[512], ts_path[512];
    get_cache_paths(src.url, cache_path, sizeof(cache_path), ts_path, sizeof(ts_path));

    RepoPayload *items = NULL;
    size_t count = 0;
    int refreshed = 0;

    char *cached = NULL;
    size_t csize = 0;
    if (read_file_text(cache_path, &cached, &csize) == 0 && cached) {
        int parsed = parse_repository_payloads(cached, &items, &count);
        free(cached);
        if (parsed != 0) {
            json_append(&jb, "{\"ok\":false,\"message\":\"Failed to parse repository\"}");
            return -1;
        }
    }

    int found_idx = -1;
    for (size_t i = 0; i < count; i++) {
        if (strcmp(items[i].id, safe_id) == 0) {
            found_idx = (int)i;
            break;
        }
    }

    if (found_idx < 0) {
        /* Missing from cache, force refresh */
        if (items) free(items);
        items = NULL;
        count = 0;
        sources_ensure_fresh(src.url, 1);
        refreshed = 1;

        if (read_file_text(cache_path, &cached, &csize) == 0 && cached) {
            int parsed = parse_repository_payloads(cached, &items, &count);
            free(cached);
            if (parsed != 0) {
                json_append(&jb, "{\"ok\":false,\"message\":\"Failed to parse repository\"}");
                return -1;
            }
            for (size_t i = 0; i < count; i++) {
                if (strcmp(items[i].id, safe_id) == 0) {
                    found_idx = (int)i;
                    break;
                }
            }
        }
    }

    if (found_idx < 0) {
        if (items) free(items);
        json_append(&jb, "{\"ok\":false,\"message\":\"Payload no longer in repository\"}");
        return -1;
    }

    RepoPayload *entry = (RepoPayload *)calloc(1, sizeof(RepoPayload));
    if (!entry) {
        if (items) free(items);
        json_append(&jb, "{\"ok\":false,\"message\":\"Out of memory\"}");
        return -1;
    }
    *entry = items[found_idx];
    free(items);
    items = NULL;

    /* Block installing pldmgr as a payload */
    if (is_pldmgr_name(safe_id) || is_pldmgr_name(entry->id) ||
        is_pldmgr_name(entry->filename) || is_pldmgr_name(entry->name)) {
        free(entry);
        json_append(&jb,
                 "{\"ok\":false,\"message\":\"Payload Manager cannot be installed as a payload\"}");
        return -1;
    }

    /* Validate filename */
    if (entry->filename[0] == '\0' || strstr(entry->filename, "/") || strstr(entry->filename, "..")) {
        free(entry);
        json_append(&jb, "{\"ok\":false,\"message\":\"Invalid payload filename in repository\"}");
        return -1;
    }
    const char *ext = strrchr(entry->filename, '.');
    if (!ext || (strcasecmp(ext, ".elf") != 0 && strcasecmp(ext, ".bin") != 0)) {
        free(entry);
        json_append(&jb, "{\"ok\":false,\"message\":\"Unsupported file extension in repository\"}");
        return -1;
    }

    /* Download into a unique private file, never an installed slot. */
    if (ensure_dir_recursive(PAYLOADS_STORAGE_DIR)) {
        free(entry);
        json_append(&jb, "{\"ok\":false,\"message\":\"Failed to create storage directory\"}"); return -1;
    }
    char part_path[768];
    snprintf(part_path, sizeof(part_path), "%s/.download-XXXXXX", PAYLOADS_STORAGE_DIR);
    int part_fd = mkstemp(part_path);
    if (part_fd < 0) {
        free(entry); json_append(&jb, "{\"ok\":false,\"message\":\"Failed to stage download\"}"); return -1;
    }
    if (close(part_fd)) {
        remove(part_path); free(entry);
        json_append(&jb, "{\"ok\":false,\"message\":\"Failed to close staging file\"}"); return -1;
    }

    /* At most two attempts. Every entry, including a refreshed replacement,
     * is validated before downloading and verifies its own supplied checksum. */
    int installed_bytes_verified = 0;
    for (int attempt = 0; attempt < 2; attempt++) {
        if (repository_entry_valid(entry) && download_to_file(entry->url, part_path) == 0) {
            char calc[65];
            if (!entry->checksum[0] ||
                (!compute_sha256_file(part_path, calc) && !strcasecmp(calc, entry->checksum))) {
                installed_bytes_verified = 1; break;
            }
        }
        if (refreshed || attempt == 1 || sources_ensure_fresh(src.url, 1)) break;
        refreshed = 1;
        cached = NULL; items = NULL; count = 0;
        int ref_found = 0;
        if (!read_file_text(cache_path, &cached, &csize) && cached &&
            !parse_repository_payloads(cached, &items, &count)) {
            for (size_t i = 0; i < count; i++) {
                if (!strcmp(items[i].id, safe_id)) { *entry = items[i]; ref_found = 1; break; }
            }
        }
        free(cached); free(items); cached = NULL; items = NULL;
        if (!ref_found) break;
    }
    if (!installed_bytes_verified) {
        free(entry); remove(part_path);
        json_append(&jb, "{\"ok\":false,\"message\":\"Download or integrity verification failed\"}"); return -1;
    }

    /* Write meta.json */
    SlotMeta *meta = (SlotMeta *)calloc(1, sizeof(SlotMeta));
    if (!meta) {
        free(entry); remove(part_path);
        json_append(&jb, "{\"ok\":false,\"message\":\"Out of memory\"}");
        return -1;
    }
    meta->schema = PAYLOAD_SLOT_SCHEMA;
    strcpy(meta->kind, SLOT_KIND_REPO);
    strncpy(meta->slot_key, target_slot, sizeof(meta->slot_key) - 1);
    strncpy(meta->filename, entry->filename, sizeof(meta->filename) - 1);

    time_t now = time(NULL);
    struct tm tmv;
    localtime_r(&now, &tmv);
    strftime(meta->installed_at, sizeof(meta->installed_at), "%Y-%m-%dT%H:%M:%S%z", &tmv);

    strncpy(meta->id, safe_id, sizeof(meta->id) - 1);
    strncpy(meta->source_url, src.url, sizeof(meta->source_url) - 1);
    strncpy(meta->source_name, src.name, sizeof(meta->source_name) - 1);
    strncpy(meta->name, entry->name, sizeof(meta->name) - 1);
    strncpy(meta->version, entry->version, sizeof(meta->version) - 1);
    strncpy(meta->checksum, entry->checksum, sizeof(meta->checksum) - 1);
    strncpy(meta->last_update, entry->last_update, sizeof(meta->last_update) - 1);
    strncpy(meta->url, entry->url, sizeof(meta->url) - 1);
    strncpy(meta->source, entry->source, sizeof(meta->source) - 1);
    strncpy(meta->source_direct, entry->source_direct, sizeof(meta->source_direct) - 1);
    strncpy(meta->category, entry->category, sizeof(meta->category) - 1);
    strncpy(meta->description, entry->description, sizeof(meta->description) - 1);
    strncpy(meta->author, entry->author, sizeof(meta->author) - 1);
    strncpy(meta->details_url, entry->details_url, sizeof(meta->details_url) - 1);

    char committed_slot[128];
    /* An omitted mode preserves the established reinstall/update behavior;
     * explicit new is exclusive, and keep_both also works within one source. */
    const char *commit_mode = mode && mode[0] ? mode : "replace";
    int committed = slot_commit_file(target_slot, part_path, commit_mode, meta, !is_mode_replace && !is_mode_keep_both,
                                     committed_slot, sizeof(committed_slot));
    free(meta); remove(part_path);
    if (committed) {
        free(entry);
        json_append(&jb, "{\"ok\":false,\"message\":\"Storage commit failed (conflict or I/O error)\"}"); return -1;
    }
    snprintf(target_slot, sizeof(target_slot), "%s", committed_slot);
    int old_cleanup_failed = 0;
    /* Retire a conflicting source only after the new slot is usable. */
    if (is_mode_replace && replace_slot && replace_slot[0] && strcmp(replace_slot, target_slot)) {
        int autoload_result = pldmgr_autoload_update_config_entry(replace_slot, target_slot);
        int favorites_result = pldmgr_favorites_update_entry(replace_slot, target_slot);
        if (autoload_result || favorites_result || slot_delete(replace_slot)) {
            old_cleanup_failed = 1;
            pldmgr_log("[PLDMGR] New repository slot committed; old slot cleanup incomplete: %s\n", replace_slot);
        }
    }

    char sk_e[6 * 128], id_e[6 * 128], ver_e[6 * 64], fn_e[6 * 256];
    json_escape_checked(&jb, target_slot, sk_e, sizeof(sk_e));
    json_escape_checked(&jb, safe_id, id_e, sizeof(id_e));
    json_escape_checked(&jb, entry->version, ver_e, sizeof(ver_e));
    json_escape_checked(&jb, entry->filename, fn_e, sizeof(fn_e));

    json_append(&jb,
             "{\"ok\":true,\"slot\":\"%s\",\"id\":\"%s\",\"version\":\"%s\",\"filename\":\"%s\",\"refreshed\":%s%s}",
             sk_e, id_e, ver_e, fn_e, refreshed ? "true" : "false",
             old_cleanup_failed ? ",\"warning\":\"New payload installed; previous slot cleanup incomplete\"" : "");

    pldmgr_log("[PLDMGR] Repo install success: slot=%s id=%s ver=%s\n", target_slot, id, entry->version);
    free(entry);
    return jb.error ? -1 : 0;
}
