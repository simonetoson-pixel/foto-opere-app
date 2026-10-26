// Service worker: tiene in cache l'app, perche' in cantiere deve aprirsi anche senza rete.

// Alzare insieme a VERSIONE in js/app.js.
const CACHE = 'ponti-v1';
const FILE = [
  './', './index.html', './stile.css', './manifest.json',
  './js/app.js', './js/vicini.js', './js/coda.js', './js/rete.js', './js/dati.js',
  './icona.svg', './config.json',
];

self.addEventListener('install', e => {
  // cache: 'reload' = dalla rete, mai dalla copia che il telefono tiene da se
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chiavi => Promise.all(chiavi.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // le chiamate a Supabase non si cachano mai: o passano o vanno in coda
  if (e.request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return;
  // prima la rete (cosi un aggiornamento si vede subito), poi la copia
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
