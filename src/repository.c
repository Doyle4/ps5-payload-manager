#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <time.h>
#include <unistd.h>
#include <curl/curl.h>

#include "repository.h"
#include "sources.h"
#include "slot.h"
#include "json_helpers.h"
#include "pldmgr.h"
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

        /* Prevent repository connection timeouts from delaying startup and autoload. */
        if (strcmp(url, REPOSITORY_SOURCE_URL) == 0) {
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 3L);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
        }

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

