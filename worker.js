'use strict';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// CSP covering all external origins used by the app (GA, CF beacon, NWS, ArcGIS, PGE)
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://static.cloudflareinsights.com https://www.google-analytics.com",
  "connect-src 'self' https://api.weather.gov https://services3.arcgis.com https://ags.pge.esriemcs.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const AUTH_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WMC Dev — Password Required</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F4F2EE; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { background: #fff; padding: 32px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 280px; }
  h1 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  p { font-size: 13px; color: #666; margin-bottom: 20px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px; box-sizing: border-box; margin-bottom: 12px; }
  button { width: 100%; padding: 10px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }
  .err { color: #B91C1C; font-size: 13px; margin-bottom: 12px; display: none; }
</style>
</head>
<body>
<form method="POST" action="/__auth">
  <h1>WMC Staging</h1>
  <p>Password required</p>
  <div class="err" id="err">Incorrect password</div>
  <input type="password" name="pwd" placeholder="Password" autofocus>
  <button type="submit">Enter</button>
</form>
</body>
</html>`;

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

// Returns hex-encoded SHA-256 of 'wmc:<password>' so the raw password never appears in a cookie
async function tokenFor(password) {
  const data = new TextEncoder().encode('wmc:' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function withCSP(response) {
  const r = new Response(response.body, response);
  r.headers.set('Content-Security-Policy', CSP);
  return r;
}

function htmlResponse(body, init) {
  const r = new Response(body, init);
  r.headers.set('Content-Security-Policy', CSP);
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Dev environment: gate all requests behind a password + cookie session
    if (env.DEV_PASSWORD) {
      const token  = await tokenFor(env.DEV_PASSWORD);
      const authed = getCookie(request, 'wmc_dev_auth') === token;

      // Handle login form POST
      if (request.method === 'POST' && url.pathname === '/__auth') {
        const body = await request.formData();
        if (body.get('pwd') === env.DEV_PASSWORD) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/',
              'Set-Cookie': `wmc_dev_auth=${token}; Path=/; HttpOnly; SameSite=Strict`,
            },
          });
        }
        const page = AUTH_PAGE.replace('display: none', 'display: block');
        return htmlResponse(page, { status: 401, headers: { 'Content-Type': 'text/html' } });
      }

      // Not authenticated — show password page for all requests
      if (!authed) {
        return htmlResponse(AUTH_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    }

    // Block .git and .wrangler directory traversal
    if (url.pathname.startsWith('/.git') || url.pathname.startsWith('/.wrangler')) {
      return new Response('Not found', { status: 404 });
    }

    // Proxy endpoint: /api/511
    if (url.pathname === '/api/511') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      const apiKey = env.KEY_511;
      if (!apiKey) {
        return new Response('Missing API key', { status: 500, headers: CORS });
      }

      const upstream = `https://api.511.org/traffic/events?api_key=${apiKey}&format=json`;

      try {
        const res = await fetch(upstream, {
          headers: { 'Accept-Encoding': 'identity' },
        });

        const body = await res.text();
        return new Response(body, {
          status:  res.status,
          headers: {
            ...CORS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
          },
        });
      } catch (err) {
        return new Response('Upstream error: ' + err.message, { status: 502, headers: CORS });
      }
    }

    // All other requests: serve static assets, adding CSP to HTML responses
    const assetResponse = await env.ASSETS.fetch(request);
    const ct = assetResponse.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) return assetResponse;
    return withCSP(assetResponse);
  },
};
