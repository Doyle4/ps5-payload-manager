#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>

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

static int load_sources(SourceEntry *out, int *out_count) {
    char *json = NULL;
    size_t size = 0;
    int count = 0;

    memset(out, 0, sizeof(SourceEntry) * MAX_SOURCES);

    /* Always start with the default source at index 0 */
    strncpy(out[0].id,   "default",             sizeof(out[0].id) - 1);
    strncpy(out[0].name, "Official Repository", sizeof(out[0].name) - 1);
    strncpy(out[0].url,  REPOSITORY_SOURCE_URL, sizeof(out[0].url) - 1);
    out[0].removable = 0;
    count = 1;

    if (read_file_text(SOURCES_CONFIG_PATH, &json, &size) != 0 || !json || size == 0) {
        if (json) free(json);
        *out_count = count;
        return 0;
    }

    const char *arr_start = strstr(json, "\"sources\"");
    if (!arr_start) { free(json); *out_count = count; return 0; }

    arr_start = strchr(arr_start, '[');
    if (!arr_start) { free(json); *out_count = count; return 0; }

    const char *p = arr_start + 1;
    while (count < MAX_SOURCES && (p = strchr(p, '{')) != NULL) {
        const char *end = strchr(p, '}');
        if (!end) break;

        char id[64] = "", name[256] = "", url[1024] = "";
        char removable_str[8] = "";

        json_extract_string(p, end, "id",   id,   sizeof(id));
        json_extract_string(p, end, "name", name, sizeof(name));
        json_extract_string(p, end, "url",  url,  sizeof(url));
        json_extract_string(p, end, "removable", removable_str, sizeof(removable_str));

        if (strcmp(id, "default") == 0) { p = end + 1; continue; }

        if (name[0] && url[0] && id[0]) {
            strncpy(out[count].id,   id,   sizeof(out[count].id) - 1);
            strncpy(out[count].name, name, sizeof(out[count].name) - 1);
            strncpy(out[count].url,  url,  sizeof(out[count].url) - 1);
            out[count].removable = (strcmp(removable_str, "false") != 0);
            count++;
        }
        p = end + 1;
    }

    free(json);
    *out_count = count;
    return 0;
}

static int save_sources(SourceEntry *sources, int count) {
    char buf[16384];
    JsonListBuilder jb = { buf, sizeof(buf), 0, 1 };

    ensure_dir_recursive(BASE_DATA_DIR);

    json_append(&jb, "{\"sources\":[\n");
    for (int i = 0; i < count; i++) {
        char id_e[128], name_e[512], url_e[2048];
        pldmgr_json_escape(sources[i].id,   id_e,   sizeof(id_e));
        pldmgr_json_escape(sources[i].name, name_e, sizeof(name_e));
        pldmgr_json_escape(sources[i].url,  url_e,  sizeof(url_e));
        if (json_append(&jb, "  {\"id\":\"%s\",\"name\":\"%s\",\"url\":\"%s\",\"removable\":%s}%s\n",
            id_e, name_e, url_e,
            sources[i].removable ? "true" : "false",
            (i < count - 1) ? "," : "") != 0) {
            break;
        }
    }
    json_append(&jb, "]}\n");

    return write_file_text(SOURCES_CONFIG_PATH, buf, jb.pos);
}

/* ── Public API ────────────────────────────────────────────── */

int sources_list_json(char *buf, size_t size) {
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) return -1;
    int count = 0;
    load_sources(sources, &count);

    JsonListBuilder jb = { buf, size, 0, 1 };
    buf[0] = '\0';

    json_append(&jb, "{\"sources\":[\n");
    for (int i = 0; i < count; i++) {
        char id_e[128], name_e[512], url_e[2048];
        pldmgr_json_escape(sources[i].id,   id_e,   sizeof(id_e));
        pldmgr_json_escape(sources[i].name, name_e, sizeof(name_e));
        pldmgr_json_escape(sources[i].url,  url_e,  sizeof(url_e));
        if (json_append(&jb, "  {\"id\":\"%s\",\"name\":\"%s\",\"url\":\"%s\",\"removable\":%s}%s\n",
            id_e, name_e, url_e,
            sources[i].removable ? "true" : "false",
            (i < count - 1) ? "," : "") != 0) {
            break;
        }
    }
    json_append(&jb, "]}\n");
    free(sources);
    return 0;
}

int sources_save(const char *json, size_t len) {
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) return -1;
    int count = 0;

    if (!json || len == 0) {
        free(sources);
        return -1;
    }

    /* Default at slot 0 */
    strncpy(sources[0].id,   "default",             sizeof(sources[0].id) - 1);
    strncpy(sources[0].name, "Official Repository", sizeof(sources[0].name) - 1);
    strncpy(sources[0].url,  REPOSITORY_SOURCE_URL, sizeof(sources[0].url) - 1);
    sources[0].removable = 0;
    count = 1;

    const char *arr_start = strstr(json, "\"sources\"");
    if (!arr_start) { free(sources); return -1; }
    arr_start = strchr(arr_start, '[');
    if (!arr_start) { free(sources); return -1; }

    const char *p = arr_start + 1;
    while (count < MAX_SOURCES && (p = strchr(p, '{')) != NULL) {
        const char *end = strchr(p, '}');
        if (!end) break;

        char id[64] = "", name[256] = "", url[1024] = "";
        json_extract_string(p, end, "id",   id,   sizeof(id));
        json_extract_string(p, end, "name", name, sizeof(name));
        json_extract_string(p, end, "url",  url,  sizeof(url));

        if (strcmp(id, "default") == 0) { p = end + 1; continue; }
        if (!name[0] || !url[0] || !id[0]) { p = end + 1; continue; }

        strncpy(sources[count].id,   id,   sizeof(sources[count].id) - 1);
        strncpy(sources[count].name, name, sizeof(sources[count].name) - 1);
        strncpy(sources[count].url,  url,  sizeof(sources[count].url) - 1);
        sources[count].removable = 1;
        count++;
        p = end + 1;
    }

    int ret = save_sources(sources, count);
    free(sources);
    return ret;
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
    snprintf(tmp_path, sizeof(tmp_path), "%s/source_validate.tmp", BASE_DATA_DIR);

    if (download_to_file(url, tmp_path) != 0) {
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

    /* Read top-level name before payloads key */
    {
        const char *payloads_key = strstr(json, "\"payloads\"");
        if (payloads_key) {
            size_t search_len = (size_t)(payloads_key - json);
            const char *name_key = NULL;
            for (size_t i = 0; i + 6 <= search_len; i++) {
                if (memcmp(json + i, "\"name\"", 6) == 0) {
                    name_key = json + i;
                    break;
                }
            }
            if (name_key) {
                const char *colon = strchr(name_key + 6, ':');
                if (colon && (size_t)(colon - json) < search_len) {
                    const char *q = colon + 1;
                    while (*q == ' ' || *q == '\t') q++;
                    if (*q == '"') {
                        q++;
                        size_t pos = 0;
                        while (*q && *q != '"' && pos < sizeof(source_name) - 1)
                            source_name[pos++] = *q++;
                        source_name[pos] = '\0';
                    }
                }
            }
        }
        if (!source_name[0]) {
            const char *host = strstr(url, "://");
            host = host ? host + 3 : url;
            size_t pos = 0;
            while (*host && *host != '/' && *host != ':' &&
                   pos < sizeof(source_name) - 1)
                source_name[pos++] = *host++;
            source_name[pos] = '\0';
        }
    }

    if (parse_repository_payloads(json, &items, &count) != 0 || count == 0) {
        free(json);
        if (items) free(items);
        snprintf(msg_buf, msg_size, "No valid payloads found in source JSON");
        return -1;
    }
    free(items);
    free(json);

    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        snprintf(msg_buf, msg_size, "Memory allocation failed");
        return -1;
    }
    int src_count = 0;
    load_sources(sources, &src_count);

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
    snprintf(new_id, sizeof(new_id), "source_%d", (int)time(NULL));

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

int sources_remove(int index, char *msg_buf, size_t msg_size) {
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
    load_sources(sources, &count);

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
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", cache_path);
    if (download_to_file(url, tmp_path) != 0) {
        return -1;
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

    tf = fopen(ts_path, "w");
    if (tf) {
        fprintf(tf, "%ld", (long)now);
        fclose(tf);
    }

    if (strcmp(url, REPOSITORY_SOURCE_URL) == 0) {
        config_write_last_update((long)now);
    }

    return 0;
}

size_t sources_multi_repository_list_json(char *buf, size_t size, int force_refresh) {
    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        if (buf && size > 0) buf[0] = '\0';
        return 0;
    }
    int src_count = 0;
    load_sources(sources, &src_count);

    /* Single-source mode: if multi_sources is off, only use source 0 */
    PldmgrConfig cfg;
    config_read(&cfg);
    if (!cfg.multi_sources_enabled && src_count > 1) {
        src_count = 1;
    }

    JsonListBuilder jb = { buf, size, 0, 1 };
    buf[0] = '\0';

    json_append(&jb, "{\"sources\":[\n");

    for (int si = 0; si < src_count; si++) {
        int fetch_ok = (sources_ensure_fresh(sources[si].url, force_refresh) == 0);

        char cache_path[512], ts_path[512];
        get_cache_paths(sources[si].url, cache_path, sizeof(cache_path), ts_path, sizeof(ts_path));

        char id_e[128], name_e[512], url_e[2048];
        pldmgr_json_escape(sources[si].id,   id_e,   sizeof(id_e));
        pldmgr_json_escape(sources[si].name, name_e, sizeof(name_e));
        pldmgr_json_escape(sources[si].url,  url_e,  sizeof(url_e));

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

            if (read_file_text(cache_path, &cached, &cached_size) == 0 && cached) {
                parse_repository_payloads(cached, &items, &count);
                free(cached);
            }

            char *icon_e = (char *)malloc(16384);
            if (!icon_e) {
                if (items) free(items);
                free(sources);
                return 0;
            }

            int first_payload = 1;
            for (size_t pi = 0; pi < count; pi++) {
                if (is_pldmgr_name(items[pi].id) ||
                    is_pldmgr_name(items[pi].filename) ||
                    is_pldmgr_name(items[pi].name)) {
                    continue;
                }

                char id_pe[128], name_pe[256], filename_e[512], desc_e[2048];
                char ver_e[128], url_e[2048], src_id_e[128], src_name_e[512];
                char last_upd_e[128], cat_e[256], csum_e[128];
                char auth_e[256], det_url_e[2048], rn_e[4096];

                pldmgr_json_escape(items[pi].id,          id_pe,      sizeof(id_pe));
                pldmgr_json_escape(items[pi].name,        name_pe,    sizeof(name_pe));
                pldmgr_json_escape(items[pi].filename,    filename_e, sizeof(filename_e));
                pldmgr_json_escape(items[pi].description, desc_e,     sizeof(desc_e));
                pldmgr_json_escape(items[pi].version,     ver_e,      sizeof(ver_e));
                pldmgr_json_escape(items[pi].url,         url_e,      sizeof(url_e));
                pldmgr_json_escape(items[pi].checksum,    csum_e,     sizeof(csum_e));
                pldmgr_json_escape(items[pi].last_update, last_upd_e, sizeof(last_upd_e));
                pldmgr_json_escape(items[pi].category,    cat_e,      sizeof(cat_e));
                pldmgr_json_escape(sources[si].id,        src_id_e,   sizeof(src_id_e));
                pldmgr_json_escape(sources[si].name,      src_name_e, sizeof(src_name_e));
                pldmgr_json_escape(items[pi].author,      auth_e,     sizeof(auth_e));
                pldmgr_json_escape(items[pi].details_url, det_url_e,  sizeof(det_url_e));
                pldmgr_json_escape(items[pi].release_notes,rn_e,      sizeof(rn_e));
                pldmgr_json_escape(items[pi].icon,        icon_e,     16384);

                if (json_append(&jb, "%s    {\"id\":\"%s\",\"name\":\"%s\",\"filename\":\"%s\",\"description\":\"%s\","
                    "\"version\":\"%s\",\"checksum\":\"%s\",\"last_update\":\"%s\",\"url\":\"%s\","
                    "\"source_id\":\"%s\",\"source_name\":\"%s\",\"category\":\"%s\","
                    "\"author\":\"%s\",\"details_url\":\"%s\",\"release_notes\":\"%s\",\"icon\":\"%s\"}",
                    first_payload ? "" : ",\n",
                    id_pe, name_pe, filename_e, desc_e, ver_e, csum_e, last_upd_e, url_e,
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
    char safe_id[128];
    slot_slug(id, safe_id, sizeof(safe_id));
    if (safe_id[0] == '\0') {
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Missing payload id\"}");
        return -1;
    }
    if (is_pldmgr_name(safe_id)) {
        snprintf(out_json, out_size,
                 "{\"ok\":false,\"message\":\"Payload Manager cannot be installed as a payload\"}");
        return -1;
    }

    SourceEntry *sources = calloc(MAX_SOURCES, sizeof(SourceEntry));
    if (!sources) {
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Memory error\"}");
        return -1;
    }
    int src_count = 0;
    load_sources(sources, &src_count);

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
        if (slot_list_all(&existing_slots, &existing_count) == 0 && existing_slots) {
            for (size_t i = 0; i < existing_count; i++) {
                if (strcmp(existing_slots[i].kind, SLOT_KIND_REPO) == 0 &&
                    strcmp(existing_slots[i].id, safe_id) == 0 &&
                    strcmp(existing_slots[i].slot_key, target_slot) != 0) {
                    /* Conflict found with another source! */
                    char c_slot[128], c_name[256], c_ver[64];
                    pldmgr_json_escape(existing_slots[i].slot_key, c_slot, sizeof(c_slot));
                    pldmgr_json_escape(existing_slots[i].source_name, c_name, sizeof(c_name));
                    pldmgr_json_escape(existing_slots[i].version, c_ver, sizeof(c_ver));

                    snprintf(out_json, out_size,
                             "{\"ok\":false,\"conflict\":{\"slot\":\"%s\",\"source_name\":\"%s\",\"version\":\"%s\"}}",
                             c_slot, c_name, c_ver);
                    slot_free_all(existing_slots);
                    return 0; /* Handled conflict, return 200 JSON with conflict object */
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
        parse_repository_payloads(cached, &items, &count);
        free(cached);
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
            parse_repository_payloads(cached, &items, &count);
            free(cached);
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
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Payload no longer in repository\"}");
        return -1;
    }

    RepoPayload *entry = (RepoPayload *)calloc(1, sizeof(RepoPayload));
    if (!entry) {
        if (items) free(items);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Out of memory\"}");
        return -1;
    }
    *entry = items[found_idx];
    free(items);
    items = NULL;

    /* Block installing pldmgr as a payload */
    if (is_pldmgr_name(safe_id) || is_pldmgr_name(entry->id) ||
        is_pldmgr_name(entry->filename) || is_pldmgr_name(entry->name)) {
        free(entry);
        snprintf(out_json, out_size,
                 "{\"ok\":false,\"message\":\"Payload Manager cannot be installed as a payload\"}");
        return -1;
    }

    /* Validate filename */
    if (entry->filename[0] == '\0' || strstr(entry->filename, "/") || strstr(entry->filename, "..")) {
        free(entry);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Invalid payload filename in repository\"}");
        return -1;
    }
    const char *ext = strrchr(entry->filename, '.');
    if (!ext || (strcasecmp(ext, ".elf") != 0 && strcasecmp(ext, ".bin") != 0)) {
        free(entry);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Unsupported file extension in repository\"}");
        return -1;
    }

    /* Prepare slot directory */
    char slot_dir[640];
    snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, target_slot);
    if (ensure_dir_recursive(slot_dir) != 0) {
        free(entry);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Failed to create slot directory\"}");
        return -1;
    }

    char part_path[768];
    snprintf(part_path, sizeof(part_path), "%s/.part", slot_dir);

    /* Download attempt */
    int dl_ok = (download_to_file(entry->url, part_path) == 0);
    if (!dl_ok && !refreshed) {
        /* Retry after refresh */
        sources_ensure_fresh(src.url, 1);
        refreshed = 1;
        int ref_found = 0;
        if (read_file_text(cache_path, &cached, &csize) == 0 && cached) {
            if (parse_repository_payloads(cached, &items, &count) == 0) {
                for (size_t i = 0; i < count; i++) {
                    if (strcmp(items[i].id, safe_id) == 0) {
                        *entry = items[i];
                        ref_found = 1;
                        break;
                    }
                }
                free(items);
                items = NULL;
            }
            free(cached);
            cached = NULL;
        }
        if (!ref_found) {
            free(entry);
            remove(part_path);
            snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Payload no longer in repository\"}");
            return -1;
        }
        dl_ok = (download_to_file(entry->url, part_path) == 0);
    }

    if (!dl_ok) {
        free(entry);
        remove(part_path);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Download failed\"}");
        return -1;
    }

    /* Checksum verification */
    if (strlen(entry->checksum) == 64) {
        char calc[65];
        if (compute_sha256_file(part_path, calc) != 0 || strcasecmp(calc, entry->checksum) != 0) {
            pldmgr_log("[PLDMGR] Checksum mismatch for %s. Expected: %s, Got: %s\n",
                       entry->filename, entry->checksum, calc);
            if (!refreshed) {
                /* Retry after refresh */
                sources_ensure_fresh(src.url, 1);
                refreshed = 1;
                int ref_found = 0;
                if (read_file_text(cache_path, &cached, &csize) == 0 && cached) {
                    if (parse_repository_payloads(cached, &items, &count) == 0) {
                        for (size_t i = 0; i < count; i++) {
                            if (strcmp(items[i].id, safe_id) == 0) {
                                *entry = items[i];
                                ref_found = 1;
                                break;
                            }
                        }
                        free(items);
                        items = NULL;
                    }
                    free(cached);
                    cached = NULL;
                }
                if (ref_found && download_to_file(entry->url, part_path) == 0) {
                    if (compute_sha256_file(part_path, calc) == 0 &&
                        strcasecmp(calc, entry->checksum) == 0) {
                        goto checksum_passed;
                    }
                }
            }
            free(entry);
            remove(part_path);
            snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Checksum verification failed\"}");
            return -1;
        }
    }

checksum_passed:

    /* Handle mode=replace for conflicting slot */
    if (is_mode_replace && replace_slot && replace_slot[0] && strcmp(replace_slot, target_slot) != 0) {
        pldmgr_autoload_update_config_entry(replace_slot, target_slot);
        pldmgr_favorites_update_entry(replace_slot, target_slot);
        slot_delete(replace_slot);
    }

    /* Remove any old payload in target slot */
    DIR *sd = opendir(slot_dir);
    if (sd) {
        struct dirent *se;
        while ((se = readdir(sd)) != NULL) {
            if (se->d_name[0] == '.') continue;
            if (strcmp(se->d_name, "meta.json") == 0) continue;
            char old_file[768];
            snprintf(old_file, sizeof(old_file), "%s/%s", slot_dir, se->d_name);
            remove(old_file);
        }
        closedir(sd);
    }

    /* Commit .part -> entry->filename */
    char final_file[768];
    snprintf(final_file, sizeof(final_file), "%s/%s", slot_dir, entry->filename);
    if (rename(part_path, final_file) != 0) {
        free(entry);
        remove(part_path);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Failed to commit payload file\"}");
        return -1;
    }

    /* Write meta.json */
    SlotMeta *meta = (SlotMeta *)calloc(1, sizeof(SlotMeta));
    if (!meta) {
        free(entry);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Out of memory\"}");
        return -1;
    }
    meta->schema = PAYLOAD_SLOT_SCHEMA;
    strcpy(meta->kind, SLOT_KIND_REPO);
    strncpy(meta->slot_key, target_slot, sizeof(meta->slot_key) - 1);
    strncpy(meta->slot_dir, slot_dir, sizeof(meta->slot_dir) - 1);
    strncpy(meta->payload_path, final_file, sizeof(meta->payload_path) - 1);
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

    slot_write_meta(slot_dir, meta);
    free(meta);

    char sk_e[256], id_e[256], ver_e[128], fn_e[512];
    pldmgr_json_escape(target_slot, sk_e, sizeof(sk_e));
    pldmgr_json_escape(safe_id, id_e, sizeof(id_e));
    pldmgr_json_escape(entry->version, ver_e, sizeof(ver_e));
    pldmgr_json_escape(entry->filename, fn_e, sizeof(fn_e));

    snprintf(out_json, out_size,
             "{\"ok\":true,\"slot\":\"%s\",\"id\":\"%s\",\"version\":\"%s\",\"filename\":\"%s\",\"refreshed\":%s}",
             sk_e, id_e, ver_e, fn_e, refreshed ? "true" : "false");

    pldmgr_log("[PLDMGR] Repo install success: slot=%s id=%s ver=%s\n", target_slot, id, entry->version);
    free(entry);
    return 0;
}
