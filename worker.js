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
