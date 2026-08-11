import { describe, it, expect } from 'vitest';
import {
  ageStr, dotState, parse511Roads, buildState, parseUntilStr, inWestMarin, STALE_MINS,
} from '../src/lib.js';

// ============================================================
// ageStr
// ============================================================

describe('ageStr', () => {
  it('returns — for null', () => {
    expect(ageStr(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(ageStr(undefined)).toBe('—');
  });

  it('returns seconds for recent timestamp', () => {
    expect(ageStr(Date.now() - 30_000)).toBe('30s');
  });

  it('returns minutes for older timestamp', () => {
    expect(ageStr(Date.now() - 5 * 60_000)).toBe('5m');
  });

  it('returns hours for very old timestamp', () => {
    expect(ageStr(Date.now() - 2 * 60 * 60_000)).toBe('2h');
  });
});

// ============================================================
// dotState
// ============================================================

describe('dotState', () => {
  it('returns stale when no at timestamp', () => {
    const fresh = { '511': { at: null, ok: false } };
    expect(dotState('511', fresh)).toBe('stale');
  });

  it('returns live for recent successful fetch', () => {
    const fresh = { 'NWS': { at: Date.now(), ok: true } };
    expect(dotState('NWS', fresh)).toBe('live');
  });

  it('returns stale when data is past threshold', () => {
    // WFIGS threshold is 90 min; use 100 min ago
    const fresh = { 'WFIGS': { at: Date.now() - 100 * 60_000, ok: true } };
    expect(dotState('WFIGS', fresh)).toBe('stale');
  });

  it('returns off when fetch failed but we have a timestamp', () => {
    const fresh = { 'PGE': { at: Date.now() - 5 * 60_000, ok: false } };
    expect(dotState('PGE', fresh)).toBe('off');
  });

  it('returns stale for unknown src (missing from fresh)', () => {
    expect(dotState('511', {})).toBe('stale');
  });
});

// ============================================================
// parseUntilStr
// ============================================================

describe('parseUntilStr', () => {
  it('returns empty for null', () => {
    expect(parseUntilStr(null)).toBe('');
  });

  it('returns empty for empty string', () => {
    expect(parseUntilStr('')).toBe('');
  });

  it('returns empty when no end segment in interval', () => {
    expect(parseUntilStr('2026-01-01T00:00Z')).toBe('');
  });

  it('returns empty for invalid end date', () => {
    expect(parseUntilStr('2026-01-01T00:00Z/not-a-date')).toBe('');
  });

  it('returns empty for interval ending more than 7 days out', () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
    expect(parseUntilStr(`2026-01-01T00:00Z/${farFuture}`)).toBe('');
  });

  it('returns "· until X" for near-term end date', () => {
    const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
    const result = parseUntilStr(`2026-01-01T00:00Z/${soon}`);
    expect(result).toMatch(/^ · until /);
  });
});

// ============================================================
// inWestMarin
// ============================================================

describe('inWestMarin', () => {
  it('returns true for Point Reyes coords', () => {
    expect(inWestMarin([-122.8, 38.1])).toBe(true);
  });

  it('returns false for SF coords', () => {
    expect(inWestMarin([-122.4, 37.8])).toBe(false);
  });

  it('returns false for null', () => {
    expect(inWestMarin(null)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(inWestMarin([])).toBe(false);
  });

  it('returns false for coords north of bbox', () => {
    expect(inWestMarin([-122.8, 38.5])).toBe(false);
  });
});

// ============================================================
// parse511Roads
// ============================================================

describe('parse511Roads', () => {
  it('returns empty map for null input', () => {
    expect(parse511Roads(null)).toEqual({});
  });

  it('returns empty map for empty events array', () => {
    expect(parse511Roads({ events: [] })).toEqual({});
  });

  it('parses a CLOSED event on Hwy 1 North (lat north of Olema)', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.8, 38.1] },
        roads: [{ name: 'CA-1', state: 'CLOSED', from: 'Marshall', to: 'Pt Reyes Station' }],
        headline: 'Road closed',
        schedule: { intervals: [] },
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1n']).toBeDefined();
    expect(result['hwy1n'].status).toBe('Closed');
    expect(result['hwy1n'].cls).toBe('r');
  });

  it('puts Hwy 1 south of Olema in hwy1s', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.6, 37.9] },
        roads: [{ name: 'CA-1', state: 'CLOSED' }],
        headline: '',
        schedule: {},
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1s']).toBeDefined();
    expect(result['hwy1n']).toBeUndefined();
  });

  it('ignores events outside West Marin bounding box', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.4, 37.8] },
        roads: [{ name: 'CA-1', state: 'CLOSED' }],
        headline: 'Closure',
      }],
    };
    expect(parse511Roads(raw)).toEqual({});
  });

  it('maps SINGLE_LANE_ALTERNATING to Single Lane / amber', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.9, 38.0] },
        roads: [{ name: 'Sir Francis Drake', state: 'SINGLE_LANE_ALTERNATING' }],
        headline: '',
        schedule: {},
      }],
    };
    const result = parse511Roads(raw);
    expect(result['sfd']?.status).toBe('Single Lane');
    expect(result['sfd']?.cls).toBe('a');
  });

  it('ignores inactive events', () => {
    const raw = {
      events: [{
        status: 'Inactive',
        geography: { coordinates: [-122.8, 38.1] },
        roads: [{ name: 'CA-1', state: 'CLOSED' }],
        headline: '',
      }],
    };
    expect(parse511Roads(raw)).toEqual({});
  });
});

// ============================================================
// buildState
// ============================================================

describe('buildState', () => {
  it('returns calm with All clear title when no alerts and no fire', () => {
    const s = buildState({ level: 'calm', props: null }, null, {}, null, false, null, {});
    expect(s.level).toBe('calm');
    expect(s.pillTitle).toBe('All clear');
  });

  it('returns alert level and fire title when fire is present', () => {
    const fire = { name: 'Tomales Ridge', acres: 120, pct: 5, updAt: new Date() };
    const s = buildState(null, null, {}, fire, false, null, {});
    expect(s.level).toBe('alert');
    expect(s.pillTitle).toContain('Tomales Ridge');
  });

  it('fire beats NWS watch — returns alert even when nwsAlert says watch', () => {
    const fire = { name: 'Test Fire', acres: 50, pct: 0, updAt: new Date() };
    const s = buildState(
      { level: 'watch', props: { event: 'Fire Weather Watch' } },
      null, {}, fire, false, null, {}
    );
    expect(s.level).toBe('alert');
  });

  it('returns watch with correct title from NWS watch alert', () => {
    const s = buildState(
      { level: 'watch', props: { event: 'Fire Weather Watch', expires: null } },
      null, {}, null, false, null, {}
    );
    expect(s.level).toBe('watch');
    expect(s.pillTitle).toBe('Fire Weather Watch');
  });

  it('appends "updated Xm ago" to pillSub during alert when fresh data is >2 min old', () => {
    const f = {
      '511':   { at: Date.now() - 5 * 60_000, ok: true },
      'NWS':   { at: Date.now() - 5 * 60_000, ok: true },
      'WFIGS': { at: Date.now() - 5 * 60_000, ok: true },
      'PGE':   { at: Date.now() - 5 * 60_000, ok: true },
    };
    const fire = { name: 'Test', acres: 10, pct: 0, updAt: new Date() };
    const s = buildState(null, null, {}, fire, false, null, f);
    expect(s.pillSub).toContain('updated');
    expect(s.pillSub).toContain('m ago');
  });

  it('does NOT append feed age when data is fresh (<2 min)', () => {
    const f = {
      '511':   { at: Date.now(), ok: true },
      'NWS':   { at: Date.now(), ok: true },
      'WFIGS': { at: Date.now(), ok: true },
      'PGE':   { at: Date.now(), ok: true },
    };
    const fire = { name: 'Test', acres: 10, pct: 0, updAt: new Date() };
    const s = buildState(null, null, {}, fire, false, null, f);
    expect(s.pillSub).not.toContain('updated');
  });

  it('marks all roads as Clear when has511 is true and no closures', () => {
    const s = buildState({ level: 'calm', props: null }, null, {}, null, true, null, {});
    expect(s.roads.every(r => r.status === 'Clear')).toBe(true);
  });

  it('marks roads as — when has511 is false', () => {
    const s = buildState({ level: 'calm', props: null }, null, {}, null, false, null, {});
    expect(s.roads.every(r => r.status === '—')).toBe(true);
  });

  it('returns feeds object with 4 keys', () => {
    const s = buildState(null, null, {}, null, false, null, {});
    expect(Object.keys(s.feeds)).toEqual(['511', 'NWS', 'WFIGS', 'PGE']);
  });
});

// ============================================================
// parse511Roads — Hwy 1 N/S boundary regression (#33)
//
// #33 was fixed by moving the split latitude from 38.04 to 38.055.
// None of the tests above exercise a coordinate anywhere near that
// boundary (they use 38.1 / 37.9), so a repeat drift would go
// uncaught. These pin the real-world coordinates involved in #33
// itself plus the exact split value.
// ============================================================

describe('parse511Roads — Hwy 1 N/S boundary (regression for #33)', () => {
  it('classifies the real Olema coordinate (38.042) as hwy1s, not hwy1n', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.79, 38.042] },
        roads: [{ name: 'Highway 1', state: 'CLOSED' }],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1s']).toBeDefined();
    expect(result['hwy1n']).toBeUndefined();
  });

  it('classifies the Point Reyes Station coordinate (38.069) as hwy1n', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.81, 38.069] },
        roads: [{ name: 'Highway 1', state: 'CLOSED' }],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1n']).toBeDefined();
    expect(result['hwy1s']).toBeUndefined();
  });

  it('treats the exact split latitude (38.055) as hwy1n — inclusive boundary', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.8, 38.055] },
        roads: [{ name: 'Highway 1', state: 'CLOSED' }],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1n']).toBeDefined();
    expect(result['hwy1s']).toBeUndefined();
  });

  it('classifies just south of the split (38.054) as hwy1s', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.8, 38.054] },
        roads: [{ name: 'Highway 1', state: 'CLOSED' }],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1s']).toBeDefined();
    expect(result['hwy1n']).toBeUndefined();
  });
});

// ============================================================
// parse511Roads — multi-road events
//
// status/cls is read once from roads[0].state and then applied to
// every road ID matched anywhere in the event's roads[] array. An
// event naming two roads with different states will misreport the
// second one. This is a plausible cause of "our status doesn't
// match 511.org's map" reports, since 511 events commonly span an
// intersection of two named roads.
// ============================================================

describe('parse511Roads — multi-road events must not bleed status across roads', () => {
  it('gives each matched road its own status instead of copying roads[0]', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.85, 38.0] },
        roads: [
          { name: 'Highway 1', state: 'CLOSED' },
          { name: 'Sir Francis Drake', state: 'SINGLE_LANE_ALTERNATING' },
        ],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['hwy1s'].status).toBe('Closed');
    expect(result['sfd'].status).toBe('Single Lane');
  });
});

// ============================================================
// parse511Roads — Valley Ford Rd vs. WM_BBOX
//
// Valley Ford Rd is one of the 11 roads the app tracks (see ROADS
// in src/lib.js), but the town of Valley Ford itself sits at
// ~38.318N (per USGS/Wikipedia), north of WM_BBOX.maxLat (38.30).
// An event geotagged there would be silently dropped by
// inWestMarin() before road-matching ever runs.
// ============================================================

describe('parse511Roads — Valley Ford Rd sits at the edge of WM_BBOX', () => {
  it('does not silently drop an event at Valley Ford\'s real coordinates (38.318N)', () => {
    const raw = {
      events: [{
        status: 'Active',
        geography: { coordinates: [-122.924, 38.318] },
        roads: [{ name: 'Valley Ford Rd', state: 'SOME_LANES_CLOSED' }],
        headline: '',
      }],
    };
    const result = parse511Roads(raw);
    expect(result['vf']).toBeDefined();
  });
});
