// Service worker.
// - Squelette de l'application : servi immédiatement depuis le cache, mis à jour en arrière-plan
//   (nouvelle version visible au lancement suivant). Changer CACHE à chaque déploiement force
//   une mise à jour complète et cohérente de tous les fichiers.
// - Fiches techniques : cache dédié (smpm84-fiches) rempli par fiches.js ; lecture hors ligne.
// - Carte hors ligne : cache dédié (smpm84-carte) rempli par carte-hors-ligne.js à la demande ; jamais rempli ici.
// Les données personnelles ne passent jamais par ce cache (elles sont dans localStorage).
const CACHE = 'smpm84-shell-v39';
const FICHES_CACHE = 'smpm84-fiches';
const CARTE_CACHE = 'smpm84-carte';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'fiches.js', 'fmpa.js', 'fmpa-list.js', 'intervention-list.js', 'fmpa-valid.js', 'livret-remplir.js', 'carte-hors-ligne.js', 'config.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'assets/ecusson-132.png', 'assets/sdis84-210.png', 'assets/icon-192.png',
  'assets/banniere-700.jpg', 'assets/banniere-1000.jpg',
];

// Numéro de version affiché dans le bandeau : demandé par la page au service worker qui la sert
self.addEventListener('message', e => {
  if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(CACHE.replace(/^.*-v/, ''));
});

self.addEventListener('install', e => {
  // cache: 'reload' : contourne le cache HTTP du navigateur pour récupérer la version déployée
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

  // Cache d'abord (affichage immédiat même sur réseau lent), mise à jour en arrière-plan
  const isNav = req.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: isNav }) || (isNav ? await cache.match('index.html') : null);
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    if (cached) {
      e.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network.catch(() => cache.match('index.html'));
  }));
});
