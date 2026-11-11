// Carte hors ligne : télécharge la Photo aérienne IGN et/ou la Carte IGN 1:25 000 (SCAN 25) des zones de relief
// du Vaucluse (Ventoux et Dentelles, Monts de Vaucluse, Luberon) au zoom 15, dans le cache « smpm84-carte ».
// Chaque fond se télécharge et se supprime séparément (cases à cocher dans Mon profil).
// Lu par sw.js : la carte « Pointer sur la carte » fonctionne ensuite sans réseau.
// Téléchargement uniquement à la demande de l'utilisateur, en ligne.
(() => {
  'use strict';

  const CACHE = 'smpm84-carte';
  const KEY_META = 'smpm_carte_meta';        // { photo: {at,count,missing,failed}, scan25: {…} } (ancien format : celui de la photo)
  const KEY_CHOIX = 'smpm_carte_choix';
  const FONDS = [
    { id: 'photo', nom: 'Photo aérienne', libelle: 'Photo aérienne IGN' },
    { id: 'scan25', nom: 'Carte IGN 1:25 000', libelle: 'Carte IGN 1:25 000 (SCAN 25)' },
  ];
  const ZOOM = 15;
  const PARALLEL = 6;                       // requêtes simultanées
  const TIMEOUT_MS = 15000;                 // délai max par tuile (sans lui, une tuile bloquée fige tout le téléchargement)
  const TRIES = 3;                          // essais par tuile avant de la compter comme manquante
  const NEED_BYTES = 250 * 1024 * 1024;     // espace libre demandé avant de commencer
  // Zones de relief : sud, nord, ouest, est (degrés)
  const ZONES = [
    { name: 'Mont Ventoux et Dentelles', s: 44.05, n: 44.35, w: 5.00, e: 5.45 },
    { name: 'Monts de Vaucluse', s: 43.95, n: 44.20, w: 5.40, e: 5.85 },
    { name: 'Luberon', s: 43.75, n: 43.97, w: 5.15, e: 5.55 },
  ];

  // URL identique à celle des cartes (config.js › SMPM_FONDS) : c'est elle qui sert de clé de cache
  let fondEnCours = FONDS[0];
  const tileUrl = (x, y, f = fondEnCours) => window.SMPM_FONDS.tuile(f.nom, ZOOM, x, y);

  const tileX = lon => Math.floor((lon + 180) / 360 * 2 ** ZOOM);
  const tileY = lat => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** ZOOM);
  };

  function allTileUrls(f = fondEnCours) {
    const seen = new Set();
    const urls = [];
    for (const z of ZONES) {
      for (let x = tileX(z.w); x <= tileX(z.e); x++) {
        for (let y = tileY(z.n); y <= tileY(z.s); y++) {
          const u = tileUrl(x, y, f);
          if (!seen.has(u)) { seen.add(u); urls.push(u); }
        }
      }
    }
    return urls;
  }

  const $ = sel => document.querySelector(sel);

  function readAll() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(KEY_META) || 'null'); } catch (e) { m = null; }
    if (m && m.at) m = { photo: m };                       // ancien format (photo aérienne seule)
    return m || {};
  }
  const readMeta = (f = fondEnCours) => readAll()[f.id] || null;
  function writeMeta(v, f = fondEnCours) {
    const m = readAll();
    if (v) m[f.id] = v; else delete m[f.id];
    try {
      if (Object.keys(m).length) localStorage.setItem(KEY_META, JSON.stringify(m)); else localStorage.removeItem(KEY_META);
    } catch (e) {}
  }
  function choix() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(KEY_CHOIX) || 'null'); } catch (e) { c = null; }
    return Array.isArray(c) ? c : ['photo', 'scan25'];
  }

  function formatWhen(iso) {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  let busy = false;
  let stopRequested = false;

  // Nombre d'images présentes dans le cache et poids total (octets)
  async function cacheStats(urls) {
    const cache = await caches.open(CACHE);
    let n = 0;
    let bytes = 0;
    for (const u of urls) {
      const res = await cache.match(u);
      if (!res) continue;
      n++;
      const len = Number(res.headers.get('content-length'));
      bytes += len > 0 ? len : (await res.blob()).size;
    }
    return { n, bytes };
  }

  // Récupère une tuile avec délai d'attente et nouvelles tentatives.
  // Renvoie '' si réussi, sinon la raison de l'échec du dernier essai.
  async function fetchTile(cache, u) {
    let why = 'erreur inconnue';
    for (let t = 1; t <= TRIES; t++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(u, { signal: ctrl.signal });
        if (res.status === 404) return 'absente';          // pas de tuile à cet endroit (hors couverture) : inutile de réessayer
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await cache.put(u, res);
        return '';
      } catch (e) {
        why = e.name === 'AbortError' ? 'délai dépassé' : (e.message && e.message.startsWith('HTTP') ? e.message : 'réseau');
        if (stopRequested) return 'arrêt';
        await new Promise(r => setTimeout(r, 1000 * t));   // pause avant nouvel essai
      } finally {
        clearTimeout(timer);
      }
    }
    return why;
  }

  // Texte listant les tuiles manquantes et la raison (pour diagnostic)
  function missingNote(meta) {
    if (!meta.missing) return '';
    const list = (meta.failed || []).map(f => `x${f.x} y${f.y} : ${f.why}`).join(' ; ');
    return `${meta.missing} images n’ont pas pu être téléchargées : relancez le téléchargement.` +
      (list ? ` Détail : ${list}.` : '');
  }

  function formatMo(bytes) {
    const mo = bytes / (1024 * 1024);
    return `${mo.toFixed(1).replace('.', ',')} Mo`;
  }

  async function hasRoomFor(n = 1) {
    if (!navigator.storage || !navigator.storage.estimate) return true;
    const { quota, usage } = await navigator.storage.estimate();
    return !quota || quota - usage > NEED_BYTES * n;
  }

  function showStatus(text, note) {
    $('#carte-status').textContent = text;
    $('#carte-note').textContent = note || '';
  }

  // Cases à cocher (un fond par ligne) avec l'état de chacun
  function renderChoix() {
    const box = $('#carte-fonds');
    if (!box) return;
    const c = choix();
    box.replaceChildren(...FONDS.map(f => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = f.id;
      cb.checked = c.includes(f.id);
      cb.disabled = busy;
      cb.addEventListener('change', () => {
        const v = FONDS.map(x => x.id).filter(id => id === f.id ? cb.checked : choix().includes(id));
        try { localStorage.setItem(KEY_CHOIX, JSON.stringify(v)); } catch (e) {}
        render();
      });
      const etat = document.createElement('small');
      etat.className = 'muted carte-fond-etat';
      etat.id = 'carte-etat-' + f.id;
      const m = readMeta(f);
      etat.textContent = m ? `téléchargée le ${formatWhen(m.at)} (${m.count} images, calcul du poids…)` : 'non téléchargée';
      const lab = document.createElement('label');
      lab.className = 'carte-fond';
      lab.append(cb, document.createTextNode(' ' + f.libelle + ' '), etat);
      return lab;
    }));
  }

  function render() {
    const c = choix();
    const metas = FONDS.map(f => readMeta(f));
    const btn = $('#btn-carte');
    const stop = $('#btn-carte-stop');
    const del = $('#btn-carte-del');
    stop.hidden = !busy;
    del.hidden = busy || !FONDS.some((f, i) => metas[i] && c.includes(f.id));
    del.textContent = 'Supprimer la sélection de l’appareil';
    btn.disabled = busy || !navigator.onLine || !c.length;
    const tous = FONDS.filter(f => c.includes(f.id)).every(f => readMeta(f));
    btn.textContent = c.length && tous ? 'Mettre à jour la sélection' : 'Télécharger la sélection';
    if (busy) return;
    renderChoix();
    showStatus(c.length ? '' : 'Cochez au moins un fond de carte.', FONDS.map(f => readMeta(f) ? missingNote(readMeta(f)) : '').filter(Boolean).join(' '));
    FONDS.forEach(f => { const m = readMeta(f); if (m) refreshSize(m, f); });
  }

  // Calcule le poids réel occupé dans le cache et met à jour l'état du fond
  async function refreshSize(meta, f) {
    try {
      const { n, bytes } = await cacheStats(allTileUrls(f));
      if (busy || readMeta(f)?.at !== meta.at) return;
      const el = $('#carte-etat-' + f.id);
      if (el) el.textContent = `téléchargée le ${formatWhen(meta.at)} (${n} images, ${formatMo(bytes)} sur l’appareil)`;
    } catch (e) { /* cache indisponible : on garde l'état sans poids */ }
  }

  async function download() {
    if (busy) return;
    const sel = FONDS.filter(f => choix().includes(f.id));
    if (!sel.length) return;
    const total = sel.reduce((n, f) => n + allTileUrls(f).length, 0);
    if (!navigator.onLine) { showStatus('Connexion nécessaire pour télécharger la carte.'); return; }
    if (!confirm(`Téléchargement de ${sel.map(f => f.libelle).join(' et ')} : environ ${total} images, à faire de préférence en Wi-Fi. ` +
      'Ne fermez pas l’application pendant le téléchargement. Continuer ?')) return;
    if (!(await hasRoomFor(sel.length))) {
      showStatus('Espace de stockage insuffisant sur cet appareil pour la carte.');
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    for (const f of sel) {
      fondEnCours = f;
      const fini = await downloadFond(f);
      if (!fini) break;
    }
    fondEnCours = FONDS[0];
    render();
  }

  // Télécharge un fond ; renvoie false si l'utilisateur a arrêté
  async function downloadFond(f) {
    const urls = allTileUrls(f);

    busy = true;
    stopRequested = false;
    render();
    const cache = await caches.open(CACHE);
    let done = 0;
    let missing = 0;
    let absentes = 0;                                       // tuiles inexistantes chez l'IGN (404) : pas des manques
    const failed = [];
    try {
      for (let i = 0; i < urls.length && !stopRequested; i += PARALLEL) {
        await Promise.all(urls.slice(i, i + PARALLEL).map(async u => {
          if (await cache.match(u)) return;                 // déjà présente : on ne la retélécharge pas
          const why = await fetchTile(cache, u);
          if (why === 'absente') { absentes++; return; }      // hors couverture IGN : rien à télécharger
          if (why) {
            missing++;
            if (failed.length < 10) {
              const q = new URL(u).searchParams;
              failed.push({ x: q.get('TILECOL'), y: q.get('TILEROW'), why });
            }
          }
        }));
        done = Math.min(i + PARALLEL, urls.length);
        showStatus(`${f.libelle} : ${done} / ${urls.length} images…`);
      }
    } finally {
      busy = false;
    }

    const { n: count } = await cacheStats(urls);
    if (stopRequested) {
      if (count) writeMeta({ at: new Date().toISOString(), count, missing: Math.max(0, urls.length - count - absentes), failed }, f);
      render();
      showStatus(`Téléchargement arrêté (${f.libelle} : ${done} / ${urls.length} images). Relancez pour terminer.`);
      return false;
    }
    writeMeta({ at: new Date().toISOString(), count, missing: Math.max(0, urls.length - count - absentes), failed }, f);
    // clé SCAN 25 refusée : toutes les images manquent avec une erreur HTTP 401/403
    if (!count && failed.some(x => /HTTP 40[13]/.test(x.why))) {
      writeMeta(null, f);
      render();
      showStatus('', `${f.libelle} : accès refusé par l’IGN (clé d’accès). Prévenez l’administrateur de l’application.`);
      return false;
    }
    return true;
  }

  async function remove() {
    const sel = FONDS.filter(f => choix().includes(f.id) && readMeta(f));
    if (busy || !sel.length || !confirm(`Supprimer de cet appareil : ${sel.map(f => f.libelle).join(' et ')} ?`)) return;
    const cache = await caches.open(CACHE);
    for (const f of sel) {
      await Promise.all(allTileUrls(f).map(u => cache.delete(u)));
      writeMeta(null, f);
    }
    if (!Object.keys(readAll()).length) await caches.delete(CACHE);
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
