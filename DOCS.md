# West Marin Civic — Technical Documentation

---

## Overview

West Marin Civic is a single-page web app (PWA) that monitors road conditions and emergency status for Point Reyes, Inverness, and the West Marin coast. It runs entirely in the browser — no server, no database, no login. Every time a user opens it, the app fetches live data from three public APIs, combines them into a single status, and displays it.

The app lives at **westmarincivic.org**, is deployed on **Cloudflare Workers**, and can be installed on a phone like a native app (it's a PWA).

---

## Architecture: How the pieces fit together

```
User's browser
    │
    ▼
Cloudflare Worker (westmarincivic.org)
    │
    ├── Serves the app (index.html, sw.js, manifest.json, icon.svg)
    │
    └── /api/511  ──►  511 SF Bay API (traffic events)
                        (proxied server-side to avoid CORS)

App also fetches directly from:
    ├── api.weather.gov  (NWS alerts + weather)
    └── ArcGIS / NIFC    (WFIGS active fire data)
```

The Cloudflare Worker does two things:
1. Serves the static app files
2. Acts as a proxy for the 511 API (because 511 doesn't allow browser requests — the Worker fetches it server-side and passes it back)

---

## Files

| File | What it does |
|---|---|
| `index.html` | App HTML, CSS, and JavaScript (imports pure logic from `src/lib.js`) |
| `src/lib.js` | Pure data-parsing functions: `parse511Roads`, `buildState`, `ageStr`, `dotState`, `parseUntilStr`, `inWestMarin` and related helpers |
| `worker.js` | Cloudflare Worker — serves the app, proxies 511 API, auth gate for staging |
| `wrangler.jsonc` | Cloudflare deployment config (Worker name, routes, settings) |
| `sw.js` | Service Worker — caches the app shell (including `src/lib.js`) for offline use |
| `manifest.json` | PWA metadata — app name, icon, colors, install behavior |
| `icon.svg` | App icon (used on home screen when installed) |
| `config.js` | Empty placeholder — API key moved to Cloudflare secret |
| `package.json` | Dev dependencies: Vitest + `@cloudflare/vitest-pool-workers` |
| `vitest.workspace.js` | Vitest workspace: unit tests (Node) + worker tests (miniflare) |
| `tests/lib.test.js` | 37 unit tests for pure functions in `src/lib.js` |
| `tests/worker-routing.test.js` | Worker routing tests: `.git` 404, CORS, 511 proxy |
| `tests/worker-auth.test.js` | Auth gate tests: password form, session cookie, CSP |
| `.github/workflows/test.yml` | CI: runs `npm test` on every push to main and on PRs |

---

## Data Sources

The app polls four external APIs every 5 minutes (every 60 seconds during an active alert). The Marin County OES evacuation zones endpoint is also polled each cycle but is only displayed during active alert state.

### 1. NWS — National Weather Service
**What it provides:** Fire weather alerts + current conditions for Point Reyes  
**Two endpoints used:**

| Endpoint | What it returns |
|---|---|
| `api.weather.gov/alerts/active?zone=CAZ505` | Active weather alerts for Coastal North Bay (zone CAZ505 covers Point Reyes) |
| `api.weather.gov/gridpoints/MTR/74,121/forecast/hourly` | Hourly forecast for the Point Reyes grid (temperature, wind speed, wind direction, humidity) |

**Alert types the app watches for:**

| Alert type | App state triggered |
|---|---|
| Red Flag Warning | 🔴 Alert |
| Fire Warning | 🔴 Alert |
| Extreme Fire Danger | 🔴 Alert |
| Fire Weather Watch | 🟡 Watch |

**Cost:** Free. No API key required.

---

### 2. 511 SF Bay — Traffic Events
**What it provides:** Road closures and incidents on West Marin roads  
**Endpoint:** `api.511.org/traffic/events?api_key=KEY&format=json`  
**API key:** Stored as a Cloudflare Worker secret named `KEY_511` (not in the code)  
**Proxy:** The app calls `/api/511` on the Worker, which forwards to 511 server-side. This is required because 511 doesn't send CORS headers, which means browsers can't call it directly.

**How road matching works:**

The 511 API returns events for the entire Bay Area — hundreds of events. The app filters them down to West Marin roads in two steps:

**Step 1 — Bounding box filter**  
Every event has GPS coordinates. Any event outside this rectangle is discarded immediately:

```
North:  38.30  (above Tomales)
South:  37.85  (below Stinson Beach)
West:  -123.05 (Pacific coast)
East:  -122.55 (east of Nicasio)
```

**Step 2 — Road name matching**  
Each event that passes the bounding box is matched to one of the 11 roads in the app using regex patterns. For example, an event on "CA-1 Northbound" at latitude 38.1 matches `hwy1n` (Hwy 1 North). The word-boundary regex prevents false matches — `CA-1` will not match `CA-11`, `CA-13`, or `CA-116`.

**Cost:** Free tier. Read-only key.

---

### 3. Marin County OES — Evacuation Zones
**What it provides:** Active evacuation zones (Warning / Order) during emergencies  
**Endpoint:** Marin County OES ArcGIS FeatureServer, queried with `where=1=1` to fetch all features  
**Filter:** Client-side — only zones with `EvacStatus` of `Warning` or `Order` are displayed  
**Display:** Shown as color-coded rows below the Emergency Contacts section, but only when state is `alert` and at least one active zone is returned. Section is hidden otherwise.  
**Cost:** Free. No API key required.

Field names are normalized client-side across common Marin County ArcGIS field variants (`ZoneName`, `ZONE_NAME`, `Zone_Name`, `EvacStatus`, `EVACSTATUS`).

---

### 4. WFIGS — Wildland Fire Incident Data
**What it provides:** Active wildfires (name, acres, % contained, last updated)  
**Endpoint:** NIFC ArcGIS FeatureServer, queried with a West Marin bounding box  
**Cost:** Free. No API key required.

If any active fire is found within the bounding box, the app immediately goes to 🔴 Alert state regardless of NWS alerts.

---

## The ROADS Array

This is a hardcoded list of the 11 West Marin roads the app monitors. Each entry has two fields:

```javascript
{ id: 'hwy1n', label: 'Hwy 1 North' }
```

| Field | What it does |
|---|---|
| `id` | Internal key used to match 511 events to roads |
| `label` | The display name shown in the road status tray |

When a road has an active 511 event, a detail line appears below the road name showing the affected segment (e.g., "Olema → Stinson Beach"). This comes from the live 511 data, not the ROADS array.

**The 11 monitored roads:**

| ID | Display name |
|---|---|
| `hwy1n` | Hwy 1 North |
| `hwy1s` | Hwy 1 South |
| `sfd` | Sir Francis Drake Blvd |
| `bv` | Bear Valley Rd |
| `prp` | Point Reyes-Petaluma Rd |
| `plat` | Platform Bridge Rd |
| `nic` | Nicasio Valley Rd |
| `marsh` | Marshall-Petaluma Rd |
| `tom` | Tomales-Petaluma Rd |
| `fallon` | Fallon-Two Rock Rd |
| `vf` | Valley Ford Rd |

---

## App States

The app is always in one of four states. The state determines the pill color, the contacts shown, and the polling interval.

| State | Pill color | Triggered by | Poll interval |
|---|---|---|---|
| `calm` | 🟢 Green | No alerts, no fires | Every 5 minutes |
| `watch` | 🟡 Amber | NWS Fire Weather Watch | Every 5 minutes |
| `alert` | 🔴 Red | NWS Red Flag Warning, or active fire from WFIGS | Every 60 seconds |
| `unknown` | 🟠 Orange | All 3 feeds fail for 2 consecutive cycles | Every 5 minutes |

**State priority:** Fire (WFIGS) beats NWS alert. If WFIGS reports an active fire and NWS only has a Watch, the app goes to Alert.

**Feed freshness on pill:** During `alert` state, if the newest live feed is older than 2 minutes, `· updated Xm ago` is appended to the pill sub-line so users can gauge data age without scrolling to the feed footer.

**Blackout logic:** The app doesn't go to Unknown on the first failure — it requires all three feeds to fail twice in a row. This prevents a single bad network request from triggering the emergency state.

---

## Feed Freshness

The app tracks whether each data source is live, stale, or offline. This is shown in the small feed status row at the bottom of the screen.

| Feed | Goes stale after |
|---|---|
| 511 | 15 minutes |
| NWS | 15 minutes |
| WFIGS | 90 minutes |

**Dot colors:**
- 🟢 Green = live (data received recently)
- ⚫ Grey = stale (data received but too old)
- 🔴 Red = offline (last fetch failed)

---

## Polling

The app refreshes on a dynamic timer, not a fixed interval:

```
On load → fetch immediately
After each fetch → schedule next fetch:
    - If state is Alert → wait 60 seconds
    - Otherwise → wait 5 minutes
```

The timer is reset after every fetch (success or failure), so the schedule never drifts. All four fetches (NWS alerts, NWS weather, 511, WFIGS) run in parallel.

**Fetch timeout:** Every request times out after 10 seconds. If a feed is slow or unreachable, the app doesn't hang — it moves on and marks that feed as offline.

---

## Offline / PWA Behavior

The service worker (`sw.js`) caches the app shell (HTML, JS, icon, manifest) so the app loads instantly even without a connection. Two caches are maintained:

| Cache | What's in it | Strategy |
|---|---|---|
| `wmc-shell-v1` | App files (index.html, config.js, manifest, icon) | Cache-first (serve cached, fetch if missing) |
| `wmc-api-v1` | API responses | Network-first (try live, fall back to cached) |

API responses are stamped with an `X-Cached-At` header when stored, so the app can show how old the data is even when served from cache.

---

## Developer Tools

A dev bar is built into the app with five buttons: Calm, Watch, Alert, Unknown, Live. It is **hidden from real users** — it only appears on:
- `localhost`
- The staging Worker (`west-marin-civic-dev.john-b98.workers.dev`)

The first four buttons load mock data so you can preview each state without waiting for a real event. The Live button triggers a fresh fetch from all APIs.

---

## Environments

| Environment | URL | Purpose |
|---|---|---|
| Production | `westmarincivic.org` | Live site — real users |
| Staging | `west-marin-civic-dev.john-b98.workers.dev` | Review before shipping to prod |

Staging is password-protected. Every visit prompts for the password (stored as `DEV_PASSWORD` secret on the staging Worker). The auth cookie stores a SHA-256 hash of the password — the raw value never appears in the browser. The dev bar is visible on staging so you can switch between mock states.

---

## Deploy Workflow

**Always follow this order:**

1. Open a GitHub issue describing the change
2. Make the change and commit to `main`
3. Deploy to staging: `npx wrangler deploy --env dev`
4. Review on staging — switch mock states with the dev bar
5. Deploy to prod: `npx wrangler deploy`
6. Push to GitHub: `git push origin main`
7. Close the GitHub issue with the commit reference

**Git is always the source of truth.** Never deploy without a commit first.

---

## Secrets

| Secret | Worker | What it does |
|---|---|---|
| `KEY_511` | prod + dev | 511 SF Bay API key |
| `DEV_PASSWORD` | dev only | Password gate for staging site |

To set or rotate a secret:
```bash
echo "VALUE" | npx wrangler secret put SECRET_NAME           # prod
echo "VALUE" | npx wrangler secret put SECRET_NAME --env dev # staging
```

---

## Deployment

```bash
npx wrangler deploy           # prod (westmarincivic.org)
npx wrangler deploy --env dev # staging only
```

---

## Adding or Changing a Road

1. Add an entry to the `ROADS` array in `index.html`:
```javascript
{ id: 'myroad', label: 'My Road Name' }
```

2. Add a matcher to `ROAD_MATCHERS`:
```javascript
{ id: 'myroad', re: /my\s*road/i }
```

The `re` field is a regex that matches against road names in the 511 API. Make sure it won't accidentally match other roads — use word boundaries (`\b`) for short names.

3. Make sure the road is within the West Marin bounding box (`WM_BBOX`). If not, expand the box.

4. Deploy: `npx wrangler deploy`

---

## Adding a New Alert Type

NWS alert types are matched by exact string. To add a new alert that triggers Alert state:

```javascript
const FIRE_ALERT_EVENTS = ['Red Flag Warning', 'Fire Warning', 'Extreme Fire Danger', 'YOUR NEW ALERT'];
```

To trigger Watch state instead:
```javascript
const FIRE_WATCH_EVENTS = ['Fire Weather Watch', 'YOUR NEW WATCH'];
```

The exact strings must match the NWS `event` field. You can browse active alerts at `api.weather.gov/alerts/active?zone=CAZ505`.

---

## Sprint System (Usain)

The project uses a scheduled AI agent ("Usain") to plan and build sprints automatically on a 2-week cycle.

### Agents

| Agent | Schedule | What it does |
|---|---|---|
| Usain Mode A (Planner) | Every other Monday 8am PT | Picks 2 issues from GitHub, writes a plan, emails for approval |
| Usain Mode B (Builder) | Every other Wednesday 8am PT | Implements the 2 issues, deploys to staging, emails for review |

Trigger IDs and config are managed via the Claude Code scheduled agents dashboard.

### sprint-panel.json

`sprint-panel.json` is the data contract between Usain and the app. After Mode B builds and deploys, it writes this file with `built: true`. The app reads it on load — if `built: true`, a "This Sprint" panel button appears in the UI showing what was built and preview buttons for each change.

**Schema:**
```json
{
  "built": true,
  "sprint_start": "YYYY-MM-DD",
  "retro": "...",
  "backlog_health": "...",
  "issues": [
    {
      "number": 16,
      "title": "Issue title",
      "effort": "S|M|L",
      "meta": "Short description",
      "body": "Implementation notes",
      "preview_state": "alert",
      "preview_target": ".css-selector"
    }
  ],
  "blocker": "Optional blocker note",
  "pr_url": "https://github.com/...",
  "staging_url": "https://west-marin-civic-dev.john-b98.workers.dev"
}
```

When `built: false` (default), the panel button is hidden.

---

## Health Monitor

A GitHub Actions workflow (`.github/workflows/monitor.yml`) runs every 6 hours and checks:

1. `westmarincivic.org` returns 200 with expected content
2. `/api/511` returns 200 with valid JSON
3. PG&E ArcGIS API is reachable (warning only — doesn't fail the job)

On failure: opens a GitHub issue tagged `bug, automated, critical`. If a matching open issue already exists, adds a comment instead of opening a duplicate.

On recovery: closes the open issue automatically with a comment.

---

## Analytics

Cloudflare Web Analytics is enabled. Traffic data (page views, unique visitors, top pages, device types) is visible in the Cloudflare dashboard under **westmarincivic.org → Analytics**. No cookies, no personal data collected.
