'use strict';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    // Sprint state endpoint: /api/sprint
    if (url.pathname === '/api/sprint') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      const token = url.searchParams.get('token');
      if (!token || token !== env.SPRINT_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }

      const action = url.searchParams.get('action');

      // Read current sprint state: KV first, then static file, then default
      let state;
      if (env.SPRINT_KV) {
        const stored = await env.SPRINT_KV.get('state');
        if (stored) {
          state = JSON.parse(stored);
        }
      }
      if (!state) {
        try {
          const raw = await env.ASSETS.fetch(new Request(new URL('/sprint.json', request.url)));
          state = await raw.json();
        } catch {
          state = { sprint_active: false, sprint_start: null, issues: [], approved: false };
        }
      }

      if (request.method === 'GET') {
        // Approve action via GET shows a confirmation page to prevent prefetch auto-approval
        if (action === 'approve') {
          const issues = (state.issues || []).map(i => `<li>#${i.number} — ${i.title}</li>`).join('');
          const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approve Sprint — West Marin Civic</title><style>body{font-family:-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:0 24px;color:#1a1a1a}h2{font-size:18px;margin-bottom:8px}ul{padding-left:20px;margin:12px 0}form{margin-top:24px}button{background:#1a6b3c;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;width:100%}button:hover{background:#145c33}.warn{font-size:13px;color:#666;margin-top:12px}</style></head><body><h2>Approve this sprint?</h2><p>The following issues will be built on Wednesday 8am PT:</p><ul>${issues || '<li>No issues loaded</li>'}</ul><form method="POST" action="/api/sprint?token=${token}&action=approve"><button type="submit">Approve — start building</button></form><p class="warn">This will greenlight Usain to implement these issues and deploy to staging.</p></body></html>`;
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        return new Response(JSON.stringify(state), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        if (action === 'approve') {
          state.approved = true;
        } else if (action === 'reset') {
          state = { sprint_active: false, sprint_start: null, issues: [], approved: false };
        } else if (action === 'activate') {
          // Body: { issues: [...], sprint_start: "ISO date" }
          let body = {};
          try { body = await request.json(); } catch {}
          state.sprint_active = true;
          state.sprint_start = body.sprint_start || new Date().toISOString().slice(0, 10);
          state.issues = body.issues || [];
          state.approved = false;
        } else {
          return new Response('Unknown action', { status: 400, headers: CORS });
        }

        // Persist updated state by writing to KV (SPRINT_KV binding) if available,
        // otherwise return the new state for the agent to commit to git
        if (env.SPRINT_KV) {
          await env.SPRINT_KV.put('state', JSON.stringify(state));
          return new Response(JSON.stringify({ ok: true, state }), {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }

        // No KV — return state for agent to write back to sprint.json in git
        return new Response(JSON.stringify({ ok: true, state, persist_to_git: true }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    // All other requests: serve static assets
    return env.ASSETS.fetch(request);
  },
};
