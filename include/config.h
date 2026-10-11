#ifndef CONFIG_H
#define CONFIG_H

#include <stddef.h>

/* Consolidated configuration state for pldmgr_config.txt */
typedef struct PldmgrConfig {
    int  autoload_enabled;       /* Default: 0  (off) */
    long last_repository_update; /* Default: 0 */
    int  auto_browser_open;      /* Default: 1  (on) */
    int  autoload_delay;         /* Default: 5  (seconds) */
    int  scan_usb_payloads;      /* Default: 0  (off) */
    int  auto_install_app;       /* Default: 1  (on) */
    int  multi_sources_enabled;  /* Default: 0  (off) */
} PldmgrConfig;

/* Read all config values from PLDMGR_CONFIG_PATH.
 * Missing file / keys → defaults above. */
void config_read(PldmgrConfig *cfg);

/* Write all config values to PLDMGR_CONFIG_PATH.
 * Returns 0 on success, -1 on failure. */
int config_write(const PldmgrConfig *cfg);

/* Read a single boolean (0/1) key from the config file.
 * Returns default_val if the key or file is missing. */
int config_read_bool(const char *key, int default_val);

/* Apply a JSON config update sent from the frontend /set_config route.
 * Handles AUTOLOAD_ENABLED, AUTO_BROWSER_OPEN, AUTOLOAD_DELAY,
 * SCAN_USB_PAYLOADS, AUTO_INSTALL_APP, MULTI_SOURCES_ENABLED, and AUTOLOAD_LIST.
 * Returns 0 on success, -1 on error. */
int config_handle_set_json(const char *json_data);

/* Upsert a single key=value line in the config file.
 * Returns 0 on success, -1 on failure. */
int config_upsert_value(const char *key, const char *value);

/* Read the LAST_REPOSITORY_UPDATE timestamp from the config file.
 * Always succeeds; sets *out_ts to 0 if not found. */
int config_read_last_update(long *out_ts);

/* Write the LAST_REPOSITORY_UPDATE timestamp to the config file. */
int config_write_last_update(long ts);

/* Favorites management */
int config_get_favorites_csv(char *out_buf, size_t max_size, int *out_file_exists);
int config_save_favorites_csv(const char *csv);
void pldmgr_favorites_update_entry(const char *old_key, const char *new_key);

#endif
