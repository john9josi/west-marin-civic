import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker, { requestForAsset, staticAssetPath } from '../worker.js';

describe('coverage map route', () => {
  it('serves /map and /map/ from map.html', () => {
    expect(staticAssetPath('/map')).toBe('/map.html');
    expect(staticAssetPath('/map/')).toBe('/map.html');
    expect(staticAssetPath('/map.html')).toBe('/map.html');
    expect(staticAssetPath('/')).toBe('/');
  });

  it('rewrites the asset request URL and leaves other requests alone', () => {
    const mapReq = requestForAsset(new Request('https://westmarincivic.org/map'));
    expect(new URL(mapReq.url).pathname).toBe('/map.html');

    const home = new Request('https://westmarincivic.org/');
    expect(requestForAsset(home)).toBe(home);
  });

  it('GET /map returns the asset HTML with the site CSP', async () => {
    let fetchedPath = '';
    const env = {
      ASSETS: {
        fetch: async (request) => {
          fetchedPath = new URL(request.url).pathname;
          return new Response('<!doctype html><title>Coverage map</title>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        },
      },
    };

    const res = await worker.fetch(new Request('https://www.westmarincivic.org/map'), env);
    expect(fetchedPath).toBe('/map.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain('Coverage map');
  });

  it('map.html FAQ states the coordinates for each filter', () => {
    const html = readFileSync(new URL('../map.html', import.meta.url), 'utf8');
    expect(html).toContain('What coordinates do road closures and PG&amp;E outages cover?');
    expect(html).toContain('37.85°N');
    expect(html).toContain('38.34°N');
    expect(html).toContain('123.05°W');
    expect(html).toContain('122.55°W');
    expect(html).toContain('What coordinates do active fires cover?');
    expect(html).toContain('37.75°N');
    expect(html).toContain('38.40°N');
    expect(html).toContain('123.10°W');
    expect(html).toContain('122.50°W');
    expect(html).toContain('What coordinates do weather alerts cover?');
    expect(html).toContain('CAZ505');
    expect(html).toContain('37.82°N');
    expect(html).toContain('38.78°N');
    expect(html).toContain('Where does Highway 1 switch from North to South?');
    expect(html).toContain('38.055°N');
  });
});
