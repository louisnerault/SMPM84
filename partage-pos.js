// Partage de la position des agents (back-end : Partage.gs — pos_cle, pos_start, pos_stop, pos_list).
// - Partage par l'appli Traccar Client (arrière-plan, écran éteint, appli fermée) : l'agent y saisit l'adresse du
//   serveur et son identifiant personnel, puis touche « Démarrer le partage » ici. Tous les membres peuvent partager.
// - Boutons « Partager ma position » : rubrique Cartographie / points d'intérêt, Accueil intervention, carte.
// - Pendant le partage : bandeau flottant en haut (âge de la dernière position reçue, bouton Arrêter).
// - Carte : pastilles des agents (vert < 2 min, orange < 7 min, gris au-delà), étoile pour les IMP 3, croix de secours pour les SSSM, chemin en
//   pointillé ; clic : nom, batterie, âge, précision. Visibles des chefs de section, CT et administrateurs
//   (app.js : canVoirPos) et des agents qui partagent eux-mêmes leur position (contrôle par le serveur).
(() => {
  'use strict';

  const KEY_ACTIF = 'smpm_partage_pos';      // partage démarré sur cet appareil : état suivi en continu
  const KEY_REGLE = 'smpm_partage_traccar';  // Traccar déjà réglé : on ne remontre pas toutes les explications
  const ETAT_MS = 30000, LISTE_MS = 20000;
  const VERT_MS = 2 * 60000, ORANGE_MS = 7 * 60000;
  const COUL = { vert: '#2a9d3a', orange: '#f08c00', gris: '#8a8f98' };
  const URL_ANDROID = 'https://play.google.com/store/apps/details?id=org.traccar.client';
  const URL_IOS = 'https://apps.apple.com/app/traccar-client/id843156974';
  const ANDROID = /android/i.test(navigator.userAgent);
  // Lien de configuration de Traccar Client (versions 9.6 et suivantes) : adresse, identifiant, fréquence, distance
  function configurerTraccar(id) {
    const q = 'url=' + encodeURIComponent(window.SMPM_CONFIG.API_URL) + '&id=' + encodeURIComponent(id) + '&interval=30&distance=25&accuracy=highest&buffer=false';   // sans mémoire tampon : pas de vieilles positions renvoyées en boucle
    location.href = ANDROID
      ? 'intent://config?' + q + '#Intent;scheme=org.traccar.client;package=org.traccar.client;S.browser_fallback_url=' + encodeURIComponent(URL_ANDROID) + ';end'
      : 'org.traccar.client://config?' + q;
  }
  // Ouvre Traccar Client (Android ; Google Play s'il n'est pas installé). Pas de lien d'ouverture connu sur iPhone.
  function ouvrirTraccar() {
    if (!ANDROID) return false;
    location.href = 'intent://#Intent;package=org.traccar.client;S.browser_fallback_url=' + encodeURIComponent(URL_ANDROID) + ';end';
    return true;
  }

  const app = () => window.SMPM_APP;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const connecte = () => !!(app() && app().token && app().token());
  const peutVoir = () => !!(app() && app().voirPosDroit && app().voirPosDroit());

  // Appel discret (sans barre de chargement) : l'état est relu toutes les 20 à 30 s
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
  function h(tag, attrs, ...enfants) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    });
    enfants.flat().forEach(c => c != null && e.append(c));
    return e;
  }

  // ---------- état de son partage ----------
  const S = { moi: null, agents: [], voit: false, lu: 0, enCours: false };
  const actif = () => !!(S.moi ? S.moi.actif : store.get(KEY_ACTIF));

  async function lire() {
    if (!connecte() || S.enCours) return;
    S.enCours = true;
    try {
      const r = await appel('pos_list');
      S.moi = r.moi || { actif: false };
      S.voit = !!r.voit;
      S.agents = r.agents || [];
      S.lu = Date.now();
      if (S.moi.actif) store.set(KEY_ACTIF, '1'); else store.del(KEY_ACTIF);
    } catch (e) { /* on garde le dernier état */ }
    finally { S.enCours = false; majTout(); }
  }

  function majTout() { bandeau(); boutons(); dessiner(); }

  async function demarrer(btn) {
    if (btn) btn.disabled = true;
    try {
      await appel('pos_start');
      store.set(KEY_ACTIF, '1');
      S.moi = { actif: true, t: '' };
      fermer();
      bandeau(); boutons();
      ouvrirTraccar();          // l'agent y active le Service, puis revient (ou non) dans l'appli
      lire();
    } catch (e) { alert(navigator.onLine ? (e.message || 'Erreur du serveur') : 'Réseau nécessaire pour démarrer le partage.'); }
    finally { if (btn) btn.disabled = false; }
  }

  async function arreter() {
    if (!confirm('Arrêter le partage de votre position ?\n\nVotre position et votre chemin disparaissent de la carte. Pensez aussi à désactiver le Service dans Traccar Client pour économiser la batterie.')) return;
    try {
      await appel('pos_stop');
      store.del(KEY_ACTIF);
      S.moi = { actif: false };
      S.agents = S.agents.filter(a => !a.moi);
      if (!peutVoir()) { S.voit = false; S.agents = []; }
      majTout();
    } catch (e) { alert(navigator.onLine ? (e.message || 'Erreur du serveur') : 'Réseau nécessaire pour arrêter le partage.'); }
  }

  // Bandeau flottant en haut de l'écran
  function bandeau() {
    let b = document.getElementById('partage-bandeau');
    if (!actif() || !connecte()) { if (b) b.remove(); document.body.classList.remove('partage-on'); return; }
    if (!b) {
      b = h('div', { id: 'partage-bandeau', class: 'partage-bandeau', role: 'status' },
        h('span', { class: 'partage-dot' }),
        h('span', { class: 'partage-txt' }, h('strong', { text: 'Partage de localisation en cours' }), h('span', { class: 'partage-age' })),
        h('button', { type: 'button', class: 'partage-stop', text: 'Arrêter', onclick: arreter }));
      document.body.append(b);
      document.body.classList.add('partage-on');
    }
    const t = S.moi && S.moi.t ? Date.parse(S.moi.t) : 0;
    b.querySelector('.partage-dot').style.background = COUL[t ? couleur(t) : 'gris'];
    // Diagnostic : Traccar envoie, mais une position plus ancienne que la dernière (mémoire tampon de Traccar)
    const recu = S.moi && S.moi.recu ? Date.parse(S.moi.recu) : 0, recuPos = S.moi && S.moi.recuPos ? Date.parse(S.moi.recuPos) : 0;
    const vieux = recu && recuPos && (!t || recuPos < t) && Date.now() - recu < ORANGE_MS;
    const hm = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    b.querySelector('.partage-age').textContent = vieux
      ? `Traccar renvoie une ancienne position (${hm(recuPos)}) : désactivez son Buffer`
      : t ? `Dernière position ${age(t)}` + (S.moi.batt != null ? ` · 🔋 ${S.moi.batt} %` : '')
      : recu ? 'Traccar envoie, position en attente…' : 'En attente de Traccar : activez son Service';
    b.title = recu ? `Dernier envoi reçu de Traccar ${age(recu)}` : 'Aucun envoi reçu de Traccar';
  }

  // Boutons « Partager ma position » (rubrique, accueil intervention, carte)
  function boutons() {
    document.querySelectorAll('[data-partage]').forEach(b => {
      const lib = b.querySelector('.partage-lib') || b;
      lib.textContent = actif() ? 'Arrêter le partage' : 'Partager ma position';
      b.classList.toggle('partage-btn-on', actif());
      b.hidden = !connecte();
    });
    if (C.btn) {
      C.btn.classList.toggle('partage-btn-on', actif());
      C.btn.title = actif() ? 'Arrêter le partage de ma position' : 'Partager ma position en temps réel';
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-partage]');
    if (!b) return;
    e.preventDefault();
    if (actif()) arreter(); else ouvrir();
  });

  // ---------- fenêtre « Partager ma position » ----------
  function fenetre(...contenu) {
    let d = document.getElementById('partage-dlg');
    if (!d) { d = h('dialog', { id: 'partage-dlg', class: 'partage-dlg' }); document.body.append(d); }
    d.replaceChildren(h('button', { type: 'button', class: 'partage-x', 'aria-label': 'Fermer', text: '×', onclick: fermer }), ...contenu);
    if (!d.open) d.showModal ? d.showModal() : d.setAttribute('open', '');
    return d;
  }
  function fermer() { const d = document.getElementById('partage-dlg'); if (d && d.open) d.close ? d.close() : d.removeAttribute('open'); }
  async function copier(txt, btn) {
    try { await navigator.clipboard.writeText(txt); btn.textContent = 'Copié ✓'; } catch (e) { btn.textContent = 'Copie impossible'; }
    setTimeout(() => { btn.textContent = 'Copier'; }, 1800);
  }
  const btnDemarrer = () => { const b = h('button', { type: 'button', class: 'pill partage-go', text: 'Démarrer le partage' }); b.addEventListener('click', () => demarrer(b)); return b; };
  const quiVoit = () => h('p', { class: 'small', text: 'Votre position et votre chemin seront visibles des chefs de section, du CT, des administrateurs et des agents qui partagent leur position. Ceux qui partagent déjà sont prévenus.' });

  function ouvrir() {
    if (!connecte()) return;
    if (store.get(KEY_REGLE)) {
      fenetre(h('h3', { text: 'Partager ma position' }),
        h('p', {}, ANDROID ? 'Touchez Démarrer le partage : Traccar Client s’ouvre, activez-y le ' : 'Touchez Démarrer le partage, puis ouvrez Traccar Client et activez le ', h('strong', { text: 'Service' }), '.'),
        quiVoit(), btnDemarrer(),
        h('button', { type: 'button', class: 'link', text: 'Revoir les réglages de Traccar Client', onclick: () => reglages(false) }));
    } else reglages(false);
  }

  async function reglages(renouveler) {
    const etat = h('p', { class: 'small', text: 'Préparation de votre identifiant…' });
    fenetre(h('h3', { text: 'Partager ma position' }), etat);
    let id;
    try { id = (await appel('pos_cle', { renouveler: !!renouveler })).id; }
    catch (e) { etat.textContent = navigator.onLine ? (e.message || 'Erreur du serveur') : 'Réseau nécessaire pour préparer votre identifiant.'; return; }
    store.set(KEY_REGLE, '1');
    const url = window.SMPM_CONFIG.API_URL;
    const ligne = (lib, val) => { const b = h('button', { type: 'button', class: 'pill', text: 'Copier' }); b.addEventListener('click', () => copier(val, b));
      return h('div', { class: 'partage-champ' }, h('div', { class: 'small', text: lib }), h('code', { text: val }), b); };
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    fenetre(
      h('h3', { text: 'Partager ma position' }),
      h('p', { class: 'small', text: 'Le partage passe par l’application gratuite Traccar Client : elle envoie votre position même écran éteint et application SMPM fermée. À régler une seule fois.' }),
      h('ol', { class: 'partage-etapes' },
        h('li', {}, 'Installez ', h('strong', { text: 'Traccar Client' }), ' : ', h('a', { href: ios ? URL_IOS : URL_ANDROID, target: '_blank', rel: 'noopener', text: ios ? 'App Store' : 'Google Play' }), '.'),
        h('li', {}, 'Touchez ', h('strong', { text: 'Configurer Traccar' }), ' : Traccar s’ouvre avec l’adresse, votre identifiant, la fréquence et la distance déjà remplis.',
          h('button', { type: 'button', class: 'pill partage-go', text: 'Configurer Traccar', onclick: () => configurerTraccar(id) }),
          h('details', { class: 'small' }, h('summary', { text: 'Si Traccar ne se remplit pas : saisie manuelle' }),
            'Dans ses réglages, collez ces deux valeurs :', ligne('Identifiant de l’appareil', id), ligne('URL du serveur', url),
            'Réglez ', h('strong', { text: 'Précision : élevée' }), ', ', h('strong', { text: 'Fréquence : 30 s' }), ', ', h('strong', { text: 'Distance : 25 m' }), ', ', h('strong', { text: 'Mise en mémoire tampon (Buffer) : désactivée' }), '.')),
        h('li', {}, 'Autorisez la position ', h('strong', { text: '« Toujours »' }), ' et, sur Android, retirez l’optimisation de batterie pour Traccar.'),
        h('li', {}, 'Touchez ', h('strong', { text: 'Démarrer le partage' }), ' ci-dessous' + (ANDROID ? ' : Traccar Client s’ouvre' : ', puis ouvrez Traccar Client') + ' ; activez-y le ', h('strong', { text: 'Service' }), ' (sur Android, une notification reste affichée tant qu’il tourne).')),
      quiVoit(), btnDemarrer(),
      h('p', { class: 'small', text: 'Cet identifiant est personnel : ne le communiquez pas. En cas de doute (téléphone perdu…), renouvelez-le : l’ancien ne fonctionnera plus.' }),
      h('button', { type: 'button', class: 'link', text: 'Renouveler l’identifiant', onclick: () => { if (confirm('Créer un nouvel identifiant ? L’ancien ne fonctionnera plus dans Traccar Client.')) reglages(true); } }));
  }

  // ---------- positions des agents sur la carte ----------
  const C = { L: null, map: null, couche: null, btn: null };

  function pastille(a) {
    const c = COUL[couleur(Date.parse(a.t))];
    // SSSM : croix de secours (prioritaire) ; IMP 3 : étoile
    const etoile = a.sssm ? '<path d="M10.2 6h3.6v4.2H18v3.6h-4.2V18h-3.6v-4.2H6v-3.6h4.2z" fill="#fff"/>'
      : a.imp3 ? '<path d="M12 5.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L12 15l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#fff"/>' : '';
    return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${c}" stroke="#fff" stroke-width="2.5"/>${a.moi ? '<circle cx="12" cy="12" r="11.5" fill="none" stroke="#1d72d8" stroke-width="1.5"/>' : ''}${etoile}</svg>`;
  }

  function popup(a) {
    const t = Date.parse(a.t);
    const bat = a.batt === null || a.batt === undefined ? 'inconnue' : `${a.batt} %${a.charge ? ' (en charge)' : ''}`;
    return h('div', { class: 'poi-pop partage-pop' },
      h('strong', { text: (a.nom || 'Agent') + (a.moi ? ' (vous)' : '') + (a.imp3 ? ' ★' : '') + (a.sssm ? ' ✚ SSSM' : '') }),
      h('div', { class: 'small', text: `🔋 Batterie : ${bat}` }),
      h('div', { class: 'small', text: `Position ${age(t)}` + (a.acc ? ` · ± ${a.acc} m` : '') }));
  }

  function dessiner() {
    if (!C.couche) return;
    const L = C.L;
    C.couche.clearLayers();
    if (!S.voit) return;
    S.agents.forEach(a => {
      const tr = (a.trace || []).concat([[a.lat, a.lng]]);
      if (tr.length > 1) L.polyline(tr, { color: COUL[couleur(Date.parse(a.t))], weight: 3, opacity: .85, dashArray: '6 7', interactive: false }).addTo(C.couche);
    });
    S.agents.forEach(a => {
      const icon = L.divIcon({ className: 'partage-pin', html: pastille(a), iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
      L.marker([a.lat, a.lng], { icon, title: a.nom, zIndexOffset: 1000 }).bindPopup(() => popup(a)).addTo(C.couche);
    });
  }

  const carteVisible = () => !!(C.map && C.map.getContainer().offsetParent && document.visibilityState === 'visible');

  // Appelé par poi.js à la création de la carte
  function attacher(L, map) {
    if (C.map === map) return;
    C.L = L; C.map = map;
    C.couche = L.featureGroup().addTo(map);
    const Btn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const b = h('button', { type: 'button', class: 'poi-locate partage-btn', 'aria-label': 'Partage de ma position' });
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => { if (actif()) arreter(); else ouvrir(); });
        C.btn = b;
        boutons();
        return b;
      },
    });
    map.addControl(new Btn());
    if (peutVoir() || actif()) lire();
  }

  // Relecture : toutes les 20 s carte affichée (si l'on peut voir), toutes les 30 s pendant son partage
  setInterval(() => {
    if (!connecte() || document.visibilityState !== 'visible') { bandeau(); return; }
    const dt = Date.now() - S.lu;
    if (carteVisible() && (peutVoir() || actif()) && dt >= LISTE_MS) lire();
    else if (actif() && dt >= ETAT_MS) lire();
    else { bandeau(); dessiner(); }
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connecte() && (actif() || carteVisible())) lire(); });
  window.addEventListener('load', () => setTimeout(() => { boutons(); if (connecte() && store.get(KEY_ACTIF)) lire(); }, 2500));
  setInterval(() => { boutons(); if (!connecte()) { store.del(KEY_ACTIF); S.moi = null; bandeau(); } }, 15000);

  window.SMPM_PARTAGE = { attacher, ouvrir, arreter, actif, lire };
})();
