'use strict';

// Bump SHELL_CACHE version to force re-install after HTML changes
const SHELL_CACHE = 'wmc-shell-v1';
const API_CACHE   = 'wmc-api-v1';

const SHELL_FILES = ['./index.html', './config.js', './manifest.json', './icon.svg'];

// ---- Install: cache the app shell ----
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ---- Activate: delete old cache versions ----
self.addEventListener('activate', e => {
  const keep = [SHELL_CACHE, API_CACHE];
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- Fetch ----
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Same-origin (app shell) → cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // External APIs → network-first, stamp cache time so the app can show honest staleness
  e.respondWith(
    fetch(e.request.clone())
      .then(async res => {
        if (res.ok) {
          const buf     = await res.clone().arrayBuffer();
          const headers = new Headers(res.headers);
          headers.set('X-Cached-At', String(Date.now()));
          const stamped = new Response(buf, {
            status: res.status, statusText: res.statusText, headers
          });
          caches.open(API_CACHE).then(c => c.put(e.request, stamped));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { cacheName: API_CACHE })
          .then(r => r || Response.error())
      )
  );
});
