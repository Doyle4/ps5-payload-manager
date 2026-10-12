#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>

#include "slot.h"
#include "sha256.h"
#include "json_helpers.h"
#include "pldmgr.h"
#include "config.h"
#include "autoload.h"
#include "utils.h"

static int is_supported_ext(const char *name) {
    const char *ext = strrchr(name, '.');
    if (!ext) return 0;
    return (strcasecmp(ext, ".elf") == 0 || strcasecmp(ext, ".bin") == 0);
}

int slot_source_hash(const char *source_url, char *out_hash8, size_t out_size) {
    if (!source_url || !out_hash8 || out_size < 9) return -1;

    /* Normalize: trimmed, no trailing '/' */
    const char *p = source_url;
    while (*p && isspace((unsigned char)*p)) p++;

    size_t len = strlen(p);
    while (len > 0 && isspace((unsigned char)p[len - 1])) len--;
    while (len > 0 && p[len - 1] == '/') len--;

    char norm[1024];
    if (len >= sizeof(norm)) len = sizeof(norm) - 1;
    memcpy(norm, p, len);
    norm[len] = '\0';

    SHA256_CTX ctx;
    unsigned char hash[32];
    sha256_init(&ctx);
    sha256_update(&ctx, (const unsigned char *)norm, strlen(norm));
    sha256_final(&ctx, hash);

    snprintf(out_hash8, out_size, "%02x%02x%02x%02x",
             hash[0], hash[1], hash[2], hash[3]);
    return 0;
}

int slot_slug(const char *input, char *out_slug, size_t out_size) {
    if (!input || !out_slug || out_size == 0) return -1;

    size_t out_idx = 0;
    int last_dash = 1; /* treat start as dash to avoid leading dash */

    for (size_t i = 0; input[i] != '\0' && out_idx + 1 < out_size; i++) {
        unsigned char c = (unsigned char)input[i];
        if (isalnum(c)) {
            out_slug[out_idx++] = (char)tolower(c);
            last_dash = 0;
        } else if ((c == '.' || c == '_') && out_idx > 0 && out_slug[out_idx - 1] != '.') {
            out_slug[out_idx++] = (char)c;
            last_dash = 0;
        } else {
            /* Separator */
            if (!last_dash) {
                out_slug[out_idx++] = '-';
                last_dash = 1;
            }
        }
    }

    /* Strip trailing dashes, dots, or underscores */
    while (out_idx > 0 && (out_slug[out_idx - 1] == '-' ||
                           out_slug[out_idx - 1] == '.' ||
                           out_slug[out_idx - 1] == '_')) {
        out_idx--;
    }

    out_slug[out_idx] = '\0';

    if (out_idx == 0) {
        strncpy(out_slug, "payload", out_size - 1);
        out_slug[out_size - 1] = '\0';
    }

    return 0;
}

int slot_local_key(const char *filename, char *out_key, size_t out_size) {
    if (!filename || !out_key || out_size == 0) return -1;

    const char *base = strrchr(filename, '/');
    base = base ? base + 1 : filename;

    char clean[256];
    strncpy(clean, base, sizeof(clean) - 1);
    clean[sizeof(clean) - 1] = '\0';

    /* Strip extension (.elf or .bin) */
    char *dot = strrchr(clean, '.');
    if (dot && (strcasecmp(dot, ".elf") == 0 || strcasecmp(dot, ".bin") == 0)) {
        *dot = '\0';
    }

    /* Look for version markers: [_\s\.-]v?[0-9] */
    size_t clen = strlen(clean);
    for (size_t i = 0; i < clen; i++) {
        char sep = clean[i];
        if (sep == '_' || sep == '-' || sep == '.' || sep == ' ') {
            size_t next = i + 1;
            if (next < clen && (clean[next] == 'v' || clean[next] == 'V')) {
                next++;
            }
            if (next < clen && isdigit((unsigned char)clean[next])) {
                clean[i] = '\0';
                break;
            }
        }
    }

    /* Strip trailing [-_\s\.]ps[45] */
    clen = strlen(clean);
    if (clen >= 4) {
        char sep = clean[clen - 4];
        if (sep == '-' || sep == '_' || sep == '.' || sep == ' ') {
            if ((clean[clen - 3] == 'p' || clean[clen - 3] == 'P') &&
                (clean[clen - 2] == 's' || clean[clen - 2] == 'S') &&
                (clean[clen - 1] == '4' || clean[clen - 1] == '5')) {
                clean[clen - 4] = '\0';
            }
        }
    }

    /* If clean ended up empty, use base name */
    if (clean[0] == '\0') {
        strncpy(clean, base, sizeof(clean) - 1);
        clean[sizeof(clean) - 1] = '\0';
        dot = strrchr(clean, '.');
        if (dot) *dot = '\0';
    }

    return slot_slug(clean, out_key, out_size);
}

int slot_repo_key(const char *id, const char *source_url, char *out_slot, size_t out_size) {
    if (!id || !source_url || !out_slot || out_size == 0) return -1;

    char safe_id[128];
    slot_slug(id, safe_id, sizeof(safe_id));

    char hash8[16];
    if (slot_source_hash(source_url, hash8, sizeof(hash8)) != 0) return -1;

    snprintf(out_slot, out_size, "repo/%s@%s", safe_id, hash8);
    return 0;
}

int slot_find_next_local_key(const char *base_key, char *out_slot, size_t out_size) {
    if (!base_key || !out_slot || out_size == 0) return -1;

    char safe_key[128];
    slot_slug(base_key, safe_key, sizeof(safe_key));

    char check_path[640];
    snprintf(check_path, sizeof(check_path), "%s/local/%s", PAYLOADS_STORAGE_DIR, safe_key);
    if (access(check_path, F_OK) != 0) {
        snprintf(out_slot, out_size, "local/%s", safe_key);
        return 0;
    }

    for (int i = 2; i <= 1000; i++) {
        snprintf(check_path, sizeof(check_path), "%s/local/%s-%d", PAYLOADS_STORAGE_DIR, safe_key, i);
        if (access(check_path, F_OK) != 0) {
            snprintf(out_slot, out_size, "local/%s-%d", safe_key, i);
            return 0;
        }
    }

    snprintf(out_slot, out_size, "local/%s-new", safe_key);
    return 0;
}

int slot_read_meta(const char *slot_dir, SlotMeta *out_meta) {
    if (!slot_dir || !out_meta) return -1;
    memset(out_meta, 0, sizeof(SlotMeta));

    strncpy(out_meta->slot_dir, slot_dir, sizeof(out_meta->slot_dir) - 1);

    /* Derive slot_key from slot_dir (relative to PAYLOADS_STORAGE_DIR) */
    const char *rel = slot_dir;
    size_t base_len = strlen(PAYLOADS_STORAGE_DIR);
    if (strncmp(slot_dir, PAYLOADS_STORAGE_DIR, base_len) == 0) {
        rel = slot_dir + base_len;
        if (*rel == '/') rel++;
    }
    strncpy(out_meta->slot_key, rel, sizeof(out_meta->slot_key) - 1);

    char meta_path[640];
    snprintf(meta_path, sizeof(meta_path), "%s/meta.json", slot_dir);

    char *json = NULL;
    size_t size = 0;
    if (read_file_text(meta_path, &json, &size) == 0 && json && size > 0) {
        const char *end = json + size;
        char schema_str[16] = "";
        json_extract_string(json, end, "schema", schema_str, sizeof(schema_str));
        out_meta->schema = atoi(schema_str);
        if (out_meta->schema == 0) out_meta->schema = 2;

        json_extract_string(json, end, "kind", out_meta->kind, sizeof(out_meta->kind));
        json_extract_string(json, end, "filename", out_meta->filename, sizeof(out_meta->filename));
        json_extract_string(json, end, "installed_at", out_meta->installed_at, sizeof(out_meta->installed_at));

        /* Repo fields */
        json_extract_string(json, end, "id", out_meta->id, sizeof(out_meta->id));
        json_extract_string(json, end, "source_url", out_meta->source_url, sizeof(out_meta->source_url));
        json_extract_string(json, end, "source_name", out_meta->source_name, sizeof(out_meta->source_name));
        if (out_meta->source_name[0] == '\0' && out_meta->source_url[0] != '\0') {
            if (strcmp(out_meta->source_url, REPOSITORY_SOURCE_URL) == 0) {
                strncpy(out_meta->source_name, "Official Repository", sizeof(out_meta->source_name) - 1);
            }
        }
        json_extract_string(json, end, "name", out_meta->name, sizeof(out_meta->name));
        json_extract_string(json, end, "version", out_meta->version, sizeof(out_meta->version));
        json_extract_string(json, end, "checksum", out_meta->checksum, sizeof(out_meta->checksum));
        json_extract_string(json, end, "last_update", out_meta->last_update, sizeof(out_meta->last_update));
        json_extract_string(json, end, "url", out_meta->url, sizeof(out_meta->url));
        json_extract_string(json, end, "source", out_meta->source, sizeof(out_meta->source));
        json_extract_string(json, end, "source_direct", out_meta->source_direct, sizeof(out_meta->source_direct));
        json_extract_string(json, end, "category", out_meta->category, sizeof(out_meta->category));
        json_extract_string(json, end, "description", out_meta->description, sizeof(out_meta->description));
        json_extract_string(json, end, "author", out_meta->author, sizeof(out_meta->author));
        json_extract_string(json, end, "details_url", out_meta->details_url, sizeof(out_meta->details_url));

        /* Local fields */
        json_extract_string(json, end, "origin", out_meta->origin, sizeof(out_meta->origin));
        json_extract_string(json, end, "origin_detail", out_meta->origin_detail, sizeof(out_meta->origin_detail));

        free(json);
    } else {
        if (json) free(json);
        /* If meta.json is absent, detect kind from slot_key prefix */
        if (strncmp(out_meta->slot_key, "repo/", 5) == 0) {
            strcpy(out_meta->kind, SLOT_KIND_REPO);
        } else {
            strcpy(out_meta->kind, SLOT_KIND_LOCAL);
            strcpy(out_meta->origin, "web_upload");
        }
        out_meta->schema = PAYLOAD_SLOT_SCHEMA;
    }

    /* Find actual payload file in slot_dir */
    if (out_meta->filename[0] != '\0') {
        char test_path[640];
        snprintf(test_path, sizeof(test_path), "%s/%s", slot_dir, out_meta->filename);
        if (access(test_path, F_OK) == 0) {
            strncpy(out_meta->payload_path, test_path, sizeof(out_meta->payload_path) - 1);
            out_meta->payload_path[sizeof(out_meta->payload_path) - 1] = '\0';
        }
    }

    if (out_meta->payload_path[0] == '\0') {
        DIR *d = opendir(slot_dir);
        if (d) {
            struct dirent *ent;
            while ((ent = readdir(d)) != NULL) {
                if (ent->d_name[0] == '.') continue;
                if (strcmp(ent->d_name, "meta.json") == 0) continue;
                if (is_supported_ext(ent->d_name)) {
                    snprintf(out_meta->payload_path, sizeof(out_meta->payload_path),
                             "%s/%s", slot_dir, ent->d_name);
                    if (out_meta->filename[0] == '\0') {
                        strncpy(out_meta->filename, ent->d_name, sizeof(out_meta->filename) - 1);
                    }
                    break;
                }
            }
            closedir(d);
        }
    }

    if (out_meta->payload_path[0] == '\0' && out_meta->filename[0] != '\0') {
        snprintf(out_meta->payload_path, sizeof(out_meta->payload_path),
                 "%s/%s", slot_dir, out_meta->filename);
    }

    return 0;
}

int slot_write_meta(const char *slot_dir, const SlotMeta *meta) {
    if (!slot_dir || !meta) return -1;

    char buf[8192];
    JsonListBuilder jb = { buf, sizeof(buf), 0, 1 };

    char fn_e[512], at_e[128];
    pldmgr_json_escape(meta->filename, fn_e, sizeof(fn_e));
    pldmgr_json_escape(meta->installed_at, at_e, sizeof(at_e));

    json_append(&jb, "{\n"
                     "  \"schema\": %d,\n"
                     "  \"kind\": \"%s\",\n"
                     "  \"filename\": \"%s\",\n"
                     "  \"installed_at\": \"%s\"",
                meta->schema ? meta->schema : PAYLOAD_SLOT_SCHEMA,
                meta->kind[0] ? meta->kind : SLOT_KIND_LOCAL,
                fn_e, at_e);

    if (strcmp(meta->kind, SLOT_KIND_REPO) == 0) {
        char id_e[256], surl_e[2048], sname_e[512], name_e[512], ver_e[128];
        char csum_e[128], lup_e[128], url_e[2048], src_e[2048], sd_e[2048];
        char cat_e[256], desc_e[2048], auth_e[256], det_e[2048];

        pldmgr_json_escape(meta->id, id_e, sizeof(id_e));
        pldmgr_json_escape(meta->source_url, surl_e, sizeof(surl_e));
        pldmgr_json_escape(meta->source_name, sname_e, sizeof(sname_e));
        pldmgr_json_escape(meta->name, name_e, sizeof(name_e));
        pldmgr_json_escape(meta->version, ver_e, sizeof(ver_e));
        pldmgr_json_escape(meta->checksum, csum_e, sizeof(csum_e));
        pldmgr_json_escape(meta->last_update, lup_e, sizeof(lup_e));
        pldmgr_json_escape(meta->url, url_e, sizeof(url_e));
        pldmgr_json_escape(meta->source, src_e, sizeof(src_e));
        pldmgr_json_escape(meta->source_direct, sd_e, sizeof(sd_e));
        pldmgr_json_escape(meta->category, cat_e, sizeof(cat_e));
        pldmgr_json_escape(meta->description, desc_e, sizeof(desc_e));
        pldmgr_json_escape(meta->author, auth_e, sizeof(auth_e));
        pldmgr_json_escape(meta->details_url, det_e, sizeof(det_e));

        json_append(&jb, ",\n"
                         "  \"id\": \"%s\",\n"
                         "  \"source_url\": \"%s\",\n"
                         "  \"source_name\": \"%s\",\n"
                         "  \"name\": \"%s\",\n"
                         "  \"version\": \"%s\",\n"
                         "  \"checksum\": \"%s\",\n"
                         "  \"last_update\": \"%s\",\n"
                         "  \"url\": \"%s\",\n"
                         "  \"source\": \"%s\",\n"
                         "  \"source_direct\": \"%s\",\n"
                         "  \"category\": \"%s\",\n"
                         "  \"description\": \"%s\",\n"
                         "  \"author\": \"%s\",\n"
                         "  \"details_url\": \"%s\"",
                    id_e, surl_e, sname_e, name_e, ver_e,
                    csum_e, lup_e, url_e, src_e, sd_e,
                    cat_e, desc_e, auth_e, det_e);
    } else {
        char org_e[128], od_e[2048];
        pldmgr_json_escape(meta->origin, org_e, sizeof(org_e));
        pldmgr_json_escape(meta->origin_detail, od_e, sizeof(od_e));

        json_append(&jb, ",\n"
                         "  \"origin\": \"%s\",\n"
                         "  \"origin_detail\": \"%s\"",
                    org_e, od_e);
    }

    json_append(&jb, "\n}\n");

    char tmp_path[640], final_path[640];
    snprintf(tmp_path, sizeof(tmp_path), "%s/meta.json.tmp", slot_dir);
    snprintf(final_path, sizeof(final_path), "%s/meta.json", slot_dir);

    if (write_file_text(tmp_path, buf, jb.pos) != 0) {
        remove(tmp_path);
        return -1;
    }

    return rename(tmp_path, final_path);
}

static void scan_slot_subdir(const char *parent_dir, SlotMeta **out_slots, size_t *out_count) {
    DIR *d = opendir(parent_dir);
    if (!d) return;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (ent->d_name[0] == '.') continue;

        char sub_path[512];
        snprintf(sub_path, sizeof(sub_path), "%s/%s", parent_dir, ent->d_name);

        struct stat st;
        if (stat(sub_path, &st) != 0 || !S_ISDIR(st.st_mode)) continue;

        SlotMeta meta;
        if (slot_read_meta(sub_path, &meta) == 0 && meta.payload_path[0] != '\0') {
            SlotMeta *tmp = realloc(*out_slots, (*out_count + 1) * sizeof(SlotMeta));
            if (!tmp) break;
            *out_slots = tmp;
            (*out_slots)[*out_count] = meta;
            (*out_count)++;
        }
    }
    closedir(d);
}

int slot_list_all(SlotMeta **out_slots, size_t *out_count) {
    if (!out_slots || !out_count) return -1;
    *out_slots = NULL;
    *out_count = 0;

    char repo_dir[512], local_dir[512];
    snprintf(repo_dir, sizeof(repo_dir), "%s/repo", PAYLOADS_STORAGE_DIR);
    snprintf(local_dir, sizeof(local_dir), "%s/local", PAYLOADS_STORAGE_DIR);

    scan_slot_subdir(repo_dir, out_slots, out_count);
    scan_slot_subdir(local_dir, out_slots, out_count);

    return 0;
}

void slot_free_all(SlotMeta *slots) {
    if (slots) free(slots);
}

int slot_resolve(const char *slot_or_path, char *out_path, size_t out_size) {
    if (!slot_or_path || !out_path || out_size == 0) return -1;

    /* If it is an absolute path that exists */
    if (slot_or_path[0] == '/') {
        struct stat st;
        if (stat(slot_or_path, &st) == 0 && S_ISREG(st.st_mode)) {
            strncpy(out_path, slot_or_path, out_size - 1);
            out_path[out_size - 1] = '\0';
            return 0;
        }
    }

    /* If it matches a slot key (starts with repo/ or local/) */
    if (strncmp(slot_or_path, "repo/", 5) == 0 || strncmp(slot_or_path, "local/", 6) == 0) {
        char slot_dir[640];
        snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, slot_or_path);

        SlotMeta meta;
        if (slot_read_meta(slot_dir, &meta) == 0 && meta.payload_path[0] != '\0') {
            struct stat st;
            if (stat(meta.payload_path, &st) == 0 && S_ISREG(st.st_mode)) {
                strncpy(out_path, meta.payload_path, out_size - 1);
                out_path[out_size - 1] = '\0';
                return 0;
            }
        }
    }

    /* If slot_or_path is under PAYLOADS_STORAGE_DIR */
    size_t base_len = strlen(PAYLOADS_STORAGE_DIR);
    if (strncmp(slot_or_path, PAYLOADS_STORAGE_DIR, base_len) == 0 && slot_or_path[base_len] == '/') {
        const char *rel = slot_or_path + base_len + 1;
        if (strncmp(rel, "repo/", 5) == 0 || strncmp(rel, "local/", 6) == 0) {
            char extracted_key[256];
            strncpy(extracted_key, rel, sizeof(extracted_key) - 1);
            extracted_key[sizeof(extracted_key) - 1] = '\0';
            char *s1 = strchr(extracted_key, '/');
            if (s1) {
                char *s2 = strchr(s1 + 1, '/');
                if (s2) *s2 = '\0';
            }
            char slot_dir[640];
            snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, extracted_key);
            SlotMeta meta;
            if (slot_read_meta(slot_dir, &meta) == 0 && meta.payload_path[0] != '\0') {
                struct stat st;
                if (stat(meta.payload_path, &st) == 0 && S_ISREG(st.st_mode)) {
                    strncpy(out_path, meta.payload_path, out_size - 1);
                    out_path[out_size - 1] = '\0';
                    return 0;
                }
            }
        }
    }

    /* Fallback: scan all slots to find matching payload filename or payload_path */
    const char *target_fn = strrchr(slot_or_path, '/');
    target_fn = target_fn ? target_fn + 1 : slot_or_path;

    SlotMeta *slots = NULL;
    size_t count = 0;
    if (slot_list_all(&slots, &count) == 0 && slots) {
        for (size_t i = 0; i < count; i++) {
            if (strcmp(slots[i].filename, target_fn) == 0 ||
                strcmp(slots[i].payload_path, slot_or_path) == 0) {
                strncpy(out_path, slots[i].payload_path, out_size - 1);
                out_path[out_size - 1] = '\0';
                slot_free_all(slots);
                return 0;
            }
        }
        slot_free_all(slots);
    }

    return -1;
}

int slot_delete(const char *slot_key) {
    if (!slot_key || slot_key[0] == '\0') return -1;
    if (strstr(slot_key, "..") || slot_key[0] == '/') return -1;

    char slot_dir[640];
    snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, slot_key);

    DIR *d = opendir(slot_dir);
    if (!d) return -1;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
        char file_path[768];
        snprintf(file_path, sizeof(file_path), "%s/%s", slot_dir, ent->d_name);
        remove(file_path);
    }
    closedir(d);

    rmdir(slot_dir);

    /* Remove from autoload.txt and favorites.txt */
    pldmgr_autoload_update_config_entry(slot_key, NULL);
    pldmgr_favorites_update_entry(slot_key, NULL);

    return 0;
}

int slot_version_compare(const char *v1, const char *v2) {
    if (!v1 && !v2) return 0;
    if (!v1) return -1;
    if (!v2) return 1;

    /* 1. Trim whitespace */
    while (*v1 && isspace((unsigned char)*v1)) v1++;
    while (*v2 && isspace((unsigned char)*v2)) v2++;

    /* Drop leading v / V */
    if (*v1 == 'v' || *v1 == 'V') v1++;
    if (*v2 == 'v' || *v2 == 'V') v2++;

    const char *p1 = v1;
    const char *p2 = v2;

    while (*p1 || *p2) {
        /* Skip non-alphanumeric separators */
        while (*p1 && !isalnum((unsigned char)*p1)) p1++;
        while (*p2 && !isalnum((unsigned char)*p2)) p2++;

        if (!*p1 && !*p2) break;

        /* If one side ran out of tokens */
        if (!*p1) {
            /* Remaining token is letters -> pre-release -> lower -> v1 > v2 */
            if (isalpha((unsigned char)*p2)) return 1;
            /* Remaining token is digits -> sub-version -> higher -> v1 < v2 */
            return -1;
        }
        if (!*p2) {
            if (isalpha((unsigned char)*p1)) return -1;
            return 1;
        }

        int is_digit1 = isdigit((unsigned char)*p1);
        int is_digit2 = isdigit((unsigned char)*p2);

        /* Digit > Letter at same position */
        if (is_digit1 && !is_digit2) return 1;
        if (!is_digit1 && is_digit2) return -1;

        if (is_digit1 && is_digit2) {
            const char *s1 = p1;
            while (*p1 && isdigit((unsigned char)*p1)) p1++;
            size_t len1 = p1 - s1;

            const char *s2 = p2;
            while (*p2 && isdigit((unsigned char)*p2)) p2++;
            size_t len2 = p2 - s2;

            /* Strip leading zeros */
            while (len1 > 1 && *s1 == '0') { s1++; len1--; }
            while (len2 > 1 && *s2 == '0') { s2++; len2--; }

            if (len1 != len2) {
                return (len1 > len2) ? 1 : -1;
            }
            int cmp = memcmp(s1, s2, len1);
            if (cmp != 0) return cmp > 0 ? 1 : -1;
        } else {
            const char *s1 = p1;
            while (*p1 && isalpha((unsigned char)*p1)) p1++;
            size_t len1 = p1 - s1;

            const char *s2 = p2;
            while (*p2 && isalpha((unsigned char)*p2)) p2++;
            size_t len2 = p2 - s2;

            size_t min_len = len1 < len2 ? len1 : len2;
            for (size_t i = 0; i < min_len; i++) {
                int c1 = tolower((unsigned char)s1[i]);
                int c2 = tolower((unsigned char)s2[i]);
                if (c1 != c2) return c1 - c2;
            }
            if (len1 != len2) {
                return (len1 > len2) ? 1 : -1;
            }
        }
    }

    return 0;
}

#define LAYOUT_MARKER_PATH PAYLOADS_STORAGE_DIR "/.layout"
#define LEGACY_PATHS_MAP_PATH PAYLOADS_STORAGE_DIR "/.legacy_paths.json"

typedef struct MigrationMapEntry {
    char old_path[512];
    char old_filename[256];
    char slot_key[128];
} MigrationMapEntry;

int slot_migrate_legacy(void) {
    ensure_dir_recursive(PAYLOADS_STORAGE_DIR);

    /* Check layout marker */
    char *layout_content = NULL;
    size_t layout_size = 0;
    if (read_file_text(LAYOUT_MARKER_PATH, &layout_content, &layout_size) == 0 && layout_content) {
        if (atoi(layout_content) >= 2) {
            free(layout_content);
            return 0;
        }
        free(layout_content);
    }

    pldmgr_log("[PLDMGR] Starting one-time storage layout migration...\n");

    char repo_root[512], local_root[512];
    snprintf(repo_root, sizeof(repo_root), "%s/repo", PAYLOADS_STORAGE_DIR);
    snprintf(local_root, sizeof(local_root), "%s/local", PAYLOADS_STORAGE_DIR);
    ensure_dir_recursive(repo_root);
    ensure_dir_recursive(local_root);

    DIR *d = opendir(PAYLOADS_STORAGE_DIR);
    if (!d) return -1;

    MigrationMapEntry *map = NULL;
    size_t map_count = 0;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (ent->d_name[0] == '.') continue;
        if (strcmp(ent->d_name, "repo") == 0 || strcmp(ent->d_name, "local") == 0) continue;

        char legacy_subdir[512];
        snprintf(legacy_subdir, sizeof(legacy_subdir), "%s/%s", PAYLOADS_STORAGE_DIR, ent->d_name);

        struct stat st;
        if (stat(legacy_subdir, &st) != 0 || !S_ISDIR(st.st_mode)) continue;

        DIR *sub = opendir(legacy_subdir);
        if (!sub) continue;

        struct dirent *sub_ent;
        while ((sub_ent = readdir(sub)) != NULL) {
            if (sub_ent->d_name[0] == '.') continue;
            if (!is_supported_ext(sub_ent->d_name)) continue;

            char old_file_path[640];
            snprintf(old_file_path, sizeof(old_file_path), "%s/%s", legacy_subdir, sub_ent->d_name);

            /* Read legacy sidecar if exists */
            char sidecar_path[700];
            snprintf(sidecar_path, sizeof(sidecar_path), "%s.json", old_file_path);

            SlotMeta new_meta;
            memset(&new_meta, 0, sizeof(new_meta));
            new_meta.schema = PAYLOAD_SLOT_SCHEMA;
            strncpy(new_meta.filename, sub_ent->d_name, sizeof(new_meta.filename) - 1);

            time_t now = time(NULL);
            struct tm tmv;
            localtime_r(&now, &tmv);
            strftime(new_meta.installed_at, sizeof(new_meta.installed_at), "%Y-%m-%dT%H:%M:%S%z", &tmv);

            char *sc_json = NULL;
            size_t sc_size = 0;
            char inst_src[128] = "", inst_detail[1024] = "";
            char sc_name[256] = "";

            if (read_file_text(sidecar_path, &sc_json, &sc_size) == 0 && sc_json) {
                const char *end = sc_json + sc_size;
                json_extract_string(sc_json, end, "install_source", inst_src, sizeof(inst_src));
                json_extract_string(sc_json, end, "install_source_detail", inst_detail, sizeof(inst_detail));
                json_extract_string(sc_json, end, "name", sc_name, sizeof(sc_name));
                json_extract_string(sc_json, end, "id", new_meta.id, sizeof(new_meta.id));
                json_extract_string(sc_json, end, "version", new_meta.version, sizeof(new_meta.version));
                json_extract_string(sc_json, end, "checksum", new_meta.checksum, sizeof(new_meta.checksum));
                json_extract_string(sc_json, end, "last_update", new_meta.last_update, sizeof(new_meta.last_update));
                json_extract_string(sc_json, end, "url", new_meta.url, sizeof(new_meta.url));
                json_extract_string(sc_json, end, "source", new_meta.source, sizeof(new_meta.source));
                json_extract_string(sc_json, end, "source_direct", new_meta.source_direct, sizeof(new_meta.source_direct));
                json_extract_string(sc_json, end, "category", new_meta.category, sizeof(new_meta.category));
                json_extract_string(sc_json, end, "description", new_meta.description, sizeof(new_meta.description));
                json_extract_string(sc_json, end, "author", new_meta.author, sizeof(new_meta.author));
                json_extract_string(sc_json, end, "details_url", new_meta.details_url, sizeof(new_meta.details_url));
                json_extract_string(sc_json, end, "source_name", new_meta.source_name, sizeof(new_meta.source_name));
                free(sc_json);
            }

            char target_slot[128] = "";
            if (strcmp(inst_src, "repository") == 0) {
                strcpy(new_meta.kind, SLOT_KIND_REPO);
                const char *surl = inst_detail[0] ? inst_detail : REPOSITORY_SOURCE_URL;
                strncpy(new_meta.source_url, surl, sizeof(new_meta.source_url) - 1);
                if (strcmp(new_meta.source_url, REPOSITORY_SOURCE_URL) == 0) {
                    strncpy(new_meta.source_name, "Official Repository", sizeof(new_meta.source_name) - 1);
                }
                if (sc_name[0]) {
                    strncpy(new_meta.name, sc_name, sizeof(new_meta.name) - 1);
                } else {
                    strncpy(new_meta.name, sub_ent->d_name, sizeof(new_meta.name) - 1);
                }
                if (new_meta.id[0] == '\0') {
                    slot_slug(new_meta.name, new_meta.id, sizeof(new_meta.id));
                }
                slot_repo_key(new_meta.id, new_meta.source_url, target_slot, sizeof(target_slot));
            } else {
                strcpy(new_meta.kind, SLOT_KIND_LOCAL);
                if (strcmp(inst_src, "usb") == 0) {
                    strcpy(new_meta.origin, "usb");
                    strncpy(new_meta.origin_detail, inst_detail, sizeof(new_meta.origin_detail) - 1);
                } else {
                    strcpy(new_meta.origin, "web_upload");
                }
                char lkey[128];
                slot_local_key(sub_ent->d_name, lkey, sizeof(lkey));
                slot_find_next_local_key(lkey, target_slot, sizeof(target_slot));
            }

            strncpy(new_meta.slot_key, target_slot, sizeof(new_meta.slot_key) - 1);

            char new_slot_dir[640];
            snprintf(new_slot_dir, sizeof(new_slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, target_slot);
            ensure_dir_recursive(new_slot_dir);

            char new_file_path[768];
            snprintf(new_file_path, sizeof(new_file_path), "%s/%s", new_slot_dir, sub_ent->d_name);

            /* Move payload file */
            if (rename(old_file_path, new_file_path) == 0) {
                slot_write_meta(new_slot_dir, &new_meta);
                remove(sidecar_path);

                /* Remove any .part or .tmp for this file */
                char part_path[700];
                snprintf(part_path, sizeof(part_path), "%s.part", old_file_path);
                remove(part_path);
                snprintf(part_path, sizeof(part_path), "%s.tmp", old_file_path);
                remove(part_path);

                /* Record in map */
                MigrationMapEntry *tmp = realloc(map, (map_count + 1) * sizeof(MigrationMapEntry));
                if (tmp) {
                    map = tmp;
                    strncpy(map[map_count].old_path, old_file_path, sizeof(map[map_count].old_path) - 1);
                    strncpy(map[map_count].old_filename, sub_ent->d_name, sizeof(map[map_count].old_filename) - 1);
                    strncpy(map[map_count].slot_key, target_slot, sizeof(map[map_count].slot_key) - 1);
                    map_count++;
                }

                pldmgr_log("[PLDMGR] Migrated: %s -> %s\n", old_file_path, target_slot);
            }
        }
        closedir(sub);

        /* Try removing legacy subdir if empty */
        rmdir(legacy_subdir);
    }
    closedir(d);

    /* Update autoload.txt */
    if (map && map_count > 0) {
        FILE *af = fopen(AUTOLOAD_CONFIG_PATH, "r");
        if (af) {
            char lines[128][256];
            int lcount = 0;
            while (lcount < 128 && fgets(lines[lcount], sizeof(lines[0]), af)) {
                lines[lcount][strcspn(lines[lcount], "\r\n")] = '\0';
                char *start = lines[lcount];
                while (*start && isspace((unsigned char)*start)) start++;
                char *end = start + strlen(start);
                while (end > start && isspace((unsigned char)*(end - 1))) end--;
                *end = '\0';
                if (start != lines[lcount]) memmove(lines[lcount], start, end - start + 1);
                lcount++;
            }
            fclose(af);

            int changed = 0;
            for (int i = 0; i < lcount; i++) {
                if (lines[i][0] == '!' || lines[i][0] == '\0') continue;
                /* If line is already a slot key, leave it */
                if (strncmp(lines[i], "repo/", 5) == 0 || strncmp(lines[i], "local/", 6) == 0) continue;

                for (size_t m = 0; m < map_count; m++) {
                    if (strcmp(lines[i], map[m].old_filename) == 0 ||
                        strcmp(lines[i], map[m].old_path) == 0) {
                        strncpy(lines[i], map[m].slot_key, sizeof(lines[0]) - 1);
                        changed = 1;
                        break;
                    }
                }
            }

            if (changed) {
                af = fopen(AUTOLOAD_CONFIG_PATH, "w");
                if (af) {
                    for (int i = 0; i < lcount; i++) {
                        fprintf(af, "%s\n", lines[i]);
                    }
                    fclose(af);
                }
            }
        }

        /* Update favorites.txt if exists */
        FILE *ff = fopen(FAVORITES_CONFIG_PATH, "r");
        if (ff) {
            char lines[128][256];
            int lcount = 0;
            while (lcount < 128 && fgets(lines[lcount], sizeof(lines[0]), ff)) {
                lines[lcount][strcspn(lines[lcount], "\r\n")] = '\0';
                char *start = lines[lcount];
                while (*start && isspace((unsigned char)*start)) start++;
                char *end = start + strlen(start);
                while (end > start && isspace((unsigned char)*(end - 1))) end--;
                *end = '\0';
                if (start != lines[lcount]) memmove(lines[lcount], start, end - start + 1);
                lcount++;
            }
            fclose(ff);

            int changed = 0;
            for (int i = 0; i < lcount; i++) {
                if (lines[i][0] == '\0') continue;
                if (strncmp(lines[i], "repo/", 5) == 0 || strncmp(lines[i], "local/", 6) == 0) continue;

                for (size_t m = 0; m < map_count; m++) {
                    if (strcmp(lines[i], map[m].old_filename) == 0 ||
                        strcmp(lines[i], map[m].old_path) == 0) {
                        strncpy(lines[i], map[m].slot_key, sizeof(lines[0]) - 1);
                        changed = 1;
                        break;
                    }
                }
            }

            if (changed) {
                ff = fopen(FAVORITES_CONFIG_PATH, "w");
                if (ff) {
                    for (int i = 0; i < lcount; i++) {
                        fprintf(ff, "%s\n", lines[i]);
                    }
                    fclose(ff);
                }
            }
        }

        /* Write legacy paths JSON file for frontend favorites remapping */
        char lp_buf[16384];
        JsonListBuilder jb = { lp_buf, sizeof(lp_buf), 0, 1 };
        json_append(&jb, "{\n");
        for (size_t m = 0; m < map_count; m++) {
            char op_e[1024], of_e[512], sk_e[256];
            pldmgr_json_escape(map[m].old_path, op_e, sizeof(op_e));
            pldmgr_json_escape(map[m].old_filename, of_e, sizeof(of_e));
            pldmgr_json_escape(map[m].slot_key, sk_e, sizeof(sk_e));
            json_append(&jb, "  \"%s\": \"%s\",\n", op_e, sk_e);
            json_append(&jb, "  \"%s\": \"%s\"%s\n", of_e, sk_e, (m + 1 < map_count) ? "," : "");
        }
        json_append(&jb, "}\n");
        write_file_text(LEGACY_PATHS_MAP_PATH, lp_buf, jb.pos);
        free(map);
    }

    /* Write layout marker 2 */
    write_file_text(LAYOUT_MARKER_PATH, "2\n", 2);
    pldmgr_log("[PLDMGR] Migration completed successfully. Layout v2 active.\n");
    return 0;
}

int slot_pop_legacy_paths_json(char *buf, size_t buf_size) {
    if (!buf || buf_size == 0) return -1;
    char *content = NULL;
    size_t size = 0;
    if (read_file_text(LEGACY_PATHS_MAP_PATH, &content, &size) == 0 && content) {
        if (size >= buf_size) size = buf_size - 1;
        memcpy(buf, content, size);
        buf[size] = '\0';
        free(content);
        remove(LEGACY_PATHS_MAP_PATH);
        return 0;
    }
    return -1;
}
