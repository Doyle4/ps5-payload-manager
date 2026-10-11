#ifndef SLOT_H
#define SLOT_H

#include <stddef.h>

#define PAYLOAD_SLOT_SCHEMA 2
#define SLOT_KIND_REPO "repo"
#define SLOT_KIND_LOCAL "local"

typedef struct SlotMeta {
    int schema;
    char kind[16];                /* "repo" or "local" */
    char slot_key[128];           /* "repo/<id>@<srchash8>" or "local/<key>" */
    char slot_dir[512];           /* absolute directory path */
    char payload_path[512];       /* absolute path to payload ELF/BIN */
    char filename[256];           /* payload filename in slot */
    char installed_at[64];        /* ISO timestamp */

    /* kind == "repo" */
    char id[128];
    char source_url[1024];
    char source_name[256];
    char name[256];
    char version[64];
    char checksum[65];
    char last_update[64];
    char url[1024];
    char source[1024];
    char source_direct[1024];
    char category[128];
    char description[1024];
    char author[128];
    char details_url[1024];

    /* kind == "local" */
    char origin[64];              /* "web_upload" or "usb" */
    char origin_detail[1024];
} SlotMeta;

/* Compute 8-hex-character hash of normalized source URL */
int slot_source_hash(const char *source_url, char *out_hash8, size_t out_size);

/* Convert string to clean slug ([a-z0-9._-]) */
int slot_slug(const char *input, char *out_slug, size_t out_size);

/* Compute local key from filename (strip ext, version marker, ps4/5, slug) */
int slot_local_key(const char *filename, char *out_key, size_t out_size);

/* Format repo slot key: repo/<id>@<h> */
int slot_repo_key(const char *id, const char *source_url, char *out_slot, size_t out_size);

/* Find next available local slot key ("local/<key>", "local/<key>-2", etc.) */
int slot_find_next_local_key(const char *base_key, char *out_slot, size_t out_size);

/* Read meta.json from a slot directory */
int slot_read_meta(const char *slot_dir, SlotMeta *out_meta);

/* Write meta.json to a slot directory */
int slot_write_meta(const char *slot_dir, const SlotMeta *meta);

/* Enumerate all installed slots across repo/ and local/ */
int slot_list_all(SlotMeta **out_slots, size_t *out_count);

/* Free slots array returned by slot_list_all */
void slot_free_all(SlotMeta *slots);

/* Resolve a slot key or path to absolute payload file path */
int slot_resolve(const char *slot_or_path, char *out_path, size_t out_size);

/* Delete an entire slot directory and remove from autoload */
int slot_delete(const char *slot_key);

/* Strict version comparison (implements section 4) */
int slot_version_compare(const char *v1, const char *v2);

/* One-time migration on startup (payloads/.layout = 2) */
int slot_migrate_legacy(void);

/* Retrieve legacy paths JSON map after migration (if any) and clear it */
int slot_pop_legacy_paths_json(char *buf, size_t buf_size);

#endif
