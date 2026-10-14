/**
 * CELL · 生命微观剧场 — Cloudflare Worker entry.
 *
 * Static files are served by the [assets] binding in wrangler.toml. This script
 * exists to add headers that a bare file host cannot express:
 *   - COOP/COEP so SharedArrayBuffer-style features work if they are ever used
 *   - correct charset for .glsl / source files
 *   - a soft cache policy: hashed assets live long, HTML is revalidated
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Let the asset binding answer first — it handles paths, 404s and ETags.
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType =
      MIME[url.pathname.slice(url.pathname.lastIndexOf('.')).toLowerCase()] ??
      assetResponse.headers.get('Content-Type') ??
      'application/octet-stream';

    const headers = new Headers(assetResponse.headers);
    headers.set('Content-Type', contentType);
    for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);

    // Never cache the shell: chapters are code-split and change independently.
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (url.pathname.startsWith('/vendor/') || url.pathname.includes('.')) {
      headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
