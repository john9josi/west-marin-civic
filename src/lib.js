// Pure data-parsing and state-building functions shared by the app and tests.
// index.html imports these as an ES module.

export const ROADS = [
  { id: 'hwy1n',  label: 'Hwy 1 North' },
  { id: 'hwy1s',  label: 'Hwy 1 South' },
  { id: 'sfd',    label: 'Sir Francis Drake Blvd' },
  { id: 'bv',     label: 'Bear Valley Rd' },
  { id: 'prp',    label: 'Point Reyes-Petaluma Rd' },
  { id: 'plat',   label: 'Platform Bridge Rd' },
  { id: 'nic',    label: 'Nicasio Valley Rd' },
  { id: 'marsh',  label: 'Marshall-Petaluma Rd' },
  { id: 'tom',    label: 'Tomales-Petaluma Rd' },
  { id: 'fallon', label: 'Fallon-Two Rock Rd' },
  { id: 'vf',     label: 'Valley Ford Rd' },
];

// West Marin bounding box — all 511 events must fall within this to be shown
// Roughly: Stinson Beach north to Tomales, Nicasio east to coast
export const WM_BBOX = { minLat: 37.85, maxLat: 38.30, minLon: -123.05, maxLon: -122.55 };

// Keyword matchers — use regex with word boundaries for Hwy 1 to avoid CA-11, CA-13, CA-116 etc.
// lat: [minLat, maxLat] distinguishes Hwy 1 North vs South at ~38.04 (Olema)
const ROAD_MATCHERS = [
  { id: 'hwy1n',  re: /\b(highway\s*1|hwy\s*1|ca-1|route\s*1)\b/i, lat: [38.055, 99] },
  { id: 'hwy1s',  re: /\b(highway\s*1|hwy\s*1|ca-1|route\s*1)\b/i, lat: [-99, 38.055] },
  { id: 'sfd',    re: /sir\s*francis\s*drake|francis\s*drake/i },
  { id: 'bv',     re: /bear\s*valley/i },
  { id: 'prp',    re: /point\s*reyes.petaluma|reyes.petaluma/i },
  { id: 'plat',   re: /platform\s*bridge/i },
  { id: 'nic',    re: /nicasio\s*valley/i },
  { id: 'marsh',  re: /marshall.petaluma/i },
  { id: 'tom',    re: /tomales.petaluma/i },
  { id: 'fallon', re: /fallon.two\s*rock/i },
  { id: 'vf',     re: /valley\s*ford/i },
];

export const CLEAR        = { status: 'Clear', cls: 'g' };
const         UNKNOWN_ROAD = { status: '—',    cls: '' };
export const STALE_MINS   = { '511': 15, 'NWS': 15, 'WFIGS': 90, 'PGE': 30 };

export function inWestMarin(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const [lon, lat] = coords;
  return lat >= WM_BBOX.minLat && lat <= WM_BBOX.maxLat &&
         lon >= WM_BBOX.minLon && lon <= WM_BBOX.maxLon;
}

export function ageStr(at) {
  if (!at) return '—';
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h';
}

export function dotState(src, fresh = {}) {
  const f = fresh[src] || {};
  if (!f.at || !f.ok) return f.at ? 'off' : 'stale';
  return (Date.now() - f.at) / 60000 < STALE_MINS[src] ? 'live' : 'stale';
}

function matchRoad511(name, lat) {
  for (const m of ROAD_MATCHERS) {
    if (!m.re.test(name)) continue;
    if (m.lat && lat !== null) {
      const [lo, hi] = m.lat;
      if (lat < lo || lat > hi) continue;
    }
    return m.id;
  }
  return null;
}

// Parses a 511 schedule interval string (e.g. "2026-01-01T00:00Z/2026-01-02T18:00Z")
// and returns a human-readable " · until X PM" suffix, or '' if not applicable.
export function parseUntilStr(interval) {
  if (!interval) return '';
  const endIso = interval.split('/')[1];
  if (!endIso) return '';
  const end = new Date(endIso);
  if (isNaN(end.getTime())) return '';
  const now = new Date();
  // Only show if ending within 7 days (not long-term construction)
  if (end - now > 7 * 24 * 60 * 60 * 1000) return '';
  return ' · until ' + end.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: undefined, hour12: true, timeZone: 'America/Los_Angeles',
  }).replace(':00', '');
}

export function parse511Roads(raw) {
  const map = {};
  const events = raw?.events || raw?.Events || [];
  if (!Array.isArray(events)) return map;

  for (const ev of events) {
    const active = (ev.status || ev.Status || '').toLowerCase();
    if (active === 'inactive' || active === 'closed') continue;

    const coords = ev.geography?.coordinates || null;

    // Discard events outside West Marin bounding box
    if (!inWestMarin(coords)) continue;

    const headline = ev.headline || ev.Headline || ev.description || '';
    const roads  = ev.roads  || ev.Roads  || [];
    const lat    = Array.isArray(coords) && coords.length >= 2 ? coords[1] : null;

    const roadState = (Array.isArray(roads) && roads[0] && roads[0].state) || '';
    const { status, cls } = (() => {
      if (roadState === 'CLOSED')                  return { status: 'Closed',           cls: 'r' };
      if (roadState === 'SINGLE_LANE_ALTERNATING') return { status: 'Single Lane',       cls: 'a' };
      if (roadState === 'SOME_LANES_CLOSED')       return { status: 'Some Lanes Closed', cls: 'a' };
      const sev  = (ev.severity   || '').toLowerCase();
      const type = (ev.event_type || '').toLowerCase();
      return type.includes('clos') || sev.includes('major') || sev.includes('extreme')
        ? { status: 'Closed', cls: 'r' }
        : { status: 'Caution', cls: 'a' };
    })();

    const untilStr = parseUntilStr(
      ev.schedule && ev.schedule.intervals && ev.schedule.intervals[0]
    );

    // Build detail from directional info — never echo a bare road name
    const dirDetail = (() => {
      for (const r of (Array.isArray(roads) ? roads : [])) {
        if (r.from) {
          const article = r['+article'] || 'at';
          return `${article} ${r.from}${r.to ? ' → ' + r.to : ''}`;
        }
      }
      const h = headline.slice(0, 60).trim();
      const looksLikeJustRoadName = /^(hwy|highway|ca-|route|road|rd|blvd|ave)\b/i.test(h) && !h.includes('·') && !h.includes('-') && h.split(' ').length < 5;
      return looksLikeJustRoadName ? '' : h;
    })();

    const detail = dirDetail + untilStr;

    const sources = Array.isArray(roads) && roads.length > 0 ? roads : [{ name: headline }];
    for (const r of sources) {
      const rname = r.name || r.Name || '';
      const id = matchRoad511(rname, lat);
      if (id && !map[id]) {
        map[id] = { status, cls, detail };
      }
    }
  }
  return map;
}

function minsAgo(date) {
  if (!date) return null;
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 60) return m + ' min ago';
  return Math.floor(m / 60) + ' hr ago';
}

function timeNow() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function wxEmoji(sf, windMph, level) {
  if (level === 'alert') return '🔥';
  const f = sf.toLowerCase();
  const w = windMph || 0;
  if (f.includes('thunder'))                              return '⛈️';
  if (f.includes('rain') || f.includes('shower'))        return '🌧️';
  if (f.includes('fog')  || f.includes('mist'))          return '🌫️';
  if (f.includes('snow'))                                 return '❄️';
  if (w > 20 || f.includes('breezy') || f.includes('windy')) return '🌬️';
  if (f.includes('overcast') || f.includes('cloud'))     return '☁️';
  if (f.includes('partly'))                               return '⛅';
  return '☀️';
}

// Accepts fresh as an explicit parameter so it can be tested without global state.
export function buildState(nwsAlert, nwsWx, roads511, fire, has511, pge, fresh = {}) {
  const getf = src => fresh[src] || { at: null, ok: false };

  // --- level ---
  let level = nwsAlert?.level || 'calm';
  if (fire) level = 'alert';

  // --- pill ---
  let pillTitle, pillSub;
  if (fire) {
    pillTitle = `Active fire — ${fire.name}`;
    pillSub   = `${fire.acres} ac · ${fire.pct}% contained · ${minsAgo(fire.updAt) || timeNow()}`;
  } else if (level === 'alert' && nwsAlert?.props) {
    pillTitle = nwsAlert.props.event || 'Active alert';
    pillSub   = `NWS CAZ505 · ${timeNow()}`;
  } else if (level === 'watch' && nwsAlert?.props) {
    const expires = nwsAlert.props.expires ? new Date(nwsAlert.props.expires) : null;
    const exp = expires ? ' · until ' + expires.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    pillTitle = nwsAlert.props.event || 'Fire weather watch';
    pillSub   = `NWS CAZ505${exp}`;
  } else {
    pillTitle = 'All clear';
    pillSub   = `Inverness · ${timeNow()}`;
  }

  // Feed freshness suffix on pill during alert — show data age if >2 min old (#4)
  if (level === 'alert') {
    const liveTimes = Object.values(fresh).filter(f => f.at && f.ok).map(f => f.at);
    if (liveTimes.length) {
      const ageMin = Math.floor((Date.now() - Math.max(...liveTimes)) / 60000);
      if (ageMin > 2) pillSub += ` · updated ${ageMin}m ago`;
    }
  }

  // --- weather line ---
  let wxIcon, wxText, wxWarn = (level !== 'calm');
  const sf      = nwsWx?.shortForecast || '';
  const mph     = parseInt(nwsWx?.windSpeed) || 0;
  const temp    = nwsWx ? `${nwsWx.temp}°F` : '—';
  const windSpeed = nwsWx?.windSpeed || '—';
  const windDir   = nwsWx?.windDir   || '';
  const wind      = windDir ? `${windDir} ${windSpeed}` : windSpeed;
  const hum       = nwsWx?.humidity != null ? `${Math.round(nwsWx.humidity)}% humidity` : null;
  wxIcon = wxEmoji(sf, mph, level);

  if (level === 'alert') {
    const ap  = nwsAlert?.props;
    const exp = ap?.expires ? 'until ' + new Date(ap.expires).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    wxText = [`Red flag${exp ? ' ' + exp : ''}`, wind + ' gusts', hum].filter(Boolean).join(' · ');
  } else {
    wxText = [sf || '—', temp, wind].filter(Boolean).join(' · ');
  }

  // --- roads ---
  const roads = ROADS.map(r => {
    const ov = roads511[r.id];
    if (ov) return { ...r, ...ov };
    return has511 ? { ...r, ...CLEAR } : { ...r, ...UNKNOWN_ROAD };
  });

  // --- feeds ---
  const feeds = {
    '511':   { age: ageStr(getf('511').at),   state: dotState('511', fresh) },
    'NWS':   { age: ageStr(getf('NWS').at),   state: dotState('NWS', fresh) },
    'WFIGS': { age: ageStr(getf('WFIGS').at), state: dotState('WFIGS', fresh) },
    'PGE':   { age: ageStr(getf('PGE').at),   state: dotState('PGE', fresh) },
  };
  const vals      = Object.values(feeds);
  const newestAge = Object.values(fresh).filter(f => f.at && f.ok).map(f => ageStr(f.at))[0] || '—';
  const allLive   = vals.every(f => f.state === 'live');
  const anyOff    = vals.some(f => f.state === 'off');
  const feedSummary = level === 'alert' ? null
    : allLive ? `All feeds live · updated <b>${newestAge}</b>`
    : anyOff  ? `⚠ Some feeds offline`
    : 'Feeds updating…';

  return { level, pillTitle, pillSub, wxIcon, wxText, wxWarn, roads, feeds, feedSummary, pge };
}
