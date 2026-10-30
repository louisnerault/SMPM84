// Service worker.
// - Squelette de l'application : servi immédiatement depuis le cache, mis à jour en arrière-plan
//   (nouvelle version visible au lancement suivant). Changer CACHE à chaque déploiement force
//   une mise à jour complète et cohérente de tous les fichiers.
// - Fiches techniques : cache dédié (smpm84-fiches) rempli par fiches.js ; lecture hors ligne.
// - Carte hors ligne : cache dédié (smpm84-carte) rempli par carte-hors-ligne.js à la demande ; jamais rempli ici.
// - Photos des points d'intérêt : cache dédié (smpm84-poi) rempli par poi.js ; jamais rempli ici.
// Les données personnelles ne passent jamais par ce cache (elles sont dans localStorage).
const CACHE = 'smpm84-shell-v122';
const FICHES_CACHE = 'smpm84-fiches';
const CARTE_CACHE = 'smpm84-carte';
const POI_CACHE = 'smpm84-poi';         // photos des points d'intérêt consultées (poi.js)
const INV_CACHE = 'smpm84-inv';         // photos des articles de l'inventaire (inventaire.js)
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'fiches.js', 'fmpa.js', 'fmpa-list.js', 'intervention-list.js', 'annuaire.js', 'poi.js', 'inventaire.js', 'vendor/qrcode/qrcode.min.js', 'fmpa-valid.js', 'livret-remplir.js', 'livret-themes.js', 'carte-hors-ligne.js', 'push.js', 'notifs.js', 'bugs.js', 'csh.js', 'personnel.js', 'config.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'assets/ecusson-132.png', 'assets/sdis84-210.png', 'assets/icon-192.png',
  'assets/banniere-700.jpg', 'assets/banniere-1000.jpg', 'assets/banniere-nuit-700.jpg', 'assets/banniere-nuit-1000.jpg', 'assets/soleil.png', 'assets/lune.png',
];

// Numéro de version affiché dans le bandeau : demandé par la page au service worker qui la sert
self.addEventListener('message', e => {
  if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(CACHE.replace(/^.*-v/, ''));
});

// Notification push (Firebase Cloud Messaging, envoyée par backend/Push.gs) : affichée même application fermée.
// Messages « data » : { title, body, page, tag }. Toujours afficher une notification (exigé par iOS et Chrome).
self.addEventListener('push', e => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch (err) { j = { data: { body: e.data ? e.data.text() : '' } }; }
  const d = Object.assign({}, j.notification || {}, j.data || {});
  const title = d.title || 'SMPM 84';
  // application ouverte : la clochette se met à jour
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => list.forEach(c => c.postMessage({ type: 'notif' }))).catch(() => {});
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    data: { page: d.page || '', id: d.id || '' },
  }));
});

// Toucher une notification : ouvre l'application sur la page concernée.
// Sans page (message de l'encadrement, test) : ouvre la clochette (page spéciale « notifs »).
// Ordre des tentatives (chaque étape peut échouer selon le téléphone) :
//   1. fenêtre de l'application déjà ouverte -> mise au premier plan + demande de la page ;
//   2. mise au premier plan refusée -> rechargement de cette fenêtre sur la page ;
//   3. aucune fenêtre (ou échec) -> ouverture d'une nouvelle fenêtre sur la page.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const page = (e.notification.data && e.notification.data.page) || 'notifs';
  const notif = (e.notification.data && e.notification.data.id) || '';   // lecture signalée au serveur (clic)
  const url = new URL('./?page=' + encodeURIComponent(page) + (notif ? '&notif=' + encodeURIComponent(notif) : ''), self.registration.scope).href;
  const ouvrir = () => self.clients.openWindow(url).catch(() => null);
  e.waitUntil((async () => {
    let list = [];
    try { list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (err) {}
    // fenêtres de l'application uniquement, la plus pertinente d'abord (visible, puis contrôlée)
    const scope = self.registration.scope;
    const wins = list.filter(c => c.url && c.url.startsWith(scope))
      .sort((a, b) => (b.visibilityState === 'visible') - (a.visibilityState === 'visible') || b.focused - a.focused);
    const c = wins[0];
    if (!c) return ouvrir();
    try {
      const f = await c.focus();
      if (f || c.focused) { (f || c).postMessage({ type: 'goto', page, notif }); return; }
    } catch (err) { /* mise au premier plan refusée */ }
    try {
      if (c.navigate) { const n = await c.navigate(url); if (n) { try { await n.focus(); } catch (err) {} return; } }
    } catch (err) { /* fenêtre non contrôlée par ce service worker */ }
    return ouvrir();
  })());
});

self.addEventListener('install', e => {
  // cache: 'reload' : contourne le cache HTTP du navigateur pour récupérer la version déployée
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FICHES_CACHE && k !== CARTE_CACHE && k !== POI_CACHE && k !== INV_CACHE).map(k => caches.delete(k))))
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
  // Test du réseau (app.js, hasNetwork) : toujours le réseau, jamais le cache
  if (url.pathname.endsWith('/ping.txt')) { e.respondWith(fetch(req, { cache: 'no-store' })); return; }

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
