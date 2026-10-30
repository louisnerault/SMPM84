// Inventaire du matériel (rubrique « Inventaire », actions inv_* : back-end Inventaire.gs, dépôt privé).
// Deux onglets :
//  - Contenants : véhicules (VSMPM Avignon, VSM Apt, VSM Dentelles…) → contenants (caisses, lots…) → articles
//    avec leur quantité théorique. Inventaire pré-rempli avec les quantités théoriques : on ne corrige que
//    les écarts. Historique par contenant. Recherche d'un article dans tous les véhicules.
//  - Cordes : fiches, compteurs d'utilisation et de contrôle, derniers contrôles, déclaration d'utilisation.
// Tous les membres font des inventaires et déclarent des utilisations de cordes ; chefs de section, contrôleurs EPI,
// CTD et administrateurs modifient le contenu théorique et les fiches des cordes (app.js : canInvGerer).
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
  const STATUTS = { en_service: 'En service', a_surveiller: 'À surveiller', inactive: 'Numéro libre' };
  const UTIL = { OPS: 'OPS', FMPA: 'FMPA', INVENTAIRE: 'Inventaire' };
  const CTL = { VISUEL: 'Visuel', TACTILE: 'Tactile', NETTOYAGE: 'Nettoyage à l’eau' };
  const SECT = { NORD: 'Nord', CENTRE: 'Centre', SUD: 'Sud' };
  const CONTEXTES = { simple: 'Inventaire simple', fmpa_debut: 'FMPA – début', fmpa_fin: 'FMPA – fin de journée', intervention: 'Après intervention' };
  const QUI = {
    simple: 'En cas d’écart, le chef de section et le contrôleur EPI du secteur du véhicule sont avertis.',
    fmpa_debut: 'À faire avant le début de la manœuvre. Un écart avec le contenu théorique est signalé au chef de section et au contrôleur EPI.',
    fmpa_fin: 'À faire en fin de journée. Le matériel manquant par rapport à l’inventaire du matin est signalé au chef d’unité responsable de la FMPA.',
    intervention: 'Le matériel manquant par rapport au dernier inventaire est signalé au chef d’unité de l’intervention.',
  };
  const STATUT_AL = { cu: 'Recherches en cours', cs: 'Chef de section', close: 'Close' };

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
    copy: 'M8 8h11v11H8zM5 15H4.5V4.5H15V5',
    alert: 'M12 3.5l9 16H3zM12 10v4.5M12 17.5h.01',
    back: 'M15 5l-7 7 7 7',
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
      familles: res.familles || [], droits: res.droits || {}, maj: res.maj || new Date().toISOString(),
      alertes: res.alertes || [], cus: res.cus || [], moi: res.moi || '', contextes: res.contextes || CONTEXTES };
    if (!S.p.veh || !vehicules().some(v => v.code === S.p.veh)) S.p.veh = (vehicules()[0] || {}).code || '';
    save();
  }

  function renderState() {
    const p = $('#inv-state');
    if (!p) return;
    p.textContent = S.loading && !S.data ? 'Chargement de l’inventaire…' : (S.err || S.msg || (S.loading ? 'Mise à jour…' : ''));
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
      corde: vCorde, usage: vUsage, cedit: vCordeEdit, qr: vQr, listing: vListing, activer: vActiver };
    const nodes = [].concat((vues[S.vue] || vListe)()).flat(Infinity).filter(x => x !== null && x !== undefined && x !== false);
    // page longue : même bouton de retour en bas (copie du bouton du haut)
    const haut = nodes[0] && nodes[0].classList && nodes[0].classList.contains('inv-back-bar') ? nodes[0] : null;
    if (haut && S.vue !== 'saisie') {
      const bas = haut.cloneNode(true);
      bas.classList.add('is-bottom');
      bas.querySelector('button').addEventListener('click', () => haut.querySelector('button').click());
      nodes.push(bas);
    }
    root.replaceChildren(...nodes);
    if (root.querySelector('[data-echeance]')) demarrerComptes();
  }

  // Retour à la rubrique précédente : bouton bien visible en haut, répété en bas des pages longues
  const retour = (text, onclick) => el('div', { class: 'inv-back-bar' },
    el('button', { type: 'button', class: 'inv-back', onclick, 'aria-label': 'Retour : ' + text },
      ico('back'), el('span', { class: 'inv-back-lbl' }, el('small', { text: 'Retour' }), el('span', { text })))); 

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
  const alertes = () => (S.data && S.data.alertes) || [];
  const aTraiter = () => alertes().filter(x => x.peut && x.peut.length);
  function vListe() {
    const onglets = ['contenants', 'cordes'].concat(alertes().length ? ['alertes'] : []);
    if (!onglets.includes(S.p.onglet)) S.p.onglet = 'contenants';
    const n = aTraiter().length;
    const tabs = el('div', { class: 'inv-tabs', role: 'tablist', style: `grid-template-columns: repeat(${onglets.length}, 1fr)` },
      onglets.map(o => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.p.onglet === o), onclick: () => { S.p.onglet = o; savePrefs(); render(); } },
        o === 'contenants' ? 'Contenants' : o === 'cordes' ? 'Cordes' : 'Alertes',
        o === 'alertes' && n ? el('span', { class: 'inv-count', text: String(n) }) : null)));
    const bandeau = n && S.p.onglet !== 'alertes' ? el('button', { type: 'button', class: 'inv-alert-bar', onclick: () => { S.p.onglet = 'alertes'; savePrefs(); render(); } },
      ico('alert'), `${n} alerte${n > 1 ? 's' : ''} à traiter`) : null;
    return [tabs, bandeau].concat(S.p.onglet === 'cordes' ? vCordes() : S.p.onglet === 'alertes' ? vAlertes() : vContenants());
  }

  // ===== Alertes (non-conformités d'inventaire, cordes à examiner) =====
  function vAlertes() {
    const liste = alertes();
    const ouvertes = liste.filter(x => x.statut !== 'close'), closes = liste.filter(x => x.statut === 'close');
    const carte = x => el('li', null, carteAlerte(x));
    return [
      el('p', { class: 'muted small', text: 'Inventaires non conformes et cordes à examiner. Le chef d’unité recherche le matériel manquant après une FMPA ou une intervention ; s’il n’est pas retrouvé, l’alerte passe au chef de section, au contrôleur EPI du secteur, au CTD et aux administrateurs.' }),
      ouvertes.length ? el('ul', { class: 'inv-list' }, ouvertes.map(carte)) : el('p', { class: 'muted center', text: 'Aucune alerte en cours.' }),
      closes.length ? el('details', { class: 'inv-closes' }, el('summary', { text: `Alertes closes (30 derniers jours) : ${closes.length}` }), el('ul', { class: 'inv-list' }, closes.map(carte))) : null,
    ];
  }


  // ----- carte d'alerte en étapes : 1 signalement (quoi, où, quand, qui) · 2 recherches du CU (compte à rebours)
  //       · 3 chef de section, contrôleur EPI et CTD -----
  const nomDe = cle => ((((S.data && S.data.cus) || []).find(p => p.cle === cle) || {}).aff) || cle;
  const dateCourte = iso => (iso ? new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  function reste(ms) {
    if (ms <= 0) return 'délai dépassé';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), j = Math.floor(h / 24);
    if (j >= 1) return `${j} j ${h % 24} h`;
    if (h >= 1) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
    return `${m} min`;
  }
  // compte à rebours : mis à jour toutes les 30 s tant qu'une alerte en attente du CU est affichée
  let minuteur = null;
  function majComptes() {
    const els = document.querySelectorAll('[data-echeance]');
    if (!els.length) { clearInterval(minuteur); minuteur = null; return; }
    els.forEach(e => {
      const fin = new Date(e.dataset.echeance).getTime(), deb = new Date(e.dataset.debut).getTime();
      const ms = fin - Date.now();
      const t = e.querySelector('.inv-cd-txt'), b = e.querySelector('.inv-cd-fill');
      if (t) t.textContent = ms > 0 ? `Il reste ${reste(ms)}` : 'Délai dépassé : transmission au chef de section, au contrôleur EPI et au CTD en cours';
      if (b) b.style.width = Math.min(100, Math.max(0, 100 * (Date.now() - deb) / Math.max(1, fin - deb))) + '%';
      e.classList.toggle('is-urgent', ms > 0 && ms < 6 * 3600e3);
      e.classList.toggle('is-over', ms <= 0);
    });
  }
  function demarrerComptes() { majComptes(); if (!minuteur) minuteur = setInterval(majComptes, 30000); }

  function etape(n, etat, titre, ...contenu) {
    return el('li', { class: 'inv-step-li is-' + etat },
      el('span', { class: 'inv-step-num', 'aria-hidden': 'true', text: etat === 'fait' ? '✓' : etat === 'saute' ? '–' : String(n) }),
      el('div', { class: 'inv-step-body' }, el('strong', { class: 'inv-step-titre', text: titre }), contenu));
  }
  const ligne = (k, v) => (v ? el('div', { class: 'inv-qq' }, el('span', { class: 'inv-qq-k', text: k }), el('span', { class: 'inv-qq-v' }, v)) : null);

  function carteAlerte(x) {
    const e = x.etapes || {};
    const avecCu = x.type === 'inventaire' && (x.contexte === 'fmpa_fin' || x.contexte === 'intervention');
    const occasion = x.type === 'corde' ? 'Utilisation de cordes' : (CONTEXTES[x.contexte] || '') + (x.type === 'remarque' ? ' · remarque' : '');
    const quoi = x.type === 'inventaire' ? 'Matériel manquant' : x.type === 'remarque' ? 'Remarque' : 'Corde à examiner';
    const cs = (x.cs || []).map(nomDe), ctd = (x.ctd || []).map(nomDe), epi = (x.epi || []).map(nomDe);
    const sect = SECT[x.secteur] || x.secteur || '';
    const lEpi = epi.length ? `Contrôleur${epi.length > 1 ? 's' : ''} EPI ${sect} : ${epi.join(', ')}` : '';
    const dest = [cs.length ? `Chef de section ${sect} : ${cs.join(', ')}` : '', lEpi, ctd.length ? `CTD : ${ctd.join(', ')}` : ''].filter(Boolean).join(' · ') || 'CTD';
    const destCs = [cs.length ? cs.join(', ') : '', lEpi].filter(Boolean).join(' · ') || dest;
    const bouton = (act, icon, cls, txt) => (x.peut.includes(act) ? el('button', { type: 'button', icon, class: cls, text: txt, disabled: S.busy, onclick: () => agir(x, act) }) : null);
    const etapes = [];
    // 1. Signalement
    etapes.push(etape(1, 'fait', 'Signalement',
      el('div', { class: 'inv-qq-grid' },
        ligne('Quoi', el('pre', { class: 'inv-anom', text: x.detail })),
        ligne('Où', x.libelle + (x.secteur ? ` · secteur ${SECT[x.secteur] || x.secteur}` : '')),
        ligne('Quand', `${dateCourte(x.date)} · ${occasion}`),
        ligne('Qui', [e.par ? `Inventaire : ${e.par}` : '', x.cu ? `Chef d’unité : ${nomDe(x.cu)}` : ''].filter(Boolean).join(' · ')))));
    if (avecCu) {
      // 2. Recherches du CU
      if (x.statut === 'cu') {
        etapes.push(etape(2, 'encours', `Recherches · ${nomDe(x.cu)}`,
          el('p', { class: 'small', text: 'Rechercher le matériel (véhicule, lieux de la manœuvre ou de l’intervention, autres équipes), puis indiquer le résultat.' }),
          x.echeance ? el('div', { class: 'inv-cd', 'data-echeance': x.echeance, 'data-debut': x.date },
            el('div', { class: 'inv-cd-track' }, el('div', { class: 'inv-cd-fill' })),
            el('p', { class: 'inv-cd-txt' }),
            el('p', { class: 'small muted', text: `Échéance : ${dateCourte(x.echeance)}` })) : null,
          el('div', { class: 'inv-actions' }, bouton('retrouve', 'save', 'primary', 'Retrouvé'), bouton('non_retrouve', 'alert', 'pill danger-pill', 'Non retrouvé'))));
      } else if (e.cu) {
        const r = e.cu.action === 'retrouve' ? `Retrouvé par ${e.cu.par}` : e.cu.action === 'non_retrouve' ? `Non retrouvé (${e.cu.par})` : 'Pas de réponse dans le délai';
        etapes.push(etape(2, e.cu.action === 'retrouve' ? 'fait' : 'ko', `Recherches · ${nomDe(x.cu)}`,
          el('p', { class: 'small', text: `${r} · ${dateCourte(e.cu.le)}${e.cu.txt ? ' — « ' + e.cu.txt + ' »' : ''}` })));
      } else {
        etapes.push(etape(2, 'fait', `Recherches · ${nomDe(x.cu)}`, el('p', { class: 'small', text: e.cloture ? `Clos : ${e.cloture.txt || ''} (${e.cloture.par}, ${dateCourte(e.cloture.le)})` : 'Clos' })));
      }
    }
    // dernière étape : chef de section, contrôleur EPI et CTD
    const n = avecCu ? 3 : 2;
    const titreCs = avecCu ? 'Notification · chef de section, contrôleur EPI et CTD' : 'Chef de section et contrôleur EPI';
    if (x.statut === 'cu') {
      etapes.push(etape(n, 'attente', titreCs, el('p', { class: 'small muted', text: `Prévenus seulement si le matériel n’est pas retrouvé ou sans réponse à l’échéance : ${dest}.` })));
    } else if (x.statut === 'cs' && x.type === 'corde') {
      etapes.push(etape(n, 'encours', titreCs,
        el('p', { class: 'small', text: `Notifiés : ${destCs}. Pour chaque corde : lever la surveillance, la laisser sous surveillance ou la réformer. L’alerte se clôt quand toutes les cordes sont traitées.` }),
        el('ul', { class: 'inv-traiter' }, x.objet.split(',').map(id => {
          const c = cordes().find(o => o.id === id);
          const num = id.split('-').pop();
          const fait = (x.traitees || {})[num];
          return el('li', null,
            el('button', { type: 'button', class: 'link', text: `Corde n° ${num}`, onclick: () => go('corde', { corde: id }), disabled: !c }),
            fait ? el('span', { class: 'small', text: ' ✓ ' + fait })
              : c && c.statut !== 'inactive' && droits().gerer && x.peut.includes('clore') ? boutonsDecision(c)
                : el('span', { class: 'small muted', text: ' à traiter' }));
        }))));
    } else if (x.statut === 'cs') {
      etapes.push(etape(n, 'encours', titreCs,
        el('p', { class: 'small', text: `Notifiés : ${avecCu ? dest : destCs}. Décision et clôture de l’alerte.` }),
        el('div', { class: 'inv-actions' }, bouton('clore', 'save', 'primary', 'Clore l’alerte'))));
    } else if (avecCu && e.cu && e.cu.action === 'retrouve') {
      etapes.push(etape(n, 'saute', titreCs, el('p', { class: 'small muted', text: 'Non nécessaire : matériel retrouvé.' })));
    } else {
      etapes.push(etape(n, 'fait', titreCs, el('p', { class: 'small', text: e.cloture ? `Clos par ${e.cloture.par} · ${dateCourte(e.cloture.le)}${e.cloture.txt ? ' — « ' + e.cloture.txt + ' »' : ''}` : 'Clos' })));
    }
    return el('div', { class: 'inv-card inv-alerte inv-al-' + x.statut },
      el('span', { class: 'inv-card-head' }, el('strong', { icon: 'alert', text: quoi }), el('span', { class: 'inv-badge', text: STATUT_AL[x.statut] || x.statut })),
      el('ol', { class: 'inv-steps' }, etapes),
      x.suivi ? el('details', { class: 'small' }, el('summary', { text: 'Historique détaillé' }), el('pre', { class: 'inv-suivi', text: x.suivi })) : null);
  }

  async function agir(x, action) {
    const q = { retrouve: 'Matériel retrouvé : précisez où (facultatif)', non_retrouve: 'Matériel non retrouvé : précisez les recherches faites (facultatif). L’alerte sera transmise au chef de section, au contrôleur EPI, au CTD et aux administrateurs.', clore: 'Clore l’alerte : décision prise (facultatif)' }[action];
    const commentaire = prompt(q, '');
    if (commentaire === null) return;
    S.busy = true; render();
    try {
      setData(await app().api('inv_alerte_action', { token: app().token(), id: x.id, decision: action, commentaire }));
      S.msg = action === 'non_retrouve' ? 'Alerte transmise au chef de section, au contrôleur EPI, au CTD et aux administrateurs.' : 'Alerte close.';
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      S.msg = err instanceof app().NetworkError ? app().netLabel() + ' : action impossible hors ligne.' : err.message;
    } finally { S.busy = false; render(); }
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
      retour(`${vehLib(c.vehicule)} · contenants`, () => go('liste')),
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

  // ===== QR codes à coller sur les contenants (chefs de section, contrôleurs EPI, CTD, administrateurs) =====
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
  // photo gardée sur l'appareil par identifiant de fichier : un motif commun à plusieurs cordes n'est chargé qu'une fois
  const photoReq = a => new Request(`inv-photo/${encodeURIComponent(a.ph)}`);
  const enCours = {};
  function photoUrl(a) {
    if (!enCours[a.ph]) enCours[a.ph] = chargerPhoto(a).catch(err => { delete enCours[a.ph]; throw err; });
    return enCours[a.ph];
  }
  async function chargerPhoto(a) {
    let cache = null;
    try { cache = await caches.open(PHOTO_CACHE); } catch (e) { cache = null; }
    if (cache) { const hit = await cache.match(photoReq(a)); if (hit) return URL.createObjectURL(await hit.blob()); }
    const res = a.corde
      ? await app().api('inv_corde_photo', { token: app().token(), corde: a.corde })
      : await app().api('inv_photo', { token: app().token(), article: a.id });
    const bin = atob(res.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: res.mime || 'image/jpeg' });
    if (cache) {
      try {
        await cache.put(photoReq(a), new Response(blob, { headers: { 'Content-Type': blob.type } }));
      } catch (e) {}
    }
    return URL.createObjectURL(blob);
  }
  // Vignette cliquable (agrandie en plein écran) ; chargée à l'affichage
  function vignette(a, passif) {
    if (!a.ph) return null;
    const img = el('img', { alt: '', class: 'inv-thumb-img' });
    // passif : dans une carte déjà cliquable (liste des cordes), simple image
    const b = passif ? el('span', { class: 'inv-thumb' }, img)
      : el('button', { type: 'button', class: 'inv-thumb', 'aria-label': `Photo : ${a.nom}`, onclick: ev => { ev.stopPropagation(); agrandir(a, img.src); } }, img);
    photoUrl(a).then(u => { img.src = u; }).catch(() => { b.classList.add('is-off'); b.title = 'Photo indisponible hors ligne'; });
    return b;
  }
  const photoCorde = c => (c.ph ? { ph: c.ph, corde: c.id, nom: `Corde n° ${c.num}`, detail: c.motif || '' } : null);
  function grandePhoto(a) {
    if (!a) return null;
    const img = el('img', { alt: a.nom, class: 'inv-photo-grande' });
    const b = el('button', { type: 'button', class: 'inv-photo-box', 'aria-label': `Agrandir : ${a.nom}`, onclick: () => agrandir(a, img.src) }, img);
    photoUrl(a).then(u => { img.src = u; }).catch(() => { b.replaceChildren(el('p', { class: 'muted small', text: 'Photo indisponible (hors ligne ou fichier inaccessible).' })); });
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
    const moi = (S.data && S.data.moi) || '';
    const cu = ((S.data && S.data.cus) || []).some(p => p.cle === moi) ? moi : '';
    go('saisie', { saisie: { cid: c.id, lignes, remarque: '', sid: sid(), err: '', ctx: 'simple', cu } });
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
          ? el('input', { type: 'text', class: 'inv-rq', maxlength: '300', placeholder: 'Remarque (usure, état…) — inutile d’écrire « RAS »', value: l.rq, oninput: e => { l.rq = e.target.value; } })
          : el('button', { type: 'button', icon: 'note', class: 'link small inv-note', text: 'remarque', onclick: () => { l.note = true; render(); } }),
      ].filter(Boolean));
      return li;
    });
    return [
      retour(c.nom, () => { if (!confirm('Abandonner cet inventaire ?')) return; go('contenant', { cid: c.id, saisie: null }); }),
      el('h2', { class: 'inv-title', text: `Inventaire · ${c.nom}` }),
      el('p', { class: 'muted small', text: `${vehLib(c.vehicule)} · quantités pré-remplies avec le contenu théorique : corrigez seulement ce qui manque ou est en trop.` }),
      el('div', { class: 'inv-ctx' },
        el('h3', { class: 'inv-sub', text: 'Occasion' }),
        el('div', { class: 'inv-chips', role: 'group', 'aria-label': 'Occasion de l’inventaire' },
          Object.keys(CONTEXTES).map(k => pill(CONTEXTES[k], s.ctx === k, () => { s.ctx = k; s.err = ''; render(); }))),
        s.ctx !== 'simple' ? el('label', null, s.ctx === 'intervention' ? 'Chef d’unité de l’intervention' : 'Chef d’unité responsable de la FMPA',
          el('select', { onchange: e => { s.cu = e.target.value; } },
            el('option', { value: '' }, '— choisir —'),
            ((S.data && S.data.cus) || []).map(p => el('option', { value: p.cle, selected: p.cle === s.cu }, p.aff)))) : null,
        el('p', { class: 'muted small', text: QUI[s.ctx] })),
      el('ul', { class: 'inv-rows' }, rows),
      el('label', null, 'Remarque générale (facultatif)',
        el('textarea', { rows: '2', maxlength: '1000', placeholder: 'Ex. : sac déchiré, marque d’usure…', oninput: e => { s.remarque = e.target.value; } }, s.remarque)),
      el('p', { class: 'muted small', text: 'Inutile d’écrire « RAS » ou « OK » : sans remarque, rien n’est signalé. Toute autre remarque (usure, détérioration…) est transmise au chef de section et au contrôleur EPI, même si l’inventaire est conforme.' }),
      el('p', { class: 'error', role: 'alert', text: s.err }),
      el('button', { type: 'button', icon: 'save', class: 'primary inv-submit', id: 'inv-valider', disabled: S.busy,
        text: ecarts ? `Valider l’inventaire (${ecarts} écart${ecarts > 1 ? 's' : ''})` : 'Valider : tout est conforme', onclick: submitSaisie }),
    ];
  }

  async function submitSaisie() {
    const s = S.saisie, c = contenant(s.cid);
    if (!c || S.busy) return;
    if (c.articles.some(a => s.lignes[a.id].r === '')) { s.err = 'Indiquez une quantité pour chaque article (0 si absent).'; return render(); }
    if (s.ctx !== 'simple' && !s.cu) { s.err = 'Choisissez le chef d’unité.'; return render(); }
    const inventaire = {
      contenant: c.id, remarque: s.remarque.trim(), saisi_le: new Date().toISOString(),
      contexte: { type: s.ctx, cu: s.ctx === 'simple' ? '' : s.cu },
      lignes: c.articles.map(a => ({ a: a.id, r: Number(s.lignes[a.id].r), u: s.lignes[a.id].u, rq: s.lignes[a.id].rq.trim() })),
    };
    const entry = { sid: s.sid, kind: 'inv', payload: inventaire, label: `${c.nom} · ${vehLib(c.vehicule)} · ${CONTEXTES[s.ctx]}`, ts: Date.now(), erreur: '' };
    S.busy = true; render();
    try {
      const ok = await envoyer(entry);
      S.saisie = null;
      go('contenant', { cid: c.id, msg: ok ? 'Inventaire enregistré. Merci !' + (dernierAvis ? ` Écart signalé : ${dernierAvis}.` : '') : 'Pas de réseau : inventaire gardé sur l’appareil, envoi automatique au retour du réseau.' });
      dernierAvis = '';
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

  let dernierAvis = '';
  async function envoyerUn(e) {
    if (e.kind === 'inv') {
      const res = await app().api('inv_submit', { token: app().token(), inventaire: e.payload, submission_id: e.sid });
      dernierAvis = res.alerte || '';
      if (res.alerte || (S.data && S.data.alertes && S.data.alertes.length)) { S.fresh = false; setTimeout(load, 0); }   // alertes à jour
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

  // ===== Modifier le contenu d'un contenant (chefs de section, contrôleurs EPI, CTD, administrateurs) =====
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
      e.id ? vPropager(e) : null,
      el('p', { class: 'error', role: 'alert', text: e.err || '' }),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'save', class: 'primary', text: 'Enregistrer', disabled: S.busy, onclick: () => saveEdit(false) }),
        e.id ? el('button', { type: 'button', icon: 'trash', class: 'link danger', text: 'Supprimer ce contenant', disabled: S.busy, onclick: () => saveEdit(true) }) : null),
    ];
  }

  // Contenants similaires (même nom dans les autres véhicules, ex. LOT B1) : les ajouts, modifications et retraits
  // de cette édition y sont reportés si on les coche. On peut aussi en ajouter un autre (nom différent).
  const cleNom = t => fold(t).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  function vPropager(e) {
    if (!e.prop) {
      const k = cleNom(e.nom);
      e.prop = contenants().filter(c => c.id !== e.id && cleNom(c.nom) === k).map(c => ({ id: c.id, on: false }));
    }
    const autres = contenants().filter(c => c.id !== e.id && !e.prop.some(p => p.id === c.id));
    return el('div', { class: 'inv-prop' },
      el('h3', { class: 'inv-sub', icon: 'copy' }, 'Reporter aussi les changements dans'),
      el('p', { class: 'muted small', text: 'Ajouts, retraits, changements de nom, de quantité ou de suivi : appliqués aux contenants cochés, en retrouvant les articles par leur nom. Le détail / n° de série reste propre à chaque contenant.' }),
      e.prop.length ? el('div', { class: 'inv-prop-list' }, e.prop.map(p => {
        const c = contenant(p.id);
        return c ? el('label', { class: 'ann-check' }, el('input', { type: 'checkbox', checked: p.on, onchange: ev => { p.on = ev.target.checked; } }), `${c.nom} · ${vehLib(c.vehicule)}`) : null;
      })) : el('p', { class: 'muted small', text: 'Aucun contenant du même nom dans les autres véhicules.' }),
      autres.length ? el('select', { class: 'inv-prop-add', 'aria-label': 'Ajouter un autre contenant', onchange: ev => { if (ev.target.value) { e.prop.push({ id: ev.target.value, on: true }); render(); } } },
        el('option', { value: '' }, '＋ Autre contenant…'),
        vehicules().map(v => el('optgroup', { label: v.libelle }, autres.filter(c => c.vehicule === v.code).map(c => el('option', { value: c.id }, c.nom))))) : null);
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
        propager: supprimer ? [] : (e.prop || []).filter(p => p.on).map(p => p.id),
      } });
      setData(res);
      if (supprimer) go('liste', { edit: null, msg: 'Contenant supprimé.' });
      else {
        const c = contenants().find(x => x.vehicule === e.vehicule && x.nom.toUpperCase() === e.nom.trim().toUpperCase());
        S.p.veh = e.vehicule; savePrefs();
        const dep = res.deplaces || [], pro = res.propages || [];
        const abs = pro.filter(p => p.absents.length).map(p => `${p.nom} (${vehLib(p.vehicule)}) : ${p.absents.join(', ')}`);
        go(c ? 'contenant' : 'liste', { cid: c ? c.id : null, edit: null,
          msg: 'Contenu enregistré.' + (dep.length ? ` Déplacé${dep.length > 1 ? 's' : ''} : ${dep.join(', ')}.` : '')
            + (pro.length ? ` Reporté dans ${pro.map(p => `${p.nom} (${vehLib(p.vehicule)})`).join(', ')}.` : '')
            + (abs.length ? ` Introuvable${abs.length > 1 ? 's' : ''}, à vérifier : ${abs.join(' ; ')}.` : '') });
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
      && (S.p.statut === 'toutes' || (S.p.statut === 'actives' ? c.statut !== 'inactive' : c.statut === S.p.statut)));
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
          [['actives', 'En service et à surveiller'], ['a_surveiller', 'À surveiller'], ['inactive', 'Numéros libres'], ['toutes', 'Tous les numéros']]
            .map(([v, t]) => el('option', { value: v, selected: S.p.statut === v }, t))),
        el('span', { class: 'small', text: `${liste.length} corde${liste.length > 1 ? 's' : ''}` })),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', icon: 'rope', class: 'primary', text: 'Déclarer une utilisation', disabled: !cordes().some(c => c.famille === S.p.famille && c.statut !== 'inactive'),
          onclick: () => go('usage', { usage: { famille: S.p.famille, type: 'FMPA', nums: [], ctl: ['VISUEL'], rq: {}, ref: [], sid: sid(), err: '' } }) }),
        droits().gerer && cordes().some(c => c.famille === S.p.famille && c.statut === 'inactive')
          ? el('button', { type: 'button', icon: 'plus', class: 'pill', text: 'Mettre en service une corde', onclick: () => go('activer', { activer: { famille: S.p.famille } }) }) : null),
      el('ul', { class: 'inv-list' }, liste.map(c => el('li', null,
        el('button', { type: 'button', class: 'inv-card inv-corde inv-st-' + c.statut + (c.anomalie && c.statut !== 'inactive' ? ' inv-anomalie' : ''), onclick: () => go('corde', { corde: c.id }) },
          el('span', { class: 'inv-card-head' },
            el('span', { class: 'inv-corde-titre' },
              c.anomalie && c.statut !== 'inactive' ? el('span', { class: 'inv-excl', 'aria-label': 'Anomalie', title: c.anomalie, text: '!' }) : null,
              c.statut === 'inactive' ? null : vignette(photoCorde(c) || {}, true),
              el('strong', { text: `N° ${c.num}` + (c.secteur ? ` · ${SECT[c.secteur] || c.secteur}` : '') })),
            el('span', { class: 'inv-badge', text: STATUTS[c.statut] })),
          c.anomalie && c.statut !== 'inactive' && c.anomalie !== 'À surveiller' ? el('span', { class: 'small inv-anom-txt', text: 'Anomalie : ' + c.anomalie }) : null,
          c.statut === 'inactive' ? el('span', { class: 'small muted', text: 'Numéro disponible pour une nouvelle corde' })
            : el('span', { class: 'small', text: [c.longueur ? c.longueur + ' m' : '', c.diametre ? c.diametre + ' mm' : '', c.fabricant, c.modele].filter(Boolean).join(' · ') || 'Fiche à compléter' }),
          c.statut === 'inactive' ? null : el('span', { class: 'small muted', text: `FMPA ${c.cpt.FMPA || 0} · OPS ${c.cpt.OPS || 0}` + (c.dernier ? ` · dernier contrôle ${quand(c.dernier)}` : ' · aucun contrôle enregistré') }))))),
      !liste.length ? el('p', { class: 'muted center', text: 'Aucune corde pour ces critères.' }) : null,
    ];
    return out;
  }

  function vCorde() {
    const c = cordes().find(x => x.id === S.corde);
    if (!c) return vListe();
    const fam = familles().find(f => f.code === c.famille) || { libelle: c.famille };
    const aTraiter = c.statut === 'a_surveiller' || !!c.anomalie;
    const info = [['Secteur', SECT[c.secteur] || c.secteur], ['Longueur', c.longueur && c.longueur + ' m'], ['Diamètre', c.diametre && c.diametre + ' mm'],
      ['Type', c.type], ['Fabricant', c.fabricant], ['Modèle', c.modele], ['N° de série', c.serie], ['N° TEXIS / TECHSYS', c.texis],
      ['Fabrication', moisAn(c.fabrication)], ['Mise en service', moisAn(c.service)], ['Caserne', c.caserne]].filter(x => x[1]);
    const archivesListe = () => ((c.archives || []).length ? [el('h3', { class: 'inv-sub', text: 'Cordes précédentes sur ce numéro' }),
      el('ul', { class: 'inv-arts' }, c.archives.slice().reverse().map(x => el('li', null,
        el('span', { class: 'inv-art-nom' }, el('strong', { text: `Réformée le ${new Date(x.d).toLocaleDateString('fr-FR')}` }),
          ` · ${x.par}${x.desc ? ' · ' + x.desc : ''}${x.raison ? ' — ' + x.raison : ''}`),
        x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener', class: 'pill has-ico' }, ico('print'), 'Fiche PDF') : null)))] : []);
    // numéro libre : pas d'informations de l'ancienne corde (elles sont dans sa fiche PDF)
    if (c.statut === 'inactive') return [
      retour('Liste des cordes', () => go('liste')),
      el('h2', { class: 'inv-title', text: `N° ${c.num} · numéro libre` }),
      el('p', { class: 'muted small', text: `${fam.libelle}${c.secteur ? ' · secteur ' + (SECT[c.secteur] || c.secteur) : ''}` }),
      el('p', { class: 'inv-banner inv-st-inactive', text: 'Aucune corde en service sur ce numéro.' }),
      archivesListe(),
      droits().gerer ? el('div', { class: 'inv-actions' }, el('button', { type: 'button', icon: 'plus', class: 'primary', text: 'Mettre en service une nouvelle corde sur ce numéro', onclick: () => editCorde(c, true) })) : null,
    ];
    return [
      retour('Liste des cordes', () => go('liste')),
      el('h2', { class: 'inv-title', text: `Corde n° ${c.num}` }),
      el('p', { class: 'muted small', text: fam.libelle }),
      el('p', { class: 'inv-banner inv-st-' + c.statut + (c.anomalie && c.statut !== 'inactive' ? ' inv-anomalie' : '') },
        c.anomalie && c.statut !== 'inactive' ? el('span', { class: 'inv-excl', 'aria-hidden': 'true', text: '!' }) : null,
        STATUTS[c.statut] + (c.anomalie && c.anomalie !== 'À surveiller' && c.statut !== 'inactive' ? ' · anomalie signalée : ' + c.anomalie : '')),
      c.ph ? el('figure', { class: 'inv-motif' }, grandePhoto(photoCorde(c)), el('figcaption', { class: 'small muted', text: 'Motif' + (c.motif ? ' : ' + c.motif : '') })) : null,
      c.surv && !aTraiter ? el('p', { class: 'small muted', text: texteDecision(c) }) : null,
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
      archivesListe(),
      aTraiter ? vTraitement(c) : null,
      el('div', { class: 'inv-actions' },
        c.statut !== 'inactive' ? el('button', { type: 'button', icon: 'rope', class: 'primary', text: 'Déclarer une utilisation',
          onclick: () => go('usage', { usage: { famille: c.famille, type: 'FMPA', nums: [c.num], ctl: ['VISUEL'], rq: {}, ref: [], sid: sid(), err: '' } }) }) : null,
        droits().gerer && c.statut !== 'inactive' ? el('button', { type: 'button', icon: 'edit', class: 'pill', text: 'Modifier la fiche', onclick: () => editCorde(c) }) : null,
        droits().gerer && !aTraiter ? el('button', { type: 'button', icon: 'alert', class: 'pill', text: 'Placer sous surveillance', disabled: S.busy, onclick: () => decider(c, 'maintenir') }) : null,
        droits().gerer && !aTraiter ? el('button', { type: 'button', icon: 'trash', class: 'pill danger-pill', text: 'Réformer cette corde', disabled: S.busy, onclick: () => reformer(c) }) : null),
    ];
  }

  // Dernière décision sur la surveillance (visible de tous)
  function texteDecision(c) {
    const d = c.surv;
    if (!d) return '';
    return `${d.decision === 'lever' ? 'Surveillance levée' : 'Mise sous surveillance'} le ${new Date(d.d).toLocaleDateString('fr-FR')} par ${d.par}${d.txt ? ' — « ' + d.txt + ' »' : ''}`;
  }

  // Corde signalée ou à surveiller : trois décisions (chefs de section, contrôleurs EPI, CTD, administrateurs)
  function boutonsDecision(c) {
    return el('div', { class: 'inv-actions' },
      el('button', { type: 'button', icon: 'save', class: 'primary', text: 'Lever la surveillance', disabled: S.busy, onclick: () => decider(c, 'lever') }),
      el('button', { type: 'button', icon: 'alert', class: 'pill', text: c.statut === 'a_surveiller' ? 'Laisser sous surveillance' : 'Mettre sous surveillance', disabled: S.busy, onclick: () => decider(c, 'maintenir') }),
      el('button', { type: 'button', icon: 'trash', class: 'pill danger-pill', text: 'Réformer la corde', disabled: S.busy, onclick: () => reformer(c) }));
  }

  function vTraitement(c) {
    const signalee = c.anomalie && c.anomalie !== 'À surveiller';
    return el('div', { class: 'inv-card inv-traitement' },
      el('strong', { icon: 'alert', text: signalee ? 'Signalement à traiter' : 'Corde sous surveillance' }),
      signalee ? el('p', { class: 'small', text: 'Signalé : ' + c.anomalie }) : null,
      c.surv && c.surv.decision === 'maintenir' ? el('p', { class: 'small', text: texteDecision(c) }) : null,
      droits().gerer ? [
        el('p', { class: 'small muted', text: 'Lever : la corde repasse « En service ». Laisser sous surveillance : elle reste utilisable, signalée à chaque utilisation. Réformer : fiche archivée en PDF, numéro libéré.' }),
        boutonsDecision(c),
      ] : el('p', { class: 'small muted', text: 'Décision par le chef de section, le contrôleur EPI ou le CTD.' }));
  }

  async function decider(c, decision) {
    const lever = decision === 'lever';
    const precedent = c.surv && c.surv.decision === 'maintenir' ? c.surv.txt : (c.anomalie && c.anomalie !== 'À surveiller' ? c.anomalie.replace(/^À réformer \?\s*/, '') : '');
    const txt = prompt(lever
      ? `Lever la surveillance de la corde n° ${c.num} ?\n\nElle repasse « En service » et le signalement est traité.\n\nCommentaire (facultatif) :`
      : `${c.statut === 'a_surveiller' ? 'Laisser' : 'Mettre'} la corde n° ${c.num} sous surveillance ?\n\nElle reste utilisable et apparaît « À surveiller » à chaque utilisation.\n\nCe qu’il faut surveiller :`, lever ? '' : precedent);
    if (txt === null) return;
    if (!lever && !txt.trim()) { S.msg = 'Précisez ce qu’il faut surveiller.'; render(); return; }
    S.busy = true; S.msg = ''; render();
    try {
      setData(await app().api('inv_corde_decision', { token: app().token(), corde: c.id, decision, commentaire: txt.trim() }));
      S.msg = lever ? `Corde n° ${c.num} : surveillance levée, corde en service.` : `Corde n° ${c.num} sous surveillance.`;
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      S.msg = err instanceof app().NetworkError ? app().netLabel() + ' : décision impossible hors ligne.' : err.message;
    } finally { S.busy = false; render(); }
  }

  async function reformer(c) {
    const raison = prompt(`Réformer la corde n° ${c.num} ?\n\nSa fiche (informations, compteurs, historique, photo) sera archivée en PDF dans « Cordes reformées » et le numéro ${c.num} deviendra libre pour une nouvelle corde (compteurs à zéro).\n\nMotif de la réforme :`, c.anomalie && c.anomalie !== 'À surveiller' ? c.anomalie : '');
    if (raison === null) return;
    S.busy = true; S.msg = 'Réforme et création de la fiche PDF…'; render();
    try {
      const res = await app().api('inv_corde_reformer', { token: app().token(), corde: c.id, raison });
      setData(res);
      S.msg = `Corde n° ${c.num} réformée, fiche PDF archivée. Le numéro ${c.num} est libre.`;
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      S.msg = err instanceof app().NetworkError ? app().netLabel() + ' : réforme impossible hors ligne.' : err.message;
    } finally { S.busy = false; render(); }
  }

  // Choix d'un numéro libre pour une nouvelle corde (pas de création de numéro : 1 à 75 en SMPM, 25 par secteur)
  function vActiver() {
    const x = S.activer;
    const fam = familles().find(f => f.code === x.famille) || { libelle: x.famille, secteurs: [] };
    const libres = cordes().filter(c => c.famille === x.famille && c.statut === 'inactive');
    const groupes = fam.secteurs.length ? fam.secteurs.map(sec => [SECT[sec] || sec, libres.filter(c => c.secteur === sec)]).concat([['Sans secteur', libres.filter(c => !fam.secteurs.includes(c.secteur))]]) : [['', libres]];
    return [
      retour('Liste des cordes', () => go('liste', { activer: null })),
      el('h2', { class: 'inv-title', text: 'Mettre en service une corde' }),
      el('p', { class: 'muted small', text: `${fam.libelle} : choisissez un numéro libre. La nouvelle corde reprend ce numéro avec des compteurs à zéro ; les données de l’ancienne corde restent dans sa fiche PDF.` }),
      libres.length ? groupes.filter(g => g[1].length).map(([t, l]) => el('div', { class: 'inv-numgrp' },
        t ? el('p', { class: 'small muted', text: t }) : null,
        el('div', { class: 'inv-nums' }, l.map(c => pill(String(c.num), false, () => editCorde(c, true)))))) : el('p', { class: 'muted', text: 'Aucun numéro libre : réformez d’abord une corde.' }),
    ];
  }

  function vUsage() {
    const u = S.usage;
    if (!u) return vListe();
    const fam = familles().find(f => f.code === u.famille) || { libelle: u.famille, secteurs: [] };
    const dispo = cordes().filter(c => c.famille === u.famille && c.statut !== 'inactive');
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
        el('div', { class: 'inv-nums' }, l.map(c => pill((c.anomalie ? '! ' : '') + c.num, u.nums.includes(c.num), () => { toggle(u.nums, c.num); u.nums.sort((a, b) => a - b); render(); },
          { class: 'pill' + (c.statut === 'a_surveiller' || c.anomalie ? ' inv-pill-warn' : ''), title: [c.longueur && c.longueur + ' m', c.modele, STATUTS[c.statut]].filter(Boolean).join(' · ') }))))),
      el('h3', { class: 'inv-sub', text: 'Contrôles réalisés' }),
      el('div', { class: 'inv-chips' }, Object.keys(CTL).map(k => pill(CTL[k], u.ctl.includes(k), () => { toggle(u.ctl, k); render(); }))),
      u.nums.length ? el('h3', { class: 'inv-sub', text: 'Remarques (facultatif)' }) : null,
      el('ul', { class: 'inv-rows' }, u.nums.map(n => el('li', { class: 'inv-row' },
        el('span', { class: 'inv-corde-titre' }, vignette(photoCorde(dispo.find(c => c.num === n) || {}) || {}), el('strong', { text: `Corde n° ${n}` })),
        el('input', { type: 'text', maxlength: '500', placeholder: 'Usure, point dur… (pas de « RAS »)', value: u.rq[n] || '', 'aria-label': `Remarque corde ${n}`, oninput: e => { u.rq[n] = e.target.value; } }),
        el('label', { class: 'ann-check' }, el('input', { type: 'checkbox', checked: u.ref.includes(n), onchange: () => toggle(u.ref, n) }), 'À faire examiner pour réforme')))),
      u.nums.length ? el('p', { class: 'muted small', text: 'Une remarque (autre que « RAS » ou « OK ») ou la case « réforme » avertit le chef de section et le contrôleur EPI du secteur de la corde.' }) : null,
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

  // activer : nouvelle corde sur un numéro libre (champs vides, mise en service ce mois-ci)
  function editCorde(c, activer) {
    const iso = v => (v ? String(v).slice(0, 7) : '');
    go('cedit', { cEdit: activer
      ? { id: c.id, famille: c.famille, num: c.num, secteur: c.secteur, statut: 'en_service', activer: true, longueur: '', diametre: '', type: '',
        fabricant: '', modele: '', serie: '', texis: '', fabrication: '', service: new Date().toISOString().slice(0, 7), caserne: '', commentaire: '', motif: '', ph: '', err: '' }
      : Object.assign({}, c, { fabrication: iso(c.fabrication), service: iso(c.service), err: '' }) });
  }

  function vCordeEdit() {
    const c = S.cEdit;
    if (!c) return vListe();
    const fam = familles().find(f => f.code === c.famille) || { secteurs: [] };
    const champ = (lab, k, attrs) => el('label', null, lab, el('input', Object.assign({ type: 'text', value: c[k] || '', oninput: e => { c[k] = e.target.value; } }, attrs || {})));
    return [
      retour(`Corde n° ${c.num}`, () => go('corde', { corde: c.id, cEdit: null })),
      el('h2', { class: 'inv-title', text: c.activer ? `Nouvelle corde n° ${c.num}` : `Fiche de la corde n° ${c.num}` }),
      el('p', { class: 'muted small', text: `${fam.libelle || c.famille} · n° ${c.num}${c.secteur ? ' · secteur ' + (SECT[c.secteur] || c.secteur) : ''}`
        + (c.activer ? ' · compteurs remis à zéro à la mise en service.' : '') }),
      el('div', { class: 'inv-2col' }, champ('Longueur (m)', 'longueur', { inputmode: 'decimal' }), champ('Diamètre (mm)', 'diametre', { inputmode: 'decimal' })),
      el('div', { class: 'inv-2col' }, champ('Type', 'type', { placeholder: 'Semi-stat, A…' }), champ('Fabricant', 'fabricant')),
      el('div', { class: 'inv-2col' }, champ('Modèle', 'modele'), champ('N° de série', 'serie')),
      champ('N° TEXIS / TECHSYS', 'texis'),
      el('div', { class: 'inv-2col' }, champ('Fabrication', 'fabrication', { type: 'month' }), champ('Mise en service', 'service', { type: 'month' })),
      champ('Caserne', 'caserne'),
      champ('Motif (couleurs, marque)', 'motif', { placeholder: 'Ex. : Beal Access jaune/gris', maxlength: '80' }),
      !c.activer ? el('div', { class: 'inv-edit-photo inv-corde-photo' },
        vignette(photoCorde(c) || {}),
        el('label', { class: 'pill inv-file', icon: 'camera' }, c.ph ? 'Changer la photo du motif' : 'Ajouter une photo du motif',
          el('input', { type: 'file', accept: 'image/*', disabled: S.busy, onchange: ev => { const f = ev.target.files[0]; if (f) photoCordeEnvoyer(c, f); } })),
        c.ph ? el('button', { type: 'button', icon: 'trash', class: 'link danger small', text: 'Retirer', disabled: S.busy, onclick: () => { if (confirm('Retirer la photo du motif ?')) photoCordeEnvoyer(c, null); } }) : null)
        : el('p', { class: 'muted small', text: 'Photo du motif : à ajouter depuis la fiche, une fois la corde mise en service.' }),
      el('label', null, 'Commentaire', el('textarea', { rows: '3', maxlength: '1000', oninput: e => { c.commentaire = e.target.value; } }, c.commentaire || '')),
      el('p', { class: 'error', role: 'alert', text: c.err }),
      el('button', { type: 'button', icon: 'save', class: 'primary inv-submit', disabled: S.busy, text: 'Enregistrer', onclick: saveCorde }),
    ];
  }

  async function photoCordeEnvoyer(c, file) {
    try {
      S.busy = true; c.err = ''; render();
      const photo = file ? await compresser(file) : '';
      setData(await app().api('inv_corde_photo_save', { token: app().token(), corde: c.id, photo, motif: c.motif || '' }));
      const n = cordes().find(x => x.id === c.id);
      if (n) { c.ph = n.ph; c.motifInit = n.motif; }
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      c.err = err instanceof app().NetworkError ? app().netLabel() + ' : photo non envoyée.' : err.message;
    } finally { S.busy = false; render(); }
  }

  async function saveCorde() {
    const c = S.cEdit;
    S.busy = true; render();
    try {
      const corde = Object.assign({}, c, { fabrication: c.fabrication ? c.fabrication + '-01' : '', service: c.service ? c.service + '-01' : '' });
      delete corde.err; delete corde.hist; delete corde.cpt;
      let res = c.activer
        ? await app().api('inv_corde_activer', { token: app().token(), corde })
        : await app().api('inv_corde_save', { token: app().token(), corde });
      // nom du motif changé : enregistré à part (la photo ne change pas)
      const n0 = (res.cordes || []).find(x => x.famille === c.famille && x.num === Number(c.num));
      if (!c.activer && n0 && (c.motif || '') !== (n0.motif || '')) res = await app().api('inv_corde_photo_save', { token: app().token(), corde: n0.id, motif: c.motif || '' });
      setData(res);
      const n = cordes().find(x => x.famille === c.famille && x.num === Number(c.num));
      go(n ? 'corde' : 'liste', { corde: n ? n.id : null, cEdit: null, msg: c.activer ? `Corde n° ${c.num} mise en service.` : 'Fiche enregistrée.' });
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
    // notification d'alerte touchée : onglet Alertes à l'ouverture
    ongletAlertes: () => { S.p.onglet = 'alertes'; S.vue = 'liste'; savePrefs(); },
    pending: () => outbox().length,
    // saisie en cours : pas de rechargement automatique de l'application (nouvelle version)
    busy: () => !$('#tab-inventaire').hidden && ['saisie', 'edit', 'usage', 'cedit'].includes(S.vue),
  };
})();
