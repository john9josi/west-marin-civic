// Auth gate tests — run with DEV_PASSWORD='test-password' set via miniflare bindings.
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('worker auth gate (DEV_PASSWORD set)', () => {
  it('GET / without auth cookie returns auth page', async () => {
    const res = await SELF.fetch('https://example.com/');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Password required');
    expect(text).toContain('WMC Staging');
  });

  it('auth page includes CSP header', async () => {
    const res = await SELF.fetch('https://example.com/');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
  });

  it('POST /__auth with correct password redirects and sets hashed session cookie', async () => {
    const body = new URLSearchParams({ pwd: 'test-password' });
    const res = await SELF.fetch('https://example.com/__auth', {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toBeTruthy();
    // Raw password must NOT appear in the cookie
    expect(cookie).not.toContain('test-password');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('POST /__auth with wrong password returns 401', async () => {
    const body = new URLSearchParams({ pwd: 'wrong-password' });
    const res = await SELF.fetch('https://example.com/__auth', {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Incorrect password');
  });

  it('valid session cookie bypasses auth gate and reaches api proxy', async () => {
    // Log in to get the real SHA-256 session token
    const loginBody = new URLSearchParams({ pwd: 'test-password' });
    const loginRes = await SELF.fetch('https://example.com/__auth', {
      method: 'POST',
      body: loginBody.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    const setCookie = loginRes.headers.get('Set-Cookie');
    const tokenMatch = setCookie?.match(/wmc_dev_auth=([^;]+)/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch[1];

    // With the real token, /api/511 should reach the proxy (not auth page).
    // No KEY_511 in test env → 500 with CORS (not the auth 200 page).
    const res = await SELF.fetch('https://example.com/api/511', {
      headers: { Cookie: `wmc_dev_auth=${token}` },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).not.toContain('Password required');
  });
});

// ============================================================
// Ship to Live: GET /api/ship-status, POST /api/ship (#15)
//
// Both routes live inside the DEV_PASSWORD-gated block in worker.js, so an
// unauthenticated caller must never reach them — that's what makes it safe
// for these routes to exist at all on a publicly reachable Worker. The
// actual GitHub merge call isn't exercised here (no live network access in
// tests, and it must never hit the real API from a test run); the
// config-missing branch is exercised instead, same pattern already used for
// NOTIFY_SECRET/SLACK_SIGNING_SECRET above. GITHUB_TOKEN is deliberately
// left unset in this project's bindings (see vitest.workspace.js) so that
// branch is reachable.
// ============================================================

async function getAuthCookie() {
  const loginBody = new URLSearchParams({ pwd: 'test-password' });
  const loginRes = await SELF.fetch('https://example.com/__auth', {
    method: 'POST',
    body: loginBody.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  });
  const setCookie = loginRes.headers.get('Set-Cookie');
  const token = setCookie?.match(/wmc_dev_auth=([^;]+)/)?.[1];
  return `wmc_dev_auth=${token}`;
}

describe('worker ship-to-live routes (DEV_PASSWORD set)', () => {
  it('unauthenticated GET /api/ship-status returns the password page, not ship data', async () => {
    const res = await SELF.fetch('https://example.com/api/ship-status?branch=sprint/2026-05-25');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Password required');
  });

  it('unauthenticated POST /api/ship returns the password page, not ship data', async () => {
    const res = await SELF.fetch('https://example.com/api/ship', {
      method: 'POST',
      body: JSON.stringify({ branch: 'sprint/2026-05-25' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Password required');
  });

  it('authenticated GET /api/ship-status without GITHUB_TOKEN configured returns 500', async () => {
    const cookie = await getAuthCookie();
    const res = await SELF.fetch('https://example.com/api/ship-status?branch=sprint/2026-05-25', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('GITHUB_TOKEN not configured');
  });

  it('authenticated POST /api/ship without GITHUB_TOKEN configured returns 500', async () => {
    const cookie = await getAuthCookie();
    const res = await SELF.fetch('https://example.com/api/ship', {
      method: 'POST',
      body: JSON.stringify({ branch: 'sprint/2026-05-25' }),
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('GITHUB_TOKEN not configured');
  });

  it('authenticated POST /api/ship-status (wrong method) returns 405', async () => {
    const cookie = await getAuthCookie();
    const res = await SELF.fetch('https://example.com/api/ship-status?branch=sprint/2026-05-25', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(405);
  });

  it('authenticated GET /api/ship (wrong method) returns 405', async () => {
    const cookie = await getAuthCookie();
    const res = await SELF.fetch('https://example.com/api/ship', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(405);
  });
});
