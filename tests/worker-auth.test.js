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
