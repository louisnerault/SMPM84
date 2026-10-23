// Fiches techniques : liste, synchronisation sur smartphone, état réseau et dernière synchro.
(() => {
  'use strict';

  const MANIFEST = 'fiches/manifest.json';
  const CACHE = 'smpm84-fiches';   // cache dédié, lu par sw.js
  const KEY = 'smpm_fiches_manifest';
  const KEY_SYNCED = 'smpm_fiches_synced_at';
  const KEY_FAVS = 'smpm_fiches_favs';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const abs = rel => new URL(rel, location.href).href;

  const state = { manifest: null, syncing: false, failed: false };

  // Smartphone : petit écran ou écran tactile. Sur ordinateur, pas de synchronisation.
  function isMobile() {
    return window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeLocal(m) {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }
  function readSyncedAt() {
    try { return localStorage.getItem(KEY_SYNCED); } catch (e) { return null; }
  }
  function writeSyncedAt(iso) {
    try { localStorage.setItem(KEY_SYNCED, iso); } catch (e) {}
  }

  async function fetchManifest() {
    const res = await fetch(MANIFEST, { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest');
    return res.json();
  }

  // ---------- synchronisation (smartphone) ----------
  async function sync() {
    if (state.syncing || !navigator.onLine || !('caches' in window)) return;
    if (!isMobile()) { await refresh(); return; }

    setSyncing(true);
    try {
      const remote = await fetchManifest();
      const local = readLocal();
      const oldItems = (local && local.items) || [];
      const oldById = new Map(oldItems.map(i => [i.id, i]));
      const cache = await caches.open(CACHE);

      // Ne télécharge que ce qui a changé ou manque dans le cache
      for (const item of remote.items) {
        const old = oldById.get(item.id);
        const cached = await cache.match(abs(item.url));
        if (old && old.version === item.version && old.path === item.path && cached) continue;
        const res = await fetch(item.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(item.url);
        await cache.put(abs(item.url), res);
      }

      // Retire du cache les fiches supprimées sur Drive
      const wanted = new Set(remote.items.map(i => abs(i.url)));
      for (const old of oldItems) {
        if (!wanted.has(abs(old.url))) await cache.delete(abs(old.url));
      }

      await cache.put(abs(MANIFEST), new Response(JSON.stringify(remote), {
        headers: { 'Content-Type': 'application/json' },
      }));
      writeLocal(remote);
      writeSyncedAt(new Date().toISOString());
      state.manifest = remote;
      state.failed = false;
    } catch (e) {
      // Échec (réseau coupé en cours de route) : on garde la version précédente
      state.failed = true;
    } finally {
      setSyncing(false);
    }
  }

  async function refresh() {
    try { state.manifest = await fetchManifest(); }
    catch (e) { state.manifest = readLocal(); }
    render();
  }

  // ---------- affichage ----------
  function setSyncing(on) {
    state.syncing = on;
    document.body.classList.toggle('fiches-syncing', on);
    $$('[data-sync-dot]').forEach(el => { el.hidden = !on; });
    render();
  }

  function formatWhen(iso) {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // Barre d'état : dernière synchronisation de l'application (mot + heure, le mot se masque sur petit écran)
  function syncParts() {
    if (state.syncing) return { word: 'Synchro en cours…', when: '' };
    const at = readSyncedAt() || ((state.manifest || readLocal()) || {}).generated_at;
    if (!at) return { word: 'Jamais synchro', when: '' };
    return { word: state.failed ? 'Échec' : 'Synchro', when: formatWhen(at) };
  }

  function writeSyncParts(el) {
    const { word, when } = syncParts();
    const a = document.createElement('span');
    a.className = 'txt';
    a.textContent = word;
    const b = document.createElement('span');
    b.textContent = when;
    el.replaceChildren(a, b);
  }

  function updateNet() {
    const online = navigator.onLine;
    document.body.classList.toggle('is-offline', !online);
    const label = $('#status-net-label');
    if (label) label.textContent = online ? 'En ligne' : 'Hors ligne';
  }

  function render() {
    $$('[data-sync-label]').forEach(writeSyncParts);
    const groups = $('#fiches-groups');
    if (!groups) return;

    const m = state.manifest || readLocal();
    const items = (m && m.items) || [];
    $('#fiches-empty').hidden = items.length > 0;

    // Favoris (propres à cet appareil) : groupe « Mes favoris » en tête, puis les catégories
    const favs = readFavs();
    const byCat = new Map();
    const favItems = [];
    items.forEach(i => {
      if (favs.has(i.id)) { favItems.push(i); return; }
      const c = i.category || 'Divers';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(i);
    });

    const frag = document.createDocumentFragment();
    const addGroup = (title, list, isFav) => {
      const h = document.createElement('h2');
      h.className = 'fiches-cat' + (isFav ? ' fiches-cat-fav' : '');
      h.textContent = title;
      const ul = document.createElement('ul');
      ul.className = 'fiches-list';
      list.sort((a, b) => a.title.localeCompare(b.title, 'fr')).forEach(i => ul.append(row(i, favs.has(i.id))));
      frag.append(h, ul);
    };
    if (favItems.length) addGroup('★ Mes favoris', favItems, true);
    [...byCat.keys()].sort((a, b) => a.localeCompare(b, 'fr')).forEach(cat => addGroup(cat, byCat.get(cat), false));
    groups.replaceChildren(frag);
  }

  function row(i, isFav) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = i.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = i.title;
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'fav' + (isFav ? ' on' : '');
    star.setAttribute('aria-pressed', String(isFav));
    star.setAttribute('aria-label', (isFav ? 'Retirer des favoris : ' : 'Ajouter aux favoris : ') + i.title);
    star.textContent = isFav ? '★' : '☆';
    star.addEventListener('click', () => toggleFav(i.id));
    li.append(a, star);
    return li;
  }

  function readFavs() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY_FAVS) || '[]')); } catch (e) { return new Set(); }
  }
  function toggleFav(id) {
    const favs = readFavs();
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    try { localStorage.setItem(KEY_FAVS, JSON.stringify([...favs])); } catch (e) {}
    render();
  }

  // Appelé à l'ouverture de la page Fiches techniques
  function open() {
    render();
    if (!state.syncing) refresh();
  }

  window.SMPM_FICHES = { sync, open, render };

  // Démarrage : affichage immédiat depuis le cache local, puis synchronisation
  updateNet();
  render();
  sync();
  window.addEventListener('online', () => { updateNet(); sync(); });
  window.addEventListener('offline', updateNet);
})();
