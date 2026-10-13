#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <time.h>
#include <unistd.h>
#include <curl/curl.h>
#include <stdint.h>
#include "utils.h"

#include "repository.h"
#include "collection_helpers.h"
#include "sources.h"
#include "slot.h"
#include "json_helpers.h"
#include "pldmgr.h"
#include "assets_cacert_pem.h"

/* ── cURL download helper ──────────────────────────────────── */

typedef struct { FILE *file; size_t bytes, limit; } DownloadOutput;
static size_t write_data(void *ptr, size_t size, size_t nmemb, void *context) {
    DownloadOutput *out = context;
    if (size && nmemb > SIZE_MAX / size) return 0;
    size_t bytes = size * nmemb;
    if (bytes > out->limit - out->bytes) return 0;
    size_t written = fwrite(ptr, 1, bytes, out->file);
    out->bytes += written;
    return written;
}

int download_to_file_limited(const char *url, const char *out_path, size_t limit) {
    if (!url || !out_path || !limit ||
        (strncasecmp(url, "https://", 8) && strncasecmp(url, "http://", 7))) return -1;
    FILE *fp = fopen(out_path, "wb");
    if (!fp) return -1;
    CURL *curl = curl_easy_init();
    CURLcode res = CURLE_FAILED_INIT;
    DownloadOutput output = { fp, 0, limit };
    if (curl) {
#define SET_OPTION(option, value) do { res = curl_easy_setopt(curl, option, value); if (res != CURLE_OK) goto finished; } while (0)
        SET_OPTION(CURLOPT_URL, url);
        SET_OPTION(CURLOPT_NOSIGNAL, 1L);
        SET_OPTION(CURLOPT_CONNECTTIMEOUT, strcmp(url, REPOSITORY_SOURCE_URL) ? 10L : 3L);
        SET_OPTION(CURLOPT_TIMEOUT, strcmp(url, REPOSITORY_SOURCE_URL) ? 60L : 5L);
        SET_OPTION(CURLOPT_WRITEFUNCTION, write_data);
        SET_OPTION(CURLOPT_WRITEDATA, &output);
        SET_OPTION(CURLOPT_USERAGENT, "pldmgr/1.0");
        struct curl_blob blob = { (void *)assets_cacert_pem, assets_cacert_pem_len, CURL_BLOB_COPY };
        SET_OPTION(CURLOPT_CAINFO_BLOB, &blob);
        SET_OPTION(CURLOPT_SSL_VERIFYPEER, 1L);
        SET_OPTION(CURLOPT_SSL_VERIFYHOST, 2L);
        SET_OPTION(CURLOPT_FOLLOWLOCATION, 1L);
        SET_OPTION(CURLOPT_MAXREDIRS, 5L);
        SET_OPTION(CURLOPT_MAXFILESIZE_LARGE, (curl_off_t)limit);
#if LIBCURL_VERSION_NUM >= 0x075500
        SET_OPTION(CURLOPT_PROTOCOLS_STR, "http,https");
        SET_OPTION(CURLOPT_REDIR_PROTOCOLS_STR, strncasecmp(url, "https://", 8) ? "http,https" : "https");
#else
        SET_OPTION(CURLOPT_PROTOCOLS, (long)(CURLPROTO_HTTP | CURLPROTO_HTTPS));
        SET_OPTION(CURLOPT_REDIR_PROTOCOLS, strncasecmp(url, "https://", 8) ? (long)(CURLPROTO_HTTP | CURLPROTO_HTTPS) : (long)CURLPROTO_HTTPS);
#endif
        res = curl_easy_perform(curl);
        long status = 0;
        if (res == CURLE_OK && (curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status) != CURLE_OK || status != 200))
            res = CURLE_HTTP_RETURNED_ERROR;
finished:
        if (res != CURLE_OK) pldmgr_log("[PLDMGR] Verified download failed: %s (%s)\n", url, curl_easy_strerror(res));
        curl_easy_cleanup(curl);
#undef SET_OPTION
    }
    int failed = res != CURLE_OK || ferror(fp);
    if (fflush(fp)) failed = 1;
    if (!failed && fsync(fileno(fp))) failed = 1;
    if (fclose(fp)) failed = 1;
    if (failed) { remove(out_path); return -1; }
    return 0;
}

int download_to_file(const char *url, const char *out_path) {
    return download_to_file_limited(url, out_path, PLDMGR_PAYLOAD_DOWNLOAD_LIMIT);
}

int repository_checksum_valid(const char *checksum) {
    if (!checksum) return 0;
    if (!checksum[0]) return 1; /* Missing/empty remains optional. */
    if (strlen(checksum) != 64) return 0;
    for (size_t i = 0; i < 64; i++)
        if (!((checksum[i] >= '0' && checksum[i] <= '9') ||
              (checksum[i] >= 'a' && checksum[i] <= 'f') ||
              (checksum[i] >= 'A' && checksum[i] <= 'F'))) return 0;
    return 1;
}
int repository_entry_valid(const RepoPayload *entry) {
    if (!entry || !entry->filename[0] || entry->filename[0] == '.' ||
        strchr(entry->filename, '/') || strstr(entry->filename, "..") ||
        is_pldmgr_name(entry->id) || is_pldmgr_name(entry->name) || is_pldmgr_name(entry->filename) ||
        !repository_checksum_valid(entry->checksum)) return 0;
    const char *ext = strrchr(entry->filename, '.');
    return ext && (!strcasecmp(ext, ".elf") || !strcasecmp(ext, ".bin"));
}

/* ── JSON parsing ──────────────────────────────────────────── */

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
    size_t count = 0, capacity = 0;

    if (!out_items || !out_count) return -1;
    *out_items = NULL;
    *out_count = 0;

    if (!json || strnlen(json, 16 * 1024 * 1024 + 1) > 16 * 1024 * 1024) return -1;
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

        if (!*end && depth > 0) { free(items); return -1; }

        RepoPayload entry;
        RepoPayload *item = &entry;

        memset(item, 0, sizeof(*item));
        if (json_extract_string(p, end + 1, "name", item->name, sizeof(item->name)) != 0 ||
            json_extract_string(p, end + 1, "filename", item->filename, sizeof(item->filename)) != 0 ||
            json_extract_string(p, end + 1, "url", item->url, sizeof(item->url)) != 0) {
            p = end + 1;
            continue;
        }

        /* Extract id or fallback to slug(name) */
        json_extract_string(p, end + 1, "id", item->id, sizeof(item->id));
        if (item->id[0] == '\0') {
            slot_slug(item->name, item->id, sizeof(item->id));
        }

        json_extract_string(p, end + 1, "source", item->source, sizeof(item->source));
        json_extract_string(p, end + 1, "source_direct", item->source_direct, sizeof(item->source_direct));
        json_extract_string_prefix(p, end + 1, "description", item->description, sizeof(item->description));
        json_extract_string(p, end + 1, "last_update", item->last_update, sizeof(item->last_update));
        json_extract_string(p, end + 1, "version", item->version, sizeof(item->version));
        int checksum_result = json_extract_string(p, end + 1, "checksum", item->checksum, sizeof(item->checksum));
        /* A supplied oversized/non-string hash must not turn into an absent,
         * optional checksum after extraction fails. Hex validation is separate. */
        if ((checksum_result != JSON_STRING_OK && checksum_result != JSON_STRING_MISSING) ||
            !repository_checksum_valid(item->checksum)) {
            p = end + 1;
            continue;
        }
        json_extract_string(p, end + 1, "author", item->author, sizeof(item->author));
        json_extract_string(p, end + 1, "details_url", item->details_url, sizeof(item->details_url));

        int notes_result = json_extract_string_prefix(p, end + 1, "release_notes",
                                                     item->release_notes, sizeof(item->release_notes));
        if (notes_result == JSON_STRING_TRUNCATED) {
            size_t length = strlen(item->release_notes);
            if (length > sizeof(item->release_notes) - 4) length = sizeof(item->release_notes) - 4;
            while (length && ((unsigned char)item->release_notes[length] & 0xc0) == 0x80) length--;
            strcpy(item->release_notes + length, "...");
        }

        json_extract_string(p, end + 1, "icon_key", item->icon_key, sizeof(item->icon_key));

        if (json_extract_string(p, end + 1, "category", item->category, sizeof(item->category)) != 0 ||
            strlen(item->category) == 0) {
            strncpy(item->category, "Uncategorized", sizeof(item->category) - 1);
        }

        RepoPayload *tmp = (RepoPayload *)collection_reserve(items, &capacity, count + 1, sizeof(RepoPayload));
        if (!tmp) {
            free(items);
            return -1;
        }
        items = tmp;
        items[count] = *item;
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

