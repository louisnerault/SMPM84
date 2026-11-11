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
    // synchro terminée : pictogramme seul (date et heure dans l'infobulle) pour laisser la place au nom
    return { word: state.failed ? 'Échec' : '', when: '', title: 'Dernière synchro : ' + formatWhen(at) };
  }

  function writeSyncParts(el) {
    const { word, when, title } = syncParts();
    const btn = el.closest('button');
    if (btn) btn.title = (title ? title + ' — ' : '') + 'Synchroniser maintenant';
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

  // Trois rubriques alimentées par le même dossier Drive : « Notices » (dossier NOTICES),
  // « GTO/GDO/GNR » (dossier du même nom) et « FTE » (tout le reste, dont le dossier FTE SMPM).
  // Le nom du dossier GTO/GDO/GNR est écrit « GTO GDO GNR » dans le manifest (le « / » est interdit dans un chemin).
  const NOTICES_ROOT = 'Notices';
  const GTO_ROOT = 'GTO GDO GNR';
  const rootOf = i => (i.path || '').split('/')[0];
  const isNotice = i => rootOf(i) === NOTICES_ROOT;
  const isGto = i => rootOf(i) === GTO_ROOT;

  function render() {
    $$('[data-sync-label]').forEach(writeSyncParts);
    const m = state.manifest || readLocal();
    const items = (m && m.items) || [];
    const favs = readFavs();
    renderSection($('#fiches-groups'), $('#fiches-empty'), items.filter(i => !isNotice(i) && !isGto(i)), favs);
    renderSection($('#notices-groups'), $('#notices-empty'), items.filter(isNotice), favs);
    renderSection($('#gto-groups'), $('#gto-empty'), items.filter(isGto), favs);
  }

  // Titre de groupe sans le dossier racine (« Notices › Équipement individuel » → « Équipement individuel »)
  function groupTitle(cat) {
    const parts = (cat || 'Divers').split(' › ');
    return parts.length > 1 ? parts.slice(1).join(' › ') : parts[0];
  }

  function renderSection(groups, empty, items, favs) {
    if (!groups) return;
    if (empty) empty.hidden = items.length > 0;

    // Favoris (propres à cet appareil) : groupe « Mes favoris » en tête, puis les catégories
    const byCat = new Map();
    const favItems = [];
    items.forEach(i => {
      if (favs.has(i.id)) { favItems.push(i); return; }
      const c = groupTitle(i.category);
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
    a.addEventListener('click', e => {
      if (!iosApp() || !/\.pdf($|\?)/i.test(i.url)) return;   // ordinateur, ou fichier non PDF : ouverture habituelle
      e.preventDefault();
      ouvrirDoc(i);
    });
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

  // Téléphone / tablette : le PDF s'affichait sans bouton de retour (iPhone : fermer et rouvrir l'app ;
  // Android : visionneuse de Chrome). On l'affiche donc dans l'application avec pdf.js et un bouton « ← Retour ».
  function iosApp() {   // nom historique : vrai pour tout écran tactile (téléphone, tablette)
    return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  }

  let viewer = null;
  let pdfjs = null;
  let docEnCours = null;   // { pdf, zoom, jeton }
  function fermerDoc() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    if (docEnCours) { try { docEnCours.pdf.destroy(); } catch (e) {} }
    docEnCours = null;
    viewer.querySelector('.doc-viewer-pages').replaceChildren();
    document.body.classList.remove('doc-ouvert');
  }
  function construireViewer() {
    viewer = document.createElement('div');
    viewer.className = 'doc-viewer';
    viewer.hidden = true;
    viewer.innerHTML = '<div class="doc-viewer-bar"><button type="button" class="doc-viewer-back">← Retour</button>' +
      '<span class="doc-viewer-titre"></span>' +
      '<button type="button" class="doc-viewer-zoom" data-z="-1" aria-label="Réduire">−</button>' +
      '<button type="button" class="doc-viewer-zoom" data-z="1" aria-label="Agrandir">+</button></div>' +
      '<div class="doc-viewer-zone"><p class="doc-viewer-msg"></p><div class="doc-viewer-pages"></div></div>';
    viewer.querySelector('.doc-viewer-back').addEventListener('click', () => {
      if (history.state && history.state.smpmDoc) history.back(); else fermerDoc();
    });
    viewer.querySelectorAll('.doc-viewer-zoom').forEach(b => b.addEventListener('click', () => {
      if (!docEnCours) return;
      const z = Math.min(3, Math.max(1, docEnCours.zoom + Number(b.dataset.z) * 0.5));
      if (z !== docEnCours.zoom) { docEnCours.zoom = z; afficherPages(); }
    }));
    window.addEventListener('popstate', fermerDoc);
    document.body.append(viewer);
  }
  async function ouvrirDoc(i) {
    if (!viewer) construireViewer();
    viewer.querySelector('.doc-viewer-titre').textContent = i.title;
    viewer.querySelector('.doc-viewer-pages').replaceChildren();
    const msg = viewer.querySelector('.doc-viewer-msg');
    msg.textContent = 'Ouverture du document…';
    viewer.hidden = false;
    document.body.classList.add('doc-ouvert');
    history.pushState({ smpmDoc: true }, '');
    const jeton = {};
    docEnCours = { jeton, zoom: 1, pdf: null };
    try {
      if (!pdfjs) {
        pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
      }
      const res = await fetch(i.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = new Uint8Array(await res.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      if (!docEnCours || docEnCours.jeton !== jeton) { pdf.destroy(); return; }
      docEnCours.pdf = pdf;
      msg.textContent = '';
      afficherPages();
    } catch (e) {
      if (!docEnCours || docEnCours.jeton !== jeton) return;
      msg.textContent = navigator.onLine ? 'Impossible d’afficher ce document.' : 'Document pas encore disponible hors ligne : ouvrez-le une fois avec du réseau.';
    }
  }
  // Une toile par page, dessinée quand elle approche de l'écran
  async function afficherPages() {
    const d = docEnCours;
    const box = viewer.querySelector('.doc-viewer-pages');
    box.replaceChildren();
    const largeur = viewer.querySelector('.doc-viewer-zone').clientWidth * d.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const obs = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      obs.unobserve(en.target);
      dessiner(en.target);
    }), { root: viewer.querySelector('.doc-viewer-zone'), rootMargin: '800px 0px' });
    const first = await d.pdf.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    for (let n = 1; n <= d.pdf.numPages; n++) {
      const c = document.createElement('canvas');
      c.className = 'doc-viewer-page';
      c.dataset.n = n;
      c.style.width = largeur + 'px';
      c.style.height = (largeur * v1.height / v1.width) + 'px';   // provisoire, corrigé au dessin
      box.append(c);
      obs.observe(c);
    }
    async function dessiner(c) {
      if (docEnCours !== d) return;
      const page = await d.pdf.getPage(Number(c.dataset.n));
      const v = page.getViewport({ scale: 1 });
      const scale = largeur / v.width;
      const vp = page.getViewport({ scale: scale * dpr });
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.height = (v.height * scale) + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
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

  // Appelé à l'ouverture des pages FTE, Notices et GTO/GDO/GNR
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
