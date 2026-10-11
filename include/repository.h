#ifndef REPOSITORY_H
#define REPOSITORY_H

#include <stddef.h>

/* Payload entry from a repository JSON */
typedef struct RepoPayload {
    char id[128];
    char name[128];
    char filename[256];
    char url[1024];
    char source[1024];
    char source_direct[1024];
    char description[1024];
    char last_update[64];
    char version[64];
    char checksum[65];
    char source_name[256];
    char category[128];
    char icon[16384];
    char release_notes[2048];
    char author[128];
    char details_url[1024];
} RepoPayload;

/* Download a URL to a local file. Returns 0 on success, -1 on failure. */
int download_to_file(const char *url, const char *out_path);

/* Parse a JSON string containing payload objects into a RepoPayload array.
 * Caller must free *out_items. Returns 0 on success, -1 on failure. */
int parse_repository_payloads(const char *json, RepoPayload **out_items, size_t *out_count);

/* ── Repository cache management ────────────────────────── */

/* Ensure the repository cache is up-to-date. If force_refresh, always re-download. */
int repository_ensure_fresh(int force_refresh);

/* Build the /repository_payloads JSON response. Returns bytes written. */
size_t repository_list_json(char *json_buf, size_t buf_size, int force_refresh);

/* ── Self-update ────────────────────────────────────────── */

/* Read the PLDMGR_VER: signature from an ELF binary. Returns 0 on success. */
int get_elf_pldmgr_version(const char *path, char *out_version, size_t out_size);

/* Scan the payload storage for a newer pldmgr.elf.
 * If found, writes the path to out_path and returns 0. */
int repository_check_self_update(char *out_path, size_t out_size,
                                 char *out_version, size_t out_version_size);

/* Check if a newer version of the payload manager is available in the repo cache.
 * Returns 0 if an update is available, -1 otherwise. */
int repository_check_repo_update(char *out_filename, size_t out_size,
                                 char *out_version, size_t out_version_size,
                                 char *out_source, size_t out_source_size);

#endif
