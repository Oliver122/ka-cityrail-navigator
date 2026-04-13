# KA CityRail Navigator

A desktop departure board for Karlsruhe public transport (KVV), built with Tauri v2, React 19, and Rust/Diesel.

Shows real-time departures for stops near you, lets you star favourites, and pins stops to specific WiFi/Ethernet networks so your go-to stops are always on top when you're at home, work, or elsewhere.

---

## Features

- **Nearby stops** — fetches all stops within 1.5 km of your current GPS position (or a saved fallback location) and shows real-time departures.
- **Starred stops** — star any stop; it always appears above nearby results. Persisted in `localStorage`.
- **Network-pinned stops** — save known WiFi/Ethernet networks (by SSID/connection name). When you're connected to one, its pinned stops float to the top of the board.
- **Stop search** — searches both the local SQLite cache and the KVV StopFinder API simultaneously and deduplicates results.
- **Offline-friendly** — previously fetched stops are cached in a local SQLite database so searches work without hitting the network.
- **Manual-coords fallback** — if GPS is unavailable or denied, the app uses manually configured coordinates.
- **Delay badges** — departures show whether they're on time, early, or late.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Desktop shell | Tauri v2 |
| Backend (Rust) | Reqwest (HTTP), Serde JSON, Diesel 2 ORM |
| Local database | SQLite (via Diesel with embedded migrations) |
| Network detection | `nmcli` (Linux / NetworkManager) |
| Location | `tauri-plugin-geolocation` |

---

## Prerequisites

- [Rust toolchain](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) ≥ 18
- [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) for your OS (WebKitGTK on Linux, etc.)
- `nmcli` (NetworkManager CLI) — required for WiFi/Ethernet detection on Linux

---

## Development

```bash
npm install
npm run tauri:dev   # starts Vite + Tauri in dev mode
```

> **Note:** The `tauri:dev` script sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` to work around a WebKit rendering issue on some Linux setups.

### Build

```bash
npm run tauri build
```

---

## Database

The app maintains a local SQLite database at:

- **Linux/macOS:** `$XDG_DATA_HOME/ka-cityrail-navigator/stops.db` (falls back to `~/.local/share/…`)
- **Windows:** `%LOCALAPPDATA%\ka-cityrail-navigator\stops.db`

Migrations run automatically on startup via `diesel_migrations`.

### Schema

```sql
-- Cached transit stops (populated from KVV API on each area fetch)
CREATE TABLE stops (
    id        TEXT PRIMARY KEY NOT NULL,
    name      TEXT NOT NULL,
    longitude REAL NOT NULL,
    latitude  REAL NOT NULL
);

-- User-defined named networks (identified by connection name / SSID)
CREATE TABLE networks (
    ssid  TEXT PRIMARY KEY NOT NULL,  -- actually the nmcli connection name
    label TEXT NOT NULL               -- human-readable display name
);

-- Per-network stop pins (many-to-many junction)
CREATE TABLE network_stops (
    network_ssid TEXT NOT NULL,
    stop_id      TEXT NOT NULL,
    PRIMARY KEY (network_ssid, stop_id)
);
```

---

## KVV API Endpoints Used

| Purpose | Endpoint |
|---|---|
| Nearby stops (bounding box) | `kvv.de/tunnelEfaDirect.php` — `XSLT_COORD_REQUEST` |
| Stop departures + stop details | `kvv-efa.de/sl3-alone/XSLT_DM_REQUEST` |
| Stop search by name | `kvv-efa.de/sl3-alone/XSLT_STOPFINDER_REQUEST` |

The COORD endpoint returns JSONP (`jsonpFn1(…)`); the backend strips the wrapper before parsing.

---

## Tauri Commands (Rust → Frontend IPC)

| Command | Description |
|---|---|
| `fetch_stops_near` | Fetch & cache stops within radius; return nearest N |
| `fetch_departures` | Real-time departures for a stop ID |
| `search_stops` | KVV StopFinder API search |
| `search_stops_db` | Full-text LIKE search in local SQLite cache |
| `fetch_and_store_stop` | Fetch single stop by ID and persist it |
| `fetch_and_store_stops` | Batch fetch + persist stops by IDs |
| `fetch_stops_in_bounds` | Fetch all stops in a lon/lat bounding box |
| `get_stops` | Return all stops from local DB |
| `get_current_connection` | Active WiFi/Ethernet connection via `nmcli` |
| `check_current_network` | Match active connection against saved networks |
| `get_networks` | List saved networks |
| `add_network` | Save a new known network |
| `remove_network` | Delete a known network |
| `pin_stop_to_network` | Pin a stop to a network (upserts stop too) |
| `unpin_stop_from_network` | Remove a network-stop pin |
| `get_network_stops` | All stops pinned to a specific network |

---

## Project Structure

```
src/                       React frontend
  App.tsx                  Main departure board UI
  Settings.tsx             Settings page (coords, starred stops, networks)
  storage.ts               localStorage helpers (starred stops, manual coords)
src-tauri/
  src/
    lib.rs                 All Tauri commands + app entry point
    db.rs                  Diesel models, repository functions, connection setup
    schema.rs              Diesel-generated table DSL (do not edit manually)
    main.rs                Binary entry point (calls lib::run)
  migrations/              Diesel SQL migrations (up + down per migration)
  Cargo.toml
  tauri.conf.json
```

---

## CI/CD Pipelines

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **PR Validation** | Pull request to `development` or `main` | Builds frontend, runs Rust format/lint/tests, then builds Android APK (aarch64) |
| **Dev Build** | Push to `development` | Builds signed arm64 APK versioned as `x.x.x-pre_dev`, uploads APK + SHA256 checksums (30-day retention), creates/updates GitHub pre-release |
| **Release Build** | Push to `main` | Auto-bumps version from commit semantics, builds signed AAB/APK in parallel, publishes release assets + checksums, optionally uploads AAB to Play Store |
| **Security Scans** | PR/push to `development` or `main`, weekly schedule, manual | Runs CodeQL (JS + Rust) and dependency audits (`npm audit`, `cargo audit`) |

### Versioning Convention

Version bump on `main` push is derived from commit semantics since last tag:
- `BREAKING CHANGE` footer or `type!:` commit subject → **major** (**1**.0.0)
- `feat:` (or merged `feat/` PR) → **minor** (0.**1**.0)
- all other code changes → **patch** (0.0.**1**)
- CI/docs-only changes (`.github/`, `*.md`, `LICENSE`) → no bump / no build

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
