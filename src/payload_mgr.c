#include <ctype.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "payload_mgr.h"
#include "slot.h"
#include "json_helpers.h"
#include "sha256.h"
#include "repository.h"
#include "config.h"
#include "pldmgr.h"
#include "autoload.h"
#include "utils.h"

/* ── Extension / path checks ──────────────────────────────── */

static int is_supported_extension(const char *path) {
    const char *ext = strrchr(path, '.');
    if (!ext) return 0;
    return (strcasecmp(ext, ".elf") == 0 || strcasecmp(ext, ".bin") == 0);
}

static int is_allowed_usb_path(const char *path) {
    if (!path || path[0] == '\0') return 0;
    if (strstr(path, "..")) return 0;
    if (!is_supported_extension(path)) return 0;
    if (strncmp(path, "/mnt/usb", 8) == 0 && path[8] >= '0' && path[8] <= '7' &&
        path[9] == '/') {
        return 1;
    }
    return 0;
}

static int copy_file(const char *src, const char *dst) {
    FILE *in = fopen(src, "rb");
    if (!in) return -1;
    FILE *out = fopen(dst, "wb");
    if (!out) {
        fclose(in);
        return -1;
    }
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), in)) > 0) {
        if (fwrite(buf, 1, n, out) != n) {
            fclose(in);
            fclose(out);
            return -1;
        }
    }
    fclose(in);
    fclose(out);
    return 0;
}

/* ── USB Scanning (Unmanaged, run-in-place) ─────────────────── */

static void scan_usb_dir(const char *dir_path, char ***out_paths, int *count, int *cap) {
    DIR *d = opendir(dir_path);
    if (!d) return;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (ent->d_name[0] == '.') continue;

        char full[512];
        snprintf(full, sizeof(full), "%s/%s", dir_path, ent->d_name);

        struct stat st;
        if (stat(full, &st) != 0) continue;

        if (S_ISDIR(st.st_mode)) {
            /* Scan 1 level deep */
            DIR *sub = opendir(full);
            if (sub) {
                struct dirent *sub_ent;
                while ((sub_ent = readdir(sub)) != NULL) {
                    if (sub_ent->d_name[0] == '.') continue;
                    if (is_supported_extension(sub_ent->d_name)) {
                        char sub_full[640];
                        snprintf(sub_full, sizeof(sub_full), "%s/%s", full, sub_ent->d_name);
                        if (*count >= *cap) {
                            *cap = (*cap == 0) ? 32 : (*cap * 2);
                            *out_paths = realloc(*out_paths, *cap * sizeof(char *));
                        }
                        (*out_paths)[*count] = strdup(sub_full);
                        (*count)++;
                    }
                }
                closedir(sub);
            }
        } else if (is_supported_extension(ent->d_name)) {
            if (*count >= *cap) {
                *cap = (*cap == 0) ? 32 : (*cap * 2);
                *out_paths = realloc(*out_paths, *cap * sizeof(char *));
            }
            (*out_paths)[*count] = strdup(full);
            (*count)++;
        }
    }
    closedir(d);
}

/* ── Listing API ───────────────────────────────────────────── */

size_t payload_mgr_list_json(char *json_buf, size_t buf_size) {
    SlotMeta *slots = NULL;
    size_t slot_count = 0;
    slot_list_all(&slots, &slot_count);

    /* Enumerate USB payloads */
    char **usb_paths = NULL;
    int usb_count = 0, usb_cap = 0;
    int scan_usb = config_read_bool("SCAN_USB_PAYLOADS", 0);

    for (int u = 0; u < 8; u++) {
        char pldmgr_usb[64];
        snprintf(pldmgr_usb, sizeof(pldmgr_usb), "/mnt/usb%d/pldmgr", u);
        scan_usb_dir(pldmgr_usb, &usb_paths, &usb_count, &usb_cap);

        if (scan_usb) {
            char root_usb[64];
            snprintf(root_usb, sizeof(root_usb), "/mnt/usb%d", u);
            DIR *d = opendir(root_usb);
            if (d) {
                struct dirent *ent;
                while ((ent = readdir(d)) != NULL) {
                    if (ent->d_name[0] == '.') continue;
                    if (is_supported_extension(ent->d_name)) {
                        char full[512];
                        snprintf(full, sizeof(full), "%s/%s", root_usb, ent->d_name);
                        if (usb_count >= usb_cap) {
                            usb_cap = (usb_cap == 0) ? 32 : (usb_cap * 2);
                            usb_paths = realloc(usb_paths, usb_cap * sizeof(char *));
                        }
                        usb_paths[usb_count++] = strdup(full);
                    }
                }
                closedir(d);
            }
        }
    }

    /* Pop any legacy paths migration map */
    char legacy_map[8192] = "";
    int has_legacy = (slot_pop_legacy_paths_json(legacy_map, sizeof(legacy_map)) == 0 && legacy_map[0] != '\0');

    JsonListBuilder jb = { json_buf, buf_size, 0, 1 };
    json_append(&jb, "{\n  \"items\": [\n");

    for (size_t i = 0; i < slot_count; i++) {
        char sk_e[256], pp_e[1024], kind_e[64], fn_e[512];
        pldmgr_json_escape(slots[i].slot_key, sk_e, sizeof(sk_e));
        pldmgr_json_escape(slots[i].payload_path, pp_e, sizeof(pp_e));
        pldmgr_json_escape(slots[i].kind, kind_e, sizeof(kind_e));
        pldmgr_json_escape(slots[i].filename, fn_e, sizeof(fn_e));

        json_append(&jb, "    {\n"
                         "      \"slot\": \"%s\",\n"
                         "      \"path\": \"%s\",\n"
                         "      \"kind\": \"%s\",\n"
                         "      \"filename\": \"%s\"",
                    sk_e, pp_e, kind_e, fn_e);

        if (strcmp(slots[i].kind, SLOT_KIND_REPO) == 0) {
            char id_e[256], surl_e[2048], sname_e[512], name_e[512];
            char ver_e[128], csum_e[128], lup_e[128], auth_e[256], det_e[2048];

            pldmgr_json_escape(slots[i].id, id_e, sizeof(id_e));
            pldmgr_json_escape(slots[i].source_url, surl_e, sizeof(surl_e));
            pldmgr_json_escape(slots[i].source_name, sname_e, sizeof(sname_e));
            pldmgr_json_escape(slots[i].name, name_e, sizeof(name_e));
            pldmgr_json_escape(slots[i].version, ver_e, sizeof(ver_e));
            pldmgr_json_escape(slots[i].checksum, csum_e, sizeof(csum_e));
            pldmgr_json_escape(slots[i].last_update, lup_e, sizeof(lup_e));
            pldmgr_json_escape(slots[i].author, auth_e, sizeof(auth_e));
            pldmgr_json_escape(slots[i].details_url, det_e, sizeof(det_e));

            char src_e[2048], desc_e[2048];
            pldmgr_json_escape(slots[i].source, src_e, sizeof(src_e));
            pldmgr_json_escape(slots[i].description, desc_e, sizeof(desc_e));

            json_append(&jb, ",\n"
                             "      \"id\": \"%s\",\n"
                             "      \"source_url\": \"%s\",\n"
                             "      \"source_name\": \"%s\",\n"
                             "      \"name\": \"%s\",\n"
                             "      \"version\": \"%s\",\n"
                             "      \"checksum\": \"%s\",\n"
                             "      \"last_update\": \"%s\",\n"
                             "      \"author\": \"%s\",\n"
                             "      \"details_url\": \"%s\",\n"
                             "      \"source\": \"%s\",\n"
                             "      \"description\": \"%s\"",
                        id_e, surl_e, sname_e, name_e, ver_e,
                        csum_e, lup_e, auth_e, det_e, src_e, desc_e);
        } else {
            char org_e[128], od_e[2048];
            pldmgr_json_escape(slots[i].origin, org_e, sizeof(org_e));
            pldmgr_json_escape(slots[i].origin_detail, od_e, sizeof(od_e));

            json_append(&jb, ",\n"
                             "      \"origin\": \"%s\",\n"
                             "      \"origin_detail\": \"%s\"",
                        org_e, od_e);
        }

        json_append(&jb, "\n    }%s\n", (i + 1 < slot_count) ? "," : "");
    }

    json_append(&jb, "  ],\n  \"usb\": [\n");
    for (int u = 0; u < usb_count; u++) {
        char u_e[1024];
        pldmgr_json_escape(usb_paths[u], u_e, sizeof(u_e));
        json_append(&jb, "    \"%s\"%s\n", u_e, (u + 1 < usb_count) ? "," : "");
    }

    /* Provide payloads array containing all paths for backward compatibility */
    json_append(&jb, "  ],\n  \"payloads\": [\n");
    size_t total_p = slot_count + (size_t)usb_count;
    size_t curr_p = 0;
    for (size_t i = 0; i < slot_count; i++) {
        char pp_e[1024];
        pldmgr_json_escape(slots[i].payload_path, pp_e, sizeof(pp_e));
        curr_p++;
        json_append(&jb, "    \"%s\"%s\n", pp_e, (curr_p < total_p) ? "," : "");
    }
    for (int u = 0; u < usb_count; u++) {
        char u_e[1024];
        pldmgr_json_escape(usb_paths[u], u_e, sizeof(u_e));
        curr_p++;
        json_append(&jb, "    \"%s\"%s\n", u_e, (curr_p < total_p) ? "," : "");
    }

    if (has_legacy) {
        json_append(&jb, "  ],\n  \"legacy_paths\": %s\n}", legacy_map);
    } else {
        json_append(&jb, "  ]\n}\n");
    }

    slot_free_all(slots);
    for (int u = 0; u < usb_count; u++) free(usb_paths[u]);
    if (usb_paths) free(usb_paths);

    return jb.pos;
}

int payload_mgr_delete_payload(const char *slot_or_filename) {
    if (!slot_or_filename || slot_or_filename[0] == '\0') return -1;
    if (strstr(slot_or_filename, "..")) return -1;

    /* If it is a direct slot key */
    if (strncmp(slot_or_filename, "repo/", 5) == 0 || strncmp(slot_or_filename, "local/", 6) == 0) {
        return slot_delete(slot_or_filename);
    }

    /* If it starts with PAYLOADS_STORAGE_DIR */
    size_t base_len = strlen(PAYLOADS_STORAGE_DIR);
    if (strncmp(slot_or_filename, PAYLOADS_STORAGE_DIR, base_len) == 0 && slot_or_filename[base_len] == '/') {
        const char *rel = slot_or_filename + base_len + 1;
        if (strncmp(rel, "repo/", 5) == 0 || strncmp(rel, "local/", 6) == 0) {
            char extracted_slot[256];
            strncpy(extracted_slot, rel, sizeof(extracted_slot) - 1);
            extracted_slot[sizeof(extracted_slot) - 1] = '\0';
            char *s1 = strchr(extracted_slot, '/');
            if (s1) {
                char *s2 = strchr(s1 + 1, '/');
                if (s2) *s2 = '\0';
            }
            return slot_delete(extracted_slot);
        }
    }

    /* Fallback: match by filename or payload_path */
    const char *target_fn = strrchr(slot_or_filename, '/');
    target_fn = target_fn ? target_fn + 1 : slot_or_filename;

    SlotMeta *slots = NULL;
    size_t count = 0;
    if (slot_list_all(&slots, &count) == 0 && slots) {
        for (size_t i = 0; i < count; i++) {
            if (strcmp(slots[i].filename, target_fn) == 0 ||
                strcmp(slots[i].payload_path, slot_or_filename) == 0) {
                int res = slot_delete(slots[i].slot_key);
                slot_free_all(slots);
                return res;
            }
        }
        slot_free_all(slots);
    }

    return -1;
}

int payload_mgr_check_existing(const char *filename, char *out_json, size_t out_size) {
    if (!filename || filename[0] == '\0') {
        snprintf(out_json, out_size, "{\"status\":\"error\",\"message\":\"Missing filename\"}");
        return -1;
    }

    char lkey[128];
    slot_local_key(filename, lkey, sizeof(lkey));

    char check_dir[640];
    snprintf(check_dir, sizeof(check_dir), "%s/local/%s", PAYLOADS_STORAGE_DIR, lkey);

    SlotMeta meta;
    int exists = (slot_read_meta(check_dir, &meta) == 0 && meta.payload_path[0] != '\0');

    char key_e[256];
    pldmgr_json_escape(lkey, key_e, sizeof(key_e));

    if (exists) {
        char slot_e[256], fn_e[512];
        pldmgr_json_escape(meta.slot_key, slot_e, sizeof(slot_e));
        pldmgr_json_escape(meta.filename, fn_e, sizeof(fn_e));
        snprintf(out_json, out_size,
                 "{\"status\":\"ok\",\"key\":\"%s\",\"folder_exists\":true,\"file_exists\":true,"
                 "\"folder_name\":\"%s\",\"existing\":{\"slot\":\"%s\",\"filename\":\"%s\"}}",
                 key_e, key_e, slot_e, fn_e);
    } else {
        snprintf(out_json, out_size,
                 "{\"status\":\"ok\",\"key\":\"%s\",\"folder_exists\":false,\"file_exists\":false,"
                 "\"folder_name\":\"%s\",\"existing\":null}",
                 key_e, key_e);
    }
    return 0;
}

int payload_mgr_import_to_storage_mode(const char *filename, const char *temp_path,
                                       const char *mode, const char *install_source,
                                       const char *install_source_detail,
                                       char *msg_buf, size_t msg_buf_size,
                                       char *out_slot, size_t out_slot_size) {
    if (!filename || strstr(filename, "/") || strstr(filename, "..")) {
        snprintf(msg_buf, msg_buf_size, "Invalid filename");
        return -1;
    }

    char lkey[128];
    slot_local_key(filename, lkey, sizeof(lkey));

    char target_slot[128];
    if (mode && strcmp(mode, "keep_both") == 0) {
        slot_find_next_local_key(lkey, target_slot, sizeof(target_slot));
    } else {
        snprintf(target_slot, sizeof(target_slot), "local/%s", lkey);
    }

    char slot_dir[640];
    snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, target_slot);
    if (ensure_dir_recursive(slot_dir) != 0) {
        snprintf(msg_buf, msg_buf_size, "Failed to create slot directory");
        return -1;
    }

    /* Remove any previous payload in this slot */
    DIR *d = opendir(slot_dir);
    if (d) {
        struct dirent *ent;
        while ((ent = readdir(d)) != NULL) {
            if (ent->d_name[0] == '.') continue;
            if (strcmp(ent->d_name, "meta.json") == 0) continue;
            char old_f[768];
            snprintf(old_f, sizeof(old_f), "%s/%s", slot_dir, ent->d_name);
            remove(old_f);
        }
        closedir(d);
    }

    char final_path[768];
    snprintf(final_path, sizeof(final_path), "%s/%s", slot_dir, filename);

    if (rename(temp_path, final_path) != 0) {
        snprintf(msg_buf, msg_buf_size, "Failed to move file into slot");
        return -1;
    }

    SlotMeta meta;
    memset(&meta, 0, sizeof(meta));
    meta.schema = PAYLOAD_SLOT_SCHEMA;
    strcpy(meta.kind, SLOT_KIND_LOCAL);
    strncpy(meta.slot_key, target_slot, sizeof(meta.slot_key) - 1);
    strncpy(meta.slot_dir, slot_dir, sizeof(meta.slot_dir) - 1);
    strncpy(meta.payload_path, final_path, sizeof(meta.payload_path) - 1);
    strncpy(meta.filename, filename, sizeof(meta.filename) - 1);

    time_t now = time(NULL);
    struct tm tmv;
    localtime_r(&now, &tmv);
    strftime(meta.installed_at, sizeof(meta.installed_at), "%Y-%m-%dT%H:%M:%S%z", &tmv);

    strncpy(meta.origin, install_source ? install_source : "web_upload", sizeof(meta.origin) - 1);
    if (install_source_detail) {
        strncpy(meta.origin_detail, install_source_detail, sizeof(meta.origin_detail) - 1);
    }

    slot_write_meta(slot_dir, &meta);

    if (out_slot && out_slot_size > 0) {
        strncpy(out_slot, target_slot, out_slot_size - 1);
        out_slot[out_slot_size - 1] = '\0';
    }

    pldmgr_log("[PLDMGR] Local import complete: slot=%s filename=%s\n", target_slot, filename);
    snprintf(msg_buf, msg_buf_size, "Imported %s", filename);
    return 0;
}

int payload_mgr_usb_check(const char *usb_path, char *out_json, size_t out_size) {
    if (!is_allowed_usb_path(usb_path)) {
        snprintf(out_json, out_size, "{\"error\":\"Invalid USB path\"}");
        return -1;
    }

    struct stat st;
    if (stat(usb_path, &st) != 0) {
        snprintf(out_json, out_size, "{\"error\":\"File not found\"}");
        return -1;
    }

    const char *filename = strrchr(usb_path, '/');
    filename = filename ? filename + 1 : usb_path;

    char lkey[128];
    slot_local_key(filename, lkey, sizeof(lkey));

    char check_dir[640];
    snprintf(check_dir, sizeof(check_dir), "%s/local/%s", PAYLOADS_STORAGE_DIR, lkey);

    SlotMeta meta;
    int exists = (slot_read_meta(check_dir, &meta) == 0 && meta.payload_path[0] != '\0');

    char name_e[512], path_e[1024], key_e[256];
    pldmgr_json_escape(filename, name_e, sizeof(name_e));
    pldmgr_json_escape(usb_path, path_e, sizeof(path_e));
    pldmgr_json_escape(lkey, key_e, sizeof(key_e));

    if (exists) {
        char slot_e[256], exfn_e[512];
        pldmgr_json_escape(meta.slot_key, slot_e, sizeof(slot_e));
        pldmgr_json_escape(meta.filename, exfn_e, sizeof(exfn_e));

        int is_same = (strcmp(meta.filename, filename) == 0);
        snprintf(out_json, out_size,
                 "{\"filename\":\"%s\",\"path\":\"%s\",\"size\":%lld,\"key\":\"%s\","
                 "\"status\":\"%s\",\"folder_exists\":true,\"folder_name\":\"%s\","
                 "\"existing\":{\"slot\":\"%s\",\"filename\":\"%s\"}}",
                 name_e, path_e, (long long)st.st_size, key_e,
                 is_same ? "exists_same" : "exists_different", key_e,
                 slot_e, exfn_e);
    } else {
        snprintf(out_json, out_size,
                 "{\"filename\":\"%s\",\"path\":\"%s\",\"size\":%lld,\"key\":\"%s\","
                 "\"status\":\"ready\",\"folder_exists\":false,\"folder_name\":\"%s\","
                 "\"existing\":null}",
                 name_e, path_e, (long long)st.st_size, key_e, key_e);
    }
    return 0;
}

int payload_mgr_usb_move(const char *usb_path, const char *mode, int keep_original,
                         char *out_json, size_t out_size) {
    if (!is_allowed_usb_path(usb_path)) {
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Invalid USB path\"}");
        return -1;
    }

    struct stat st;
    if (stat(usb_path, &st) != 0) {
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"File not found\"}");
        return -1;
    }

    const char *filename = strrchr(usb_path, '/');
    filename = filename ? filename + 1 : usb_path;

    char lkey[128];
    slot_local_key(filename, lkey, sizeof(lkey));

    char target_slot[128];
    if (mode && strcmp(mode, "keep_both") == 0) {
        slot_find_next_local_key(lkey, target_slot, sizeof(target_slot));
    } else {
        snprintf(target_slot, sizeof(target_slot), "local/%s", lkey);
    }

    char slot_dir[640];
    snprintf(slot_dir, sizeof(slot_dir), "%s/%s", PAYLOADS_STORAGE_DIR, target_slot);
    ensure_dir_recursive(slot_dir);

    char part_path[768];
    snprintf(part_path, sizeof(part_path), "%s/.part", slot_dir);

    if (copy_file(usb_path, part_path) != 0) {
        remove(part_path);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Copy failed\"}");
        return -1;
    }

    /* Remove any other payload file in slot */
    DIR *d = opendir(slot_dir);
    if (d) {
        struct dirent *ent;
        while ((ent = readdir(d)) != NULL) {
            if (ent->d_name[0] == '.') continue;
            if (strcmp(ent->d_name, "meta.json") == 0) continue;
            char old_f[768];
            snprintf(old_f, sizeof(old_f), "%s/%s", slot_dir, ent->d_name);
            remove(old_f);
        }
        closedir(d);
    }

    char final_path[768];
    snprintf(final_path, sizeof(final_path), "%s/%s", slot_dir, filename);
    if (rename(part_path, final_path) != 0) {
        remove(part_path);
        snprintf(out_json, out_size, "{\"ok\":false,\"message\":\"Move commit failed\"}");
        return -1;
    }

    SlotMeta meta;
    memset(&meta, 0, sizeof(meta));
    meta.schema = PAYLOAD_SLOT_SCHEMA;
    strcpy(meta.kind, SLOT_KIND_LOCAL);
    strncpy(meta.slot_key, target_slot, sizeof(meta.slot_key) - 1);
    strncpy(meta.slot_dir, slot_dir, sizeof(meta.slot_dir) - 1);
    strncpy(meta.payload_path, final_path, sizeof(meta.payload_path) - 1);
    strncpy(meta.filename, filename, sizeof(meta.filename) - 1);

    time_t now = time(NULL);
    struct tm tmv;
    localtime_r(&now, &tmv);
    strftime(meta.installed_at, sizeof(meta.installed_at), "%Y-%m-%dT%H:%M:%S%z", &tmv);

    strcpy(meta.origin, "usb");
    strncpy(meta.origin_detail, usb_path, sizeof(meta.origin_detail) - 1);

    slot_write_meta(slot_dir, &meta);

    if (!keep_original) {
        if (remove(usb_path) != 0) {
            pldmgr_log("[PLDMGR] Warning: Failed to remove original file from USB: %s\n", usb_path);
            snprintf(out_json, out_size,
                     "{\"ok\":true,\"slot\":\"%s\",\"message\":\"Moved successfully\","
                     "\"warning\":\"Payload copied, but failed to delete original from USB.\"}",
                     target_slot);
        } else {
            pldmgr_log("[PLDMGR] USB payload moved: %s -> %s\n", usb_path, final_path);
            snprintf(out_json, out_size, "{\"ok\":true,\"slot\":\"%s\",\"message\":\"Moved successfully\"}",
                     target_slot);
        }
    } else {
        pldmgr_log("[PLDMGR] USB payload copied: %s -> %s\n", usb_path, final_path);
        snprintf(out_json, out_size, "{\"ok\":true,\"slot\":\"%s\",\"message\":\"Copied successfully\"}",
                 target_slot);
    }

    return 0;
}
