// Fiches techniques : liste, synchronisation automatique sur smartphone, indicateur animé.
(() => {
  'use strict';

  const MANIFEST = 'fiches/manifest.json';
  const CACHE = 'smpm84-fiches';   // cache dédié, lu par sw.js
  const KEY = 'smpm_fiches_manifest';

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

  function subtitle() {
    if (state.syncing) return 'Synchronisation en cours…';
    const m = state.manifest || readLocal();
    if (!m || !m.items) return 'Aucune fiche synchronisée';
    const n = m.items.length;
    let text = `${n} fiche${n > 1 ? 's' : ''}`;
    if (m.generated_at) {
      const when = new Date(m.generated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      text += ` · contenu du ${when}`;
    }
    if (state.failed) text += ' · synchronisation impossible';
    return text;
  }

  function render() {
    $$('[data-sync-label]').forEach(el => { el.textContent = subtitle(); });
    const groups = $('#fiches-groups');
    if (!groups) return;

    const m = state.manifest || readLocal();
    const items = (m && m.items) || [];
    $('#fiches-empty').hidden = items.length > 0;

    const byCat = new Map();
    items.forEach(i => {
      const c = i.category || 'Divers';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(i);
    });

    const frag = document.createDocumentFragment();
    [...byCat.keys()].sort((a, b) => a.localeCompare(b, 'fr')).forEach(cat => {
      const h = document.createElement('h2');
      h.className = 'fiches-cat';
      h.textContent = cat;
      const ul = document.createElement('ul');
      ul.className = 'fiches-list';
      byCat.get(cat)
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
        .forEach(i => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = i.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = i.title;
          li.append(a);
          ul.append(li);
        });
      frag.append(h, ul);
    });
    groups.replaceChildren(frag);
  }

  // Appelé à l'ouverture de la page Fiches techniques
  function open() {
    render();
    if (!state.syncing) refresh();
  }

  window.SMPM_FICHES = { sync, open, render };

  // Démarrage : affichage immédiat depuis le cache local, puis synchronisation
  render();
  sync();
  window.addEventListener('online', sync);
})();
