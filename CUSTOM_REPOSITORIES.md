# Custom Payload Repositories

PS5 Payload Manager supports adding custom, third-party payload repositories (sources) in addition to the default official repository. This allows developers and communities to host and distribute their own payloads.

---

## JSON Format Specification

To create a repository, you must host a JSON file that conforms to the following schema.

### Core Rules:
1. Both formats are supported:
   - Object wrapper with top-level `"name"` and `"payloads"` array (recommended).
   - Bare array of payload objects `[ { ... }, { ... } ]`.
2. When using the object wrapper, the `"name"` field **must appear before** the `"payloads"` field in the JSON structure.
3. The `"payloads"` field must be an array of payload objects.

### Example JSON:
```json
{
  "name": "My Custom Payloads",
  "payloads": [
    {
      "id": "ftpsrv",
      "name": "FTP Server",
      "filename": "ftpsrv_v0.19.elf",
      "url": "https://example.com/payloads/ftpsrv_v0.19.elf",
      "description": "A simple FTP server that accepts connections on port 2121",
      "version": "v0.19",
      "last_update": "2026-10-11",
      "category": "Networking",
      "checksum": "e6c1babbfd5e1b766d12b659853b514b9faedf6333cbe8cb514b1a3e79b7ce39",
      "author": "hippie68",
      "icon": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMjgnIGhlaWdodD0nMTI4Jz48cmVjdCB3aWR0aD0nMTI4JyBoZWlnaHQ9JzEyOCcgcng9JzI0JyBmaWxsPScjM2I4MmY2Jy8+PHRleHQgeD0nNjQnIHk9JzgyJyBmb250LWZhbWlseT0nQXJpYWwsc2Fucy1zZXJpZicgZm9udC1zaXplPSc0NCcgZm9udC13ZWlnaHQ9J2JvbGQnIGZpbGw9JyNmZmYnIHRleHQtYW5jaG9yPSdtaWRkbGUnPkZUUDwvdGV4dD48L3N2Zz4="
    },
    {
      "id": "debug-tool",
      "name": "Debug Tool",
      "filename": "debug_tool.elf",
      "url": "https://example.com/payloads/debug_tool.elf",
      "description": "A helper utility to dump debug information.",
      "version": "v1.0"
    }
  ]
}
```

### Field Reference:

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| **`name`** (top-level) | String | Yes | The display name of your repository catalog in the user interface (e.g. `"My Custom Payloads"`). |
| **`payloads`** (top-level) | Array | Yes | List of payload items available in this repository. |
| **`id`** (item-level) | String | Recommended | Stable identifier, unique within the repository, unchanged across versions (`[a-z0-9._-]`). Defaults to `slug(name)`. Stable IDs allow slots to maintain favorites and autoload entries across updates. |
| **`name`** (item-level) | String | Yes | Human-readable name of the specific payload. |
| **`filename`** (item-level) | String | Yes | The exact filename (including extension like `.elf`, `.bin`) when saved. |
| **`url`** (item-level) | String | Yes | Direct HTTP or HTTPS link where the payload binary can be downloaded. |
| **`version`** (item-level) | String | No | Version string used for update checks (e.g. `"v1.0"`). Follows version comparison rules described below. |
| **`last_update`** (item-level) | String | No | ISO 8601 date (e.g. `"2026-10-11"`). Serves as a tie-breaker when version strings compare equal. |
| **`description`** (item-level) | String | No | A description of what the payload does, displayed in the dashboard. |
| **`category`** (item-level) | String | No | The category name used to group payloads in the frontend (e.g. `"Networking"`). Defaults to `"Uncategorized"`. |
| **`checksum`** (item-level) | String | No | **SHA-256** hash (64 hex characters) of the file. If provided, the manager automatically validates the downloaded file against it before installation. If versions are identical but checksum differs, it is flagged as an update. |
| **`author`** (item-level) | String | No | Author or creator of the payload. |
| **`icon`** (item-level) | String | No | Inline base64 data URI icon (e.g. `data:image/svg+xml;base64,...` or `data:image/png;base64,...`). See [Payload Icons](#payload-icons) below. |
| **`details_url`** (item-level) | String | No | URL to documentation or README markdown for the payload. |
| **`release_notes`** (item-level) | String | No | Markdown release notes for this version (truncated at 2000 characters by backend). |
| **`source`** (item-level) | String | No | Link to the upstream source repository or releases page. |

---

### Payload Icons

- **Data URIs Only**: The `icon` field must be an inline data URI starting with `data:image/` (e.g., SVG `data:image/svg+xml;base64,...` or PNG `data:image/png;base64,...`).
- **No External Image URLs**: Direct HTTP/HTTPS image URLs (such as `https://example.com/icon.png`) are **not supported**. Inline data URIs are embedded directly inside the repository catalog, ensuring icons load instantly without extra network roundtrips, work 100% offline, and are unaffected by DNS blockers commonly configured on PS5 consoles.
- **Maximum Length**: The data URI must not exceed **12 KB** (~12,288 characters). Icons exceeding this limit are ignored.
- **Recommended Dimensions**: Square icons (e.g. 128x128 or 256x256) with rounded or transparent borders look best across the Dashboard, Autoload, and Repository views.
- **Automatic Fallback**: If `icon` is omitted, malformed, or exceeds the size limit, Payload Manager automatically renders a colorful gradient icon based on a hash of the payload's name.

## Version Comparison Rules

Payload Manager implements a strict version comparison algorithm:

1. Whitespace is trimmed, and any leading `v` or `V` prefix is dropped (e.g. `v1.2` equals `1.2`).
2. The version string is tokenized into numeric runs (`0-9`) and alphabetical runs (`a-z`, `A-Z`). Separators like `.`, `-`, and `_` separate tokens.
3. Numeric tokens compare numerically without leading zeros (e.g. `1.11` > `1.2`, and `20261011` > `20260901`).
4. Alphabetical tokens compare case-insensitively. A numeric token takes precedence over an alphabetical token at the same position (`1.1` > `1.a`).
5. When one version string runs out of tokens first:
   - If the next token on the other version is alphabetical, that version is treated as a pre-release and is considered **lower** (e.g. `1.7` > `1.7beta3`, `1.0` > `1.0-alpha`).
   - If the next token is numeric, it is treated as a sub-version and is considered **higher** (e.g. `1.0.1` > `1.0`).
6. If the version strings compare equal, `last_update` is used as a tie-breaker (newer date takes precedence).

---

## Hosting Your Repository

1. **Accessibility**: Upload your JSON file and your payload binaries to any static hosting provider (e.g., GitHub Pages, Vercel, Netlify, or your own VPS). The PS5 must be able to resolve and reach the host IP.
2. **CORS Headers**: To ensure that the web interface can interact with the files from the browser, your server should respond with CORS headers:
   ```http
   Access-Control-Allow-Origin: *
   ```

---

## Adding the Source in Payload Manager

1. Open the Payload Manager dashboard.
2. Navigate to **Settings** (gear icon) and select **Manage Sources**.
3. Click **Add Source**, paste the direct HTTP/HTTPS URL to your `payloads.json` file, and press **Add**.
4. The dashboard will validate the source and add it to your catalog list.
