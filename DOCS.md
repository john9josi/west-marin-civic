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
| `index.html` | The entire app — HTML, CSS, and JavaScript in one file |
| `worker.js` | Cloudflare Worker — serves the app and proxies the 511 API |
| `wrangler.jsonc` | Cloudflare deployment config (Worker name, routes, settings) |
| `sw.js` | Service Worker — caches the app shell for offline use |
| `manifest.json` | PWA metadata — app name, icon, colors, install behavior |
| `icon.svg` | App icon (used on home screen when installed) |
| `config.js` | Empty placeholder — API key moved to Cloudflare secret |

---

## Data Sources

The app polls three external APIs every 5 minutes (every 60 seconds during an active alert).

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

### 3. WFIGS — Wildland Fire Incident Data
**What it provides:** Active wildfires (name, acres, % contained, last updated)  
**Endpoint:** NIFC ArcGIS FeatureServer, queried with a West Marin bounding box  
**Cost:** Free. No API key required.

If any active fire is found within the bounding box, the app immediately goes to 🔴 Alert state regardless of NWS alerts.

---

## The ROADS Array

This is a hardcoded list of the 11 West Marin roads the app monitors. Each entry has three fields:

```javascript
{ id: 'hwy1n', label: 'Hwy 1 North', detail: 'Point Reyes north' }
```

| Field | What it does |
|---|---|
| `id` | Internal key used to match 511 events to roads |
| `label` | The display name shown in the road status tray |
| `detail` | Static fallback description — currently unused in a meaningful way (see note below) |

**Note on `detail`:** The detail field in the ROADS array is a static placeholder. When a road has an active 511 event, the detail shown in the tray comes from the live 511 data (e.g., "Olema → Stinson Beach"), not from this field. The static default only appears if the 511 event has no `from`/`to` segment info. It could be removed or repurposed.

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

A dev bar is built into the app with five buttons: Calm, Watch, Alert, Unknown, Live. It is **hidden from real users** — it only appears when:
- You're running on `localhost`, or
- The URL contains `?dev=1` (e.g., `westmarincivic.org?dev=1`)

The first four buttons load mock data so you can preview each state without waiting for a real event. The Live button triggers a fresh fetch from all APIs.

---

## Deployment

The app is deployed via Cloudflare Workers using the `wrangler` CLI.

**To deploy:**
```bash
npx wrangler deploy
```

**The 511 API key** is stored as a Cloudflare Worker secret and never appears in the code:
```bash
echo "YOUR_KEY" | npx wrangler secret put KEY_511
```

**Routes:** The Worker responds to:
- `westmarincivic.org/*`
- `www.westmarincivic.org/*`
- `west-marin-civic.john-b98.workers.dev` (fallback URL)

---

## Adding or Changing a Road

1. Add an entry to the `ROADS` array in `index.html`:
```javascript
{ id: 'myroad', label: 'My Road Name', detail: 'Optional description' }
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

## Analytics

Cloudflare Web Analytics is enabled. Traffic data (page views, unique visitors, top pages, device types) is visible in the Cloudflare dashboard under **westmarincivic.org → Analytics**. No cookies, no personal data collected.
