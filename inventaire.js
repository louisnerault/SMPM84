// Inventaire du matériel (rubrique « Inventaire », actions inv_* : back-end Inventaire.gs, dépôt privé).
// Deux onglets :
//  - Contenants : véhicules (VSMPM Avignon, VSM Apt, VSM Dentelles…) → contenants (caisses, lots…) → articles
//    avec leur quantité théorique. Inventaire pré-rempli avec les quantités théoriques : on ne corrige que
//    les écarts. Historique par contenant. Recherche d'un article dans tous les véhicules.
//  - Cordes : fiches, compteurs d'utilisation et de contrôle, derniers contrôles, déclaration d'utilisation.
// Tous les membres font des inventaires et déclarent des utilisations de cordes ; chefs de section, CTD et
// administrateurs modifient le contenu théorique et les fiches des cordes (app.js : canInvGerer).
// Hors ligne : dernières données gardées sur l'appareil ; inventaires et utilisations en file d'attente.
// Lien direct vers un contenant (QR code collé sur la caisse) : ?page=inventaire&c=<id du contenant>.
// QR codes générés dans l'application (vendor/qrcode, chefs de section et au-delà) : étiquettes à imprimer.
(() => {
  'use strict';

  const KEY = 'smpm_inv';
  const KEY_PREFS = 'smpm_inv_prefs';
  const KEY_OUTBOX = 'smpm_inv_outbox';
  const PHOTO_CACHE = 'smpm84-inv';          // photos des articles consultées (gardé par sw.js)
  const VIEUX_JOURS = 90;                    // inventaire plus ancien : signalé « à refaire »
  const STATUTS = { en_service: 'En service', a_surveiller: 'À surveiller', reformee: 'Réformée' };
  const UTIL = { OPS: 'OPS', FMPA: 'FMPA', INVENTAIRE: 'Inventaire' };
  const CTL = { VISUEL: 'Visuel', TACTILE: 'Tactile', NETTOYAGE: 'Nettoyage à l’eau' };
  const SECT = { NORD: 'Nord', CENTRE: 'Centre', SUD: 'Sud' };

  const $ = sel => document.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const sid = () => 'inv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  // contenant demandé par un QR code (lu avant que app.js ne nettoie l'adresse)
  let lienContenant = null;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('page') === 'inventaire' && q.get('c')) lienContenant = q.get('c');
  } catch (e) {}

  const P0 = () => ({ onglet: 'contenants', veh: '', famille: 'SMPM', secteur: '', statut: 'actives' });
  const S = {
    data: null, fresh: false, loading: false, err: '',
    p: Object.assign(P0(), store.getJSON(KEY_PREFS) || {}),
    vue: 'liste', cid: null, q: '', saisie: null, edit: null, histo: null, corde: null, usage: null, cEdit: null, qr: null,
    busy: false, msg: '',
  };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'icon') return;
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat(Infinity).forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    if (attrs && attrs.icon) { n.prepend(ico(attrs.icon)); n.classList.add('has-ico'); }
    return n;
  }
  // Icônes des actions (traits, couleur du texte)
  const ICONES = {
    plus: 'M12 5v14M5 12h14',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2',
    print: 'M7 9V3.5h10V9M7 17H4.5v-6.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17M7 14h10v6.5H7z',
    check: 'M9 3.5h6v3H9zM6.5 5H5v15.5h14V5h-1.5M8.5 13.5l2.5 2.5 4.5-5',
    clock: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
    camera: 'M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4zM12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    save: 'M5 12.5l4.5 4.5L19 7.5',
    rope: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
    move: 'M5 12h13M14 7.5L18.5 12 14 16.5',
    note: 'M5 4.5h14v11H11l-4 4v-4H5z',
    close: 'M6 6l12 12M18 6L6 18',
  };
  function ico(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'inv-ico');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONES[name] || ''); svg.append(path);
    return svg;
  }
  const pill = (text, on, onclick, extra) => el('button', Object.assign({ type: 'button', class: 'pill', 'aria-pressed': String(!!on), text, onclick }, extra || {}));

  const droits = () => ({ gerer: !!(S.data && S.data.droits && S.data.droits.gerer) || !!(app() && app().invGerer && app().invGerer()) });
  const savePrefs = () => store.set(KEY_PREFS, JSON.stringify(S.p));
  const save = () => { if (S.data) store.set(KEY, JSON.stringify(S.data)); };

  // ---------- dates ----------
  const jours = iso => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
  function quand(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const j = jours(iso);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (j <= 0) return `aujourd’hui ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    if (j === 1) return 'hier';
    if (j < 31) return `il y a ${j} j (${date})`;
    return date;
  }
  const moisAn = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' }); };

  // ---------- données ----------
  const vehicules = () => (S.data && S.data.vehicules) || [];
  const contenants = () => (S.data && S.data.contenants) || [];
  const cordes = () => (S.data && S.data.cordes) || [];
  const familles = () => ((S.data && S.data.familles) || []).filter(f => cordes().some(c => c.famille === f.code) || droits().gerer);
  const contenant = id => contenants().find(c => c.id === id) || null;
  const vehLib = code => (vehicules().find(v => v.code === code) || {}).libelle || code;

  function open() {
    if (!S.data) S.data = store.getJSON(KEY);
    if (lienContenant) {
      S.vue = 'contenant'; S.cid = lienContenant; lienContenant = null;
      const c = contenant(S.cid);
      if (c) S.p.veh = c.vehicule;
    }
    render();
    renderPending();
    if (!S.fresh && !S.loading) load();
    flush();
  }

  async function load() {
    if (!app() || !app().token()) return;
    S.loading = true; S.err = '';
    renderState();
    try {
      const res = await app().api('inv_data', { token: app().token() });
      setData(res);
      S.fresh = true;
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      S.err = err instanceof app().NetworkError
        ? (S.data ? `${app().netLabel()} : données du ${new Date(S.data.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.`
          : `${app().netLabel()} : inventaire indisponible sur cet appareil. Ouvrez-le une fois avec du réseau pour le garder hors ligne.`)
        : err.message === 'Action inconnue' ? 'L’inventaire n’est pas encore activé sur le serveur (Inventaire.gs).' : err.message;
    } finally {
      S.loading = false;
      render();
    }
  }

  function setData(res) {
    S.data = { vehicules: res.vehicules || [], contenants: res.contenants || [], cordes: res.cordes || [],
      familles: res.familles || [], droits: res.droits || {}, maj: res.maj || new Date().toISOString() };
    if (!S.p.veh || !vehicules().some(v => v.code === S.p.veh)) S.p.veh = (vehicules()[0] || {}).code || '';
    save();
  }

  function renderState() {
    const p = $('#inv-state');
    if (!p) return;
    p.textContent = S.loading ? (S.data ? 'Mise à jour…' : 'Chargement de l’inventaire…') : (S.err || S.msg || '');
    p.classList.toggle('error', !!S.err && !S.data);
  }

  function go(vue, extra) {
    Object.assign(S, { vue, msg: '' }, extra || {});
    render();
    window.scrollTo(0, 0);
  }

  // ---------- rendu ----------
  function render() {
    const root = $('#inv-root');
    if (!root) return;
    renderState();
    if (!S.data) { root.replaceChildren(); return; }
    const vues = { liste: vListe, contenant: vContenant, saisie: vSaisie, histo: vHisto, edit: vEdit,
      corde: vCorde, usage: vUsage, cedit: vCordeEdit, qr: vQr, listing: vListing };
    root.replaceChildren(...[].concat((vues[S.vue] || vListe)()).flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
  }

  const retour = (text, onclick) => el('div', { class: 'sub-head' }, el('button', { type: 'button', class: 'link', text: '← ' + text, onclick }));

  function etat(c) {
    const d = c.dernier;
    if (attente(c.id)) return { cls: 'inv-wait', txt: 'Inventaire en attente d’envoi' };
    if (!d) return { cls: 'inv-old', txt: 'Jamais inventorié dans l’application' };
    const j = jours(d.date);
    if (d.ecarts > 0) return { cls: 'inv-bad', txt: `${d.ecarts} écart${d.ecarts > 1 ? 's' : ''} · ${quand(d.date)} · ${d.par}` };
    if (j > VIEUX_JOURS) return { cls: 'inv-old', txt: `À refaire · ${quand(d.date)} · ${d.par}` };
    return { cls: 'inv-ok', txt: `Conforme · ${quand(d.date)} · ${d.par}` };
  }

  // ===== Liste : onglets Contenants / Cordes =====
  function vListe() {
    const tabs = el('div', { class: 'inv-tabs', role: 'tablist' },
      ['contenants', 'cordes'].map(o => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.p.onglet === o),
        text: o === 'contenants' ? 'Contenants' : 'Cordes', onclick: () => { S.p.onglet = o; savePrefs(); render(); } })));
    return [tabs].concat(S.p.onglet === 'cordes' ? vCordes() : vContenants());
  }

  function vContenants() {
    const out = [];
    out.push(el('input', { type: 'search', id: 'inv-q', placeholder: 'Rechercher un article (ex. Grigri, civière…)', autocomplete: 'off',
      'aria-label': 'Rechercher un article', value: S.q,
      oninput: e => { S.q = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#inv-q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} } } }));
    const q = fold(S.q.trim());
    if (q.length >= 2) {
      const hits = [];
      contenants().forEach(c => c.articles.forEach(a => {
        if (fold(a.nom + ' ' + a.detail).includes(q)) hits.push({ c, a });
      }));
      out.push(el('p', { class: 'muted small', text: hits.length ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}` : 'Aucun article trouvé.' }));
      out.push(el('ul', { class: 'inv-list' }, hits.slice(0, 80).map(h => el('li', null,
        el('button', { type: 'button', class: 'inv-card', onclick: () => go('contenant', { cid: h.c.id }) },
          el('strong', { text: `${h.a.nom}${h.a.t !== 1 ? ' ×' + h.a.t : ''}` }),
          el('span', { class: 'muted small', text: `${h.c.nom} · ${vehLib(h.c.vehicule)}${h.a.detail ? ' · ' + h.a.detail : ''}` }))))));
      return out;
    }
    out.push(el('div', { class: 'inv-chips', role: 'group', 'aria-label': 'Véhicule' },
      vehicules().map(v => pill(v.libelle, S.p.veh === v.code, () => { S.p.veh = v.code; savePrefs(); render(); }))));
    const liste = contenants().filter(c => c.vehicule === S.p.veh);
    const nbBad = liste.filter(c => c.dernier && c.dernier.ecarts > 0).length;
    const nbOld = liste.filter(c => !c.dernier || jours(c.dernier.date) > VIEUX_JOURS).length;
    out.push(el('p', { class: 'muted small inv-resume', text: `${liste.length} contenant${liste.length > 1 ? 's' : ''}`
      + (nbBad ? ` · ${nbBad} avec écart` : '') + (nbOld ? ` · ${nbOld} à refaire` : '') }));
    if (!droits().gerer && liste.length) out.push(el('div', { class: 'inv-actions' },
      el('button', { type: 'button', icon: 'print', class: 'pill', text: 'Listing papier', onclick: () => go('listing', { listing: liste.map(c => c.id) }) })));
    if (droits().gerer) out.push(el('div', { class: 'inv-actions' },
      el('button', { type: 'button', icon: 'plus', class: 'pill', text: 'Nouveau contenant',
        onclick: () => go('edit', { edit: { id: '', vehicule: S.p.veh, nom: '', articles: [] } }) }),
      liste.length ? el('button', { type: 'button', icon: 'print', class: 'pill', text: 'Listing papier', onclick: () => go('listing', { listing: liste.map(c => c.id) }) }) : null,
      liste.length ? el('button', { type: 'button', icon: 'qr', class: 'pill', text: 'QR codes du véhicule', onclick: () => go('qr', { qr: liste.map(c => c.id) }) }) : null));
    out.push(el('ul', { class: 'inv-list' }, liste.map(c => {
      const e = etat(c);
      return el('li', null, el('button', { type: 'button', class: 'inv-card ' + e.cls, onclick: () => go('contenant', { cid: c.id }) },
        el('span', { class: 'inv-card-head' }, el('strong', { text: c.nom }), el('span', { class: 'inv-n', text: `${c.articles.length} art.` })),
        el('span', { class: 'small inv-etat', text: e.txt })));
    })));
    if (!liste.length) out.push(el('p', { class: 'muted center', text: 'Aucun contenant pour ce véhicule.' }));
    return out;
  }

  // ===== Contenant =====
  function vContenant() {
    const c = contenant(S.cid);
    if (!c) return [retour('Inventaire', () => go('liste')), el('p', { class: 'muted', text: 'Contenant introuvable (supprimé ?).' })];
    const e = etat(c);
    const d = c.dernier;
    const last = {};
    ((d && d.lignes) || []).forEach(l => { last[l.a] = l; });
    return [
      retour('Inventaire', () => go('liste')),
      el('h2', { class: 'inv-title', text: c.nom }),
      el('p', { class: 'muted small', text: vehLib(c.vehicule) }),
      el('p', { class: 'inv-banner ' + e.cls, text: e.txt }),
      d && d.anomalies ? el('pre', { class: 'inv-anom', text: d.anomalies }) : null,
      d && d.remarque ? el('p', { class: 'small', text: '« ' + d.remarque + ' »' }) : null,
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'check', class: 'primary', text: 'Faire l’inventaire', disabled: !c.articles.length, onclick: () => startSaisie(c) }),
        el('button', { type: 'button', icon: 'clock', class: 'pill', text: 'Historique', onclick: () => openHisto(c) }),
        el('button', { type: 'button', icon: 'print', class: 'pill', text: 'Listing papier', disabled: !c.articles.length, onclick: () => go('listing', { listing: [c.id] }) }),
        droits().gerer ? el('button', { type: 'button', icon: 'edit', class: 'pill', text: 'Modifier le contenu',
          onclick: () => go('edit', { edit: { id: c.id, vehicule: c.vehicule, nom: c.nom, articles: c.articles.map(a => Object.assign({}, a)) } }) }) : null,
        droits().gerer ? el('button', { type: 'button', icon: 'qr', class: 'pill', text: 'QR code', onclick: () => go('qr', { qr: [c.id] }) }) : null),
      el('h3', { class: 'inv-sub', text: 'Contenu théorique' }),
      el('ul', { class: 'inv-arts' }, c.articles.map(a => {
        const l = last[a.id];
        const ecart = l && l.r !== l.t;
        return el('li', { class: ecart ? 'is-ecart' : '' },
          vignette(a),
          el('span', { class: 'inv-art-nom' }, a.nom, a.detail ? el('small', { class: 'muted', text: ' · ' + a.detail }) : null),
          el('span', { class: 'inv-art-q', text: ecart ? `${l.r} / ${a.t}` : String(a.t) }));
      })),
      !c.articles.length ? el('p', { class: 'muted', text: 'Aucun article.' }) : null,
    ];
  }

  // ===== QR codes à coller sur les contenants (chefs de section, CTD, administrateurs) =====
  const lienDe = c => new URL('./?page=inventaire&c=' + encodeURIComponent(c.id), location.href).href;
  function qrSvg(texte) {
    const NS = 'http://www.w3.org/2000/svg';
    const q = window.qrcode(0, 'M');
    q.addData(texte);
    q.make();
    const n = q.getModuleCount(), m = 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n + 2 * m} ${n + 2 * m}`);
    svg.setAttribute('class', 'inv-qr-img');
    svg.setAttribute('role', 'img');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#fff');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#000');
    svg.append(bg, path);
    return svg;
  }

  function vQr() {
    const liste = (S.qr || []).map(contenant).filter(Boolean);
    if (!liste.length || !droits().gerer) return vListe();
    const un = liste.length === 1 ? liste[0] : null;
    return [
      retour(un ? un.nom : 'Inventaire', () => go(un ? 'contenant' : 'liste', { cid: un ? un.id : S.cid, qr: null })),
      el('h2', { class: 'inv-title', text: un ? `QR code · ${un.nom}` : `QR codes · ${vehLib(liste[0].vehicule)}` }),
      el('p', { class: 'muted small', text: 'À imprimer et coller sur le contenant : le scan ouvre directement son inventaire dans l’application (connexion requise).' }),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'print', class: 'primary', text: liste.length > 1 ? `Imprimer les ${liste.length} étiquettes` : 'Imprimer', onclick: imprimer }),
        un ? el('button', { type: 'button', icon: 'link', class: 'pill', text: 'Copier le lien', onclick: () => copierLien(un) }) : null),
      el('div', { class: 'inv-print-area inv-qr-sheet' }, liste.map(c => {
        let img;
        try { img = qrSvg(lienDe(c)); } catch (e) { img = el('p', { class: 'error', text: 'QR code indisponible' }); }
        return el('figure', { class: 'inv-qr' }, img,
          el('figcaption', null, el('strong', { text: c.nom }), el('span', { text: vehLib(c.vehicule) }), el('small', { text: 'SMPM 84 · Scanner pour l’inventaire' })));
      })),
    ];
  }

  // ===== Listing papier (véhicule entier ou un contenant) : contenu théorique, pour consultation ou affichage =====
  function vListing() {
    const liste = (S.listing || []).map(contenant).filter(Boolean);
    if (!liste.length) return vListe();
    const un = liste.length === 1 ? liste[0] : null;
    const veh = vehLib(liste[0].vehicule);
    const nbArt = liste.reduce((n, c) => n + c.articles.length, 0);
    return [
      retour(un ? un.nom : 'Inventaire', () => go(un ? 'contenant' : 'liste', { cid: un ? un.id : S.cid, listing: null })),
      el('h2', { class: 'inv-title', text: un ? `Listing · ${un.nom}` : `Listing · ${veh}` }),
      el('p', { class: 'muted small', text: `Contenu théorique : ${liste.length} contenant${liste.length > 1 ? 's' : ''}, ${nbArt} article${nbArt > 1 ? 's' : ''}. Les inventaires se font dans l’application.` }),
      el('div', { class: 'inv-actions' }, el('button', { type: 'button', icon: 'print', class: 'primary', text: 'Imprimer', onclick: imprimer })),
      el('div', { class: 'inv-print-area inv-listing' },
        el('div', { class: 'inv-lst-head' },
          el('strong', { text: `SMPM 84 · Matériel ${veh}${un ? ' · ' + un.nom : ''}` }),
          el('span', { text: `Contenu théorique au ${new Date().toLocaleDateString('fr-FR')}` })),
        liste.map(c => el('section', { class: 'inv-lst-cont' },
          el('h3', { text: c.nom }),
          el('table', null,
            el('thead', null, el('tr', null, ['Article', 'Détail / n° de série', 'Quantité'].map(t => el('th', { text: t })))),
            el('tbody', null, c.articles.map(a => el('tr', null,
              el('td', { text: a.nom }), el('td', { text: a.detail || '' }), el('td', { class: 'num', text: String(a.t) })))))))),
    ];
  }

  function imprimer() {
    document.body.classList.add('inv-print');
    const fin = () => { document.body.classList.remove('inv-print'); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    window.print();
    setTimeout(fin, 1000);
  }

  async function copierLien(c) {
    const url = lienDe(c);
    try { await navigator.clipboard.writeText(url); S.msg = 'Lien copié.'; }
    catch (e) { prompt('Lien direct vers ce contenant :', url); }
    renderState();
  }

  // ===== Photos des articles (cache de l'appareil, puis serveur) =====
  const photoReq = a => new Request(`inv-photo/${encodeURIComponent(a.id)}?v=${encodeURIComponent(a.ph)}`);
  async function photoUrl(a) {
    let cache = null;
    try { cache = await caches.open(PHOTO_CACHE); } catch (e) { cache = null; }
    if (cache) { const hit = await cache.match(photoReq(a)); if (hit) return URL.createObjectURL(await hit.blob()); }
    const res = await app().api('inv_photo', { token: app().token(), article: a.id });
    const bin = atob(res.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: res.mime || 'image/jpeg' });
    if (cache) {
      try {
        (await cache.keys()).filter(r => r.url.includes(`/inv-photo/${encodeURIComponent(a.id)}?`)).forEach(r => cache.delete(r));
        await cache.put(photoReq(a), new Response(blob, { headers: { 'Content-Type': blob.type } }));
      } catch (e) {}
    }
    return URL.createObjectURL(blob);
  }
  // Vignette cliquable (agrandie en plein écran) ; chargée à l'affichage
  function vignette(a) {
    if (!a.ph) return null;
    const img = el('img', { alt: '', class: 'inv-thumb-img' });
    const b = el('button', { type: 'button', class: 'inv-thumb', 'aria-label': `Photo : ${a.nom}`, onclick: ev => { ev.stopPropagation(); agrandir(a, img.src); } }, img);
    photoUrl(a).then(u => { img.src = u; }).catch(() => { b.classList.add('is-off'); b.title = 'Photo indisponible hors ligne'; });
    return b;
  }
  function agrandir(a, src) {
    if (!src) return;
    const ov = el('div', { class: 'inv-photo-ov', role: 'dialog', 'aria-label': a.nom, onclick: () => ov.remove() },
      el('img', { src, alt: a.nom }), el('p', { text: a.nom + (a.detail ? ' · ' + a.detail : '') }), el('button', { type: 'button', icon: 'close', class: 'pill', text: 'Fermer' }));
    document.body.append(ov);
  }
  // Photo réduite sur l'appareil avant envoi (1280 px max, JPEG)
  function compresser(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }
  async function envoyerPhoto(a, file) {
    const e = S.edit;
    try {
      S.busy = true; e.err = ''; render();
      const photo = file ? await compresser(file) : '';
      const res = await app().api('inv_article_photo', { token: app().token(), article: a.id, photo });
      a.ph = res.ph || '';
      contenants().forEach(c => c.articles.forEach(x => { if (x.id === a.id) x.ph = a.ph; }));
      save();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      e.err = err instanceof app().NetworkError ? app().netLabel() + ' : photo non envoyée.' : err.message;
    } finally { S.busy = false; render(); }
  }

  // ===== Saisie d'un inventaire =====
  function startSaisie(c) {
    const lignes = {};
    c.articles.forEach(a => { lignes[a.id] = { r: a.t, u: '', rq: '', note: false }; });
    go('saisie', { saisie: { cid: c.id, lignes, remarque: '', sid: sid(), err: '' } });
  }

  function vSaisie() {
    const s = S.saisie, c = s && contenant(s.cid);
    if (!c) return vListe();
    const ecarts = c.articles.filter(a => Number(s.lignes[a.id].r) !== a.t).length;
    const majBtn = () => {
      const n = c.articles.filter(a => Number(s.lignes[a.id].r) !== a.t).length;
      const b = $('#inv-valider');
      if (b) b.lastChild.textContent = n ? `Valider l’inventaire (${n} écart${n > 1 ? 's' : ''})` : 'Valider : tout est conforme';
    };
    const rows = c.articles.map(a => {
      const l = s.lignes[a.id];
      const li = el('li', { class: 'inv-row' + (Number(l.r) !== a.t ? ' is-ecart' : '') });
      const input = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '999', value: String(l.r), 'aria-label': `Quantité réelle : ${a.nom}`,
        oninput: e => { l.r = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0); li.classList.toggle('is-ecart', Number(l.r) !== a.t); majBtn(); } });
      const step = d => { l.r = Math.max(0, (Number(l.r) || 0) + d); input.value = String(l.r); li.classList.toggle('is-ecart', l.r !== a.t); majBtn(); };
      li.append(...[
        el('div', { class: 'inv-row-main' },
          vignette(a),
          el('div', { class: 'inv-row-nom' }, el('strong', { text: a.nom }), el('small', { class: 'muted', text: `théorique : ${a.t}${a.detail ? ' · ' + a.detail : ''}` })),
          el('div', { class: 'inv-step' },
            el('button', { type: 'button', class: 'pill', 'aria-label': 'Un de moins', text: '−', onclick: () => step(-1) }),
            input,
            el('button', { type: 'button', class: 'pill', 'aria-label': 'Un de plus', text: '+', onclick: () => step(1) }))),
        a.u ? el('div', { class: 'inv-chips inv-util', role: 'group', 'aria-label': 'Utilisation' },
          el('span', { class: 'small muted', text: 'Utilisation :' }),
          [['', 'Non utilisé'], ['FMPA', 'FMPA'], ['OPS', 'OPS']].map(([v, t]) => pill(t, l.u === v, e => {
            l.u = v; e.currentTarget.parentNode.querySelectorAll('.pill').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          }))) : null,
        l.note || l.rq
          ? el('input', { type: 'text', class: 'inv-rq', maxlength: '300', placeholder: 'Remarque (état, n° manquant…)', value: l.rq, oninput: e => { l.rq = e.target.value; } })
          : el('button', { type: 'button', icon: 'note', class: 'link small inv-note', text: 'remarque', onclick: () => { l.note = true; render(); } }),
      ].filter(Boolean));
      return li;
    });
    return [
      retour(c.nom, () => { if (!confirm('Abandonner cet inventaire ?')) return; go('contenant', { cid: c.id, saisie: null }); }),
      el('h2', { class: 'inv-title', text: `Inventaire · ${c.nom}` }),
      el('p', { class: 'muted small', text: `${vehLib(c.vehicule)} · quantités pré-remplies avec le contenu théorique : corrigez seulement ce qui manque ou est en trop.` }),
      el('ul', { class: 'inv-rows' }, rows),
      el('label', null, 'Remarque générale (facultatif)',
        el('textarea', { rows: '2', maxlength: '1000', oninput: e => { s.remarque = e.target.value; } }, s.remarque)),
      el('p', { class: 'error', role: 'alert', text: s.err }),
      el('button', { type: 'button', icon: 'save', class: 'primary inv-submit', id: 'inv-valider', disabled: S.busy,
        text: ecarts ? `Valider l’inventaire (${ecarts} écart${ecarts > 1 ? 's' : ''})` : 'Valider : tout est conforme', onclick: submitSaisie }),
    ];
  }

  async function submitSaisie() {
    const s = S.saisie, c = contenant(s.cid);
    if (!c || S.busy) return;
    if (c.articles.some(a => s.lignes[a.id].r === '')) { s.err = 'Indiquez une quantité pour chaque article (0 si absent).'; return render(); }
    const inventaire = {
      contenant: c.id, remarque: s.remarque.trim(), saisi_le: new Date().toISOString(),
      lignes: c.articles.map(a => ({ a: a.id, r: Number(s.lignes[a.id].r), u: s.lignes[a.id].u, rq: s.lignes[a.id].rq.trim() })),
    };
    const entry = { sid: s.sid, kind: 'inv', payload: inventaire, label: `${c.nom} · ${vehLib(c.vehicule)}`, ts: Date.now(), erreur: '' };
    S.busy = true; render();
    try {
      const ok = await envoyer(entry);
      S.saisie = null;
      go('contenant', { cid: c.id, msg: ok ? 'Inventaire enregistré. Merci !' : 'Pas de réseau : inventaire gardé sur l’appareil, envoi automatique au retour du réseau.' });
    } catch (err) {
      s.err = err.message;
      render();
    } finally { S.busy = false; render(); }
  }

  // Envoi immédiat ; sans réseau, mise en file d'attente. Renvoie true si envoyé, false si en attente.
  async function envoyer(entry) {
    if (navigator.onLine) {
      try { await envoyerUn(entry); return true; } catch (err) {
        if (app().AUTH_ERRORS.includes(err.message)) { app().logout(); throw err; }
        if (!(err instanceof app().NetworkError)) throw err;
      }
    }
    if (!store.set(KEY_OUTBOX, JSON.stringify(outbox().filter(x => x.sid !== entry.sid).concat(entry)))) throw new Error('Mémoire de l’appareil pleine : saisie non enregistrée.');
    renderPending();
    return false;
  }

  async function envoyerUn(e) {
    if (e.kind === 'inv') {
      const res = await app().api('inv_submit', { token: app().token(), inventaire: e.payload, submission_id: e.sid });
      const c = S.data && contenant(e.payload.contenant);
      if (c && res.inventaire && (!c.dernier || c.dernier.date <= res.inventaire.date)) { c.dernier = res.inventaire; save(); }
      if (S.histo && S.histo.cid === e.payload.contenant) S.histo = null;
    } else if (e.kind === 'corde') {
      const res = await app().api('inv_corde_usage', { token: app().token(), usage: e.payload, submission_id: e.sid });
      if (res.contenants) setData(res);
    }
  }

  // ===== Historique d'un contenant =====
  async function openHisto(c) {
    go('histo', { histo: { cid: c.id, liste: null, err: '' } });
    try {
      const res = await app().api('inv_historique', { token: app().token(), contenant: c.id });
      if (S.histo && S.histo.cid === c.id) { S.histo.liste = res.inventaires || []; render(); }
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (S.histo) { S.histo.err = err instanceof app().NetworkError ? app().netLabel() + ' : historique indisponible hors ligne.' : err.message; render(); }
    }
  }

  function vHisto() {
    const h = S.histo, c = h && contenant(h.cid);
    if (!c) return vListe();
    const out = [retour(c.nom, () => go('contenant', { cid: c.id })), el('h2', { class: 'inv-title', text: `Historique · ${c.nom}` })];
    if (h.err) return out.concat(el('p', { class: 'error', text: h.err }));
    if (!h.liste) return out.concat(el('p', { class: 'muted', text: 'Chargement…' }));
    if (!h.liste.length) return out.concat(el('p', { class: 'muted', text: 'Aucun inventaire enregistré.' }));
    return out.concat(el('ul', { class: 'inv-list' }, h.liste.map(i => el('li', null,
      el('details', { class: 'inv-card inv-histo ' + (i.ecarts ? 'inv-bad' : 'inv-ok') },
        el('summary', null,
          el('strong', { text: new Date(i.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }),
          el('span', { class: 'small', text: ` · ${i.par} · ${i.ecarts ? i.ecarts + ' écart' + (i.ecarts > 1 ? 's' : '') : 'conforme'}${i.source === 'import' ? ' · repris des formulaires' : ''}` })),
        i.anomalies ? el('pre', { class: 'inv-anom', text: i.anomalies }) : null,
        i.remarque ? el('p', { class: 'small', text: '« ' + i.remarque + ' »' }) : null,
        (i.lignes || []).some(l => l.u) ? el('p', { class: 'small muted', text: 'Utilisation : ' + i.lignes.filter(l => l.u).map(l => `${l.nom} (${l.u})`).join(', ') }) : null)))));
  }

  // ===== Modifier le contenu d'un contenant (chefs de section, CTD, administrateurs) =====
  function vEdit() {
    const e = S.edit;
    if (!e) return vListe();
    // autres contenants (tous véhicules) pour « Déplacer vers… » ; articles existants seulement
    const autres = contenants().filter(c => c.id !== e.id);
    const destSelect = a => el('label', { class: 'inv-edit-dest', icon: 'move' }, el('select', { 'aria-label': 'Déplacer vers un autre contenant',
      onchange: ev => { a.dest = ev.target.value; render(); } },
      el('option', { value: '' }, a.dest ? 'Annuler le déplacement' : 'Déplacer vers…'),
      vehicules().map(v => el('optgroup', { label: v.libelle },
        autres.filter(c => c.vehicule === v.code).map(c => el('option', { value: c.id, selected: a.dest === c.id }, c.nom))))));
    const rows = e.articles.map((a, i) => el('li', { class: 'inv-edit-row' + (a.dest ? ' is-moved' : '') },
      el('input', { type: 'text', maxlength: '120', placeholder: 'Article', value: a.nom, 'aria-label': 'Nom de l’article', oninput: ev => { a.nom = ev.target.value; } }),
      el('input', { type: 'number', min: '0', max: '999', inputmode: 'numeric', value: String(a.t), 'aria-label': 'Quantité théorique', class: 'inv-edit-q', oninput: ev => { a.t = Math.max(0, parseInt(ev.target.value, 10) || 0); } }),
      el('input', { type: 'text', maxlength: '200', placeholder: 'Détail, n° de série (facultatif)', value: a.detail || '', class: 'inv-edit-detail', 'aria-label': 'Détail', oninput: ev => { a.detail = ev.target.value; } }),
      a.dest ? el('p', { class: 'inv-edit-move small', text: `→ sera déplacé vers ${(contenant(a.dest) || {}).nom} (${vehLib((contenant(a.dest) || {}).vehicule)}) à l’enregistrement` }) : null,
      a.id && autres.length ? destSelect(a) : null,
      a.id ? el('div', { class: 'inv-edit-photo' },
        vignette(a),
        el('label', { class: 'pill inv-file', icon: 'camera' }, a.ph ? 'Changer la photo' : 'Ajouter une photo',
          el('input', { type: 'file', accept: 'image/*', disabled: S.busy, onchange: ev => { const f = ev.target.files[0]; if (f) envoyerPhoto(a, f); } })),
        a.ph ? el('button', { type: 'button', icon: 'trash', class: 'link danger small', text: 'Retirer', disabled: S.busy, onclick: () => { if (confirm(`Retirer la photo de « ${a.nom} » ?`)) envoyerPhoto(a, null); } }) : null)
        : el('p', { class: 'muted small inv-edit-photo', text: 'Photo : enregistrez d’abord pour pouvoir en ajouter une.' }),
      el('div', { class: 'inv-edit-tools' },
        el('label', { class: 'ann-check' }, el('input', { type: 'checkbox', checked: a.u, onchange: ev => { a.u = ev.target.checked; } }), 'Suivi d’utilisation'),
        el('button', { type: 'button', class: 'link', 'aria-label': 'Monter', text: '↑', disabled: i === 0, onclick: () => { e.articles.splice(i - 1, 0, e.articles.splice(i, 1)[0]); render(); } }),
        el('button', { type: 'button', class: 'link', 'aria-label': 'Descendre', text: '↓', disabled: i === e.articles.length - 1, onclick: () => { e.articles.splice(i + 1, 0, e.articles.splice(i, 1)[0]); render(); } }),
        el('button', { type: 'button', icon: 'trash', class: 'link danger', text: 'Retirer', onclick: () => { e.articles.splice(i, 1); render(); } }))));
    return [
      retour(e.id ? e.nom : 'Inventaire', () => go(e.id ? 'contenant' : 'liste', { edit: null })),
      el('h2', { class: 'inv-title', text: e.id ? 'Modifier le contenu' : 'Nouveau contenant' }),
      el('label', null, 'Nom du contenant', el('input', { type: 'text', maxlength: '80', value: e.nom, placeholder: 'Ex. CAISSE 14', oninput: ev => { e.nom = ev.target.value; } })),
      el('label', null, 'Véhicule', el('select', { onchange: ev => { e.vehicule = ev.target.value; } },
        vehicules().map(v => el('option', { value: v.code, selected: v.code === e.vehicule }, v.libelle)))),
      el('h3', { class: 'inv-sub', text: `Articles (${e.articles.length})` }),
      el('p', { class: 'muted small', text: '« Suivi d’utilisation » demande à chaque inventaire si l’article a servi (FMPA, OPS). « Déplacer vers… » transfère l’article dans un autre contenant, même d’un autre véhicule. Un article retiré reste dans l’historique.' }),
      el('ul', { class: 'inv-edit' }, rows),
      el('button', { type: 'button', icon: 'plus', class: 'pill', text: 'Ajouter un article', onclick: () => {
        e.articles.push({ id: '', nom: '', detail: '', t: 1, u: false }); render();
        const ins = document.querySelectorAll('.inv-edit-row input[type=text]:first-child'); if (ins.length) ins[ins.length - 1].focus();
      } }),
      el('p', { class: 'error', role: 'alert', text: e.err || '' }),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'save', class: 'primary', text: 'Enregistrer', disabled: S.busy, onclick: () => saveEdit(false) }),
        e.id ? el('button', { type: 'button', icon: 'trash', class: 'link danger', text: 'Supprimer ce contenant', disabled: S.busy, onclick: () => saveEdit(true) }) : null),
    ];
  }

  async function saveEdit(supprimer) {
    const e = S.edit;
    if (supprimer && !confirm(`Supprimer le contenant « ${e.nom} » ? Son historique reste dans le classeur.`)) return;
    if (!supprimer && e.nom.trim().length < 2) { e.err = 'Nom du contenant obligatoire.'; return render(); }
    S.busy = true; render();
    try {
      const res = await app().api('inv_contenant_save', { token: app().token(), contenant: {
        id: e.id, vehicule: e.vehicule, nom: e.nom.trim(), supprimer: !!supprimer,
        articles: e.articles.filter(a => a.nom.trim()).map(a => ({ id: a.id, nom: a.nom.trim(), detail: (a.detail || '').trim(), t: a.t, u: !!a.u, dest: a.dest || '' })),
      } });
      setData(res);
      if (supprimer) go('liste', { edit: null, msg: 'Contenant supprimé.' });
      else {
        const c = contenants().find(x => x.vehicule === e.vehicule && x.nom.toUpperCase() === e.nom.trim().toUpperCase());
        S.p.veh = e.vehicule; savePrefs();
        const dep = res.deplaces || [];
        go(c ? 'contenant' : 'liste', { cid: c ? c.id : null, edit: null,
          msg: 'Contenu enregistré.' + (dep.length ? ` Déplacé${dep.length > 1 ? 's' : ''} : ${dep.join(', ')}.` : '') });
      }
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      e.err = err instanceof app().NetworkError ? app().netLabel() + ' : modification impossible hors ligne.' : err.message;
    } finally { S.busy = false; render(); }
  }

  // ===== Cordes =====
  function cordesFiltrees() {
    return cordes().filter(c => c.famille === S.p.famille
      && (!S.p.secteur || c.secteur === S.p.secteur)
      && (S.p.statut === 'toutes' || (S.p.statut === 'actives' ? c.statut !== 'reformee' : c.statut === S.p.statut)));
  }

  function vCordes() {
    const fams = familles();
    if (fams.length && !fams.some(f => f.code === S.p.famille)) S.p.famille = fams[0].code;
    const fam = fams.find(f => f.code === S.p.famille) || { secteurs: [] };
    const liste = cordesFiltrees();
    const out = [
      el('div', { class: 'inv-chips', role: 'group', 'aria-label': 'Famille de cordes' },
        fams.map(f => pill(f.libelle, f.code === S.p.famille, () => { S.p.famille = f.code; S.p.secteur = ''; savePrefs(); render(); }))),
      fam.secteurs.length ? el('div', { class: 'inv-chips', role: 'group', 'aria-label': 'Secteur' },
        [['', 'Tous secteurs']].concat(fam.secteurs.map(s => [s, SECT[s] || s])).map(([v, t]) => pill(t, S.p.secteur === v, () => { S.p.secteur = v; savePrefs(); render(); }))) : null,
      el('div', { class: 'inv-filtres' },
        el('select', { 'aria-label': 'Statut', onchange: e => { S.p.statut = e.target.value; savePrefs(); render(); } },
          [['actives', 'En service et à surveiller'], ['a_surveiller', 'À surveiller'], ['reformee', 'Réformées'], ['toutes', 'Toutes']]
            .map(([v, t]) => el('option', { value: v, selected: S.p.statut === v }, t))),
        el('span', { class: 'small', text: `${liste.length} corde${liste.length > 1 ? 's' : ''}` })),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'rope', class: 'primary', text: 'Déclarer une utilisation', disabled: !cordes().some(c => c.famille === S.p.famille && c.statut !== 'reformee'),
          onclick: () => go('usage', { usage: { famille: S.p.famille, type: 'FMPA', nums: [], ctl: ['VISUEL'], rq: {}, ref: [], sid: sid(), err: '' } }) }),
        droits().gerer ? el('button', { type: 'button', icon: 'plus', class: 'pill', text: 'Nouvelle corde', onclick: () => editCorde(null) }) : null),
      el('ul', { class: 'inv-list' }, liste.map(c => el('li', null,
        el('button', { type: 'button', class: 'inv-card inv-corde inv-st-' + c.statut, onclick: () => go('corde', { corde: c.id }) },
          el('span', { class: 'inv-card-head' },
            el('strong', { text: `N° ${c.num}` + (c.secteur ? ` · ${SECT[c.secteur] || c.secteur}` : '') }),
            el('span', { class: 'inv-badge', text: STATUTS[c.statut] })),
          el('span', { class: 'small', text: [c.longueur ? c.longueur + ' m' : '', c.diametre ? c.diametre + ' mm' : '', c.fabricant, c.modele].filter(Boolean).join(' · ') || 'Fiche à compléter' }),
          el('span', { class: 'small muted', text: `FMPA ${c.cpt.FMPA || 0} · OPS ${c.cpt.OPS || 0}` + (c.dernier ? ` · dernier contrôle ${quand(c.dernier)}` : ' · aucun contrôle enregistré') }))))),
      !liste.length ? el('p', { class: 'muted center', text: 'Aucune corde pour ces critères.' }) : null,
    ];
    return out;
  }

  function vCorde() {
    const c = cordes().find(x => x.id === S.corde);
    if (!c) return vListe();
    const fam = familles().find(f => f.code === c.famille) || { libelle: c.famille };
    const info = [['Secteur', SECT[c.secteur] || c.secteur], ['Longueur', c.longueur && c.longueur + ' m'], ['Diamètre', c.diametre && c.diametre + ' mm'],
      ['Type', c.type], ['Fabricant', c.fabricant], ['Modèle', c.modele], ['N° de série', c.serie], ['N° TEXIS / TECHSYS', c.texis],
      ['Fabrication', moisAn(c.fabrication)], ['Mise en service', moisAn(c.service)], ['Caserne', c.caserne]].filter(x => x[1]);
    return [
      retour('Cordes', () => go('liste')),
      el('h2', { class: 'inv-title', text: `Corde n° ${c.num}` }),
      el('p', { class: 'muted small', text: fam.libelle }),
      el('p', { class: 'inv-banner inv-st-' + c.statut, text: STATUTS[c.statut] }),
      c.commentaire ? el('p', { class: 'small', text: c.commentaire }) : null,
      el('dl', { class: 'inv-dl' }, info.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('h3', { class: 'inv-sub', text: 'Compteurs' }),
      el('div', { class: 'inv-cpt' },
        [['OPS', c.cpt.OPS], ['FMPA', c.cpt.FMPA], ['Inventaire', c.cpt.INVENTAIRE], ['Tactile', c.cpt.TACTILE], ['Visuel', c.cpt.VISUEL], ['Nettoyage', c.cpt.NETTOYAGE]]
          .map(([k, v]) => el('div', null, el('strong', { text: String(v || 0) }), el('span', { class: 'small muted', text: k })))),
      el('p', { class: 'muted small', text: 'Les inventaires ne comptent pas comme utilisation.' }),
      el('h3', { class: 'inv-sub', text: 'Derniers contrôles' }),
      c.hist.length ? el('ul', { class: 'inv-arts' }, c.hist.map(h => el('li', null,
        el('span', { class: 'inv-art-nom' }, el('strong', { text: new Date(h.d).toLocaleDateString('fr-FR') }), ` · ${h.par} · ${UTIL[h.type] || h.type}`,
          h.ctl.length ? el('small', { class: 'muted', text: ' · ' + h.ctl.map(k => CTL[k] || k).join(', ') }) : null,
          h.rq ? el('em', { class: 'inv-hrq', text: h.rq }) : null)))) : el('p', { class: 'muted small', text: 'Aucun contrôle enregistré.' }),
      el('div', { class: 'inv-actions' },
        c.statut !== 'reformee' ? el('button', { type: 'button', icon: 'rope', class: 'primary', text: 'Déclarer une utilisation',
          onclick: () => go('usage', { usage: { famille: c.famille, type: 'FMPA', nums: [c.num], ctl: ['VISUEL'], rq: {}, ref: [], sid: sid(), err: '' } }) }) : null,
        droits().gerer ? el('button', { type: 'button', icon: 'edit', class: 'pill', text: 'Modifier la fiche', onclick: () => editCorde(c) }) : null),
    ];
  }

  function vUsage() {
    const u = S.usage;
    if (!u) return vListe();
    const fam = familles().find(f => f.code === u.famille) || { libelle: u.famille, secteurs: [] };
    const dispo = cordes().filter(c => c.famille === u.famille && c.statut !== 'reformee');
    const groupes = fam.secteurs.length
      ? fam.secteurs.map(s => [SECT[s] || s, dispo.filter(c => c.secteur === s)]).concat([['Sans secteur', dispo.filter(c => !fam.secteurs.includes(c.secteur))]])
      : [['', dispo]];
    const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
    return [
      retour('Cordes', () => go('liste', { usage: null })),
      el('h2', { class: 'inv-title', text: 'Utilisation de cordes' }),
      el('p', { class: 'muted small', text: fam.libelle }),
      el('h3', { class: 'inv-sub', text: 'Type d’utilisation' }),
      el('div', { class: 'inv-chips' }, Object.keys(UTIL).map(k => pill(UTIL[k], u.type === k, () => { u.type = k; render(); }))),
      el('h3', { class: 'inv-sub', text: `Cordes utilisées (${u.nums.length})` }),
      groupes.filter(g => g[1].length).map(([t, l]) => el('div', { class: 'inv-numgrp' },
        t ? el('p', { class: 'small muted', text: t }) : null,
        el('div', { class: 'inv-nums' }, l.map(c => pill(String(c.num), u.nums.includes(c.num), () => { toggle(u.nums, c.num); u.nums.sort((a, b) => a - b); render(); },
          { class: 'pill' + (c.statut === 'a_surveiller' ? ' inv-pill-warn' : ''), title: [c.longueur && c.longueur + ' m', c.modele, STATUTS[c.statut]].filter(Boolean).join(' · ') }))))),
      el('h3', { class: 'inv-sub', text: 'Contrôles réalisés' }),
      el('div', { class: 'inv-chips' }, Object.keys(CTL).map(k => pill(CTL[k], u.ctl.includes(k), () => { toggle(u.ctl, k); render(); }))),
      u.nums.length ? el('h3', { class: 'inv-sub', text: 'Remarques (facultatif)' }) : null,
      el('ul', { class: 'inv-rows' }, u.nums.map(n => el('li', { class: 'inv-row' },
        el('strong', { text: `Corde n° ${n}` }),
        el('input', { type: 'text', maxlength: '500', placeholder: 'État, critère de réforme…', value: u.rq[n] || '', 'aria-label': `Remarque corde ${n}`, oninput: e => { u.rq[n] = e.target.value; } }),
        el('label', { class: 'ann-check' }, el('input', { type: 'checkbox', checked: u.ref.includes(n), onchange: () => toggle(u.ref, n) }), 'À faire examiner pour réforme')))),
      el('p', { class: 'error', role: 'alert', text: u.err }),
      el('button', { type: 'button', icon: 'save', class: 'primary inv-submit', disabled: S.busy || !u.nums.length, text: 'Enregistrer', onclick: submitUsage }),
    ];
  }

  async function submitUsage() {
    const u = S.usage;
    if (!u || S.busy || !u.nums.length) return;
    const rq = {};
    u.nums.forEach(n => { if ((u.rq[n] || '').trim()) rq[n] = u.rq[n].trim(); });
    const payload = { famille: u.famille, type: u.type, cordes: u.nums.slice(), controles: u.ctl.slice(), remarques: rq,
      reforme: u.ref.filter(n => u.nums.includes(n)), saisi_le: new Date().toISOString() };
    const entry = { sid: u.sid, kind: 'corde', payload, label: `Cordes ${u.nums.join(', ')} · ${UTIL[u.type]}`, ts: Date.now(), erreur: '' };
    S.busy = true; render();
    try {
      const ok = await envoyer(entry);
      go('liste', { usage: null, msg: ok ? 'Utilisation enregistrée.' : 'Pas de réseau : utilisation gardée sur l’appareil, envoi automatique au retour du réseau.' });
    } catch (err) { u.err = err.message; }
    finally { S.busy = false; render(); }
  }

  function editCorde(c) {
    const f = familles().find(x => x.code === (c ? c.famille : S.p.famille)) || familles()[0] || { code: 'SMPM', secteurs: [] };
    const max = cordes().filter(x => x.famille === f.code).reduce((m, x) => Math.max(m, x.num), 0);
    const iso = v => (v ? String(v).slice(0, 7) : '');
    go('cedit', { cEdit: c ? Object.assign({}, c, { fabrication: iso(c.fabrication), service: iso(c.service), err: '' })
      : { id: '', famille: f.code, num: max + 1, secteur: S.p.secteur || '', statut: 'en_service', longueur: '', diametre: '', type: '',
        fabricant: '', modele: '', serie: '', texis: '', fabrication: '', service: '', caserne: '', commentaire: '', err: '' } });
  }

  function vCordeEdit() {
    const c = S.cEdit;
    if (!c) return vListe();
    const fam = familles().find(f => f.code === c.famille) || { secteurs: [] };
    const champ = (lab, k, attrs) => el('label', null, lab, el('input', Object.assign({ type: 'text', value: c[k] || '', oninput: e => { c[k] = e.target.value; } }, attrs || {})));
    return [
      retour(c.id ? `Corde n° ${c.num}` : 'Cordes', () => go(c.id ? 'corde' : 'liste', { cEdit: null })),
      el('h2', { class: 'inv-title', text: c.id ? `Fiche de la corde n° ${c.num}` : 'Nouvelle corde' }),
      el('label', null, 'Famille', el('select', { disabled: !!c.id, onchange: e => { c.famille = e.target.value; c.secteur = ''; render(); } },
        familles().map(f => el('option', { value: f.code, selected: f.code === c.famille }, f.libelle)))),
      champ('Numéro', 'num', { type: 'number', min: '1', inputmode: 'numeric' }),
      fam.secteurs.length ? el('label', null, 'Secteur', el('select', { onchange: e => { c.secteur = e.target.value; } },
        [el('option', { value: '' }, '—')].concat(fam.secteurs.map(s => el('option', { value: s, selected: s === c.secteur }, SECT[s] || s))))) : null,
      el('label', null, 'Statut', el('select', { onchange: e => { c.statut = e.target.value; } },
        Object.keys(STATUTS).map(k => el('option', { value: k, selected: k === c.statut }, STATUTS[k])))),
      el('div', { class: 'inv-2col' }, champ('Longueur (m)', 'longueur', { inputmode: 'decimal' }), champ('Diamètre (mm)', 'diametre', { inputmode: 'decimal' })),
      el('div', { class: 'inv-2col' }, champ('Type', 'type', { placeholder: 'Semi-stat, A…' }), champ('Fabricant', 'fabricant')),
      el('div', { class: 'inv-2col' }, champ('Modèle', 'modele'), champ('N° de série', 'serie')),
      champ('N° TEXIS / TECHSYS', 'texis'),
      el('div', { class: 'inv-2col' }, champ('Fabrication', 'fabrication', { type: 'month' }), champ('Mise en service', 'service', { type: 'month' })),
      champ('Caserne', 'caserne'),
      el('label', null, 'Commentaire', el('textarea', { rows: '3', maxlength: '1000', oninput: e => { c.commentaire = e.target.value; } }, c.commentaire || '')),
      el('p', { class: 'error', role: 'alert', text: c.err }),
      el('button', { type: 'button', icon: 'save', class: 'primary inv-submit', disabled: S.busy, text: 'Enregistrer', onclick: saveCorde }),
    ];
  }

  async function saveCorde() {
    const c = S.cEdit;
    S.busy = true; render();
    try {
      const corde = Object.assign({}, c, { fabrication: c.fabrication ? c.fabrication + '-01' : '', service: c.service ? c.service + '-01' : '' });
      delete corde.err; delete corde.hist; delete corde.cpt;
      const res = await app().api('inv_corde_save', { token: app().token(), corde });
      setData(res);
      const n = cordes().find(x => x.famille === c.famille && x.num === Number(c.num));
      go(n ? 'corde' : 'liste', { corde: n ? n.id : null, cEdit: null, msg: 'Fiche enregistrée.' });
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      c.err = err instanceof app().NetworkError ? app().netLabel() + ' : modification impossible hors ligne.' : err.message;
    } finally { S.busy = false; render(); }
  }

  // ---------- file d'attente (saisies hors ligne) ----------
  const outbox = () => store.getJSON(KEY_OUTBOX) || [];
  const setOutbox = list => store.set(KEY_OUTBOX, JSON.stringify(list));
  const attente = cid => outbox().some(e => e.kind === 'inv' && e.payload.contenant === cid);
  let flushing = false;

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
          await envoyerUn(e);
          setOutbox(outbox().filter(x => x.sid !== e.sid));
          sent++;
        } catch (err) {
          if (app().AUTH_ERRORS.includes(err.message)) { app().logout(); return; }
          if (err instanceof app().NetworkError) break;
          setOutbox(outbox().map(x => (x.sid === e.sid ? Object.assign(x, { erreur: err.message }) : x)));
        }
      }
    } finally {
      flushing = false;
      if (sent) S.msg = `${sent} saisie${sent > 1 ? 's' : ''} en attente envoyée${sent > 1 ? 's' : ''}.`;
      renderPending();
      if (sent) render();
    }
  }

  function renderPending() {
    const list = outbox();
    if (window.SMPM_PENDING_DOT) window.SMPM_PENDING_DOT('inv', list.length);
    const dot = $('#inv-nav-dot');
    if (dot) dot.hidden = !list.length;
    const box = $('#inv-outbox');
    if (!box) return;
    if (!list.length) { box.replaceChildren(); return; }
    const offline = !navigator.onLine;
    box.replaceChildren(el('div', { class: 'outbox', role: 'status' },
      el('div', { class: 'outbox-head' },
        el('strong', { text: `${list.length} saisie${list.length > 1 ? 's' : ''} en attente d’envoi` }),
        list.some(e => !e.erreur) ? el('button', { type: 'button', class: 'pill', disabled: offline || flushing,
          text: flushing ? 'Envoi…' : offline ? 'En attente du réseau' : 'Envoyer maintenant', onclick: () => flush() }) : null),
      el('ul', { class: 'outbox-list' }, list.map(e => {
        const li = el('li', { class: e.erreur ? 'is-error' : '' },
          el('span', { text: (e.kind === 'inv' ? 'Inventaire · ' : '') + e.label }),
          el('small', { text: e.erreur ? `Refusé : ${e.erreur}` : `saisi le ${new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` }));
        if (e.erreur) li.append(el('div', { class: 'outbox-actions' },
          el('button', { type: 'button', class: 'link', text: 'Réessayer', onclick: () => { setOutbox(outbox().map(x => (x.sid === e.sid ? Object.assign(x, { erreur: '' }) : x))); flush(); } }),
          el('button', { type: 'button', class: 'link danger', text: 'Supprimer', onclick: () => { if (confirm('Supprimer définitivement cette saisie non envoyée ?')) { setOutbox(outbox().filter(x => x.sid !== e.sid)); renderPending(); render(); } } })));
        return li;
      })),
      offline ? el('p', { class: 'small', text: 'Envoi automatique dès le retour du réseau.' }) : null));
  }

  // Données gardées sur l'appareil pour une utilisation hors ligne (au démarrage, si en ligne)
  async function prefetch() {
    if (S.fresh || S.loading || !navigator.onLine) return;
    await load();
  }

  async function refresh() { S.fresh = false; await load(); }

  // explicit : déconnexion volontaire (tout est effacé) ; sinon les saisies en attente d'envoi sont gardées
  function reset(explicit) {
    if (explicit === true) store.del(KEY_OUTBOX);
    store.del(KEY);
    store.del(KEY_PREFS);
    try { caches.delete(PHOTO_CACHE); } catch (e) {}
    Object.assign(S, { data: null, fresh: false, loading: false, err: '', p: P0(), vue: 'liste', cid: null, q: '', saisie: null, edit: null, histo: null, corde: null, usage: null, cEdit: null, qr: null, listing: null, msg: '' });
    const root = $('#inv-root');
    if (root) root.replaceChildren();
    renderPending();
  }

  window.addEventListener('online', () => { renderPending(); flush(); });
  window.addEventListener('offline', renderPending);

  window.SMPM_INV = {
    open, flush, prefetch, refresh, reset, renderPending,
    pending: () => outbox().length,
    // saisie en cours : pas de rechargement automatique de l'application (nouvelle version)
    busy: () => !$('#tab-inventaire').hidden && ['saisie', 'edit', 'usage', 'cedit'].includes(S.vue),
  };
})();
