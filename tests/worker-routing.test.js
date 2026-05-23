// Worker routing tests — run without DEV_PASSWORD so auth gate is inactive.
// These tests confirm the routing logic for .git protection and /api/511.
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('worker routing (no auth gate)', () => {
  it('GET /.git returns 404', async () => {
    const res = await SELF.fetch('https://example.com/.git');
    expect(res.status).toBe(404);
  });

  it('GET /.wrangler/state returns 404', async () => {
    const res = await SELF.fetch('https://example.com/.wrangler/state');
    expect(res.status).toBe(404);
  });

  it('OPTIONS /api/511 returns 204 with CORS headers', async () => {
    const res = await SELF.fetch('https://example.com/api/511', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('GET /api/511 without KEY_511 returns 500 with CORS header', async () => {
    const res = await SELF.fetch('https://example.com/api/511');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Missing API key');
  });
});
