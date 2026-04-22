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

    // All other requests: serve static assets
    return env.ASSETS.fetch(request);
  },
};
