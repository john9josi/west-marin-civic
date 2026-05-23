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

    // Slack Events API: POST /slack-reply (before auth gate)
    // Receives thread replies from #gh-wmc and posts them as comments on issue #60
    if (url.pathname === '/slack-reply') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      const signingSecret = env.SLACK_SIGNING_SECRET;
      if (!signingSecret) {
        return new Response('SLACK_SIGNING_SECRET not configured', { status: 500 });
      }

      const rawBody = await request.text();

      // Verify Slack signature
      const timestamp = request.headers.get('X-Slack-Request-Timestamp') || '';
      const slackSig  = request.headers.get('X-Slack-Signature') || '';

      // Reject requests older than 5 minutes (replay attack prevention)
      if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        return new Response('Request too old', { status: 403 });
      }

      const sigBase = `v0:${timestamp}:${rawBody}`;
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigBase));
      const computed = 'v0=' + Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

      if (computed !== slackSig) {
        return new Response('Invalid signature', { status: 403 });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      // Slack URL verification challenge (one-time during app setup)
      if (payload.type === 'url_verification') {
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const event = payload.event || {};

      // Only handle thread replies in #gh-wmc — ignore bot messages and top-level posts
      if (
        event.type !== 'message' ||
        event.subtype === 'bot_message' ||
        event.bot_id ||
        !event.thread_ts ||
        event.thread_ts === event.ts
      ) {
        return new Response('ok', { status: 200 });
      }

      const githubToken = env.GITHUB_TOKEN;
      if (!githubToken) {
        return new Response('GITHUB_TOKEN not configured', { status: 500 });
      }

      const userName = event.user || 'someone';
      const commentBody = `💬 **Slack reply from ${userName}:**\n\n${event.text}`;

      await fetch('https://api.github.com/repos/john9josi/west-marin-civic/issues/60/comments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'wmc-worker',
        },
        body: JSON.stringify({ body: commentBody }),
      });

      return new Response('ok', { status: 200 });
    }

    // Slack notification proxy: POST /notify (before auth gate — uses its own secret)
    if (url.pathname === '/notify') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      const secret = env.NOTIFY_SECRET;
      if (!secret) {
        return new Response('NOTIFY_SECRET not configured', { status: 500 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      if (body.secret !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }

      const webhookUrl = env.SLACK_WEBHOOK;
      if (!webhookUrl) {
        return new Response('SLACK_WEBHOOK not configured', { status: 500 });
      }

      const slackPayload = {
        text: body.text,
        username: body.username || 'WMC Agent',
        icon_emoji: body.icon_emoji || ':robot_face:',
      };

      const slackRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });

      if (!slackRes.ok) {
        return new Response('Slack error: ' + slackRes.status, { status: 502 });
      }

      return new Response('ok', { status: 200 });
    }

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
