// Service worker.
// - Squelette de l'application : réseau d'abord, cache en secours hors ligne.
// - Fiches techniques : cache dédié (smpm84-fiches) rempli par fiches.js ; lecture hors ligne.
// - Carte hors ligne : cache dédié (smpm84-carte) rempli par carte-hors-ligne.js à la demande ; jamais rempli ici.
// Les données personnelles ne passent jamais par ce cache (elles sont dans localStorage).
const CACHE = 'smpm84-shell-v31';
const FICHES_CACHE = 'smpm84-fiches';
const CARTE_CACHE = 'smpm84-carte';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'fiches.js', 'fmpa.js', 'fmpa-list.js', 'intervention-list.js', 'fmpa-valid.js', 'livret-remplir.js', 'carte-hors-ligne.js', 'config.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'assets/ecusson.png', 'assets/sdis84.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/banniere.jpg', 'assets/banniere-1000.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FICHES_CACHE && k !== CARTE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Tuiles de la carte : cache seul (rempli volontairement), sinon réseau sans stockage
  if (url.hostname === 'data.geopf.fr') {
    e.respondWith(caches.open(CARTE_CACHE).then(c => c.match(req)).then(r => r || fetch(req)));
    return;
  }
  if (url.origin !== location.origin) return;     // l'API Apps Script n'est jamais mise en cache

  if (url.pathname.includes('/fiches/')) {
    // Synchronisation explicite (no-store) : toujours le réseau
    if (req.cache === 'no-store') { e.respondWith(fetch(req)); return; }
    // Liste des fiches : réseau si possible, sinon dernière liste synchronisée
    if (url.pathname.endsWith('/manifest.json')) {
      e.respondWith(
        fetch(req, { cache: 'no-store' }).catch(() => caches.match(req, { cacheName: FICHES_CACHE }))
      );
      return;
    }
    // Fiches : d'abord le cache hors ligne, sinon le réseau
    e.respondWith(
      caches.open(FICHES_CACHE).then(c => c.match(req).then(r => r || fetch(req)))
    );
    return;
  }

  // Réseau d'abord (toujours la dernière version), cache en secours hors ligne
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
