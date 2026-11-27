// Audience de l'application.
//
// 1) Mesure (tous les membres) : chaque ouverture de l'application et chaque rubrique consultée sont mises en
//    file puis envoyées par lots au serveur (action audience_track, Audience.gs dans le dépôt privé).
//    Aucune donnée nominative n'est envoyée : seulement la rubrique et l'heure ; le serveur rattache un
//    identifiant pseudonymisé. L'envoi est silencieux (pas de barre de chargement, échec sans conséquence),
//    différé hors ligne, et la file est conservée sur l'appareil jusqu'à l'envoi.
// 2) Consultation (CTD et administrateurs, Administration › Audience) : audience_stats — connexions
//    quotidiennes, agents actifs, rubriques les plus consultées, répartition par rôle et par heure.
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => window.SMPM_APP;
  const OUVERTURE = '_ouverture';
  const CLE_FILE = 'smpm_aud_file';
  const LOT = 40, FILE_MAX = 200, DELAI_ENVOI = 20000, REOUVERTURE_MS = 30 * 60 * 1000;

  // ---------------------------------------------------------------- mesure
  let file = [];
  try { file = JSON.parse(localStorage.getItem(CLE_FILE) || '[]'); } catch (e) { file = []; }
  if (!Array.isArray(file)) file = [];
  let minuteur = null, envoi = false, dernier = { r: '', t: 0 }, derniereOuverture = 0;

  function sauver() {
    try { localStorage.setItem(CLE_FILE, JSON.stringify(file.slice(-FILE_MAX))); } catch (e) { /* stockage indisponible : file en mémoire */ }
  }

  function noter(r) {
    r = String(r || '');
    if (!r) return;
    const t = Date.now();
    if (r === dernier.r && t - dernier.t < 3000) return;            // double appel (ex. rechargement de la même page)
    dernier = { r, t };
    file.push({ t, r });
    if (file.length > FILE_MAX) file = file.slice(-FILE_MAX);
    sauver();
    if (file.length >= 10) envoyer();
    else if (!minuteur) minuteur = setTimeout(envoyer, DELAI_ENVOI);
  }

  function ouverture() {
    const t = Date.now();
    if (t - derniereOuverture < REOUVERTURE_MS) return;
    derniereOuverture = t;
    noter(OUVERTURE);
  }

  async function envoyer() {
    clearTimeout(minuteur);
    minuteur = null;
    const a = app();
    const token = a && a.token();
    if (envoi || !token || !file.length || !navigator.onLine) return;
    envoi = true;
    const lot = file.slice(0, LOT);
    try {
      const res = await fetch(window.SMPM_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'audience_track', token, evenements: lot }),
        keepalive: true,
      });
      const d = await res.json();
      if (d && d.ok) {
        file = file.slice(lot.length);
        sauver();
        if (file.length) minuteur = setTimeout(envoyer, 2000);
      }
    } catch (e) { /* réseau ou serveur indisponible : la file est conservée, nouvel essai à la prochaine rubrique */ }
    finally { envoi = false; }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') envoyer(); });
  window.addEventListener('online', () => { if (file.length) envoyer(); });
  window.addEventListener('pagehide', envoyer);
  // à la déconnexion, la file de l'utilisateur ne doit pas partir avec la session du suivant
  function vider() { file = []; sauver(); }

  // ---------------------------------------------------------------- consultation
  const ROLES = { equipier: 'Équipier', chef_unite: 'Chef d’unité', chef_section: 'Chef de section', ctd: 'Conseiller technique', admin: 'Administrateur' };
  const LIB_SUP = { livret: 'Livret', accueil: 'Accueil', infos: 'Mes informations', bug: 'Signaler un problème', 'fmpa-fiche': 'Fiche FMPA', 'interv-fiche': 'Fiche intervention', 'orga-insc': 'Planning des FMPA' };
  const S = { periode: 30, avecAdmin: false, busy: false };

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function libelle(cle) {
    const b = document.querySelector('.drawer-nav button[data-page="' + cle + '"]');
    if (b) {
      const c = b.cloneNode(true);
      c.querySelectorAll('svg, .pending-dot').forEach(n => n.remove());
      const t = c.textContent.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return LIB_SUP[cle] || cle;
  }
  const jourCourt = j => j.slice(8, 10) + '/' + j.slice(5, 7);
  const pct = (n, d) => d > 0 ? Math.round(100 * n / d) + ' %' : '';
  const setState = (t, err) => { const p = $('#aud-state'); p.textContent = t || ''; p.classList.toggle('error', !!err); };

  function tuile(valeur, libelleTxt, detail) {
    const t = el('div', 'aud-tuile');
    t.append(el('div', 'aud-valeur', String(valeur)), el('div', 'aud-lib', libelleTxt));
    if (detail) t.append(el('div', 'aud-detail', detail));
    return t;
  }

  function dessiner(d) {
    // indicateurs
    const tuiles = $('#aud-tuiles');
    tuiles.replaceChildren(
      tuile(d.aujourdhui, 'Ouvertures aujourd’hui', d.agents_aujourdhui + ' agent' + (d.agents_aujourdhui > 1 ? 's' : '')),
      tuile(d.actifs_7j, 'Agents actifs (7 jours)', d.effectif ? pct(d.actifs_7j, d.effectif) + ' de l’effectif (' + d.effectif + ')' : ''),
      tuile(d.actifs_30j, 'Agents actifs (30 jours)', d.effectif ? pct(d.actifs_30j, d.effectif) + ' de l’effectif' : ''),
    );

    // connexions par jour : barre claire = ouvertures, barre foncée = agents distincts
    const jours = d.par_jour || [];
    const max = Math.max(1, ...jours.map(x => x.ouvertures));
    const graph = $('#aud-jours');
    graph.replaceChildren();
    graph.style.setProperty('--aud-n', String(jours.length));
    jours.forEach(x => {
      const c = el('div', 'aud-col');
      c.title = jourCourt(x.j) + ' : ' + x.ouvertures + ' ouverture' + (x.ouvertures > 1 ? 's' : '') + ', ' + x.agents + ' agent' + (x.agents > 1 ? 's' : '');
      const o = el('span', 'aud-o'); o.style.height = (100 * x.ouvertures / max) + '%';
      const a = el('span', 'aud-a'); a.style.height = (100 * Math.min(x.agents, x.ouvertures || x.agents) / max) + '%';
      c.append(o, a);
      graph.append(c);
    });
    const axe = $('#aud-axe');
    axe.replaceChildren(el('span', '', jours.length ? jourCourt(jours[0].j) : ''), el('span', '', 'max. ' + max + ' / jour'), el('span', '', jours.length ? jourCourt(jours[jours.length - 1].j) : ''));
    $('#aud-total').textContent = jours.reduce((s, x) => s + x.ouvertures, 0) + ' ouvertures · ' + d.actifs_periode + ' agent' + (d.actifs_periode > 1 ? 's' : '') + ' distinct' + (d.actifs_periode > 1 ? 's' : '') + ' sur ' + d.jours + ' jours';

    // rubriques
    const rub = $('#aud-rub');
    rub.replaceChildren();
    const rubs = d.rubriques || [];
    const maxR = Math.max(1, ...rubs.map(x => x.vues));
    if (!rubs.length) rub.append(el('p', 'muted small', 'Aucune consultation enregistrée sur la période.'));
    rubs.slice(0, 25).forEach(x => {
      const l = el('div', 'aud-ligne');
      const t = el('div', 'aud-ligne-t');
      t.append(el('span', 'aud-nom', libelle(x.r)), el('span', 'aud-n', x.vues + ' vue' + (x.vues > 1 ? 's' : '') + ' · ' + x.agents + ' agent' + (x.agents > 1 ? 's' : '')));
      const b = el('div', 'aud-barre'); const i = el('span'); i.style.width = (100 * x.vues / maxR) + '%'; b.append(i);
      l.append(t, b);
      rub.append(l);
    });

    // rôles
    const rol = $('#aud-roles');
    rol.replaceChildren();
    (d.roles || []).forEach(x => {
      const l = el('div', 'aud-ligne');
      const t = el('div', 'aud-ligne-t');
      t.append(el('span', 'aud-nom', ROLES[x.role] || x.role || '—'), el('span', 'aud-n', x.agents + ' agent' + (x.agents > 1 ? 's' : '') + ' · ' + x.vues + ' vue' + (x.vues > 1 ? 's' : '')));
      l.append(t);
      rol.append(l);
    });
    if (!rol.children.length) rol.append(el('p', 'muted small', 'Aucune donnée.'));

    // heures d'ouverture
    const hh = $('#aud-heures');
    hh.replaceChildren();
    const maxH = Math.max(1, ...d.heures);
    d.heures.forEach((n, h) => {
      const c = el('div', 'aud-col aud-col-h');
      c.title = h + ' h : ' + n + ' ouverture' + (n > 1 ? 's' : '');
      const o = el('span', 'aud-a'); o.style.height = (100 * n / maxH) + '%';
      c.append(o);
      hh.append(c);
    });

    $('#aud-pied').textContent = 'Données pseudonymisées (aucun nom), conservées ' + Math.round((d.conservation_jours || 365) / 30) + ' mois. Mise à jour à ' +
      new Date(d.maj).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' (actualisation toutes les 5 minutes au plus).';
  }

  async function charger() {
    const a = app();
    if (!a || S.busy) return;
    S.busy = true;
    setState('Chargement…');
    try {
      const d = await a.api('audience_stats', { token: a.token(), jours: S.periode, avec_admin: S.avecAdmin });
      setState('');
      dessiner(d);
    } catch (err) {
      if (a.AUTH_ERRORS.includes(err.message)) return a.logout();
      setState(err instanceof a.NetworkError ? a.netLabel() + ' : statistiques indisponibles.' : err.message, true);
    } finally { S.busy = false; }
  }

  function open() { charger(); }

  document.addEventListener('DOMContentLoaded', () => {
    const sel = $('#aud-periode');
    if (!sel) return;
    sel.addEventListener('change', () => { S.periode = Number(sel.value) || 30; charger(); });
    $('#aud-admin').addEventListener('change', e => { S.avecAdmin = e.target.checked; charger(); });
    $('#aud-refresh').addEventListener('click', charger);
  });

  window.SMPM_AUDIENCE = { noter, ouverture, open, vider };
})();
