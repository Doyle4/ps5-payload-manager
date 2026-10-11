#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <time.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>
#include <curl/curl.h>

#include "repository.h"
#include "sources.h"
#include "slot.h"
#include "sha256.h"
#include "json_helpers.h"
#include "config.h"
#include "pldmgr.h"
#include "payload_mgr.h"
#include "assets_cacert_pem.h"

/* ── cURL download helper ──────────────────────────────────── */

static size_t write_data(void *ptr, size_t size, size_t nmemb, FILE *stream) {
    return fwrite(ptr, size, nmemb, stream);
}

int download_to_file(const char *url, const char *out_path) {
    CURL *curl;
    FILE *fp;
    CURLcode res = CURLE_FAILED_INIT;

    if (!url || !out_path) {
        pldmgr_log("[PLDMGR] download_to_file: missing url or path\n");
        return -1;
    }

    fp = fopen(out_path, "wb");
    if (!fp) {
        pldmgr_log("[PLDMGR] download_to_file: failed to open %s\n", out_path);
        return -1;
    }

    curl = curl_easy_init();
    if (curl) {
        curl_easy_setopt(curl, CURLOPT_URL, url);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, fp);
        curl_easy_setopt(curl, CURLOPT_USERAGENT, "pldmgr/1.0");

        char *ca_bundle = malloc(assets_cacert_pem_len + 1);
        if (ca_bundle) {
            memcpy(ca_bundle, assets_cacert_pem, assets_cacert_pem_len);
            ca_bundle[assets_cacert_pem_len] = '\0';
        }

        struct curl_blob blob;
        blob.data = ca_bundle ? ca_bundle : (void *)assets_cacert_pem;
        blob.len = ca_bundle ? (assets_cacert_pem_len + 1) : assets_cacert_pem_len;
        blob.flags = CURL_BLOB_COPY;

        curl_easy_setopt(curl, CURLOPT_CAINFO_BLOB, &blob);
        if (ca_bundle) free(ca_bundle);

        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

        res = curl_easy_perform(curl);

        if (res == CURLE_PEER_FAILED_VERIFICATION) {
            pldmgr_log("[PLDMGR] SSL verification failed. Retrying insecurely: %s\n", url);
            curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
            curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);
            res = curl_easy_perform(curl);
        }

        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            pldmgr_log("[PLDMGR] curl_easy_perform failed: %s url=%s\n",
                       curl_easy_strerror(res), url);
        } else if (http_code != 200) {
            pldmgr_log("[PLDMGR] HTTP status %ld for %s\n", http_code, url);
            res = CURLE_HTTP_RETURNED_ERROR;
        }
    }

    fclose(fp);

    if (res != CURLE_OK) {
        remove(out_path);
        return -1;
    }

    return 0;
}

/* ── JSON parsing ──────────────────────────────────────────── */

static int is_pldmgr_name(const char *name) {
    if (!name || !*name) return 0;
    const char *base = strrchr(name, '/');
    base = base ? base + 1 : name;
    return (strncasecmp(base, "pldmgr", 6) == 0 ||
            strncasecmp(base, "payload-manager", 15) == 0);
}

static const char *skip_top_level_wrapper(const char *json) {
    const char *p = json;
    int in_string = 0, escaped = 0;

    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '{') return json;

    const char *q = p + 1;
    int depth = 1, is_wrapper = 0;

    while (*q && depth > 0) {
        if (in_string) {
            if (escaped) escaped = 0;
            else if (*q == '\\') escaped = 1;
            else if (*q == '"') in_string = 0;
        } else {
            if (*q == '"') {
                in_string = 1;
                if (depth == 1 && strncmp(q, "\"payloads\"", 10) == 0) {
                    is_wrapper = 1;
                    break;
                }
            } else if (*q == '{') depth++;
            else if (*q == '}' && --depth == 0) break;
        }
        q++;
    }

    if (is_wrapper) return p + 1;
    return json;
}

static const char *find_next_object_start(const char *p) {
    int in_string = 0, escaped = 0;

    while (*p) {
        if (in_string) {
            if (escaped) escaped = 0;
            else if (*p == '\\') escaped = 1;
            else if (*p == '"') in_string = 0;
        } else {
            if (*p == '"') in_string = 1;
            else if (*p == '{') return p;
        }
        p++;
    }
    return NULL;
}

int parse_repository_payloads(const char *json, RepoPayload **out_items, size_t *out_count) {
    const char *p;
    RepoPayload *items = NULL;
    size_t count = 0;

    *out_items = NULL;
    *out_count = 0;

    p = skip_top_level_wrapper(json);
    if (!p) return 0;

    while ((p = find_next_object_start(p)) != NULL) {
        const char *end = p + 1;
        int depth = 1, in_string = 0, escaped = 0;

        while (*end && depth > 0) {
            if (in_string) {
                if (escaped) escaped = 0;
                else if (*end == '\\') escaped = 1;
                else if (*end == '"') in_string = 0;
            } else {
                if (*end == '"') in_string = 1;
                else if (*end == '{') depth++;
                else if (*end == '}') depth--;
            }
            if (depth > 0) end++;
        }

        if (!*end && depth > 0) break;

        RepoPayload *item = (RepoPayload *)malloc(sizeof(RepoPayload));
        if (!item) {
            free(items);
            return -1;
        }

        memset(item, 0, sizeof(*item));
        if (json_extract_string(p, end, "name", item->name, sizeof(item->name)) != 0 ||
            json_extract_string(p, end, "filename", item->filename, sizeof(item->filename)) != 0 ||
            json_extract_string(p, end, "url", item->url, sizeof(item->url)) != 0) {
            free(item);
            p = end + 1;
            continue;
        }

        /* Extract id or fallback to slug(name) */
        json_extract_string(p, end, "id", item->id, sizeof(item->id));
        if (item->id[0] == '\0') {
            slot_slug(item->name, item->id, sizeof(item->id));
        }

        json_extract_string(p, end, "source", item->source, sizeof(item->source));
        json_extract_string(p, end, "source_direct", item->source_direct, sizeof(item->source_direct));
        json_extract_string(p, end, "description", item->description, sizeof(item->description));
        json_extract_string(p, end, "last_update", item->last_update, sizeof(item->last_update));
        json_extract_string(p, end, "version", item->version, sizeof(item->version));
        json_extract_string(p, end, "checksum", item->checksum, sizeof(item->checksum));
        json_extract_string(p, end, "author", item->author, sizeof(item->author));
        json_extract_string(p, end, "details_url", item->details_url, sizeof(item->details_url));

        json_extract_string(p, end, "release_notes", item->release_notes, sizeof(item->release_notes));
        if (strlen(item->release_notes) == sizeof(item->release_notes) - 1) {
            strcpy(item->release_notes + sizeof(item->release_notes) - 4, "...");
        }

        json_extract_string(p, end, "icon", item->icon, sizeof(item->icon));
        if (strlen(item->icon) > 12288) {
            item->icon[0] = '\0';
        }

        if (json_extract_string(p, end, "category", item->category, sizeof(item->category)) != 0 ||
            strlen(item->category) == 0) {
            strncpy(item->category, "Uncategorized", sizeof(item->category) - 1);
        }

        RepoPayload *tmp = (RepoPayload *)realloc(items, (count + 1) * sizeof(RepoPayload));
        if (!tmp) {
            free(item);
            free(items);
            return -1;
        }
        items = tmp;
        items[count] = *item;
        free(item);
        count++;
        p = end + 1;
    }

    *out_items = items;
    *out_count = count;
    return 0;
}

int repository_ensure_fresh(int force_refresh) {
    return sources_ensure_fresh(REPOSITORY_SOURCE_URL, force_refresh);
}

size_t repository_list_json(char *json_buf, size_t buf_size, int force_refresh) {
    return sources_multi_repository_list_json(json_buf, buf_size, force_refresh);
}

/* ── Self-update ───────────────────────────────────────────── */

int get_elf_pldmgr_version(const char *path, char *out_version, size_t out_size) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;

    char sig[16];
    sig[0] = 'P'; sig[1] = 'L'; sig[2] = 'D'; sig[3] = 'M'; sig[4] = 'G';
    sig[5] = 'R'; sig[6] = '_'; sig[7] = 'V'; sig[8] = 'E'; sig[9] = 'R'; sig[10] = ':'; sig[11] = '\0';
    size_t sig_len = 11;

    char buffer[8192];
    size_t bytes_read;
    int match_idx = 0;

    while ((bytes_read = fread(buffer, 1, sizeof(buffer), f)) > 0) {
        for (size_t i = 0; i < bytes_read; i++) {
            if (buffer[i] == sig[match_idx]) {
                match_idx++;
                if (match_idx == (int)sig_len) {
                    size_t v_idx = 0;
                    i++;
                    while (i < bytes_read && buffer[i] != '\0' && v_idx < out_size - 1) {
                        out_version[v_idx++] = buffer[i++];
                    }
                    if (i < bytes_read && buffer[i] == '\0') {
                        if (v_idx > 0) {
                            out_version[v_idx] = '\0';
                            fclose(f);
                            return 0;
                        }
                    } else {
                        while (v_idx < out_size - 1) {
                            int c = fgetc(f);
                            if (c == EOF || c == '\0') break;
                            out_version[v_idx++] = (char)c;
                        }
                        out_version[v_idx] = '\0';
                        if (v_idx > 0) {
                            fclose(f);
                            return 0;
                        }
                    }
                    match_idx = 0;
                }
            } else {
                match_idx = 0;
                if (buffer[i] == sig[0]) match_idx = 1;
            }
        }
    }
    fclose(f);
    return -1;
}

int repository_check_self_update(char *out_path, size_t out_size,
                                 char *out_version, size_t out_version_size) {
    SlotMeta *slots = NULL;
    size_t count = 0;

    if (slot_list_all(&slots, &count) != 0 || !slots) return -1;

    for (size_t i = 0; i < count; i++) {
        int is_match = 0;
        if (strcmp(slots[i].kind, SLOT_KIND_REPO) == 0) {
            if (strcmp(slots[i].id, "pldmgr") == 0 || is_pldmgr_name(slots[i].filename)) {
                is_match = 1;
            }
        } else if (strcmp(slots[i].kind, SLOT_KIND_LOCAL) == 0) {
            /* Check if slot key starts with local/pldmgr */
            if (strncasecmp(slots[i].slot_key, "local/pldmgr", 12) == 0 ||
                is_pldmgr_name(slots[i].filename)) {
                is_match = 1;
            }
        }

        if (!is_match) continue;

        /* Verify ELF magic */
        unsigned char magic[4];
        FILE *ef = fopen(slots[i].payload_path, "rb");
        if (ef) {
            if (fread(magic, 1, 4, ef) == 4 && magic[0] == 0x7f &&
                magic[1] == 'E' && magic[2] == 'L' && magic[3] == 'F') {
                fclose(ef);
                char version[64];
                if (get_elf_pldmgr_version(slots[i].payload_path, version, sizeof(version)) == 0) {
                    pldmgr_log("[PLDMGR] Found update candidate: %s (v%s)\n",
                               slots[i].payload_path, version);
                    if (slot_version_compare(version, MENU_VERSION) > 0) {
                        strncpy(out_path, slots[i].payload_path, out_size - 1);
                        out_path[out_size - 1] = '\0';
                        if (out_version && out_version_size) {
                            strncpy(out_version, version, out_version_size - 1);
                            out_version[out_version_size - 1] = '\0';
                        }
                        slot_free_all(slots);
                        return 0;
                    }
                }
            } else {
                fclose(ef);
            }
        }
    }

    slot_free_all(slots);
    return -1;
}

int repository_check_repo_update(char *out_filename, size_t out_size,
                                 char *out_version, size_t out_version_size,
                                 char *out_source, size_t out_source_size) {
    char h8[16];
    slot_source_hash(REPOSITORY_SOURCE_URL, h8, sizeof(h8));
    char cache_path[512];
    snprintf(cache_path, sizeof(cache_path), "%s/repo_cache_%s.json", BASE_DATA_DIR, h8);

    char *cached = NULL;
    size_t csize = 0;
    if (read_file_text(cache_path, &cached, &csize) != 0 || !cached) {
        return -1;
    }

    RepoPayload *items = NULL;
    size_t count = 0;
    parse_repository_payloads(cached, &items, &count);
    free(cached);

    int found = 0;
    for (size_t i = 0; i < count; i++) {
        if (strcmp(items[i].id, "pldmgr") == 0 || is_pldmgr_name(items[i].filename)) {
            if (items[i].version[0] != '\0' &&
                slot_version_compare(items[i].version, MENU_VERSION) > 0) {
                found = 1;
                if (out_filename && out_size) {
                    strncpy(out_filename, items[i].filename, out_size - 1);
                    out_filename[out_size - 1] = '\0';
                }
                if (out_version && out_version_size) {
                    strncpy(out_version, items[i].version, out_version_size - 1);
                    out_version[out_version_size - 1] = '\0';
                }
                if (out_source && out_source_size) {
                    const char *src = items[i].source[0] ? items[i].source : items[i].url;
                    strncpy(out_source, src, out_source_size - 1);
                    out_source[out_source_size - 1] = '\0';
                }
                break;
            }
        }
    }

    if (items) free(items);
    return found ? 0 : -1;
}
