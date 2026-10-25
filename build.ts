// Builds dist/nba-istorija.html: one self-contained page (code + history data).
import { readFileSync, writeFileSync } from 'fs';
const r = await Bun.build({ entrypoints: ['src/ui/app.tsx'], minify: true, target: 'browser', define: { 'process.env.NODE_ENV': '"production"', __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') } });
if (!r.success) { console.error(r.logs); process.exit(1); }
const js = await r.outputs[0].text();
const css = readFileSync('src/ui/style.css', 'utf8');
const hist = readFileSync('data/history.json', 'utf8').replace(/</g, '\\u003c');
const html = `<title>NBA History Simulator</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Silkscreen&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${css}</style>
<div id="app"></div>
<script type="application/json" id="hist">${hist}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync('dist/nba-istorija.html', html);
console.log('built', (html.length / 1e6).toFixed(2), 'MB, js', (js.length / 1e3).toFixed(0), 'KB');

// Installable phone/desktop app (PWA): the same page plus a manifest, icons and an offline cache.
import { mkdirSync } from 'fs';
mkdirSync('dist/pwa', { recursive: true });
const head = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d1320">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="NBA History">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
</head><body>
`;
const reg = `<script>
if ('serviceWorker' in navigator) {
  // a new version takes over as soon as it is installed: reload once so it shows right away
  const had = !!navigator.serviceWorker.controller;
  let done = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !done) { done = true; location.reload(); } });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {}));
}
</script>
</body></html>`;
writeFileSync('dist/pwa/index.html', head + html + reg);
writeFileSync('dist/pwa/manifest.webmanifest', JSON.stringify({
  name: 'NBA History Simulator', short_name: 'NBA History', start_url: './', scope: './', display: 'standalone', orientation: 'any',
  background_color: '#0d1320', theme_color: '#0d1320', description: 'Rewrite NBA history from any season since 1979–80.',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
const ver = Date.now().toString(36);
writeFileSync('dist/pwa/sw.js', `// The page always comes from the network when online (so updates show at once) and from the cache offline.
const C = 'nba-history-${ver}';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const page = req.mode === 'navigate' || req.destination === 'document' || req.url.endsWith('.html') || req.url.endsWith('/');
  if (page) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(req, cp)); } return r; }).catch(() => caches.match(req).then(h => h || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(req, cp)); } return r; })));
});
`);
console.log('pwa written to dist/pwa');
