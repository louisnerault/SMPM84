// Points d'intérêt (POI) : base partagée de points GPS (backend/Poi.gs : poi_list, poi_save, poi_delete, poi_photo).
// - Consultation : tous les membres, selon le cloisonnement des secteurs fait par le serveur
//   (ex. #SPELEO seul : personnels ISS ; #SPELEO + #NORD : tout le monde).
// - Création : chef d'unité et au-delà ; modification et suppression : chef de section, CTD, administrateur.
//   (droits renvoyés par le serveur, à défaut ceux d'app.js : canPoiCreate / canPoiEdit)
// - Liste et carte gardées sur l'appareil (hors ligne) ; photos mises en cache une fois consultées.
(() => {
  'use strict';

  const KEY = 'smpm_poi';
  const KEY_FILTRES = 'smpm_poi_filtres';
  const KEY_OUTBOX = 'smpm_poi_outbox';      // points créés hors ligne, envoyés au retour du réseau
  const PHOTO_CACHE = 'smpm84-poi';          // gardé par sw.js lors des mises à jour
  const VAUCLUSE = [44.0, 5.15];
  const STALE = 30000;                       // liste rechargée à l'ouverture si plus vieille que 30 s

  const $ = sel => document.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const F0 = () => ({ q: '', secteurs: [], carac: '', tri: 'nom', vue: 'liste' });
  const S = {
    data: null, loadedAt: 0, loading: false, pos: null,
    f: Object.assign(F0(), store.getJSON(KEY_FILTRES) || {}),
    edit: null,                              // point en cours de modification (null = création)
    photo: undefined,                        // undefined : inchangée ; null : retirée ; 'data:…' : nouvelle
  };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    return n;
  }

  // ---------- coordonnées ----------
  // « 44.123456, 5.123456 » -> [lat, lng] ; accepte la virgule décimale et le point-virgule
  function parseLatLng(v) {
    const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
    if (!m) return null;
    const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? [lat, lng] : null;
  }
  const fmtLL = (lat, lng) => `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  function distanceKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmtKm = km => km < 1 ? `${Math.round(km * 1000)} m` : `${nf1.format(km)} km`;
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR'); };

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('La géolocalisation n’est pas disponible sur cet appareil.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ ll: [p.coords.latitude, p.coords.longitude], acc: p.coords.accuracy }),
        err => reject(new Error(err.code === 1
          ? 'Accès à la position refusé : autorisez la localisation pour cette application.'
          : 'Position introuvable pour l’instant. Réessayez à découvert.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    });
  }

  // ---------- droits ----------
  function droits() {
    const d = S.data && S.data.droits;
    const local = app().poiDroits ? app().poiDroits() : { creer: false, modifier: false, gerer: false };
    return d ? { creer: !!d.creer && local.creer, modifier: !!d.modifier && local.modifier, gerer: !!d.gerer && !!local.gerer } : local;
  }
  // ---------- icônes des types, couleurs des secteurs, épingles ----------
  // Icônes (traits 24×24) proposées pour les types de points ; la clé est enregistrée dans le classeur.
  const POI_ICONES = {
    parking: ['Parking', '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3.2a3 3 0 0 1 0 6H10"/>'],
    lieudit: ['Lieu-dit', '<path d="M12 3v18"/><path d="M5 6h11l3 2.5-3 2.5H5z"/><path d="M19 13H9l-3 2.5L9 18h10z"/>'],
    acces: ['Accès / sentier', '<path d="M5 21c2-4 6-5 6-9s-3-5-2-9"/><path d="M15 21c-1-3 3-5 3-9s-2-4-1-7"/>'],
    rdv: ['Rendez-vous', '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M14 14.6c3.2-.6 7 .8 7 5.4"/>'],
    helico: ['Hélicoptère', '<circle cx="12" cy="12" r="9"/><path d="M8.5 7.5v9M15.5 7.5v9M8.5 12h7"/>'],
    cadenas: ['Cadenas / barrière', '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>'],
    eau: ["Point d'eau", '<path d="M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z"/>'],
    grotte: ['Grotte / cavité', '<path d="M2 20h20"/><path d="M4 20c0-8 3.6-13 8-13s8 5 8 13"/><path d="M9 20c0-3.5 1.3-6 3-6s3 2.5 3 6"/>'],
    sommet: ['Sommet', '<path d="M2 20l7-12 4 6 2.5-3.5L22 20z"/>'],
    refuge: ['Refuge / bâtiment', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'],
    cascade: ['Cascade / canyon', '<path d="M4 4h16"/><path d="M7 4v9M12 4v12M17 4v9"/><path d="M3 19c2 0 2-1.5 4.5-1.5S10 19 12 19s2.5-1.5 4.5-1.5S19 19 21 19"/>'],
    danger: ['Danger', '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/>'],
    antenne: ['Réseau / antenne', '<path d="M12 10v11"/><circle cx="12" cy="8" r="1.6"/><path d="M8.5 4.5a5 5 0 0 0 0 7M15.5 4.5a5 5 0 0 1 0 7M5.5 2a9 9 0 0 0 0 12M18.5 2a9 9 0 0 1 0 12"/>'],
    cle: ['Clé', '<circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2L20 20M16 16l2.5-2.5M18.5 18.5L21 16"/>'],
    foret: ['Forêt / arbre', '<path d="M12 3l6 9h-3l4 6H5l4-6H6z"/><path d="M12 18v3"/>'],
    pont: ['Pont / passerelle', '<path d="M2 15h20"/><path d="M3 15c3-6 15-6 18 0"/><path d="M8 15v5M16 15v5"/>'],
    drapeau: ['Repère', '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>'],
    etoile: ['Autre', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'],
  };
  const icoSvg = (key, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(POI_ICONES[key] || POI_ICONES.etoile)[1]}</svg>`;
  const caracIcone = c => ((S.data && S.data.listes && S.data.listes.icones) || {})[c] || 'etoile';
  const secteurCouleur = code => { const d = secteurDef(code); return (d && d.couleur) || '#5d6b7a'; };
  // Secteurs d'un point dans l'ordre de la liste (géographiques d'abord, tels que rangés par l'administrateur)
  function secteursOrdonnes(codes) {
    const ordre = ((S.data && S.data.listes && S.data.listes.secteurs) || []).map(s => s.code);
    return codes.slice().sort((a, b) => (ordre.indexOf(a) < 0 ? 99 : ordre.indexOf(a)) - (ordre.indexOf(b) < 0 ? 99 : ordre.indexOf(b)));
  }
  // Épingle : une bande verticale par secteur (1 secteur = couleur pleine, 2 = moitié/moitié, 3 = tiers…),
  // pastille blanche au centre avec l'icône du premier type du point.
  let pinSeq = 0;
  function pinSvg(couleurs, icone, size = 34) {
    const id = 'pc' + (++pinSeq);
    const cols = couleurs.length ? couleurs.slice(0, 4) : ['#5d6b7a'];
    const w = 32 / cols.length;
    const bands = cols.map((c, i) => `<rect x="${i * w}" y="0" width="${w + 0.2}" height="44" fill="${c}"/>`).join('');
    const shape = 'M16 1C8 1 2 7 2 15c0 10.5 14 27 14 27s14-16.5 14-27C30 7 24 1 16 1z';
    const ico = (POI_ICONES[icone] || POI_ICONES.etoile)[1];
    return `<svg viewBox="0 0 32 44" width="${size * 32 / 44}" height="${size}" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>
      <g clip-path="url(#${id})">${bands}</g>
      <path d="${shape}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/>
      <circle cx="16" cy="15" r="9.5" fill="#fff"/>
      <g transform="translate(9.4 8.4) scale(.55)" fill="none" stroke="#1d2733" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ico}</g>
    </svg>`;
  }
  function pinPoint(p) {
    return pinSvg(secteursOrdonnes(p.secteurs).map(secteurCouleur), p.caracs.length ? caracIcone(p.caracs[0]) : 'drapeau');
  }

  const secteurDef = code => ((S.data && S.data.listes && S.data.listes.secteurs) || []).find(s => s.code === code);
  const secteurLib = code => { const d = secteurDef(code); return d ? d.libelle : code; };

  // ---------- chargement ----------
  // Liste gardée sur l'appareil dès l'ouverture de l'application (comme le formulaire d'intervention) :
  // consultable hors ligne même si la rubrique n'a jamais été ouverte.
  function prefetch() {
    if (!S.data) S.data = store.getJSON(KEY);
    if (!navigator.onLine || Date.now() - S.loadedAt < STALE) return Promise.resolve();
    return load(true);
  }

  function open() {
    if (!S.data) S.data = store.getJSON(KEY);
    renderPending();
    flush();
    showForm(false);
    buildFilters();
    if (S.data) render();
    if (!S.loading && Date.now() - S.loadedAt > STALE) load();
  }

  // silent : chargement en arrière-plan (démarrage, synchronisation) — aucun message si la rubrique est fermée
  async function load(silent) {
    if (S.loading) return;
    const quiet = silent === true && $('#tab-poi').hidden;
    S.loading = true;
    if (!quiet) setState(S.data ? 'Mise à jour…' : 'Chargement des points d’intérêt…');
    try {
      const res = await app().api('poi_list', { token: app().token() });
      S.data = { points: res.points || [], listes: res.listes || { caracs: [], secteurs: [] }, droits: res.droits || null, maj: res.maj || new Date().toISOString() };
      S.loadedAt = Date.now();
      save();
      if (!quiet || !$('#tab-poi').hidden) setState('');
      buildFilters();
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (quiet && $('#tab-poi').hidden) return;          // nouvel essai à la prochaine synchronisation
      const d = S.data;
      const maj = d && d.maj ? new Date(d.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (d ? `${app().netLabel()} : points du ${maj}.` : app().netLabel() + ' : points indisponibles sur cet appareil. Ouvrez la rubrique une fois avec du réseau pour la garder hors ligne.')
        : err.message === 'Action inconnue' ? 'Les points d’intérêt ne sont pas encore activés sur le serveur (Poi.gs).' : err.message, !d);
    } finally { S.loading = false; }
  }
  function save() { store.set(KEY, JSON.stringify(S.data)); }

  function setState(msg, isError) {
    const p = $('#poi-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  // ---------- filtres ----------
  function buildFilters() {
    const L = (S.data && S.data.listes) || { caracs: [], secteurs: [] };
    const points = (S.data && S.data.points) || [];
    // secteurs proposés : ceux présents dans les points visibles, dans l'ordre de la liste
    const presents = L.secteurs.filter(s => points.some(p => p.secteurs.includes(s.code))).map(s => s.code);
    S.f.secteurs = S.f.secteurs.filter(c => presents.includes(c));
    $('#poi-secteurs').replaceChildren(...presents.map(c => el('button', {
      type: 'button', class: 'ann-qf poi-qf', 'aria-pressed': String(S.f.secteurs.includes(c)), title: secteurLib(c),
      html: `<i class="poi-dot" style="background:${secteurCouleur(c)}"></i>#${c}`,
      onclick: e => {
        const on = !S.f.secteurs.includes(c);
        S.f.secteurs = on ? [...S.f.secteurs, c] : S.f.secteurs.filter(x => x !== c);
        e.currentTarget.setAttribute('aria-pressed', String(on));
        changed();
      },
    })));
    const sel = $('#poi-carac');
    sel.replaceChildren(el('option', { value: '', text: 'Toutes les caractéristiques' }), ...L.caracs.map(c => el('option', { value: c, text: c })));
    sel.value = L.caracs.includes(S.f.carac) ? S.f.carac : '';
    S.f.carac = sel.value;
    $('#poi-tri').value = S.f.tri === 'distance' && !S.pos ? 'nom' : S.f.tri;
    if (S.f.tri === 'distance' && !S.pos) S.f.tri = 'nom';
    $('#poi-search').value = S.f.q;
    document.querySelectorAll('.poi-view [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.f.vue)));
    $('#poi-add').hidden = !droits().creer;
    $('#poi-gerer').hidden = !droits().gerer;
  }

  function changed() {
    store.set(KEY_FILTRES, JSON.stringify(Object.assign({}, S.f, { q: '', tri: S.f.tri === 'distance' ? 'nom' : S.f.tri })));
    render();
  }

  function match(p) {
    const f = S.f;
    if (f.secteurs.length && !f.secteurs.some(c => p.secteurs.includes(c))) return false;
    if (f.carac && !p.caracs.includes(f.carac)) return false;
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = fold([p.nom, p.commentaire, p.caracs.join(' '), p.secteurs.join(' '), p.secteurs.map(secteurLib).join(' '), p.cree_par].join(' '));
    return words.every(w => hay.includes(w));
  }

  function filtered() {
    const all = (S.data && S.data.points) || [];
    const byNom = (a, b) => a.nom.localeCompare(b.nom, 'fr');
    const tri = {
      nom: byNom,
      recent: (a, b) => String(b.cree_le).localeCompare(String(a.cree_le)) || byNom(a, b),
      distance: (a, b) => (S.pos ? distanceKm(S.pos, [a.lat, a.lng]) - distanceKm(S.pos, [b.lat, b.lng]) : byNom(a, b)),
    }[S.f.tri] || byNom;
    return all.filter(match).sort(tri);
  }

  // ---------- liste ----------
  function render() {
    const all = (S.data && S.data.points) || [];
    const list = filtered();
    const f = S.f;
    $('#poi-reset').hidden = !(f.q || f.secteurs.length || f.carac);
    $('#poi-count').textContent = all.length ? `${list.length} / ${all.length}` : '';
    const empty = $('#poi-empty');
    empty.hidden = list.length > 0 || !S.data;
    empty.textContent = all.length ? 'Aucun point ne correspond à ces critères.'
      : (droits().creer ? 'Aucun point pour le moment. Ajoutez le premier avec « ＋ Nouveau point ».' : 'Aucun point pour le moment.');
    const carte = f.vue === 'carte';
    $('#poi-list').hidden = carte;
    $('#poi-map').hidden = !carte;
    if (!carte) { $('#poi-map-note').textContent = ''; $('#poi-legend').hidden = true; }
    $('#poi-list').replaceChildren(...(carte ? [] : list.map(card)));
    if (carte) renderMap(list);
  }

  const ICONS = {
    route: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
    map: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    photo: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  };

  const routeUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

  function card(p) {
    const dist = S.pos ? distanceKm(S.pos, [p.lat, p.lng]) : null;
    const photoBox = el('div', { class: 'poi-photo-box' });
    const btnPhoto = p.photo
      ? el('button', { type: 'button', class: 'ann-btn', 'aria-label': `Voir la photo de ${p.nom}`, title: 'Photo', html: ICONS.photo,
        onclick: e => togglePhoto(p, photoBox, e.currentTarget) })
      : el('span', { class: 'ann-btn is-off', 'aria-disabled': 'true', title: 'Pas de photo', 'aria-label': 'Pas de photo', html: ICONS.photo });
    const gps = fmtLL(p.lat, p.lng);
    const auteur = [p.cree_par ? `Ajouté par ${p.cree_par}` : 'Ajouté', p.cree_le ? `le ${fmtDate(p.cree_le)}` : ''].filter(Boolean).join(' ');
    const modif = p.modifie_le ? ` · modifié${p.modifie_par ? ' par ' + p.modifie_par : ''} le ${fmtDate(p.modifie_le)}` : '';
    return el('li', { class: 'ann-card poi-card', 'data-id': p.id },
      el('div', { class: 'ann-head' },
        el('p', { class: 'ann-name poi-name' }, el('span', { class: 'poi-pin-mini', html: pinPoint(p) }), el('strong', { text: p.nom })),
        dist !== null ? el('span', { class: 'ann-fct', text: fmtKm(dist) }) : null),
      el('ul', { class: 'chips poi-tags' }, ...secteursOrdonnes(p.secteurs).map(c => el('li', { class: 'poi-tag', style: `background:${secteurCouleur(c)}`, text: '#' + c, title: secteurLib(c) + (secteurDef(c) && secteurDef(c).reserve ? ` (réservé ${secteurDef(c).reserve})` : '') }))),
      p.caracs.length ? el('ul', { class: 'chips ann-chips poi-types' }, ...p.caracs.map(c => el('li', { html: icoSvg(caracIcone(c), 14) }, c))) : null,
      p.commentaire ? el('p', { class: 'poi-comment', text: p.commentaire }) : null,
      el('p', { class: 'ann-num poi-gps', text: gps }),
      photoBox,
      el('div', { class: 'ann-actions' },
        el('a', { class: 'ann-btn', href: routeUrl(p), target: '_blank', rel: 'noopener', title: 'Itinéraire', 'aria-label': `Itinéraire vers ${p.nom}`, html: ICONS.route }),
        el('button', { type: 'button', class: 'ann-btn', title: 'Voir sur la carte', 'aria-label': `Voir ${p.nom} sur la carte`, html: ICONS.map, onclick: () => showOnMap(p) }),
        el('button', { type: 'button', class: 'ann-btn', title: 'Copier les coordonnées', 'aria-label': `Copier les coordonnées de ${p.nom}`, html: ICONS.copy, onclick: e => copyGps(gps, e.currentTarget) }),
        btnPhoto),
      el('p', { class: 'poi-foot' },
        el('span', { class: 'muted small', text: auteur + modif }),
        droits().modifier ? el('button', { type: 'button', class: 'link', text: 'Modifier', onclick: () => openForm(p) }) : null));
  }

  async function copyGps(txt, btn) {
    try { await navigator.clipboard.writeText(txt); }
    catch (e) {
      const ta = el('textarea', { class: 'sr-copy' }); ta.value = txt; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    const t = btn.title; btn.title = 'Copié'; btn.classList.add('is-done');
    setState(`Coordonnées copiées : ${txt}`);
    setTimeout(() => { btn.title = t; btn.classList.remove('is-done'); }, 1500);
  }

  // ---------- photos (cache de l'appareil, puis serveur) ----------
  const photoReq = p => new Request(`poi-photo/${encodeURIComponent(p.id)}?v=${encodeURIComponent(p.modifie_le || p.cree_le || '')}`);
  async function photoUrl(p) {
    let cache = null;
    try { cache = await caches.open(PHOTO_CACHE); } catch (e) { cache = null; }
    if (cache) {
      const hit = await cache.match(photoReq(p));
      if (hit) return URL.createObjectURL(await hit.blob());
    }
    const res = await app().api('poi_photo', { token: app().token(), id: p.id });
    const bin = atob(res.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: res.mime || 'image/jpeg' });
    if (cache) {
      try {
        // anciennes versions de la photo de ce point retirées
        (await cache.keys()).filter(r => r.url.includes(`/poi-photo/${encodeURIComponent(p.id)}?`)).forEach(r => cache.delete(r));
        await cache.put(photoReq(p), new Response(blob, { headers: { 'Content-Type': blob.type } }));
      } catch (e) {}
    }
    return URL.createObjectURL(blob);
  }

  async function togglePhoto(p, box, btn) {
    if (box.firstChild) { box.replaceChildren(); btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    const note = el('p', { class: 'muted small', text: 'Chargement de la photo…' });
    box.replaceChildren(note);
    try {
      const url = await photoUrl(p);
      const img = el('img', { class: 'poi-photo', src: url, alt: `Photo : ${p.nom}`, loading: 'lazy' });
      img.addEventListener('click', () => window.open(url, '_blank'));
      box.replaceChildren(img);
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      note.textContent = err instanceof app().NetworkError ? app().netLabel() + ' : photo non disponible (jamais consultée sur cet appareil).' : err.message;
      note.classList.add('error');
    }
  }

  // ---------- carte ----------
  let leafletP = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    const base = './vendor/leaflet/';   // Leaflet embarqué (fonctionne hors ligne)
    leafletP = new Promise((resolve, reject) => {
      if (!document.querySelector('link[href$="leaflet.css"]')) {
        document.head.append(el('link', { rel: 'stylesheet', href: base + 'leaflet.css' }));
      }
      const js = el('script', { src: base + 'leaflet.js' });
      js.onload = () => (window.L ? resolve() : reject(new Error('Leaflet')));
      js.onerror = () => { leafletP = null; js.remove(); reject(new Error('Leaflet')); };
      document.head.append(js);
    });
    return leafletP;
  }
  function baseLayers(L) {
    const wmts = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${fmt}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
    const ign = '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';
    return {
      'Plan IGN': L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 19, attribution: ign }),
      'Photo aérienne': L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 19, attribution: ign }),
      'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }),
    };
  }
  function makeMap(L, box, center, zoom) {
    const map = L.map(box, { center, zoom, zoomControl: true });
    const layers = baseLayers(L);
    layers['Plan IGN'].addTo(map);
    L.control.layers(layers, null, { collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    return map;
  }

  const M = { map: null, group: null, me: null, focus: null };
  async function renderMap(list) {
    const note = $('#poi-map-note');
    try { await loadLeaflet(); }
    catch (e) {
      note.textContent = navigator.onLine ? 'La carte n’a pas pu être chargée.' : 'Hors ligne : la carte n’est pas disponible.';
      return;
    }
    const L = window.L;
    if (!M.map) {
      M.map = makeMap(L, $('#poi-map'), VAUCLUSE, 9);
      M.group = L.featureGroup().addTo(M.map);
      const Me = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: () => {
          const b = el('button', { type: 'button', class: 'poi-locate', title: 'Ma position', 'aria-label': 'Afficher ma position', text: '◎' });
          L.DomEvent.disableClickPropagation(b);
          b.addEventListener('click', showMe);
          return b;
        },
      });
      M.map.addControl(new Me());
    }
    M.group.clearLayers();
    list.forEach(p => {
      const pop = el('div', { class: 'poi-pop' },
        el('strong', { text: p.nom }),
        el('div', { class: 'small', text: p.secteurs.map(c => '#' + c).join(' ') + (p.caracs.length ? ' · ' + p.caracs.join(', ') : '') }),
        p.commentaire ? el('div', { class: 'small poi-comment', text: p.commentaire }) : null,
        el('div', { class: 'small' }, el('a', { href: routeUrl(p), target: '_blank', rel: 'noopener', text: 'Itinéraire' }), ' · ',
          el('button', { type: 'button', class: 'link', text: 'Fiche', onclick: () => showInList(p) })));
      const icon = L.divIcon({ className: 'poi-pin', html: pinPoint(p), iconSize: [25, 34], iconAnchor: [12.5, 34], popupAnchor: [0, -30] });
      const m = L.marker([p.lat, p.lng], { title: p.nom, icon }).bindPopup(pop);
      m.poiId = p.id;
      m.addTo(M.group);
    });
    setTimeout(() => {
      M.map.invalidateSize();
      const focus = M.focus && list.find(p => p.id === M.focus);
      if (focus) {
        M.map.setView([focus.lat, focus.lng], 15);
        M.group.eachLayer(l => { if (l.poiId === focus.id) l.openPopup(); });
        M.focus = null;
      } else if (list.length) {
        M.map.fitBounds(M.group.getBounds(), { padding: [30, 30], maxZoom: 14 });
      }
    }, 50);
    note.textContent = list.length ? '' : 'Aucun point à afficher.';
    renderLegend(list);
  }

  // Légende sous la carte : couleur de chaque secteur présent, icône de chaque type présent
  function renderLegend(list) {
    const box = $('#poi-legend');
    if (!box) return;
    const sect = secteursOrdonnes([...new Set(list.flatMap(p => p.secteurs))]);
    const types = [...new Set(list.map(p => p.caracs[0]).filter(Boolean))];
    box.replaceChildren(
      ...sect.map(c => el('span', { class: 'poi-leg', html: `<i class="poi-dot" style="background:${secteurCouleur(c)}"></i>#${c}` })),
      ...types.map(t => el('span', { class: 'poi-leg', html: icoSvg(caracIcone(t), 14) }, t)),
      list.some(p => p.secteurs.length > 1) ? el('span', { class: 'poi-leg muted', text: 'Épingle à plusieurs bandes = plusieurs secteurs' }) : null);
    box.hidden = !list.length;
  }

  async function showMe() {
    const note = $('#poi-map-note');
    note.textContent = 'Recherche de votre position…';
    try {
      const r = await locate();
      S.pos = r.ll;
      const L = window.L;
      if (M.me) M.me.remove();
      M.me = L.layerGroup([
        L.circle(r.ll, { radius: r.acc, weight: 1, fillOpacity: 0.12 }),
        L.circleMarker(r.ll, { radius: 7, weight: 3, color: '#fff', fillColor: '#1d72d8', fillOpacity: 1 }),
      ]).addTo(M.map);
      M.map.setView(r.ll, Math.max(M.map.getZoom(), 13));
      note.textContent = `Votre position (précision ± ${Math.round(r.acc)} m).`;
    } catch (e) { note.textContent = e.message; }
  }

  function setView(v) {
    S.f.vue = v;
    document.querySelectorAll('.poi-view [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    changed();
  }
  function showOnMap(p) {
    M.focus = p.id;
    setView('carte');
    $('#poi-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function showInList(p) {
    setView('liste');
    const li = document.querySelector(`.poi-card[data-id="${CSS.escape(p.id)}"]`);
    if (li) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); li.classList.add('flash-card'); setTimeout(() => li.classList.remove('flash-card'), 1600); }
  }

  // ---------- formulaire (création / modification) ----------
  const FM = { map: null, marker: null };
  function showForm(on) {
    $('#poi-main').hidden = on;
    $('#poi-form').hidden = !on;
    $('#poi-admin').hidden = true;
    window.scrollTo(0, 0);
  }

  function openForm(p) {
    const d = droits();
    if (p ? !d.modifier : !d.creer) return;
    if (!S.data || !S.data.listes) { setState('Liste des secteurs indisponible : ouvrez la rubrique avec du réseau.', true); return; }
    S.edit = p || null;
    S.photo = undefined;
    const f = $('#poi-form');
    f.reset();
    $('#poi-form-title').textContent = p ? 'Modifier le point' : 'Nouveau point d’intérêt';
    f.elements.nom.value = p ? p.nom : '';
    $('#poi-f-gps').value = p ? fmtLL(p.lat, p.lng) : '';
    f.elements.commentaire.value = p ? p.commentaire : '';
    $('#poi-f-error').textContent = '';
    $('#poi-f-gps-note').textContent = '';
    $('#poi-f-photo-note').textContent = '';
    $('#poi-f-delete').hidden = !p;
    $('#poi-f-save').disabled = false;

    // secteurs : seuls ceux accessibles sont modifiables ; les autres (déjà présents) restent affichés
    const L = S.data.listes;
    const cur = p ? p.secteurs : [];
    $('#poi-f-secteurs').replaceChildren(...L.secteurs.filter(s => s.accessible || cur.includes(s.code)).map(s => el('button', {
      type: 'button', class: 'ann-qf', 'data-code': s.code, 'aria-pressed': String(cur.includes(s.code)),
      disabled: !s.accessible, html: `<i class="poi-dot" style="background:${s.couleur || '#5d6b7a'}"></i>#${s.code}`, title: s.libelle + (s.reserve ? ` (réservé ${s.reserve})` : ''),
      onclick: e => e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')),
    })));
    const res = L.secteurs.filter(s => s.accessible && s.reserve);
    $('#poi-f-secteurs-note').textContent = res.length
      ? `Un point portant uniquement ${res.map(s => '#' + s.code).join(' ou ')} n’est visible que des personnels concernés (${res.map(s => s.reserve).filter((v, i, t) => t.indexOf(v) === i).join(', ')}). Ajoutez un secteur géographique pour le partager à tous.`
      : '';
    const curC = p ? p.caracs : [];
    $('#poi-f-caracs').replaceChildren(...L.caracs.map(c => el('button', {
      type: 'button', class: 'ann-qf poi-qf', 'data-v': c, 'aria-pressed': String(curC.includes(c)), html: icoSvg(caracIcone(c), 16),
      onclick: e => e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')),
    }, c)));

    // photo existante
    const prev = $('#poi-f-preview');
    prev.hidden = true;
    prev.removeAttribute('src');
    $('#poi-f-photo-del').hidden = true;
    if (p && p.photo) {
      $('#poi-f-photo-note').textContent = 'Chargement de la photo…';
      photoUrl(p).then(url => {
        if (S.edit !== p || S.photo !== undefined) return;
        prev.src = url; prev.hidden = false; $('#poi-f-photo-del').hidden = false; $('#poi-f-photo-note').textContent = '';
      }).catch(() => { if (S.edit === p) $('#poi-f-photo-note').textContent = 'Photo existante (non affichable hors ligne) : elle est conservée.'; });
    }

    closePick();
    showForm(true);
    f.elements.nom.focus();
  }

  function closeForm() {
    closePick();
    S.edit = null;
    S.photo = undefined;
    showForm(false);
    render();
  }

  function setGps(ll, from) {
    if (from !== 'input') $('#poi-f-gps').value = ll ? fmtLL(ll[0], ll[1]) : '';
    if (FM.map && ll) {
      const L = window.L;
      if (!FM.marker) {
        FM.marker = L.marker(ll, { draggable: true }).addTo(FM.map);
        FM.marker.on('dragend', () => { const q = FM.marker.getLatLng(); setGps([q.lat, q.lng], 'map'); });
      } else FM.marker.setLatLng(ll);
      if (from !== 'map') FM.map.setView(ll, Math.max(FM.map.getZoom(), 15));
    }
  }

  async function openPick() {
    const box = $('#poi-f-map'), btn = $('#poi-f-pick'), note = $('#poi-f-gps-note');
    box.hidden = false;
    btn.textContent = 'Masquer la carte';
    btn.setAttribute('aria-expanded', 'true');
    const ll = parseLatLng($('#poi-f-gps').value);
    if (FM.map) { FM.map.invalidateSize(); if (ll) setGps(ll, 'open'); return; }
    note.textContent = 'Chargement de la carte…';
    try { await loadLeaflet(); }
    catch (e) {
      note.textContent = navigator.onLine ? 'La carte n’a pas pu être chargée. Utilisez « Ma position » ou saisissez les coordonnées.'
        : 'Hors ligne : la carte n’est pas disponible. Utilisez « Ma position » ou saisissez les coordonnées.';
      return;
    }
    const L = window.L;
    FM.map = makeMap(L, box, ll || VAUCLUSE, ll ? 15 : 9);
    FM.map.on('click', e => setGps([e.latlng.lat, e.latlng.lng], 'map'));
    if (ll) setGps(ll, 'open');
    note.textContent = 'Touchez la carte pour placer le point, faites glisser le repère pour l’ajuster.';
    setTimeout(() => FM.map.invalidateSize(), 50);
  }
  function closePick() {
    $('#poi-f-map').hidden = true;
    $('#poi-f-pick').textContent = 'Pointer sur la carte';
    $('#poi-f-pick').setAttribute('aria-expanded', 'false');
  }

  // Photo réduite sur l'appareil avant envoi (1280 px max, JPEG) : envoi rapide même en 4G faible
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }

  async function submit(e) {
    e.preventDefault();
    const f = $('#poi-form');
    const err = $('#poi-f-error');
    err.textContent = '';
    const nom = f.elements.nom.value.trim();
    const ll = parseLatLng($('#poi-f-gps').value);
    const secteurs = Array.from(document.querySelectorAll('#poi-f-secteurs [aria-pressed="true"]')).map(b => b.dataset.code);
    const caracs = Array.from(document.querySelectorAll('#poi-f-caracs [aria-pressed="true"]')).map(b => b.dataset.v);
    if (nom.length < 2) { err.textContent = 'Donnez un nom au point.'; f.elements.nom.focus(); return; }
    if (!ll) { err.textContent = 'Coordonnées GPS obligatoires : « Ma position », « Pointer sur la carte » ou saisie (ex. 44.174130, 5.278690).'; $('#poi-f-gps').focus(); return; }
    if (!secteurs.length) { err.textContent = 'Choisissez au moins un secteur.'; return; }

    const poi = { nom, lat: ll[0], lng: ll[1], secteurs, caracs, commentaire: f.elements.commentaire.value.trim() };
    if (S.edit) poi.id = S.edit.id;
    if (typeof S.photo === 'string') poi.photo = S.photo;
    if (S.photo === null && S.edit && S.edit.photo) poi.photo_suppr = true;

    const btn = $('#poi-f-save');
    const sid = S.edit ? undefined : (S.sid = S.sid || ('poi-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)));
    if (!S.edit) poi.saisi_le = new Date().toISOString();
    // Création sans réseau : mise en attente sur l'appareil, envoi automatique au retour du réseau
    if (!S.edit && !navigator.onLine) return queue(sid, poi);
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';
    try {
      const res = await app().api('poi_save', { token: app().token(), poi, submission_id: sid });
      S.sid = null;
      const pts = S.data.points.filter(x => x.id !== res.point.id);
      pts.push(res.point);
      S.data.points = pts;
      save();
      const n = res.notifies || 0;
      const msg = S.edit ? `Point « ${res.point.nom} » modifié.`
        : `Point « ${res.point.nom} » créé.` + (n ? ` Notification envoyée (${n} appareil${n > 1 ? 's' : ''}).` : '');
      closeForm();
      buildFilters();
      render();
      setState(msg);
    } catch (e2) {
      if (app().AUTH_ERRORS.includes(e2.message)) return app().logout();
      if (!S.edit && e2 instanceof app().NetworkError) { queue(sid, poi); return; }
      err.textContent = e2 instanceof app().NetworkError
        ? app().netLabel() + ' : modification impossible pour l’instant. Réessayez avec du réseau.'
        : e2.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enregistrer';
    }
  }

  // ---------- gestion des listes (CTD, administrateurs) ----------
  const RESERVES = [['', 'Visible de tous'], ['ISS', 'Réservé ISS'], ['NEIGE', 'Réservé Neige'], ['CAN', 'Réservé Canyon'], ['SSH', 'Réservé SSH'], ['SSSM', 'Réservé SSSM'], ['IMP3', 'Réservé IMP 3']];
  const A = { types: [], secteurs: [] };

  function openAdmin() {
    if (!droits().gerer || !S.data || !S.data.listes) return;
    const L = S.data.listes;
    const usage = code => ((S.data && S.data.points) || []).filter(p => p.secteurs.includes(code)).length;
    A.types = L.caracs.map(c => ({ libelle: c, ancien: c, icone: caracIcone(c) }));
    A.secteurs = L.secteurs.map(s => ({ code: s.code, libelle: s.libelle, reserve: s.reserve || '', couleur: s.couleur || '#5d6b7a', existant: true, usage: usage(s.code) }));
    $('#poi-adm-error').textContent = '';
    $('#poi-main').hidden = true;
    $('#poi-form').hidden = true;
    $('#poi-admin').hidden = false;
    renderAdmin();
    window.scrollTo(0, 0);
  }
  function closeAdmin() { $('#poi-admin').hidden = true; $('#poi-main').hidden = false; render(); }

  function moveBtns(arr, i) {
    return el('span', { class: 'poi-adm-move' },
      el('button', { type: 'button', class: 'poi-adm-ico', title: 'Monter', 'aria-label': 'Monter', text: '↑', disabled: i === 0,
        onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; renderAdmin(); } }),
      el('button', { type: 'button', class: 'poi-adm-ico', title: 'Descendre', 'aria-label': 'Descendre', text: '↓', disabled: i === arr.length - 1,
        onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; renderAdmin(); } }));
  }

  function renderAdmin() {
    $('#poi-adm-types').replaceChildren(...A.types.map((t, i) => {
      const grid = el('div', { class: 'poi-ico-grid', hidden: !t.choix }, ...Object.keys(POI_ICONES).map(k => el('button', {
        type: 'button', class: 'poi-ico-pick', 'aria-pressed': String(k === t.icone), title: POI_ICONES[k][0], 'aria-label': POI_ICONES[k][0], html: icoSvg(k, 22),
        onclick: () => { t.icone = k; t.choix = false; renderAdmin(); },
      })));
      return el('li', { class: 'poi-adm-row' },
        el('button', { type: 'button', class: 'poi-adm-icobtn', title: 'Changer l’icône', 'aria-label': `Icône de ${t.libelle || 'ce type'} : ${POI_ICONES[t.icone][0]}`, 'aria-expanded': String(!!t.choix), html: icoSvg(t.icone, 22),
          onclick: () => { A.types.forEach(x => { if (x !== t) x.choix = false; }); t.choix = !t.choix; renderAdmin(); } }),
        el('input', { type: 'text', value: t.libelle, maxlength: '40', placeholder: 'Nom du type', 'aria-label': 'Nom du type',
          oninput: e => { t.libelle = e.target.value; } }),
        moveBtns(A.types, i),
        el('button', { type: 'button', class: 'poi-adm-ico danger', title: 'Supprimer', 'aria-label': `Supprimer ${t.libelle}`, text: '✕',
          onclick: () => {
            const n = t.ancien ? ((S.data && S.data.points) || []).filter(p => p.caracs.includes(t.ancien)).length : 0;
            if (n && !confirm(`« ${t.ancien} » est utilisé par ${n} point${n > 1 ? 's' : ''} : il en sera retiré. Supprimer ce type ?`)) return;
            A.types.splice(i, 1); renderAdmin();
          } }),
        grid);
    }));
    $('#poi-adm-secteurs').replaceChildren(...A.secteurs.map((s, i) => el('li', { class: 'poi-adm-row poi-adm-sect' },
      el('input', { type: 'color', value: s.couleur, class: 'poi-adm-color', title: 'Couleur de l’épingle', 'aria-label': `Couleur de #${s.code || 'nouveau secteur'}`,
        oninput: e => { s.couleur = e.target.value; renderApercu(); } }),
      s.existant
        ? el('strong', { class: 'poi-adm-code', text: '#' + s.code, title: 'Le code d’un secteur existant ne change pas' })
        : el('input', { type: 'text', value: s.code, maxlength: '15', placeholder: 'CODE', class: 'poi-adm-codein', 'aria-label': 'Code du secteur (ex. MONTAGNE)',
          oninput: e => { s.code = e.target.value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, ''); e.target.value = s.code; renderApercu(); } }),
      el('input', { type: 'text', value: s.libelle, maxlength: '30', placeholder: 'Libellé', 'aria-label': 'Libellé du secteur', oninput: e => { s.libelle = e.target.value; } }),
      (() => {
        const sel = el('select', { 'aria-label': 'Accès', onchange: e => { s.reserve = e.target.value; } }, ...RESERVES.map(([v, l]) => el('option', { value: v, text: l })));
        sel.value = RESERVES.some(r => r[0] === s.reserve) ? s.reserve : '';
        return sel;
      })(),
      moveBtns(A.secteurs, i),
      el('button', { type: 'button', class: 'poi-adm-ico danger', disabled: s.usage > 0,
        title: s.usage ? `Utilisé par ${s.usage} point${s.usage > 1 ? 's' : ''} : suppression impossible` : 'Supprimer',
        'aria-label': `Supprimer #${s.code}`, text: '✕', onclick: () => { A.secteurs.splice(i, 1); renderAdmin(); } }),
      s.usage ? el('small', { class: 'muted poi-adm-usage', text: `${s.usage} point${s.usage > 1 ? 's' : ''}` }) : null)));
    renderApercu();
  }

  function renderApercu() {
    const sect = A.secteurs.filter(s => s.code);
    const ico = (A.types[0] && A.types[0].icone) || 'etoile';
    const items = sect.map(s => el('figure', { class: 'poi-apercu' }, el('span', { html: pinSvg([s.couleur], ico, 40) }), el('figcaption', { text: '#' + s.code })));
    if (sect.length > 1) items.push(el('figure', { class: 'poi-apercu' }, el('span', { html: pinSvg([sect[0].couleur, sect[sect.length - 1].couleur], ico, 40) }),
      el('figcaption', { text: `#${sect[0].code} + #${sect[sect.length - 1].code}` })));
    if (sect.length > 2) items.push(el('figure', { class: 'poi-apercu' }, el('span', { html: pinSvg(sect.slice(0, 3).map(s => s.couleur), ico, 40) }),
      el('figcaption', { text: '3 secteurs' })));
    $('#poi-adm-apercu').replaceChildren(...items);
  }

  async function saveAdmin() {
    const err = $('#poi-adm-error');
    err.textContent = '';
    const types = A.types.map(t => ({ libelle: t.libelle.trim(), icone: t.icone, ancien: t.ancien || '' })).filter(t => t.libelle);
    const secteurs = A.secteurs.map(s => ({ code: s.code, libelle: s.libelle.trim(), reserve: s.reserve, couleur: s.couleur })).filter(s => s.code);
    if (!types.length) { err.textContent = 'Gardez au moins un type de point.'; return; }
    if (!secteurs.length) { err.textContent = 'Gardez au moins un secteur.'; return; }
    const dbl = secteurs.map(s => s.code).find((c, i, t) => t.indexOf(c) !== i);
    if (dbl) { err.textContent = `Le code #${dbl} est utilisé deux fois.`; return; }
    if (!navigator.onLine) { err.textContent = 'Hors ligne : la gestion des listes demande le réseau.'; return; }
    const btn = $('#poi-adm-save');
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';
    try {
      const res = await app().api('poi_listes_save', { token: app().token(), listes: { caracs: types, secteurs } });
      S.data = { points: res.points || [], listes: res.listes, droits: res.droits || null, maj: res.maj || new Date().toISOString() };
      S.loadedAt = Date.now();
      save();
      closeAdmin();
      buildFilters();
      render();
      setState('Types et secteurs enregistrés' + (res.modifies ? ` (${res.modifies} point${res.modifies > 1 ? 's' : ''} mis à jour).` : '.'));
    } catch (e) {
      if (app().AUTH_ERRORS.includes(e.message)) return app().logout();
      err.textContent = e instanceof app().NetworkError ? app().netLabel() + ' : enregistrement impossible pour l’instant.'
        : e.message === 'Action inconnue' ? 'Le serveur ne connaît pas encore cette action : mettez à jour Poi.gs (poi_listes_save).' : e.message;
    } finally { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }

  $('#poi-gerer').addEventListener('click', openAdmin);
  $('#poi-adm-cancel').addEventListener('click', closeAdmin);
  $('#poi-adm-save').addEventListener('click', saveAdmin);
  $('#poi-adm-type-add').addEventListener('click', () => { A.types.forEach(x => { x.choix = false; }); A.types.push({ libelle: '', ancien: '', icone: 'etoile', choix: true }); renderAdmin(); const ins = document.querySelectorAll('#poi-adm-types input'); if (ins.length) ins[ins.length - 1].focus(); });
  $('#poi-adm-sect-add').addEventListener('click', () => {
    const libres = ['#d4337a', '#5d6b7a', '#b8a000', '#0f766e', '#1f6fd1', '#2a9d3c', '#e07b00', '#7c3aed'];
    const couleur = libres.find(c => !A.secteurs.some(s => s.couleur === c)) || '#5d6b7a';
    A.secteurs.push({ code: '', libelle: '', reserve: '', couleur, existant: false, usage: 0 });
    renderAdmin();
    const ins = document.querySelectorAll('#poi-adm-secteurs .poi-adm-codein'); if (ins.length) ins[ins.length - 1].focus();
  });

  // ---------- points créés hors ligne (file d'attente sur l'appareil) ----------
  const outbox = () => store.getJSON(KEY_OUTBOX) || [];
  function setOutbox(list) {
    try { localStorage.setItem(KEY_OUTBOX, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  let flushing = false, lastSent = null;

  function queue(sid, poi) {
    const list = outbox().filter(x => x.sid !== sid);
    const entry = { sid, poi, ts: Date.now(), erreur: '' };
    let note = '';
    if (!setOutbox(list.concat(entry))) {
      // mémoire de l'appareil pleine (photo) : le point est gardé sans sa photo
      delete entry.poi.photo;
      if (!setOutbox(list.concat(entry))) { $('#poi-f-error').textContent = 'Mémoire de l’appareil pleine : point non enregistré.'; return; }
      note = ' La photo n’a pas pu être gardée (mémoire de l’appareil pleine) : ajoutez-la ensuite.';
    }
    S.sid = null;
    closeForm();
    renderPending();
    setState(`Point « ${poi.nom} » enregistré sur l’appareil : il sera envoyé automatiquement au retour du réseau.` + note);
  }

  async function flush() {
    if (flushing || !navigator.onLine || !app() || !app().token()) return;
    const list = outbox().filter(x => !x.erreur);
    if (!list.length) return;
    flushing = true;
    renderPending();
    let sent = 0;
    try {
      for (const e of list) {
        try {
          const res = await app().api('poi_save', { token: app().token(), poi: e.poi, submission_id: e.sid });
          setOutbox(outbox().filter(x => x.sid !== e.sid));
          if (!S.data) S.data = store.getJSON(KEY);
          if (S.data) { S.data.points = S.data.points.filter(x => x.id !== res.point.id).concat(res.point); save(); }
          sent++;
        } catch (err) {
          if (app().AUTH_ERRORS.includes(err.message)) { app().logout(); return; }
          if (err instanceof app().NetworkError) break;          // nouvel essai plus tard
          setOutbox(outbox().map(x => (x.sid === e.sid ? Object.assign(x, { erreur: err.message }) : x)));
        }
      }
    } finally {
      flushing = false;
      if (sent) lastSent = { n: sent, at: Date.now() };
      renderPending();
      if (sent && S.data) { buildFilters(); render(); }
    }
  }

  function renderPending() {
    const list = outbox();
    const dot = $('#poi-nav-dot');
    if (dot) dot.hidden = !list.length;
    if (window.SMPM_PENDING_DOT) window.SMPM_PENDING_DOT('poi', list.length);
    const box = $('#poi-outbox');
    if (!list.length) {
      const recent = lastSent && Date.now() - lastSent.at < 5 * 60e3;
      box.replaceChildren(...(recent ? [el('div', { class: 'outbox outbox-ok', role: 'status' },
        el('span', { text: `✓ ${lastSent.n} point${lastSent.n > 1 ? 's' : ''} en attente ${lastSent.n > 1 ? 'ont été envoyés' : 'a été envoyé'}.` }),
        el('button', { type: 'button', class: 'link', 'aria-label': 'Masquer', text: '×', onclick: () => { lastSent = null; renderPending(); } }))] : []));
      return;
    }
    const offline = !navigator.onLine;
    const waiting = list.filter(e => !e.erreur);
    box.replaceChildren(el('div', { class: 'outbox', role: 'status' },
      el('div', { class: 'outbox-head' },
        el('strong', { text: `${list.length} point${list.length > 1 ? 's' : ''} en attente d’envoi` }),
        waiting.length ? el('button', { type: 'button', class: 'pill', disabled: offline || flushing,
          text: flushing ? 'Envoi…' : offline ? 'En attente du réseau' : 'Envoyer maintenant', onclick: () => flush() }) : null),
      el('ul', { class: 'outbox-list' }, ...list.map(e => {
        const when = new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const li = el('li', { class: e.erreur ? 'is-error' : '' },
          el('span', { text: `${e.poi.nom} · ${(e.poi.secteurs || []).map(c => '#' + c).join(' ')}` }),
          el('small', { text: e.erreur ? `Refusé : ${e.erreur}` : `${fmtLL(e.poi.lat, e.poi.lng)} · saisi le ${when}${e.poi.photo ? ' · avec photo' : ''}` }));
        if (e.erreur) li.append(el('div', { class: 'outbox-actions' },
          el('button', { type: 'button', class: 'link', text: 'Réessayer', onclick: () => { setOutbox(outbox().map(x => (x.sid === e.sid ? Object.assign(x, { erreur: '' }) : x))); flush(); } }),
          el('button', { type: 'button', class: 'link', text: 'Reprendre', onclick: () => resume(e) }),
          el('button', { type: 'button', class: 'link danger', text: 'Supprimer', onclick: () => { if (confirm(`Supprimer définitivement le point « ${e.poi.nom} » non envoyé ?`)) { setOutbox(outbox().filter(x => x.sid !== e.sid)); renderPending(); } } })));
        return li;
      })),
      offline ? el('p', { class: 'small', text: 'Envoi automatique dès le retour du réseau.' }) : null));
  }

  // Point refusé par le serveur : remis dans le formulaire pour le corriger
  function resume(e) {
    if (!droits().creer) return;
    setOutbox(outbox().filter(x => x.sid !== e.sid));
    renderPending();
    openForm(null);
    const f = $('#poi-form'), p = e.poi;
    f.elements.nom.value = p.nom || '';
    $('#poi-f-gps').value = fmtLL(p.lat, p.lng);
    f.elements.commentaire.value = p.commentaire || '';
    document.querySelectorAll('#poi-f-secteurs [data-code]').forEach(b => b.setAttribute('aria-pressed', String((p.secteurs || []).includes(b.dataset.code))));
    document.querySelectorAll('#poi-f-caracs [data-v]').forEach(b => b.setAttribute('aria-pressed', String((p.caracs || []).includes(b.dataset.v))));
    if (p.photo) { S.photo = p.photo; const prev = $('#poi-f-preview'); prev.src = p.photo; prev.hidden = false; $('#poi-f-photo-del').hidden = false; }
    S.sid = e.sid;
    $('#poi-f-error').textContent = e.erreur ? `Refusé par le serveur : ${e.erreur}` : '';
  }

  async function remove() {
    const p = S.edit;
    if (!p || !confirm(`Supprimer définitivement le point « ${p.nom} » ? Il disparaîtra pour tous les membres.`)) return;
    const btn = $('#poi-f-delete');
    btn.disabled = true;
    try {
      await app().api('poi_delete', { token: app().token(), id: p.id });
      S.data.points = S.data.points.filter(x => x.id !== p.id);
      save();
      try { const c = await caches.open(PHOTO_CACHE); (await c.keys()).filter(r => r.url.includes(`/poi-photo/${encodeURIComponent(p.id)}?`)).forEach(r => c.delete(r)); } catch (e) {}
      closeForm();
      buildFilters();
      render();
      setState(`Point « ${p.nom} » supprimé.`);
    } catch (e) {
      if (app().AUTH_ERRORS.includes(e.message)) return app().logout();
      $('#poi-f-error').textContent = e instanceof app().NetworkError ? app().netLabel() + ' : suppression impossible pour l’instant.' : e.message;
    } finally { btn.disabled = false; }
  }

  // explicit : déconnexion volontaire (tout est effacé) ; sinon les points en attente d'envoi sont gardés
  function reset(explicit) {
    if (explicit === true) store.del(KEY_OUTBOX);
    lastSent = null;
    store.del(KEY);
    store.del(KEY_FILTRES);
    try { caches.delete(PHOTO_CACHE); } catch (e) {}
    Object.assign(S, { data: null, loadedAt: 0, loading: false, pos: null, f: F0(), edit: null, photo: undefined, sid: null });
    $('#poi-list').replaceChildren();
    if (M.group) M.group.clearLayers();
    showForm(false);
    setState('');
    renderPending();
  }

  // ---------- événements ----------
  let t;
  $('#poi-search').addEventListener('input', e => { S.f.q = e.target.value; clearTimeout(t); t = setTimeout(render, 120); });
  $('#poi-carac').addEventListener('change', e => { S.f.carac = e.target.value; changed(); });
  $('#poi-tri').addEventListener('change', async e => {
    const v = e.target.value;
    if (v === 'distance') {
      setState('Recherche de votre position…');
      try { S.pos = (await locate()).ll; setState(''); }
      catch (err) { setState(err.message, true); e.target.value = S.f.tri; return; }
    }
    S.f.tri = v;
    changed();
  });
  document.querySelectorAll('.poi-view [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#poi-reset').addEventListener('click', () => { S.f = Object.assign(F0(), { tri: S.f.tri, vue: S.f.vue }); buildFilters(); changed(); });
  $('#poi-add').addEventListener('click', () => openForm(null));

  $('#poi-form').addEventListener('submit', submit);
  $('#poi-f-cancel').addEventListener('click', closeForm);
  $('#poi-f-delete').addEventListener('click', remove);
  $('#poi-f-pick').addEventListener('click', () => ($('#poi-f-map').hidden ? openPick() : closePick()));
  $('#poi-f-loc').addEventListener('click', async () => {
    const b = $('#poi-f-loc'), note = $('#poi-f-gps-note');
    b.disabled = true;
    note.textContent = 'Recherche de votre position…';
    try {
      const r = await locate();
      setGps(r.ll, 'loc');
      note.textContent = `Position relevée (précision ± ${Math.round(r.acc)} m). Vérifiez-la sur la carte si besoin.`;
    } catch (e) { note.textContent = e.message; }
    finally { b.disabled = false; }
  });
  $('#poi-f-gps').addEventListener('input', e => {
    const ll = parseLatLng(e.target.value);
    setGps(ll, 'input');
    $('#poi-f-gps-note').textContent = e.target.value.trim() && !ll ? 'Format attendu : latitude, longitude en degrés décimaux (ex. 44.174130, 5.278690).' : '';
  });
  $('#poi-f-photo').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const note = $('#poi-f-photo-note');
    note.textContent = 'Préparation de la photo…';
    try {
      S.photo = await compressPhoto(file);
      const prev = $('#poi-f-preview');
      prev.src = S.photo;
      prev.hidden = false;
      $('#poi-f-photo-del').hidden = false;
      note.textContent = `Photo prête (${Math.round(S.photo.length * 0.75 / 1024)} Ko).`;
    } catch (err) { note.textContent = 'Cette image n’a pas pu être lue. Essayez une autre photo.'; }
  });
  $('#poi-f-photo-del').addEventListener('click', () => {
    S.photo = null;
    const prev = $('#poi-f-preview');
    prev.hidden = true;
    prev.removeAttribute('src');
    $('#poi-f-photo-del').hidden = true;
    $('#poi-f-photo-note').textContent = S.edit && S.edit.photo ? 'La photo sera retirée à l’enregistrement.' : '';
  });

  window.addEventListener('online', () => { renderPending(); flush(); });
  // Le retour du réseau n'est pas toujours signalé par le téléphone, et une application remise au premier plan
  // n'est pas rechargée : nouvel essai à chaque retour au premier plan et toutes les 30 s tant qu'un point attend.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { renderPending(); flush(); } });
  window.addEventListener('pageshow', () => flush());
  setInterval(() => { if (outbox().some(x => !x.erreur)) { renderPending(); flush(); } }, 30000);
  window.addEventListener('offline', renderPending);
  renderPending();

  window.SMPM_POI = { open, prefetch, flush, pending: () => outbox().length, reset, refresh: () => { S.loadedAt = 0; return load(true); } };
})();
