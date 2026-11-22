// Partage de la position des agents sur la carte des points d'intérêt (back-end : Partage.gs — pos_update, pos_stop, pos_list).
// - Pour l'instant réservé aux chefs de section, CT et administrateurs (app.js : canPartagePos ; Partage.gs : POS.ROLES).
// - L'agent active le partage (bouton de la carte) : bandeau flottant en haut « Partage de localisation en cours »,
//   âge de la dernière position envoyée et bouton Arrêter. Le partage reprend à la réouverture de l'appli.
// - Batterie : GPS suivi en continu, mais envoi au plus toutes les 30 s (ou après 25 m de déplacement) ;
//   une web app ne tourne pas écran verrouillé : le partage est alors en pause.
// - Partage en arrière-plan (écran éteint, appli fermée) : appli Traccar Client, réglée avec l'adresse du serveur
//   et un identifiant personnel (Partage.gs : pos_cle) ; fenêtre « Partager ma position » ci-dessous.
// - Carte : pastilles rondes (vert < 2 min, orange < 7 min, gris au-delà), étoile pour les IMP 3 ;
//   chemin parcouru en pointillé (effacé à l'arrêt du partage) ; clic : nom, batterie, âge et précision. Actualisées toutes les 20 s quand la carte est affichée.
(() => {
  'use strict';

  const KEY_ACTIF = 'smpm_partage_pos';
  const ENVOI_MIN_MS = 30000;        // au plus un envoi toutes les 30 s…
  const ENVOI_DIST_M = 25;           // …sauf déplacement d'au moins 25 m (mais jamais plus d'un toutes les 10 s)
  const ENVOI_PLANCHER_MS = 10000;
  const ENVOI_MAX_MS = 120000;       // immobile : un envoi toutes les 2 min pour rester « vert »
  const LISTE_MS = 20000;
  const VERT_MS = 2 * 60000, ORANGE_MS = 7 * 60000;
  const COUL = { vert: '#2a9d3a', orange: '#f08c00', gris: '#8a8f98' };

  const app = () => window.SMPM_APP;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const droit = () => !!(app() && app().partageDroit && app().partageDroit());

  // Appel discret (sans barre de chargement) : envoyé toutes les 30 s
  async function appel(action, payload) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
    try {
      const r = await fetch(window.SMPM_CONFIG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: app().token() }, payload || {})),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.error) || 'Erreur du serveur');
      return j;
    } finally { if (t) clearTimeout(t); }
  }

  const couleur = t => { const a = Date.now() - t; return a < VERT_MS ? 'vert' : a < ORANGE_MS ? 'orange' : 'gris'; };
  function age(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `il y a ${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m} min`;
    return `il y a ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }
  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- partage de sa position ----------
  const P = { watch: null, batt: null, dernier: null, envoye: 0, envoiEnCours: false, erreur: '', tic: null };

  async function batterie() {
    if (P.batt || !navigator.getBattery) return P.batt;      // pas d'API batterie sur iPhone : « inconnue »
    try { P.batt = await navigator.getBattery(); } catch (e) { P.batt = null; }
    return P.batt;
  }

  async function envoyer(pos) {
    if (P.envoiEnCours) return;
    P.envoiEnCours = true;
    try {
      const b = await batterie();
      await appel('pos_update', { pos: { lat: pos.lat, lng: pos.lng, acc: pos.acc,
        batt: b ? Math.round(b.level * 100) : null, charge: b ? !!b.charging : false } });
      P.dernier = pos; P.envoye = Date.now(); P.erreur = '';
      if (C.map) charger();
    } catch (e) {
      P.erreur = navigator.onLine ? (e.message || 'Envoi impossible') : 'Hors ligne : position non envoyée';
      if (/réservé/i.test(P.erreur)) arreter(true);
    } finally { P.envoiEnCours = false; bandeau(); }
  }

  function surPosition(g) {
    const pos = { lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy };
    const dt = Date.now() - P.envoye;
    const bouge = !P.dernier || distM(P.dernier, pos) >= ENVOI_DIST_M;
    if (!P.envoye || dt >= ENVOI_MIN_MS && (bouge || dt >= ENVOI_MAX_MS) || bouge && dt >= ENVOI_PLANCHER_MS) envoyer(pos);
    P.courante = pos;
  }

  function surErreur(err) {
    if (err.code === 1) { P.erreur = 'Accès à la position refusé : autorisez la localisation pour cette application.'; arreter(true); }
    else P.erreur = 'Position introuvable pour l’instant…';
    bandeau();
  }

  function demarrer() {
    if (!droit() || P.watch !== null) return;
    if (!navigator.geolocation) { alert('La géolocalisation n’est pas disponible sur cet appareil.'); return; }
    store.set(KEY_ACTIF, '1');
    P.erreur = ''; P.envoye = 0; P.dernier = null;
    P.watch = navigator.geolocation.watchPosition(surPosition, surErreur, { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 });
    clearInterval(P.tic);
    P.tic = setInterval(() => {
      bandeau();
      // immobile : watchPosition ne rappelle pas toujours, on renvoie la dernière position pour rester à jour
      if (P.courante && Date.now() - P.envoye >= ENVOI_MAX_MS && document.visibilityState === 'visible') envoyer(P.courante);
    }, 5000);
    bandeau();
    majBouton();
  }

  function arreter(garderErreur) {
    if (P.watch !== null) { try { navigator.geolocation.clearWatch(P.watch); } catch (e) {} }
    const avait = P.watch !== null || store.get(KEY_ACTIF);
    P.watch = null; P.courante = null;
    clearInterval(P.tic); P.tic = null;
    store.del(KEY_ACTIF);
    if (avait && app() && app().token && app().token()) appel('pos_stop').then(() => C.map && charger()).catch(() => {});
    if (!garderErreur) P.erreur = '';
    bandeau();
    majBouton();
    if (garderErreur && P.erreur) setTimeout(() => alert(P.erreur), 0);
  }

  const actif = () => P.watch !== null;

  // Bandeau flottant en haut de l'écran
  function bandeau() {
    let b = document.getElementById('partage-bandeau');
    if (!actif()) { if (b) b.remove(); document.body.classList.remove('partage-on'); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'partage-bandeau';
      b.className = 'partage-bandeau';
      b.setAttribute('role', 'status');
      b.innerHTML = '<span class="partage-dot"></span><span class="partage-txt"><strong>Partage de localisation en cours</strong><span class="partage-age"></span></span><button type="button" class="partage-stop">Arrêter</button>';
      b.querySelector('.partage-stop').addEventListener('click', () => arreter());
      document.body.append(b);
      document.body.classList.add('partage-on');
    }
    const c = P.envoye ? couleur(P.envoye) : 'gris';
    b.querySelector('.partage-dot').style.background = COUL[c];
    b.querySelector('.partage-age').textContent = P.erreur
      ? P.erreur + (P.envoye ? ` · dernière position ${age(P.envoye)}` : '')
      : P.envoye ? `Dernière position ${age(P.envoye)}` : 'Recherche de la position…';
  }

  // ---------- positions des agents sur la carte ----------
  const C = { L: null, map: null, couche: null, btn: null, timer: null, agents: [] };

  function pastille(a) {
    const c = COUL[couleur(Date.parse(a.t))];
    const etoile = a.imp3 ? '<path d="M12 5.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L12 15l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#fff"/>' : '';
    return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${c}" stroke="#fff" stroke-width="2.5"/>${a.moi ? '<circle cx="12" cy="12" r="11.5" fill="none" stroke="#1d72d8" stroke-width="1.5"/>' : ''}${etoile}</svg>`;
  }

  function popup(a) {
    const d = document.createElement('div');
    d.className = 'poi-pop partage-pop';
    const t = Date.parse(a.t);
    const bat = a.batt === null || a.batt === undefined ? 'inconnue' : `${a.batt} %${a.charge ? ' (en charge)' : ''}`;
    const lignes = [
      ['strong', (a.nom || 'Agent') + (a.moi ? ' (vous)' : '') + (a.imp3 ? ' ★' : '')],
      ['div', `🔋 Batterie : ${bat}`],
      ['div', `Position ${age(t)}` + (a.acc ? ` · ± ${a.acc} m` : '')],
    ];
    lignes.forEach(([tag, txt]) => { const e = document.createElement(tag); if (tag === 'div') e.className = 'small'; e.textContent = txt; d.append(e); });
    return d;
  }

  function dessiner() {
    if (!C.couche) return;
    const L = C.L;
    C.couche.clearLayers();
    C.agents.forEach(a => {
      // chemin parcouru, en pointillé de la couleur de la pastille
      const tr = (a.trace || []).concat([[a.lat, a.lng]]);
      if (tr.length > 1) L.polyline(tr, { color: COUL[couleur(Date.parse(a.t))], weight: 3, opacity: .85, dashArray: '6 7', interactive: false }).addTo(C.couche);
    });
    C.agents.forEach(a => {
      const icon = L.divIcon({ className: 'partage-pin', html: pastille(a), iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
      L.marker([a.lat, a.lng], { icon, title: a.nom, zIndexOffset: 1000, keyboard: true }).bindPopup(() => popup(a)).addTo(C.couche);
    });
  }

  const carteVisible = () => !!(C.map && C.map.getContainer().offsetParent && document.visibilityState === 'visible');

  async function charger() {
    if (!droit() || !C.map) return;
    try { C.agents = (await appel('pos_list')).agents || []; dessiner(); } catch (e) { /* on garde les dernières positions */ }
  }

  function boucle() {
    clearInterval(C.timer);
    C.timer = setInterval(() => { if (carteVisible()) charger(); else dessiner(); }, LISTE_MS);
  }

  function majBouton() {
    if (!C.btn) return;
    C.btn.classList.toggle('partage-btn-on', actif());
    C.btn.title = actif() ? 'Arrêter le partage de ma position' : 'Partager ma position en temps réel';
    C.btn.setAttribute('aria-pressed', actif() ? 'true' : 'false');
  }

  // Appelé par poi.js à la création de la carte
  function attacher(L, map) {
    if (!droit() || C.map === map) return;
    C.L = L; C.map = map;
    C.couche = L.featureGroup().addTo(map);
    const Btn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'poi-locate partage-btn';
        b.setAttribute('aria-label', 'Partage de ma position');
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => {
          if (actif()) { if (confirm('Arrêter le partage de votre position ?')) arreter(); }
          else choix();
        });
        C.btn = b;
        majBouton();
        return b;
      },
    });
    map.addControl(new Btn());
    charger();
    boucle();
  }

  // ---------- fenêtre « Partager ma position » : dans l'appli, ou en arrière-plan avec Traccar Client ----------
  function h(tag, attrs, ...enfants) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    });
    enfants.flat().forEach(c => c != null && e.append(c));
    return e;
  }
  function fenetre(...contenu) {
    let d = document.getElementById('partage-dlg');
    if (!d) { d = h('dialog', { id: 'partage-dlg', class: 'partage-dlg' }); document.body.append(d); }
    d.replaceChildren(h('button', { type: 'button', class: 'partage-x', 'aria-label': 'Fermer', text: '×', onclick: () => d.close() }), ...contenu);
    if (!d.open) d.showModal ? d.showModal() : d.setAttribute('open', '');
    return d;
  }
  function choix() {
    const d = fenetre(
      h('h3', { text: 'Partager ma position' }),
      h('p', { class: 'small', text: 'Votre position et votre chemin seront visibles des chefs de section, du CT et des administrateurs.' }),
      h('button', { type: 'button', class: 'pill partage-choix', onclick: () => { d.close(); demarrer(); } },
        h('strong', { text: 'Depuis l’application' }), h('span', { class: 'small', text: 'Tant que l’application reste ouverte ; en pause écran verrouillé.' })),
      h('button', { type: 'button', class: 'pill partage-choix', onclick: () => traccar(false) },
        h('strong', { text: 'En arrière-plan avec Traccar Client' }), h('span', { class: 'small', text: 'Écran éteint et application fermée, avec une notification permanente.' })));
  }
  async function copier(txt, btn) {
    try { await navigator.clipboard.writeText(txt); btn.textContent = 'Copié ✓'; } catch (e) { btn.textContent = 'Copie impossible'; }
    setTimeout(() => { btn.textContent = 'Copier'; }, 1800);
  }
  async function traccar(renouveler) {
    const etat = h('p', { class: 'small', text: 'Préparation de votre identifiant…' });
    fenetre(h('h3', { text: 'Partage en arrière-plan' }), etat);
    let id;
    try { id = (await appel('pos_cle', { renouveler: !!renouveler })).id; }
    catch (e) { etat.textContent = navigator.onLine ? (e.message || 'Erreur du serveur') : 'Réseau nécessaire pour préparer l’identifiant.'; return; }
    const url = window.SMPM_CONFIG.API_URL;
    const ligne = (lib, val) => { const b = h('button', { type: 'button', class: 'pill', text: 'Copier' }); b.addEventListener('click', () => copier(val, b));
      return h('div', { class: 'partage-champ' }, h('div', { class: 'small', text: lib }), h('code', { text: val }), b); };
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    fenetre(
      h('h3', { text: 'Partage en arrière-plan' }),
      h('ol', { class: 'partage-etapes' },
        h('li', {}, 'Installez l’application gratuite ', h('strong', { text: 'Traccar Client' }), ' : ',
          h('a', { href: ios ? 'https://apps.apple.com/app/traccar-client/id843156974' : 'https://play.google.com/store/apps/details?id=org.traccar.client', target: '_blank', rel: 'noopener', text: ios ? 'App Store' : 'Google Play' }), '.'),
        h('li', {}, 'Dans ses réglages, copiez ces deux valeurs :', ligne('Identifiant de l’appareil', id), ligne('URL du serveur', url)),
        h('li', {}, 'Réglez ', h('strong', { text: 'Précision : élevée' }), ', ', h('strong', { text: 'Fréquence : 30 s' }), ', ', h('strong', { text: 'Distance : 25 m' }), ', puis autorisez la position ', h('strong', { text: '« Toujours »' }), ' et désactivez l’optimisation de batterie pour Traccar.'),
        h('li', {}, 'Activez le ', h('strong', { text: 'Service' }), ' : une notification reste affichée tant que le partage est en cours. Désactivez-le pour arrêter : votre pastille grise, puis votre chemin disparaît au bout de 15 min.')),
      h('p', { class: 'small', text: 'Cet identifiant est personnel : ne le partagez pas. En cas de doute (téléphone perdu…), renouvelez-le : l’ancien ne fonctionnera plus.' }),
      h('button', { type: 'button', class: 'pill', text: 'Renouveler l’identifiant', onclick: () => { if (confirm('Créer un nouvel identifiant ? L’ancien ne fonctionnera plus dans Traccar.')) traccar(true); } }));
  }

  // Reprise automatique à la réouverture de l'application ; arrêt à la déconnexion
  function reprise() {
    if (store.get(KEY_ACTIF) && !actif()) {
      if (droit()) demarrer();
      else if (app() && app().token && !app().token()) store.del(KEY_ACTIF);
    }
    if (actif() && !droit() && app() && app().token && !app().token()) arreter(true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    reprise();
    if (actif() && P.courante && Date.now() - P.envoye >= ENVOI_MIN_MS) envoyer(P.courante);
    if (carteVisible()) charger();
  });
  window.addEventListener('load', () => setTimeout(reprise, 2500));
  setInterval(reprise, 15000);

  window.SMPM_PARTAGE = { attacher, demarrer, arreter, actif, choix, traccar };
})();
