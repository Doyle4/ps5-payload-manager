#ifndef JSON_HELPERS_H
#define JSON_HELPERS_H

#include <stddef.h>

/* Incremental JSON array/object builder */
typedef struct JsonListBuilder {
    char *buf;
    size_t size;
    size_t pos;
    int first;
} JsonListBuilder;

/* Append formatted text to the builder. Returns 0 on success, -1 on overflow. */
int json_append(JsonListBuilder *jb, const char *fmt, ...);

enum {
    JSON_STRING_OK = 0,
    JSON_STRING_TRUNCATED = 1,
    JSON_STRING_MISSING = -1,
    JSON_STRING_INVALID = -2,
    JSON_STRING_TOO_LONG = -3
};

/* Extract a direct member of one complete object in [obj_start, obj_end).
 * Decode all JSON escapes/Unicode, validating the entire object (max depth 64).
 * Duplicate requested keys, non-string values, invalid UTF-8, and decoded NUL
 * in the requested value are invalid. Errors clear out when capacity is nonzero.
 * Strict extraction never returns a partial identifier/URL/checksum. */
int json_extract_string(const char *obj_start, const char *obj_end,
                        const char *key, char *out, size_t out_size);

/* Display-text variant: overflow returns TRUNCATED with a terminated prefix of
 * complete UTF-8 scalars. Other results have the same contract as above. */
int json_extract_string_prefix(const char *obj_start, const char *obj_end,
                               const char *key, char *out, size_t out_size);

/* Validate one object starting at '{', returning its exclusive end. Never reads
 * outside [start, limit); allows following array members after the object. */
int json_find_object_end(const char *start, const char *limit, const char **end);

/* Read an entire file into a malloc'd buffer. Caller must free *out_buf.
 * Returns 0 on success, -1 on failure. */
int read_file_text(const char *path, char **out_buf, size_t *out_size);

/* Write data to a file atomically. Returns 0 on success, -1 on failure. */
int write_file_text(const char *path, const char *data, size_t size);

/* Create a directory if it doesn't exist. Returns 0 on success. */
int mkdir_if_missing(const char *path);

/* Recursively create all directories in path. Returns 0 on success. */
int ensure_dir_recursive(const char *path);

#endif
