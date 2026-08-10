# Review Issues — Repository Redesign (`repository-redesign`)

Review of the `REPOSITORY_REDESIGN_PLAN.md` implementation against the plan spec.
Scope: commits `dffb3ab`, `52ceb98`, `9d585f7`. Findings below, grouped by severity.

## Critical

### 1. `parse_repository_payloads` regression (src/repository.c) — ✅ FIXED
The depth-tracking rewrite broke parsing. When the scanner hits the top-level `{`, it
advances into `depth=1` and then scans until depth returns to 0 — which is the
*document's* final `}`. The entire JSON object becomes a single "entry", and the closing
`}` is captured into the entry body.

Reproduced: `test_repo.json` now yields **1 bogus entry**
(`name='Test Categories Repository'`) instead of **19**.

Impact:
- App-shop grid / `/repository_payloads` broken
- `repository_check_self_update` / `repository_check_repo_update` effectively dead
  (no `pldmgr` entry is ever found)

Fix applied: added `skip_top_level_wrapper()` (detects a top-level `"payloads"` wrapper
and returns a pointer just past its opening `{`) and `find_next_object_start()` (string-aware
`{` search so braces inside string values are ignored). Verified against `test_repo.json`
(19/19 entries) plus adversarial cases (braces in strings, escaped quotes, nested objects),
bare-array format (2/2), and single-object format (1/1).

### 2. Self-update apply is dead-end — ✅ FIXED
`/update_check` and the frontend agree on the `status` contract
(`none` / `update-available` / `ready-to-apply`), but there was no apply path:
- `ready-to-apply` banner text said "Launch it from the dashboard", yet `pldmgr` is
  filtered from the dashboard via `isSystemPayload` — it cannot be launched.
- No `Load` CTA calling `/loadpayload:<path>` existed; the `path` field returned by
  http_server.c:595 was ignored by the frontend.
- `update-available` had no download/install CTA either.

Fix applied:
- `/update_check` now returns the full contract: `current_version`, `new_version`,
  `local_path` (ready-to-apply) or `new_filename` + `source` (update-available).
- `repository_check_self_update()` / `repository_check_repo_update()` gained optional
  out-params for version/filename/source (repository.h, repository.c, main.c updated).
- Added `ROUTE_UPDATE_CHECK` to `is_noisy_route()`.
- Frontend banner now shows a **Load** CTA (`/loadpayload:<local_path>`, explicit only)
  for `ready-to-apply`, and an **Update** CTA (`/repository_install?filename=<new_filename>`
  then re-checks `/update_check`) for `update-available`. The `local_path`
  (`/data/pldmgr/payloads/...`) passes `is_allowed_payload_path` (matches SCAN_DIRS[0]).

## High

### 3. Dashboard icons are always null — ✅ FIXED
App.jsx passed `icon={payloadMeta[p.split('/').pop()]?.icon}` but
`payload_mgr_list_json` adds only `author` + `details_url` to the meta (per plan), never
`icon`. Every dashboard card rendered the fallback generated icon. The planned
"lifted repo filename→icon map" was never wired into the dashboard.

Fix applied:
- `RepositoryProvider` moved to `main.jsx` (drops the `config` prop dependency) so App can
  consume the context via `useRepository()`.
- Context now derives and exposes `filenameMap`: `filename → { icon, author,
  release_notes, details_url, display_name }`, built from all payload entries in
  `/repository_payloads` (handles both `sources[]` and bare-array `payloads[]` shapes).
- App's dashboard `PayloadButton` now sources `icon`, `author`, and `displayName` from
  `filenameMap` (falling back to `payloadMeta` for author, and to filename parsing when no
  map entry exists).
- `PayloadName` gained a `displayName` override prop; `PayloadCard` (shop) passes the repo
  `name` as well.
- Note: the live mirror (`payloads.json`) currently ships a bare array without
  `icon`/`author`/`release_notes` yet (mirror tool out of scope), so dashboard icons still
  fall back to generated icons until the mirror adds them — but the wiring is now correct.

### 4. No `SHOW_UPDATE_NOTIFICATIONS` UI toggle — ✅ FIXED
`show_update_notifications` is read/written in config.c (defaults on) and the server-side
gate in `/update_check` works, but SettingsView had no toggle (plan required one).

Fix applied:
- Added a "Update Notifications" toggle row in SettingsView's Startup section
  (`settings.update_notifications_title` / `_desc` keys), defaulting on via
  `config.SHOW_UPDATE_NOTIFICATIONS !== false`, persisting through `onSaveConfig` →
  `/set_config` (backend already applies the key via `extract_json_bool`).
- `/get_config` already returned the key, so the toggle reflects the live state.
- Ran `npm run extract` — also picked up previously-missing keys (`app.toasts.payload_installed`,
  `app.toasts.install_failed`, `app.dashboard.removePayload`).

## Minor

- **Hardcoded English strings** — App.jsx (update banner, manage-mode toasts),
  PayloadCard ("Update"/"Installed" badges), PayloadDetailPanel ("Back to Repository",
  "Description", "What's New", "About", "Loading details...", "Failed to load details.").
  No i18n keys added; `en-US.json` unchanged (217 keys). Locales submodule shows
  uncommitted content changes in `git status`.
- **PayloadDetailPanel** — content not reset between payload switches (brief stale
  markup shown), details refetched on every open (no memoization), markdown images not
  lazy-loaded / error-bounded.
- **Dead code** — `PayloadCard` `opacity-60` "installed" state is unreachable (installed
  payloads are filtered out of `availablePayloads` in StorageHub); "Installed ✓"/Remove
  states in the detail panel are unreachable.
- **Manage mode** — entire card click opens the delete confirm; the trash icon is
  decorative (no `stopPropagation`), deviating from the specified trash-overlay
  interaction.
- **`repository_check_repo_update`** matches any filename containing `pldmgr` via
  `strcasestr` — false-positive risk for unrelated repo files.
- **Icon size threshold** — icons dropped only when truncated to ~16KB
  (buffer-limited), vs plan's 12KB. Non-issue functionally.

## Verified OK
- `RESPONSE_BUFFER_SIZE` = 4MB (http_server.c:32)
- Icon data-URI rendered via `<img>` only, never innerHTML
- Lazy `marked` + DOMPurify sanitization (PayloadDetailPanel)
- Multi-source passthrough of `author`/`details_url` (sources.c)
- `/update_check` `status` key matches frontend `data.status`
- `pldmgr_json_escape` is length-bounded — the 16KB icon escape buffers are safe (no overflow)
