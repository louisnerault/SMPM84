// Carte hors ligne : télécharge la Photo aérienne IGN des zones de relief du Vaucluse
// (Ventoux et Dentelles, Monts de Vaucluse, Luberon) au zoom 15, dans le cache « smpm84-carte ».
// Lu par sw.js : la carte « Pointer sur la carte » fonctionne ensuite sans réseau.
// Téléchargement uniquement à la demande de l'utilisateur, en ligne.
(() => {
  'use strict';

  const CACHE = 'smpm84-carte';
  const KEY_META = 'smpm_carte_meta';
  const ZOOM = 15;
  const PARALLEL = 6;                       // requêtes simultanées
  const NEED_BYTES = 250 * 1024 * 1024;     // espace libre demandé avant de commencer
  // Zones de relief : sud, nord, ouest, est (degrés)
  const ZONES = [
    { name: 'Mont Ventoux et Dentelles', s: 44.05, n: 44.35, w: 5.00, e: 5.45 },
    { name: 'Monts de Vaucluse', s: 43.95, n: 44.20, w: 5.40, e: 5.85 },
    { name: 'Luberon', s: 43.75, n: 43.97, w: 5.15, e: 5.55 },
  ];

  // URL identique à celle de la carte (fmpa.js) : c'est elle qui sert de clé de cache
  const tileUrl = (x, y) =>
    `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS` +
    `&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${ZOOM}&TILEROW=${y}&TILECOL=${x}`;

  const tileX = lon => Math.floor((lon + 180) / 360 * 2 ** ZOOM);
  const tileY = lat => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** ZOOM);
  };

  function allTileUrls() {
    const seen = new Set();
    const urls = [];
    for (const z of ZONES) {
      for (let x = tileX(z.w); x <= tileX(z.e); x++) {
        for (let y = tileY(z.n); y <= tileY(z.s); y++) {
          const u = tileUrl(x, y);
          if (!seen.has(u)) { seen.add(u); urls.push(u); }
        }
      }
    }
    return urls;
  }

  const $ = sel => document.querySelector(sel);

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(KEY_META) || 'null'); } catch (e) { return null; }
  }
  function writeMeta(m) {
    try { localStorage.setItem(KEY_META, JSON.stringify(m)); } catch (e) {}
  }

  function formatWhen(iso) {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  let busy = false;
  let stopRequested = false;

  async function countCached(urls) {
    const cache = await caches.open(CACHE);
    let n = 0;
    for (const u of urls) if (await cache.match(u)) n++;
    return n;
  }

  async function hasRoomFor() {
    if (!navigator.storage || !navigator.storage.estimate) return true;
    const { quota, usage } = await navigator.storage.estimate();
    return !quota || quota - usage > NEED_BYTES;
  }

  function showStatus(text, note) {
    $('#carte-status').textContent = text;
    $('#carte-note').textContent = note || '';
  }

  function render() {
    const meta = readMeta();
    const btn = $('#btn-carte');
    const stop = $('#btn-carte-stop');
    const del = $('#btn-carte-del');
    stop.hidden = !busy;
    del.hidden = !meta || busy;
    btn.disabled = busy || !navigator.onLine;
    btn.textContent = meta && !busy ? 'Mettre à jour la carte' : 'Télécharger la carte';
    if (busy) return;
    if (!meta) {
      showStatus('Carte non téléchargée sur cet appareil.');
    } else {
      showStatus(`Téléchargée le ${formatWhen(meta.at)} (${meta.count} images).`,
        meta.missing ? `${meta.missing} images n’ont pas pu être téléchargées : relancez le téléchargement.` : '');
    }
  }

  async function download() {
    if (busy) return;
    const urls = allTileUrls();
    if (!navigator.onLine) { showStatus('Connexion nécessaire pour télécharger la carte.'); return; }
    if (!confirm(`Téléchargement d’environ ${urls.length} images, à faire de préférence en Wi-Fi. ` +
      'Ne fermez pas l’application pendant le téléchargement. Continuer ?')) return;
    if (!(await hasRoomFor())) {
      showStatus('Espace de stockage insuffisant sur cet appareil pour la carte.');
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

    busy = true;
    stopRequested = false;
    render();
    const cache = await caches.open(CACHE);
    let done = 0;
    let missing = 0;
    try {
      for (let i = 0; i < urls.length && !stopRequested; i += PARALLEL) {
        await Promise.all(urls.slice(i, i + PARALLEL).map(async u => {
          if (await cache.match(u)) return;                 // déjà présente : on ne la retélécharge pas
          try {
            const res = await fetch(u);
            if (!res.ok) throw new Error(String(res.status));
            await cache.put(u, res);
          } catch (e) {
            missing++;
          }
        }));
        done = Math.min(i + PARALLEL, urls.length);
        showStatus(`Téléchargement : ${done} / ${urls.length} images…`);
      }
    } finally {
      busy = false;
    }

    if (stopRequested) {
      showStatus(`Téléchargement arrêté (${done} / ${urls.length} images). Relancez pour terminer.`);
      render();
      return;
    }
    const count = await countCached(urls);
    writeMeta({ at: new Date().toISOString(), count, missing: urls.length - count });
    render();
  }

  async function remove() {
    if (busy || !confirm('Supprimer la carte hors ligne de cet appareil ?')) return;
    await caches.delete(CACHE);
    try { localStorage.removeItem(KEY_META); } catch (e) {}
    render();
  }

  function setAllowed(on) {
    const card = $('#carte-card');
    if (card) card.hidden = !on;
    if (on) render();
  }

  function bind() {
    $('#btn-carte').addEventListener('click', download);
    $('#btn-carte-stop').addEventListener('click', () => { stopRequested = true; });
    $('#btn-carte-del').addEventListener('click', remove);
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
  }

  window.SMPM_CARTE = { setAllowed, render };
  bind();
})();
