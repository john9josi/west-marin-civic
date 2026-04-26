'use strict';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
<form method="POST">
  <h1>WMC Staging</h1>
  <p>Password required</p>
  <div class="err" id="err">Incorrect password</div>
  <input type="password" name="pwd" placeholder="Password" autofocus>
  <button type="submit">Enter</button>
</form>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Dev environment: gate all requests behind a password prompt
    if (env.DEV_PASSWORD) {
      if (request.method === 'POST' && url.pathname === '/') {
        const body = await request.formData();
        if (body.get('pwd') === env.DEV_PASSWORD) {
          // Correct — serve the app
          return env.ASSETS.fetch(new Request(url.origin + '/', request));
        }
        // Wrong password — show form with error
        const page = AUTH_PAGE.replace('display: none', 'display: block');
        return new Response(page, { status: 401, headers: { 'Content-Type': 'text/html' } });
      }
      if (request.method !== 'POST') {
        return new Response(AUTH_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
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

    // All other requests: serve static assets
    return env.ASSETS.fetch(request);
  },
};
