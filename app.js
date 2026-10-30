(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_token';
  const KEY_CACHE = 'smpm_cache';
  const KEY_EMAIL = 'smpm_last_email';
  const KEY_LIVRET = 'smpm_livret';
  const KEY_MODE = 'smpm_mode';
  const KEY_THEME = 'smpm_theme';   // préférence de l'appareil : conservée à la déconnexion
  const AUTH_ERRORS = ['Session invalide', 'Session expirée', 'Accès révoqué', 'Compte inactif'];
  // Fonction affichée sous le nom. Une personne qui cumule plusieurs casquettes
  // se voit attribuer la plus haute : c'est le rôle renvoyé par session.role.
  const ROLES = {
    equipier: 'Équipier',
    chef_unite: "Chef d'unité",
    chef_section: 'Chef de section',
    ctd: 'Conseiller technique départemental',
  };
  const SECTIONS = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSSM: 'SSSM' };

  // Liste complète des grades proposés dans « Mon profil » (ordre hiérarchique).
  // « Exp » est gardé tel que dans la liste du personnel (sans intitulé).
  const GRADES_ALL = [
    ['Sap', 'Sapeur'], ['Cpl', 'Caporal'], ['Cch', 'Caporal-chef'],
    ['Sgt', 'Sergent'], ['Sch', 'Sergent-chef'],
    ['Adj', 'Adjudant'], ['Adc', 'Adjudant-chef'],
    ['Ltn', 'Lieutenant'], ['Cne', 'Capitaine'], ['Cdt', 'Commandant'],
    ['Lcl', 'Lieutenant-colonel'], ['Col', 'Colonel'],
    // Service de santé (SSSM)
    ['ISL', 'Infirmier'], ['ILT', 'Infirmier principal'], ['ICN', 'Infirmier chef'],
    ['MCN', 'Médecin capitaine'], ['MCDT', 'Médecin commandant'],
    ['MLCL', 'Médecin lieutenant-colonel'], ['MCOL', 'Médecin colonel'],
    ['Exp', ''],
  ];
  // Fusionne la liste complète, celle du serveur et le grade actuel (aucun grade n'est perdu).
  function gradeChoices(serverGrades, current) {
    const known = new Map(GRADES_ALL);
    const codes = GRADES_ALL.map(g => g[0]);
    [...(serverGrades || []), current].forEach(g => { if (g && !codes.includes(g)) codes.push(g); });
    return codes.map(c => ({ code: c, label: known.get(c) ? `${c} — ${known.get(c)}` : c }));
  }
  // Administrateur : le serveur envoie « admin » (Fmpa.gs, Poi.gs, Push.gs) ou « is_admin » : on accepte les deux
  const isAdm = session => !!session && (session.is_admin === true || session.admin === true);
  // Déclaration de FMPA : chef d'unité ou supérieur, et administrateurs
  const FMPA_ROLES = ['chef_unite', 'chef_section', 'ctd', 'admin'];
  const canDeclare = session => !!session && (isAdm(session) || FMPA_ROLES.includes(session.role));
  // Toutes les FMPA : administrateurs, conseillers techniques (modification) et chefs de section
  // (consultation, modification de leur secteur)
  const canAllFmpa = session => !!session && (isAdm(session) || ['ctd', 'admin', 'chef_section'].includes(session.role));
  const canEditAllFmpa = session => !!session && (isAdm(session) || ['ctd', 'admin'].includes(session.role));
  // Intervention : chefs d'unité, chefs de section, conseillers techniques et administrateurs
  // Toutes les interventions : conseillers techniques et administrateurs
  const canAllInterv = session => !!session && (isAdm(session) || ['ctd', 'admin'].includes(session.role));
  const canIntervene = session => !!session && (isAdm(session) || ['chef_unite', 'chef_section', 'ctd', 'admin'].includes(session.role));
  // Points d'intérêt (à garder cohérent avec backend/Poi.gs) : consultation par tous, selon le cloisonnement
  // des secteurs ; création : chef d'unité et au-delà ; modification et suppression : chef de section, CTD, administrateur
  const canPoiCreate = session => !!session && (isAdm(session) || ['chef_unite', 'chef_section', 'ctd', 'admin'].includes(session.role));
  const canPoiEdit = session => !!session && (isAdm(session) || ['chef_section', 'ctd', 'admin'].includes(session.role));
  // Gestion des listes des points d'intérêt (types et icônes, secteurs et couleurs) : CTD et administrateurs (Poi.gs : POI.ADMIN)
  const canPoiAdmin = session => !!session && (isAdm(session) || ['ctd', 'admin'].includes(session.role));
  // Contrôleur EPI : casquette cumulable avec n'importe quel rôle (case « Contrôleur EPI » de la Liste du personnel,
  // renvoyée par l'action « fonction » de Roles.gs : fonction.ctrl_epi) — responsable matériel de son secteur
  const isCtrlEpi = session => !!session && (session.ctrl_epi === true
    || !!(state.data && state.data.session === session && state.data.fonction && state.data.fonction.ctrl_epi));
  // Inventaire du matériel (à garder cohérent avec Inventaire.gs : INV.GERER) : inventaires et utilisations de cordes
  // par tous ; contenu théorique des contenants et fiches des cordes : chef de section, contrôleur EPI, CTD, administrateur
  const canInvGerer = session => !!session && (isAdm(session) || isCtrlEpi(session) || ['chef_section', 'ctd', 'admin'].includes(session.role));
  // Encadrer (déclarer) une FMPA : qualification IMP 3 (fonction renvoyée par le serveur), ou administrateur
  const canEncadrer = data => {
    if (!data || !data.session) return false;
    if (isAdm(data.session)) return true;
    if (data.fonction && typeof data.fonction.imp3 === 'boolean') return data.fonction.imp3;
    return (data.qualifications || []).some(q => String(q.code).replace(/\s/g, '') === 'IMP3' && q.acquis);
  };
  const FMPA_LISTS = ['fmpa-mes', 'fmpa-toutes'];
  // Rubriques réservées aux chefs de section (et CTD, administrateurs) — à garder cohérent avec backend/Heures.gs
  const CS_PAGES = ['cs-heures', 'cs-tableau', 'cs-specialistes'];
  // Heures chefs de section : « Mes heures » (chefs de section, CTD, admin), « Toutes les heures » (CTD, admin)
  const canAllCsHeures = session => !!session && (isAdm(session) || ['ctd', 'admin'].includes(session.role));
  function allowedPage(name, session) {
    if (name === 'fmpa') return canDeclare(session) && canEncadrer(state.data);
    if (name === 'fmpa-fiche' || name === 'fmpa-mes' || name === 'fmpa-valid') return canDeclare(session);
    if (name === 'fmpa-toutes') return canAllFmpa(session);
    if (name === 'interv-toutes') return canAllInterv(session);
    if (name.startsWith('interv-')) return canIntervene(session);
    if (name === 'cs-heures-toutes') return canAllCsHeures(session);
    if (CS_PAGES.includes(name)) return canAllFmpa(session);
    return true;
  }

  // Fonction affichée : jamais « administrateur » (droit d'administration invisible) ; « · Contrôleur EPI » ajouté si besoin
  function roleLabel(session, me, qualifications, fonction) {
    const base = baseLabel(session, me, qualifications, fonction);
    return (isCtrlEpi(session) || (fonction && fonction.ctrl_epi)) ? [base, 'Contrôleur EPI'].filter(Boolean).join(' · ') : base;
  }
  function baseLabel(session, me, qualifications, fonction) {
    if (fonction && fonction.libelle) return fonction.libelle;
    const base = ROLES[session.role] || '';
    if (session.role === 'equipier') {
      const sssm = (qualifications || []).some(q => q.code === 'SSSM' && q.acquis);
      return sssm ? `${base} SSSM` : base;
    }
    if (session.role !== 'chef_section') return base;
    const key = String(session.section || me.secteur || '').toUpperCase();
    const section = SECTIONS[key] || (key ? key.charAt(0) + key.slice(1).toLowerCase() : '');
    return section ? `${base} ${section}` : base;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- stockage local (protégé : peut être indisponible) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };

  // ---------- API ----------
  class NetworkError extends Error {}

  // Délai maximal d'une requête : sur un réseau très lent, on bascule sur les données
  // de l'appareil au lieu d'attendre indéfiniment. Les envois (déclarations, décisions)
  // ont un délai plus long : ils portent un identifiant qui évite les doublons au renvoi.
  // 40 s : le serveur Apps Script met souvent 20 s à répondre lorsque plusieurs requêtes arrivent ensemble
  const API_TIMEOUT = 40000;
  const API_TIMEOUT_LONG = 60000;
  const LONG_ACTIONS = /(_submit|_update|_decide|^itv_list$|^itv_get$|^itv_form$|^update_me$|^login$|^verify_code$|^request_code$|^livret_pdf$)/;

  // ---------- barre de progression des requêtes ----------
  // Apps Script ne renvoie pas d'avancement : la barre progresse vite puis ralentit
  // vers 90 %, et se termine à 100 % quand toutes les requêtes en cours sont revenues.
  const progress = (() => {
    const el = document.getElementById('progress');
    const fill = el && el.querySelector('.progress-fill');
    let active = 0, value = 0, tick = null, hideT = null;
    function set(v) { value = v; if (fill) fill.style.transform = 'scaleX(' + v + ')'; }
    function start() {
      if (!el) return;
      active++;
      if (active > 1) return;
      clearTimeout(hideT);
      el.classList.remove('done'); el.classList.add('on'); el.setAttribute('aria-hidden', 'false');
      set(0.08);
      clearInterval(tick);
      tick = setInterval(() => set(value + (0.9 - value) * 0.08), 200);
    }
    function end() {
      if (!el || active === 0) return;
      active--;
      if (active > 0) return;
      clearInterval(tick);
      set(1); el.classList.add('done');
      hideT = setTimeout(() => { el.classList.remove('on', 'done'); el.setAttribute('aria-hidden', 'true'); set(0); }, 400);
    }
    return { start, end };
  })();
  window.SMPM_PROGRESS = progress;

  // Liens rapides des formulaires (rubriques qui passent au vert) : flottants en haut
  // de l'écran dès qu'on fait défiler le formulaire, pour rester accessibles sur téléphone.
  (() => {
    let raf = 0;
    function place() {
      raf = 0;
      const mb = document.getElementById('mode-bar');
      const top = mb && !mb.hidden ? Math.max(0, mb.getBoundingClientRect().bottom) : 0;
      document.querySelectorAll('.secnav').forEach(nav => {
        let ph = nav.previousElementSibling;
        if (!ph || !ph.classList.contains('secnav-ph')) {
          ph = document.createElement('div');
          ph.className = 'secnav-ph';
          nav.before(ph);
        }
        const form = nav.parentElement;
        if (!nav.offsetParent && !nav.classList.contains('floating')) return;
        if (!form || form.offsetParent === null) { nav.classList.remove('floating'); ph.style.height = ''; return; }
        const phTop = ph.getBoundingClientRect().top;
        const formBottom = form.getBoundingClientRect().bottom;
        const h = nav.offsetHeight;
        const float = phTop < top && formBottom > top + h + 40;
        if (float) {
          if (!nav.classList.contains('floating')) { ph.style.height = h + 'px'; nav.classList.add('floating'); }
          nav.style.top = top + 'px';
        } else if (nav.classList.contains('floating')) {
          nav.classList.remove('floating'); nav.style.top = ''; ph.style.height = '';
        }
      });
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (typeof MutationObserver === 'function') new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  })();

  // Barre animée sous chaque message « Chargement… » / « Mise à jour… » affiché dans
  // une rubrique (listes, livret, formulaires, carte) : repérée automatiquement.
  (() => {
    const RE = /^\s*(Chargement|Mise à jour)[^\n]*…\s*$/;
    const check = el => {
      if (!el || el.nodeType !== 1 || el.children.length || el.closest('#view-loading')) return;
      el.classList.toggle('is-loading', RE.test(el.textContent || ''));
    };
    const scan = root => {
      check(root);
      if (root.querySelectorAll) root.querySelectorAll('p, span, div').forEach(check);
    };
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(list => list.forEach(m => {
      const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      check(t);
      m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); });
    })).observe(document.body, { childList: true, characterData: true, subtree: true });
    scan(document.body);
  })();

  async function api(action, payload = {}) {
    progress.start();
    try { return await apiCall(action, payload); }
    finally { progress.end(); }
  }

  async function apiCall(action, payload) {
    let res;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), LONG_ACTIONS.test(action) ? API_TIMEOUT_LONG : API_TIMEOUT) : null;
    try {
      // text/plain : évite la requête préliminaire CORS, non gérée par Apps Script
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new NetworkError(e && e.name === 'AbortError' ? 'Réseau trop lent' : 'Réseau indisponible');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new NetworkError('Réponse inattendue du serveur'); }
    finally { clearTimeout(timer); }
    if (!data.ok) throw new Error(data.error || 'Erreur');
    return data;
  }

  // ---------- bandeau : nom et fonction de l'utilisateur ----------
  function setIdentity(title, sub) {
    $('#top-title').textContent = title;
    $('#top-sub').textContent = sub;
  }

  // ---------- navigation ----------
  const views = ['loading', 'login', 'activate', 'verify', 'app'];
  function show(name) {
    views.forEach(v => { $('#view-' + v).hidden = v !== name; });
    $('#btn-logout').hidden = name !== 'app';
    $('#btn-menu').hidden = name !== 'app';
    $('#btn-sync').hidden = name !== 'app';
    // Le nom ne mène à « Mon profil » qu'une fois connecté
    $('#btn-identity').disabled = name !== 'app';
    $('#btn-identity').title = name === 'app' ? 'Mon profil' : '';
    $('#mode-bar').hidden = name !== 'app';
    if (name !== 'app') {
      closeMenu();
      if (window.SMPM_NOTIFS) window.SMPM_NOTIFS.reset();
      setIdentity('SMPM 84', 'Secours en milieu périlleux et montagne');
    }
    $$('.error, .ok').forEach(p => { p.textContent = ''; });
    if (name === 'login') resetLogin();
  }

  // ---------- état de la connexion (remplace le formulaire) ----------
  // phase : 'idle' (formulaire), 'busy' (en cours), 'ok' (réussie), 'fail' (échec)
  function setLoginPhase(phase, detail) {
    const idle = phase === 'idle';
    $('#form-login').hidden = !idle;
    $$('.login-links').forEach(p => { p.hidden = !idle; });
    const box = $('#login-status');
    box.hidden = idle;
    box.dataset.phase = phase;
    const texts = { busy: 'Connexion en cours…', ok: 'Connexion réussie', fail: 'Échec de connexion' };
    const icons = { busy: '', ok: '✓', fail: '✕' };
    $('#login-title').textContent = texts[phase] || '';
    $('#login-icon').textContent = icons[phase] || '';
    $('#login-icon').classList.toggle('spin', phase === 'busy');
    $('#login-detail').textContent = detail || '';
    const retry = $('#login-retry');
    retry.hidden = phase !== 'fail';
    if (phase === 'fail') retry.focus();
  }
  function resetLogin() { setLoginPhase('idle'); }

  // ---------- menu burger ----------
  function openMenu() {
    $('#drawer').classList.add('open');
    $('#scrim').hidden = false;
    $('#btn-menu').setAttribute('aria-expanded', 'true');
    const cur = $('#drawer .drawer-nav button[aria-current="page"]') || $('#drawer .drawer-nav button:not([hidden])');
    if (cur) cur.focus();
  }
  function closeMenu() {
    const drawer = $('#drawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    $('#scrim').hidden = true;
    $('#btn-menu').setAttribute('aria-expanded', 'false');
  }
  // Message affiché en tête de la page d'arrivée ; il disparaît au changement de page suivant
  let pendingFlash = null;
  function flash(opts) { pendingFlash = opts; }
  function showFlash(opts) {
    const box = $('#flash');
    if (!opts) { box.hidden = true; box.replaceChildren(); return; }
    box.className = 'flash flash-' + (opts.kind || 'info');
    const txt = document.createElement('span');
    txt.textContent = opts.text + (opts.link ? ' ' : '');
    if (opts.link) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'link';
      a.textContent = opts.link.label;
      a.addEventListener('click', () => gotoPage(opts.link.page));
      txt.append(a, document.createTextNode('.'));
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'flash-close';
    x.setAttribute('aria-label', 'Fermer le message');
    x.textContent = '×';
    x.addEventListener('click', () => showFlash(null));
    box.replaceChildren(txt, x);
    box.hidden = false;
  }

  function gotoPage(name) {
    // notification d'alerte d'inventaire : rubrique Inventaire ouverte sur l'onglet Alertes
    if (name === 'inventaire-alertes') { if (window.SMPM_INV) window.SMPM_INV.ongletAlertes(); name = 'inventaire'; }
    if (!allowedPage(name, state.data && state.data.session)) name = 'livret';
    showFlash(pendingFlash);
    pendingFlash = null;
    if (state.page !== name) state.prevPage = state.page;
    state.page = name;
    $$('.drawer-nav button[data-page]').forEach(b => {
      if (b.dataset.page === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#tab-livret').hidden = name !== 'livret';
    $('#tab-livret-remplir').hidden = name !== 'livret-remplir';
    $('#tab-livret-themes').hidden = name !== 'livret-themes';
    $('#tab-profil').hidden = name !== 'infos';
    $('#tab-fiches').hidden = name !== 'fiches';
    $('#tab-notices').hidden = name !== 'notices';
    CS_PAGES.forEach(p => { $('#tab-' + p).hidden = name !== p; });
    if (name === 'cs-heures-toutes') $('#tab-cs-heures').hidden = false;
    $('#tab-bug').hidden = name !== 'bug';
    $('#tab-accueil').hidden = name !== 'accueil';
    $('#tab-annuaire').hidden = name !== 'annuaire';
    $('#tab-poi').hidden = name !== 'poi';
    $('#tab-inventaire').hidden = name !== 'inventaire';
    $('#tab-fmpa').hidden = !(name === 'fmpa' || name === 'fmpa-fiche');
    $('#tab-fmpa-list').hidden = !FMPA_LISTS.includes(name);
    $('#tab-fmpa-valid').hidden = name !== 'fmpa-valid';
    $('#tab-interv-new').hidden = !(name === 'interv-new' || name === 'interv-fiche');
    $('#tab-interv-mes').hidden = !(name === 'interv-mes' || name === 'interv-toutes');
    updateHomeBtn();
    if (window.SMPM_NOTIFS) window.SMPM_NOTIFS.close();
    if (name.startsWith('fmpa')) setFmpaGroup(true);
    if (name.startsWith('interv-')) setIntervGroup(true);
    if (name.startsWith('livret')) setLivretGroup(true);
    if (name === 'fiches' || name === 'notices') setDocGroup(true);
    window.scrollTo(0, 0);
    if (name === 'bug' && window.SMPM_BUGS) window.SMPM_BUGS.open(state.prevPage);
    if ((name === 'fiches' || name === 'notices') && window.SMPM_FICHES) window.SMPM_FICHES.open();
    if (name === 'annuaire' && window.SMPM_ANNUAIRE) window.SMPM_ANNUAIRE.open();
    if (name === 'poi' && window.SMPM_POI) window.SMPM_POI.open();
    if (name === 'inventaire' && window.SMPM_INV) window.SMPM_INV.open();
    if (name === 'livret' && window.SMPM_CSH) window.SMPM_CSH.home(state.year);
    if (name.startsWith('cs-heures')) setCshGroup(true);
    if (name.startsWith('cs-heures') && window.SMPM_CSH) window.SMPM_CSH.open(name);
    if (name === 'cs-specialistes' && window.SMPM_PERSONNEL) window.SMPM_PERSONNEL.open();
    if (name === 'livret-remplir' && window.SMPM_THEMES) window.SMPM_THEMES.open();
    if (name === 'livret-themes' && window.SMPM_THEMES_VUS) window.SMPM_THEMES_VUS.open();
    if (name === 'fmpa' && window.SMPM_FMPA) window.SMPM_FMPA.open();
    if (name === 'interv-new' && window.SMPM_ITV) window.SMPM_ITV.open();
    if (name === 'interv-mes' && window.SMPM_ITV) window.SMPM_ITV.renderPending();
    if ((name === 'interv-mes' || name === 'interv-toutes') && window.SMPM_ITV_LIST) window.SMPM_ITV_LIST.open(name);
    if (FMPA_LISTS.includes(name) && window.SMPM_FMPA_LIST) window.SMPM_FMPA_LIST.open(name);
    if (name === 'fmpa-valid' && window.SMPM_FMPA_VALID) window.SMPM_FMPA_VALID.open();
    closeMenu();
  }

  // Sous-menu FMPA (repliable)
  function setFmpaGroup(open) {
    $('#nav-fmpa .nav-group-btn').setAttribute('aria-expanded', String(open));
    $('#nav-fmpa-sub').hidden = !open;
  }

  // Sous-menu Intervention (repliable)
  function setIntervGroup(open) {
    $('#nav-interv .nav-group-btn').setAttribute('aria-expanded', String(open));
    $('#nav-interv-sub').hidden = !open;
  }

  // Sous-menu Mon livret (repliable, ouvert par défaut)
  function setLivretGroup(open) {
    $('#nav-livret .nav-group-btn').setAttribute('aria-expanded', String(open));
    $('#nav-livret-sub').hidden = !open;
  }

  // Sous-menu Heures chefs de section (repliable) : Mes heures, Toutes les heures
  function setCshGroup(open) {
    $('#nav-csh .nav-group-btn').setAttribute('aria-expanded', String(open));
    $('#nav-csh-sub').hidden = !open;
  }

  // Sous-menu Documentation (repliable) : FTE et Notices
  function setDocGroup(open) {
    $('#nav-doc .nav-group-btn').setAttribute('aria-expanded', String(open));
    $('#nav-doc-sub').hidden = !open;
  }

  // Bandeau « hors ligne » : tant qu'il est affiché, on retente la connexion en arrière-plan.
  // Sans cela, un échec ponctuel d'appel réseau (le téléphone étant pourtant en ligne) laissait le bandeau
  // jusqu'à un événement « online » qui ne vient pas si la connexion n'a jamais été coupée.
  // « Hors ligne » seulement si le téléphone n'a réellement pas de réseau.
  // Un serveur lent ou occupé (Apps Script) n'est pas une absence de réseau : les données de
  // l'appareil restent affichées, sans bandeau, et une nouvelle tentative est faite chaque minute.
  let retryTimer = null;
  let serverBusy = false;
  function updateRetryTimer() {
    const need = !$('#offline-banner').hidden || serverBusy;
    if (need && !retryTimer) retryTimer = setInterval(retryOnline, 60000);
    if (!need && retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  }
  function setOffline(flag) {
    $('#offline-banner').hidden = !flag;
    if (flag) serverBusy = false;
    updateRetryTimer();
  }
  function setServerBusy(flag) {
    serverBusy = flag;
    updateRetryTimer();
  }
  // Test du réseau indépendant du serveur : petit fichier du site, jamais servi par le cache (voir sw.js)
  async function hasNetwork() {
    if (!navigator.onLine) return false;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      await fetch('ping.txt?t=' + Date.now(), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      return true;
    } catch (e) {
      return false;
    } finally { clearTimeout(timer); }
  }
  // Après un échec d'appel au serveur : bandeau si pas de réseau, sinon simple nouvel essai plus tard
  async function onServerUnreachable() {
    if (await hasNetwork()) { setOffline(false); setServerBusy(true); return 'busy'; }
    setOffline(true);
    return 'offline';
  }
  async function retryOnline() {
    const token = store.get(KEY_TOKEN);
    const cached = store.getJSON(KEY_CACHE);
    if (!token || !cached || !cached.data || !navigator.onLine) return;
    if ($('#offline-banner').hidden && !serverBusy) return;
    // Un seul appel léger pour tester le serveur ; le profil n'est rechargé qu'ensuite
    try { await api('session', { token }); }
    catch (e) {
      if (AUTH_ERRORS.includes(e.message)) return logout();
      if (e instanceof NetworkError) await onServerUnreachable();
      return;
    }
    await refreshProfile(token, cached);
    if ($('#offline-banner').hidden && !serverBusy) {   // serveur joignable : livret et saisies en attente
      loadLivret();
      if (window.SMPM_FMPA) window.SMPM_FMPA.flush();
      if (window.SMPM_ITV) window.SMPM_ITV.flush();
      if (window.SMPM_THEMES) window.SMPM_THEMES.flush();
      if (window.SMPM_POI) { window.SMPM_POI.flush(); window.SMPM_POI.prefetch(); }
      if (window.SMPM_INV) window.SMPM_INV.flush();
    }
  }

  function setBusy(form, busy) {
    $$('button[type="submit"]', form).forEach(b => { b.disabled = busy; });
  }

  function showError(form, msg) { $('.error', form).textContent = msg; }

  // ---------- mode intervention ----------
  // Bascule toujours visible ; en intervention, les couleurs passent au rouge
  // et l'accueil propose annuaire des spécialistes, points d'intérêt, fiches techniques.
  const isIntervention = () => document.body.classList.contains('mode-intervention');
  function applyMode(on) {
    document.body.classList.toggle('mode-intervention', on);
    store.set(KEY_MODE, on ? 'intervention' : 'normal');
    $('#btn-intervention').setAttribute('aria-pressed', String(on));
    $('#btn-intervention').title = on ? 'Quitter le mode intervention' : 'Activer le mode intervention';
    $('#drawer [data-page="accueil"]').hidden = !on;
    updateHomeBtn();
    updateMetaTheme();
  }

  // Bouton « Accueil », toujours visible (barre du mode intervention) :
  // accueil principal (livret) ou accueil intervention si le mode est activé
  function updateHomeBtn() {
    const b = $('#btn-home');
    if (!b) return;
    const on = isIntervention();
    b.title = on ? "Retour à l'accueil intervention" : "Retour à l'accueil";
    b.setAttribute('aria-label', b.title);
    if (state.page === (on ? 'accueil' : 'livret')) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }

  // ---------- thème clair / sombre ----------
  // auto : suit le téléphone (prefers-color-scheme) ; light / dark : forcé via data-theme sur <html>.
  // Le bandeau passe sur la scène de nuit en sombre (source <picture> #banner-night).
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const themeChoice = () => { const t = store.get(KEY_THEME); return t === 'light' || t === 'dark' ? t : 'auto'; };
  const isDark = () => { const t = themeChoice(); return t === 'dark' || (t === 'auto' && !!(darkMQ && darkMQ.matches)); };
  function updateMetaTheme() {
    const meta = $('#meta-theme');
    if (!meta) return;
    const dark = isDark();
    meta.setAttribute('content', isIntervention() ? (dark ? '#3d0812' : '#b3132b') : (dark ? '#060914' : '#1d4f91'));
  }
  function applyTheme(choice) {
    if (choice === 'light' || choice === 'dark') {
      store.set(KEY_THEME, choice);
      document.documentElement.setAttribute('data-theme', choice);
    } else {
      store.del(KEY_THEME);
      document.documentElement.removeAttribute('data-theme');
    }
    const night = $('#banner-night');
    if (night) night.media = choice === 'dark' ? 'all' : choice === 'light' ? 'not all' : '(prefers-color-scheme: dark)';
    $$('#theme-seg [data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === themeChoice())));
    updateMetaTheme();
    updateSky();
  }

  // Soleil / lune dans le ciel du bandeau, sous le menu : interrupteur clair ↔ sombre.
  function updateSky() {
    const b = $('#btn-sky');
    if (!b) return;
    const dark = isDark();
    const label = dark ? 'Passer en thème clair' : 'Passer en thème sombre';
    b.setAttribute('aria-pressed', String(dark));
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  // fondu jour ↔ nuit : copie de l'image affichée, effacée une fois la nouvelle image chargée
  function skyCrossfade(change) {
    const img = $('.landscape picture img');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!img || !img.currentSrc || reduce) { change(); return; }
    const cs = getComputedStyle(img);
    const old = img.currentSrc;
    const ghost = document.createElement('img');
    ghost.className = 'sky-fade';
    ghost.alt = '';
    ghost.src = old;
    Object.assign(ghost.style, {
      left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.clientWidth + 'px', height: img.clientHeight + 'px',
      objectFit: cs.objectFit, objectPosition: cs.objectPosition, filter: cs.filter,
      webkitMaskImage: cs.webkitMaskImage || '', maskImage: cs.maskImage || '',
    });
    img.closest('.landscape').insertBefore(ghost, $('#btn-sky'));  // sous le soleil / la lune
    let done = false;
    const fade = () => {
      if (done) return;
      done = true;
      requestAnimationFrame(() => { ghost.style.opacity = '0'; });
      setTimeout(() => ghost.remove(), 900);
    };
    change();
    if (img.currentSrc === old || img.complete) setTimeout(fade, 30);
    img.addEventListener('load', fade, { once: true });
    setTimeout(fade, 3000);
  }
  applyTheme(themeChoice());
  $$('#theme-seg [data-theme-choice]').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
  if ($('#btn-sky')) {
    $('#btn-sky').addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      skyCrossfade(() => applyTheme(next));
    });
  }
  if (darkMQ) {
    const onScheme = () => { updateMetaTheme(); updateSky(); };
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', onScheme);
    else if (darkMQ.addListener) darkMQ.addListener(onScheme);
  }
  function toggleMode() {
    const on = !isIntervention();
    applyMode(on);
    gotoPage(on ? 'accueil' : 'livret');
  }

  // ---------- session ----------
  // explicit : déconnexion volontaire (bouton), tout est effacé de l'appareil ;
  // sinon (session expirée) les déclarations de FMPA non envoyées sont conservées
  function logout(explicit) {
    if (window.SMPM_PUSH) window.SMPM_PUSH.reset(store.get(KEY_TOKEN));   // avant la suppression du jeton
    if (window.SMPM_NOTIFS) window.SMPM_NOTIFS.reset();
    store.del(KEY_TOKEN);
    store.del(KEY_CACHE);          // important sur un appareil partagé
    store.del(KEY_LIVRET);
    store.del(KEY_MODE);
    if (window.SMPM_FMPA) window.SMPM_FMPA.reset(explicit === true);
    if (window.SMPM_ITV) window.SMPM_ITV.reset(explicit === true);
    if (window.SMPM_ITV_LIST) window.SMPM_ITV_LIST.reset();
    if (window.SMPM_ANNUAIRE) window.SMPM_ANNUAIRE.reset();
    if (window.SMPM_PERSONNEL) window.SMPM_PERSONNEL.reset();
    if (window.SMPM_POI) window.SMPM_POI.reset(explicit === true);
    if (window.SMPM_INV) window.SMPM_INV.reset(explicit === true);
    if (window.SMPM_FMPA_LIST) window.SMPM_FMPA_LIST.reset();
    if (window.SMPM_FMPA_VALID) window.SMPM_FMPA_VALID.reset();
    if (window.SMPM_THEMES) window.SMPM_THEMES.reset(explicit === true);
    applyMode(false);
    state.data = null;
    state.livret = null;
    state.year = null;
    show('login');
  }

  const state = { data: null, options: null, pendingEmail: '', mode: 'activate', livret: null, year: null };

  async function init() {
    const token = store.get(KEY_TOKEN);
    if (!token) { prefillEmail(); return show('login'); }

    const cached = store.getJSON(KEY_CACHE);
    if (!navigator.onLine) {
      if (cached) return enterApp(cached.data, cached.options, true);
      return show('login');
    }
    // Démarrage immédiat sur les données de l'appareil : le profil est rafraîchi en arrière-plan
    if (cached && cached.data) {
      enterApp(cached.data, cached.options, false);
      return refreshProfile(token, cached);
    }
    try {
      const [data, options] = await fetchProfile(token, null);
      store.set(KEY_CACHE, JSON.stringify({ data, options }));
      enterApp(data, options, false);
    } catch (e) {
      if (e instanceof NetworkError) { prefillEmail(); return show('login'); }
      if (AUTH_ERRORS.includes(e.message)) { logout(); return; }
      prefillEmail();
      show('login');
    }
  }

  // Profil et listes de choix demandés en parallèle (et non plus l'un après l'autre)
  // Profil, listes de choix et fonction en un seul appel (« boot ») : 1 exécution Apps Script par ouverture
  // au lieu de 3. Tant que le serveur ne connaît pas « boot », on revient aux trois appels séparés.
  let bootUnknown = false;
  function applyFonction(data, fonction) {
    if (fonction && fonction.ok) data.fonction = { libelle: fonction.libelle || '', sections: fonction.sections || [], imp3: !!fonction.imp3,
      ctrl_epi: !!fonction.ctrl_epi, ctrl_epi_secteur: fonction.ctrl_epi_secteur || '' };
    else if (state.data && state.data.fonction) data.fonction = state.data.fonction;
  }
  async function fetchProfile(token, oldOptions) {
    if (!bootUnknown) {
      try {
        const r = await api('boot', { token });
        const data = r.me;
        applyFonction(data, r.fonction);
        return [data, (r.options && r.options.ok) ? r.options : oldOptions];
      } catch (e) {
        if (e.message !== 'Action inconnue') throw e;
        bootUnknown = true;
      }
    }
    const pOptions = api('options', { token }).catch(() => oldOptions);
    // Fonction SMPM (onglet « CT et CdS ») : libellé, sections, IMP3 — facultatif si le serveur ne la connaît pas encore
    const pFonction = api('fonction', { token }).catch(() => null);
    const data = await api('me', { token });
    applyFonction(data, await pFonction);
    return [data, await pOptions];
  }

  // Rafraîchissement silencieux après un démarrage sur le cache
  async function refreshProfile(token, cached) {
    document.body.classList.add('profile-syncing');
    try {
      const [data, options] = await fetchProfile(token, cached.options || null);
      if (store.get(KEY_TOKEN) !== token) return;           // déconnecté entre-temps
      store.set(KEY_CACHE, JSON.stringify({ data, options }));
      state.data = data;
      state.options = options;
      setOffline(false);
      setServerBusy(false);
      const form = $('#form-profil');
      // ne pas écraser une saisie en cours dans « Mon profil »
      if (!(form && form.contains(document.activeElement))) renderApp();
      if (window.SMPM_CARTE) window.SMPM_CARTE.setAllowed(canDeclare(data.session));
      if (window.SMPM_PUSH) window.SMPM_PUSH.setSession(data.session);
      if (state.page && !allowedPage(state.page, data.session)) gotoPage(isIntervention() ? 'accueil' : 'livret');
    } catch (e) {
      if (AUTH_ERRORS.includes(e.message)) { logout(); return; }
      if (e instanceof NetworkError) await onServerUnreachable();
    } finally {
      document.body.classList.remove('profile-syncing');
    }
  }

  function prefillEmail() {
    const last = store.get(KEY_EMAIL);
    if (last) $$('input[name="email"]').forEach(i => { if (!i.value) i.value = last; });
  }

  // ---------- application ----------
  // Page à ouvrir au démarrage, transmise par une notification (?page=…)
  let startPage = new URLSearchParams(location.search).get('page');
  let startNotif = new URLSearchParams(location.search).get('notif');   // notification touchée : lue

  // Page demandée par une notification : « notifs » = clochette ouverte sur l'accueil
  function ouvrirDepuisNotif(p, notif) {
    if (notif && window.SMPM_NOTIFS && window.SMPM_NOTIFS.lue) window.SMPM_NOTIFS.lue(notif, 'clic');
    if (p === 'notifs') {
      if (!state.page) gotoPage(isIntervention() ? 'accueil' : 'livret');
      if (window.SMPM_NOTIFS && window.SMPM_NOTIFS.open) window.SMPM_NOTIFS.open();
      return;
    }
    if (window.SMPM_NOTIFS) window.SMPM_NOTIFS.close();
    gotoPage(p);
  }

  function enterApp(data, options, offline) {
    const wasInApp = !$('#view-app').hidden;
    state.data = data;
    state.options = options;
    setOffline(offline);
    renderApp();
    if (window.SMPM_CARTE) window.SMPM_CARTE.setAllowed(canDeclare(data.session));
    if (window.SMPM_PUSH) window.SMPM_PUSH.setSession(data.session);
    show('app');
    if (window.SMPM_NOTIFS) window.SMPM_NOTIFS.setSession(data.session, offline);
    applyMode(store.get(KEY_MODE) === 'intervention');
    // Au retour du réseau, on rafraîchit sans quitter la page en cours (ex. déclaration de FMPA en cours de saisie)
    if (startPage) {
      // ouverture depuis une notification (ex. ?page=fmpa-valid) : page demandée, une seule fois
      const p = startPage;
      const n = startNotif;
      startPage = null;
      startNotif = null;
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      ouvrirDepuisNotif(p, n);
    } else if (!(state.keepPage && wasInApp && state.page)) gotoPage(isIntervention() ? 'accueil' : 'livret');
    state.keepPage = false;
    // Livret : affichage immédiat depuis l'appareil, puis rafraîchissement si en ligne
    const cachedLivret = store.getJSON(KEY_LIVRET);
    if (cachedLivret) state.livret = cachedLivret;
    renderLivret(offline ? 'offline' : (cachedLivret ? 'refreshing' : 'loading'));
    if (!offline) loadLivret();
    // déclarations de FMPA saisies hors ligne : envoi dès que possible
    if (window.SMPM_FMPA) { window.SMPM_FMPA.renderPending(); if (!offline) window.SMPM_FMPA.flush(); }
    // interventions saisies hors ligne : idem
    if (window.SMPM_ITV && canIntervene(data.session)) {
      window.SMPM_ITV.renderPending();
      // formulaire gardé sur l'appareil dès l'ouverture : saisie possible ensuite sans réseau
      if (!offline) { window.SMPM_ITV.flush(); window.SMPM_ITV.prefetch(); }
    }
    // thèmes saisis hors ligne (Remplir mon livret) : envoi dès que possible
    if (!offline && window.SMPM_THEMES) window.SMPM_THEMES.flush();
    // points d'intérêt : liste gardée sur l'appareil pour une consultation hors ligne
    if (!offline && window.SMPM_POI) { window.SMPM_POI.flush(); window.SMPM_POI.prefetch(); }
    // inventaire : saisies hors ligne envoyées, données gardées sur l'appareil (inventaire au garage sans réseau)
    if (window.SMPM_INV) { window.SMPM_INV.renderPending(); if (!offline) { window.SMPM_INV.flush(); window.SMPM_INV.prefetch(); } }
    // demandes de validation des thèmes en attente : compteur du menu
    // (compteur affiché tout de suite depuis l'appareil, puis rafraîchi : menu, bouton ☰ et icône de l'application)
    if (canDeclare(data.session) && window.SMPM_FMPA_VALID) window.SMPM_FMPA_VALID.refresh();
  }

  // ---------- livret individuel : compteurs d'heures et formations ----------
  const SMPM_SECTEURS = ['CENTRE', 'NORD', 'SUD'];
  const CATS = [
    { key: 'SMPM', label: 'SMPM', sub: 'Nord · Sud · Centre' },
    { key: 'NEIGE', label: 'Neige', sub: 'Milieu enneigé' },
    { key: 'ISS', label: 'ISS', sub: 'Site souterrain' },
    { key: 'SSH', label: 'SSH', sub: 'Secours héliporté' },
    { key: 'CAN', label: 'Canyon', sub: 'Milieu aquatique' },
  ];
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmtH = n => nf.format(n) + ' h';
  const catOf = secteur => (SMPM_SECTEURS.includes(secteur) ? 'SMPM' : secteur);

  async function loadLivret() {
    const token = store.get(KEY_TOKEN);
    if (!token) return;
    try {
      const res = await api('livret', { token });
      state.livret = res.livret;
      store.set(KEY_LIVRET, JSON.stringify(res.livret));
      renderLivret('ok');
      setServerBusy(false);
    } catch (err) {
      if (AUTH_ERRORS.includes(err.message)) return logout();
      if (err instanceof NetworkError) {
        const why = await onServerUnreachable();
        if (why === 'busy') return renderLivret(state.livret ? 'busy' : 'error', 'Serveur occupé, nouvel essai automatique.');
        return renderLivret(state.livret ? 'offline' : 'error', 'Réseau indisponible.');
      }
      if (err.message === 'Action inconnue') return renderLivret('error', "Le livret n'est pas encore activé sur le serveur.");
      renderLivret('error', err.message);
    }
  }

  function livretYears(formations, validations) {
    const set = new Set([new Date().getFullYear()]);
    formations.forEach(f => set.add(Number(f.date.slice(0, 4))));
    Object.keys((validations && validations.annees) || {}).forEach(y => set.add(Number(y)));
    return Array.from(set).sort((a, b) => b - a);
  }

  function renderLivret(status, message) {
    const L = state.livret;
    const stateEl = $('#livret-state');
    const majTxt = L && L.maj ? new Date(L.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    stateEl.classList.toggle('error', status === 'error');
    stateEl.textContent =
      status === 'loading' ? 'Chargement du livret…' :
      status === 'refreshing' ? 'Mise à jour…' :
      status === 'offline' ? (L ? `Hors ligne : données du ${majTxt}.` : 'Hors ligne : livret indisponible sur cet appareil.') :
      status === 'busy' ? `Serveur occupé : données du ${majTxt}. Nouvel essai automatique.` :
      status === 'error' ? (message || 'Livret indisponible.') + (L ? ` Données du ${majTxt}.` : '') : '';

    const formations = (L && L.formations) || [];
    const sel = $('#livret-year');
    const years = livretYears(formations, L && L.validations);
    if (!state.year || !years.includes(state.year)) state.year = years[0];
    sel.replaceChildren(...years.map(y => new Option(String(y), String(y))));
    sel.value = String(state.year);
    sel.disabled = !L;
    renderLivretYear();
    // Thèmes vus : même livret, rafraîchi en même temps (si la page est affichée)
    if (window.SMPM_THEMES_VUS) window.SMPM_THEMES_VUS.render();
  }

  // Partie qui dépend de l'année choisie dans la liste déroulante
  function renderLivretYear() {
    const L = state.livret;
    const year = state.year;
    const list = ((L && L.formations) || []).filter(f => f.date.startsWith(String(year)));
    renderCounters(L, list, year);
    if (window.SMPM_CSH) window.SMPM_CSH.home(year);
    renderValidations(L, year);
    renderFormations(L, list, year);
  }

  // Validation annuelle : gris = non effectuée, vert = validée, rouge = non validée
  const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

  function renderValidations(L, year) {
    const sec = $('#livret-valid');
    const V = L && L.validations;
    const criteres = (V && V.criteres) || [];
    sec.hidden = !criteres.length;
    if (!criteres.length) return;
    $('#livret-valid-title').textContent = `Validation annuelle ${year}`;
    const res = (V.annees && V.annees[String(year)]) || [];
    const pdfs = (L.evaluations && L.evaluations[String(year)]) || [];

    $('#livret-valid-list').replaceChildren(...criteres.map((c, i) => {
      const r = res[i];
      const st = r ? r.statut : (c.requis ? 'todo' : 'na');
      const li = document.createElement('li');
      li.className = 'valid valid-' + st;

      const ico = document.createElement('span');
      ico.className = 'valid-ico';
      ico.setAttribute('aria-hidden', 'true');
      ico.textContent = st === 'valide' ? '✓' : st === 'non_valide' ? '✕' : '';

      const txt = document.createElement('div');
      const lab = document.createElement('p');
      lab.className = 'valid-label';
      lab.textContent = c.label;
      const sub = document.createElement('p');
      sub.className = 'valid-sub';
      const qui = r && r.evaluateur ? r.evaluateur : '';
      const quand = r && r.date ? fmtDate(r.date) : '';
      const detail = [qui, quand].filter(Boolean).join(' · ');
      sub.textContent =
        st === 'valide' ? `Validé${detail ? ' — ' + detail : ''}` :
        st === 'non_valide' ? `Non validé${detail ? ' — ' + detail : ''}` :
        st === 'na' ? 'Non requis à votre niveau' : 'Non effectué';
      txt.append(lab, sub);
      if (c.eval && pdfs.includes(c.eval)) {  // affiché dès que le PDF existe
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'valid-pdf';
        btn.textContent = "📄 Consulter l'évaluation (PDF)";
        btn.addEventListener('click', () => openEvaluationPdf(year, c.eval, btn));
        txt.append(btn);
      }

      li.append(ico, txt);
      return li;
    }));
  }

  // PDF d'évaluation annuelle : téléchargé via le serveur (l'agent n'a pas forcément accès au Drive)
  async function openEvaluationPdf(year, type, btn) {
    const token = store.get(KEY_TOKEN);
    if (!token) return;
    const win = window.open('', '_blank');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Ouverture…';
    try {
      const res = await api('livret_pdf', { token, annee: String(year), type });
      const bin = atob(res.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (win) win.location.href = url;
      else { const a = document.createElement('a'); a.href = url; a.download = res.nom || `evaluation-${year}-${type}.pdf`; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (win) win.close();
      if (AUTH_ERRORS.includes(err.message)) return logout();
      alert(err instanceof NetworkError ? 'Réseau indisponible : évaluation non consultable hors ligne.' : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // Camembert (anneau SVG) : rempli selon le % du quota ; rouge et battant à 100 % et plus
  function pieChart(pct, full) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'pie' + (full ? ' pie-full' : ''));
    svg.setAttribute('aria-hidden', 'true');
    const R = 50, C = 2 * Math.PI * R;
    const bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('class', 'pie-bg');
    const fg = document.createElementNS(NS, 'circle');
    fg.setAttribute('class', 'pie-fg');
    [bg, fg].forEach(c => { c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', String(R)); });
    fg.setAttribute('stroke-dasharray', `0 ${C}`);
    fg.dataset.to = String(C * Math.min(pct, 100) / 100);
    fg.dataset.c = String(C);
    fg.setAttribute('transform', 'rotate(-90 60 60)');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '60'); t.setAttribute('y', '60');
    t.setAttribute('class', 'pie-pct');
    t.textContent = '0 %';
    t.dataset.to = String(pct);
    svg.append(bg, fg, t);
    return svg;
  }

  // Position RH d'une FMPA : repos, temps de travail (TT) ou non renseignée
  function positionRH(p) {
    const s = String(p || '').toLowerCase();
    if (/repos/.test(s)) return 'repos';
    if (/travail|\btt\b/.test(s)) return 'tt';
    return 'autre';
  }

  /** Barre Repos / TT sous un compteur, avec légende (heures et %). */
  function repartitionRH(r, total) {
    r = r || { repos: 0, tt: 0, autre: 0 };
    const pct = h => Math.round(h / total * 100);
    const parts = [['repos', 'Repos'], ['tt', 'TT'], ['autre', 'Non renseigné']].filter(([k]) => r[k] > 0);
    const wrap = document.createElement('div');
    wrap.className = 'rh';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Répartition : ' + parts.map(([k, l]) => `${l} ${fmtH(r[k])} (${pct(r[k])} %)`).join(', '));
    const bar = document.createElement('div');
    bar.className = 'rh-bar';
    parts.forEach(([k]) => {
      const s = document.createElement('span');
      s.className = 'rh-' + k;
      s.style.width = (r[k] / total * 100) + '%';
      bar.append(s);
    });
    const leg = document.createElement('p');
    leg.className = 'rh-legend';
    parts.forEach(([k, l]) => {
      const i = document.createElement('span');
      const dot = document.createElement('i');
      dot.className = 'rh-' + k;
      i.append(dot, document.createTextNode(`${l} ${fmtH(r[k])} · ${pct(r[k])} %`));
      leg.append(i);
    });
    wrap.append(bar, leg);
    return wrap;
  }

  function renderCounters(L, list, year) {
    const box = $('#livret-counters');
    if (!L) { box.replaceChildren(); return; }
    const quotas = L.quotas || {};
    const hours = {};
    const rh = {};                       // heures par catégorie et position RH : { SMPM: { repos, tt, autre } }
    list.forEach(f => {
      const c = catOf(f.secteur), h = Number(f.heures) || 0;
      hours[c] = (hours[c] || 0) + h;
      const r = rh[c] || (rh[c] = { repos: 0, tt: 0, autre: 0 });
      r[positionRH(f.position)] += h;
    });

    const cards = CATS.filter(c => {
      if (c.key === 'SMPM') return true;
      const q = quotas[c.key];
      return (q && (!q.depuis || q.depuis <= year)) || hours[c.key] > 0;
    }).map(c => {
      const done = hours[c.key] || 0;
      const q = quotas[c.key] && (!quotas[c.key].depuis || quotas[c.key].depuis <= year) ? Number(quotas[c.key].quota) || 0 : 0;
      // Paliers : bleu < 80 %, orange à partir de 80 %, rouge une fois le quota atteint
      const level = !q ? '' : done >= q ? ' full' : done >= q * 0.8 ? ' warn' : '';

      const card = document.createElement('article');
      card.className = 'counter' + level + (q ? '' : ' no-quota');
      const head = document.createElement('div');
      head.className = 'counter-head';
      const name = document.createElement('strong');
      name.textContent = c.label;
      const sub = document.createElement('span');
      sub.textContent = c.sub;
      head.append(name, sub);

      const val = document.createElement('p');
      val.className = 'counter-value';
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = '0';
      big.dataset.to = String(done);
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = q ? ` / ${nf.format(q)} h` : ' h';
      val.append(big, unit);
      card.append(head, val);

      if (q) {
        const realPct = Math.round(done / q * 100);
        const fig = document.createElement('div');
        fig.className = 'pie-wrap';
        fig.setAttribute('role', 'img');
        fig.setAttribute('aria-label', `${c.label} : ${fmtH(done)} sur ${fmtH(q)}, ${realPct} %`);
        fig.append(pieChart(realPct, done >= q));
        card.append(fig);
        const note = document.createElement('p');
        if (done >= q) {
          note.className = 'counter-alert';
          note.setAttribute('role', 'note');
          note.textContent = 'STOP FMPA cette année';
        } else {
          note.className = 'counter-note';
          note.textContent = `Reste ${fmtH(q - done)}`;
        }
        card.append(note);
      } else {
        const note = document.createElement('p');
        note.className = 'counter-note';
        note.textContent = 'Hors quota';
        card.append(note);
      }
      if (done > 0) card.append(repartitionRH(rh[c.key], done));
      return card;
    });
    box.replaceChildren(...cards);
    animateCounters(box);
  }

  // Remplissage progressif des compteurs (heures, camembert, %) jusqu'à la valeur réelle
  function animateCounters(box) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nums = Array.from(box.querySelectorAll('.counter-value .big[data-to], .pie-pct[data-to]'));
    const arcs = Array.from(box.querySelectorAll('.pie-fg[data-to]'));
    const pies = Array.from(box.querySelectorAll('.pie-full'));
    pies.forEach(p => p.classList.remove('pie-full'));   // le battement démarre une fois rempli
    const fin = () => {
      nums.forEach(el => { el.textContent = el.classList.contains('pie-pct') ? el.dataset.to + ' %' : nf.format(Number(el.dataset.to)); });
      arcs.forEach(el => el.setAttribute('stroke-dasharray', `${el.dataset.to} ${el.dataset.c}`));
      pies.forEach(p => p.classList.add('pie-full'));
    };
    if (reduce || !window.requestAnimationFrame) return fin();
    const DUR = 1200, t0 = performance.now();
    const ease = x => 1 - Math.pow(1 - x, 3);
    const step = now => {
      if (!box.isConnected) return;
      const k = Math.min(1, (now - t0) / DUR), e = ease(k);
      if (k >= 1) return fin();
      nums.forEach(el => {
        const v = Number(el.dataset.to) * e;
        el.textContent = el.classList.contains('pie-pct') ? Math.round(v) + ' %' : nf.format(Math.round(v * 10) / 10);
      });
      arcs.forEach(el => el.setAttribute('stroke-dasharray', `${Number(el.dataset.to) * e} ${el.dataset.c}`));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderFormations(L, list, year) {
    $('#livret-list-title').textContent = `Formations effectuées en ${year}`;
    const ol = $('#livret-list');
    const empty = $('#livret-empty');
    empty.hidden = !L || list.length > 0;
    empty.textContent = `Aucune formation enregistrée en ${year}.`;
    ol.replaceChildren(...list.map(f => {
      const li = document.createElement('li');
      const [y, m, d] = f.date.split('-').map(Number);

      const date = document.createElement('time');
      date.className = 'fmpa-date';
      date.dateTime = f.date;
      const dd = document.createElement('strong');
      dd.textContent = String(d);
      const mm = document.createElement('span');
      mm.textContent = MOIS[m - 1] || '';
      date.append(dd, mm);

      const body = document.createElement('div');
      body.className = 'fmpa-body';
      const lieu = document.createElement('p');
      lieu.className = 'fmpa-lieu';
      lieu.textContent = f.lieu || 'Lieu non renseigné';
      const meta = document.createElement('p');
      meta.className = 'fmpa-meta';
      const tag = document.createElement('span');
      const cat = catOf(f.secteur);
      tag.className = 'tag tag-' + cat.toLowerCase();
      tag.textContent = cat === 'SMPM' && f.secteur ? `SMPM ${f.secteur.charAt(0) + f.secteur.slice(1).toLowerCase()}` : (f.secteur || '—');
      meta.append(tag);
      // Position RH : étiquette Repos / TT
      const pos = positionRH(f.position);
      if (pos !== 'autre') {
        const t = document.createElement('span');
        t.className = 'tag tag-rh tag-rh-' + pos;
        t.textContent = pos === 'repos' ? 'Repos' : 'TT';
        t.title = pos === 'repos' ? 'Sur repos' : 'Sur temps de travail';
        meta.append(document.createTextNode(' '), t);
      }
      const extra = [pos === 'autre' ? f.position : '', f.cu ? `CU ${f.cu}` : ''].filter(Boolean).join(' · ');
      if (extra) meta.append(document.createTextNode(' ' + extra));
      body.append(lieu, meta);

      if (f.themes && f.themes.length) {
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `Thèmes abordés (${f.themes.length})`;
        const ul = document.createElement('ul');
        ul.className = 'chips';
        ul.append(...f.themes.map(t => { const c = document.createElement('li'); c.textContent = t; return c; }));
        det.append(sum, ul);
        body.append(det);
      }

      const fig = document.createElement('div');
      fig.className = 'fmpa-fig';
      const h = document.createElement('strong');
      h.textContent = fmtH(Number(f.heures) || 0);
      fig.append(h);
      if (f.corde) {
        const c = document.createElement('span');
        c.textContent = nf.format(f.corde) + ' m';
        fig.append(c);
      }

      li.append(date, body, fig);
      return li;
    }));
  }

  function renderApp() {
    const { me, session, qualifications, fonction } = state.data;
    setIdentity(`${me.prenom} ${me.nom}`, roleLabel(session, me, qualifications, fonction));
    $('#info-secteur').textContent = me.secteur || '—';
    $('#nav-sec-cu').hidden = !(canDeclare(session) || canIntervene(session));
    $('#nav-sec-cs').hidden = !canAllFmpa(session);
    $('#nav-fmpa').hidden = !canDeclare(session);
    $$('[data-page="fmpa"]').forEach(b => { b.hidden = !canEncadrer(state.data); });
    $('#nav-fmpa-all').hidden = !canAllFmpa(session);
    $('#nav-interv').hidden = !canIntervene(session);
    $('#nav-interv-all').hidden = !canAllInterv(session);
    $('#nav-csh-all').hidden = !canAllCsHeures(session);
    $('#home-interv-new').hidden = !canIntervene(session);

    const form = $('#form-profil');
    const sel = form.elements.grade;
    const choices = gradeChoices(state.options && state.options.grades, me.grade);
    sel.replaceChildren(...choices.map(c => new Option(c.label, c.code)));
    sel.value = me.grade;

    const dl = $('#list-affectations');
    dl.replaceChildren(...((state.options && state.options.affectations) || []).map(a => new Option(a, a)));

    form.elements.affectation.value = me.affectation || '';
    form.elements.email.value = me.email || '';
    form.elements.telephone.value = me.telephone || '';
    form.elements.consent_sms.checked = !!me.consent_sms;
    lockForm(form, !navigator.onLine || $('#offline-banner').hidden === false);

    renderQualifs(qualifications);
  }

  function lockForm(form, locked) {
    $$('input, select', form).forEach(el => { el.disabled = locked; });
    $('#btn-save').disabled = locked;
  }

  function renderQualifs(list) {
    const ul = $('#list-qualifs');
    ul.replaceChildren(...list.map(q => {
      const li = document.createElement('li');
      li.className = q.acquis ? 'yes' : 'no';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = q.code.replace(' ', '');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = q.label;
      const year = document.createElement('span');
      year.className = 'year';
      year.textContent = q.acquis ? (q.annee ? 'obtenu en ' + q.annee : 'acquis') : 'non acquis';
      li.append(badge, label, year);
      return li;
    }));
  }

  // ---------- événements ----------
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (!go) return;
    const target = go.dataset.goto;
    if (target === 'reset') { setMode('reset'); show('activate'); }
    else if (target === 'activate') { setMode('activate'); show('activate'); }
    else if (target === 'resend') { show('activate'); }       // garde le mode en cours
    else show(target);
    prefillEmail();
  });

  // Activation et mot de passe oublié partagent le même parcours (code SMS puis nouveau mot de passe)
  function setMode(mode) {
    state.mode = mode;
    const reset = mode === 'reset';
    $('#activate-title').textContent = reset ? 'Mot de passe oublié' : 'Activer mon compte';
    $('#activate-intro').textContent = reset
      ? "Saisissez l'adresse e-mail de votre compte. Un code vous sera envoyé par SMS pour choisir un nouveau mot de passe."
      : "Saisissez l'adresse e-mail enregistrée dans la liste du personnel. Un code vous sera envoyé par SMS.";
    $('#verify-title').textContent = reset ? 'Nouveau mot de passe' : 'Code reçu par SMS';
    $('#verify-pwd-label').textContent = reset ? 'Choisissez un nouveau mot de passe' : 'Choisissez un mot de passe';
    $('#verify-submit').textContent = reset ? 'Changer le mot de passe' : 'Activer';
  }

  $('#livret-csh-go').addEventListener('click', () => gotoPage('cs-heures'));
  $('#livret-year').addEventListener('change', e => {
    state.year = Number(e.target.value);
    renderLivretYear();
  });

  $('#btn-logout').addEventListener('click', () => {
    const n = (window.SMPM_FMPA ? window.SMPM_FMPA.pending() : 0) + (window.SMPM_ITV ? window.SMPM_ITV.pending() : 0) + (window.SMPM_POI ? window.SMPM_POI.pending() : 0)
      + (window.SMPM_INV ? window.SMPM_INV.pending() : 0);
    if (n && !confirm(`${n} saisie${n > 1 ? 's' : ''} (FMPA, intervention, point d’intérêt ou inventaire) ${n > 1 ? 'ne sont' : 'n’est'} pas encore envoyée${n > 1 ? 's' : ''}. ` +
      'Se déconnecter les supprimera de cet appareil. Continuer ?')) return;
    logout(true);
  });
  $('#btn-menu').addEventListener('click', openMenu);
  $('#btn-identity').addEventListener('click', () => gotoPage('infos'));
  $('#btn-intervention').addEventListener('click', toggleMode);
  $('#btn-home').addEventListener('click', () => gotoPage(isIntervention() ? 'accueil' : 'livret'));
  $('#btn-sync').addEventListener('click', syncAll);
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go && !go.disabled) gotoPage(go.dataset.go);
  });
  $('#btn-close').addEventListener('click', closeMenu);
  $('#scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  $$('.drawer-nav button[data-page]').forEach(btn => btn.addEventListener('click', () => gotoPage(btn.dataset.page)));
  $('#nav-fmpa .nav-group-btn').addEventListener('click', e => {
    setFmpaGroup(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  $('#nav-interv .nav-group-btn').addEventListener('click', e => {
    setIntervGroup(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  $('#nav-livret .nav-group-btn').addEventListener('click', e => {
    setLivretGroup(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  $('#nav-csh .nav-group-btn').addEventListener('click', e => {
    setCshGroup(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  $('#nav-doc .nav-group-btn').addEventListener('click', e => {
    setDocGroup(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  });

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const email = f.elements.email.value.trim();
    const password = f.elements.password.value;
    setLoginPhase('busy');
    let res;
    try {
      res = await api('login', { email, password });
    } catch (err) {
      f.elements.password.value = '';
      setLoginPhase('fail', err instanceof NetworkError ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
      return;
    }
    store.set(KEY_EMAIL, email);
    store.set(KEY_TOKEN, res.token);
    f.reset();
    setLoginPhase('ok');
    await new Promise(r => setTimeout(r, 700));      // laisse lire « Connexion réussie »
    await init();
  });

  $('#login-retry').addEventListener('click', () => {
    setLoginPhase('idle');
    const f = $('#form-login');
    if (!f.elements.email.value) prefillEmail();
    f.elements.password.focus();
  });

  $('#form-request').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    setBusy(f, true);
    try {
      const email = f.elements.email.value.trim();
      await api('request_code', { email });
      state.pendingEmail = email;
      $('#verify-hint').textContent =
        "Si cette adresse figure dans la liste avec un numéro de téléphone, un code vient d'être envoyé par SMS. Il est valable 10 minutes.";
      show('verify');
    } catch (err) {
      showError(f, err instanceof NetworkError ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
    } finally { setBusy(f, false); }
  });

  $('#form-verify').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.elements.password.value !== f.elements.password2.value) {
      return showError(f, 'Les deux mots de passe ne correspondent pas.');
    }
    setBusy(f, true);
    try {
      const res = await api('verify_code', {
        email: state.pendingEmail,
        code: f.elements.code.value.trim(),
        password: f.elements.password.value,
      });
      store.set(KEY_EMAIL, state.pendingEmail);
      store.set(KEY_TOKEN, res.token);
      f.reset();
      await init();
    } catch (err) {
      showError(f, err instanceof NetworkError ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
    } finally { setBusy(f, false); }
  });

  $('#form-profil').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const me = state.data.me;
    const changes = {};
    ['grade', 'affectation', 'email', 'telephone'].forEach(k => {
      const v = f.elements[k].value.trim();
      if (v !== String(me[k] || '')) changes[k] = v;
    });
    const optin = f.elements.consent_sms.checked;
    if (optin !== !!me.consent_sms) changes.consent_sms = optin;
    if (!Object.keys(changes).length) { $('.ok', f).textContent = 'Aucune modification.'; return; }

    setBusy(f, true);
    $('.error', f).textContent = '';
    $('.ok', f).textContent = '';
    try {
      const data = await api('update_me', { token: store.get(KEY_TOKEN), changes });
      if (state.data && state.data.fonction && !data.fonction) data.fonction = state.data.fonction;
      state.data = data;
      store.set(KEY_CACHE, JSON.stringify({ data, options: state.options }));
      renderApp();
      $('.ok', f).textContent = 'Modifications enregistrées.';
    } catch (err) {
      if (AUTH_ERRORS.includes(err.message)) return logout();
      showError(f, err instanceof NetworkError ? 'Hors ligne : modification impossible.' : err.message);
    } finally { setBusy(f, false); }
  });

  window.addEventListener('online', () => { if (store.get(KEY_TOKEN)) { state.keepPage = true; init(); } });
  window.addEventListener('offline', () => { if (!$('#view-app').hidden) { setOffline(true); lockForm($('#form-profil'), true); } });

  // Accès partagé pour les rubriques chargées à part (fmpa.js)
  window.SMPM_APP = {
    api, token: () => store.get(KEY_TOKEN), NetworkError, AUTH_ERRORS, logout,
    // Libellé d'un échec réseau : « Hors ligne » seulement sans réseau, sinon le serveur est en cause
    netLabel: () => (!navigator.onLine || !$('#offline-banner').hidden) ? 'Hors ligne' : 'Serveur occupé',
    livret: () => state.livret,
    goto: name => gotoPage(name),
    home: () => (isIntervention() ? 'accueil' : 'livret'),
    flash,
    section: () => {
      if (!state.data) return '';
      const f = state.data.fonction;
      return String((f && f.sections && f.sections[0]) || state.data.session.section || state.data.me.secteur || '');
    },
    canEditAll: () => !!state.data && canEditAllFmpa(state.data.session),
    pieChart: (pct, full) => pieChart(pct, full),
    animateCounters: box => animateCounters(box),
    csAccess: () => !!state.data && canAllFmpa(state.data.session),
    // Gestion du personnel (personnel.js) : grades proposés et centres d'affectation connus
    gradeChoices: current => gradeChoices(state.options && state.options.grades, current),
    affectations: () => (state.options && state.options.affectations) || [],
    invGerer: () => !!state.data && canInvGerer(state.data.session),
    poiDroits: () => ({ creer: !!state.data && canPoiCreate(state.data.session), modifier: !!state.data && canPoiEdit(state.data.session), gerer: !!state.data && canPoiAdmin(state.data.session) }),
  };

  // ---------- synchronisation manuelle (icône du bandeau) ----------
  // Envoie les FMPA en attente, recharge le livret, les points d'intérêt et met à jour les fiches techniques.
  let syncBusy = false;
  function setSyncBusy(on) {
    syncBusy = on;
    document.body.classList.toggle('fiches-syncing', on);
    $('#btn-sync').disabled = on || !navigator.onLine;
  }
  async function syncAll() {
    if (syncBusy || !navigator.onLine || !store.get(KEY_TOKEN)) return;
    setSyncBusy(true);
    try {
      await retryOnline();
      if (window.SMPM_FMPA) await window.SMPM_FMPA.flush();
      if (window.SMPM_ITV) await window.SMPM_ITV.flush();
      if (window.SMPM_THEMES) await window.SMPM_THEMES.flush();
      if (window.SMPM_POI) await window.SMPM_POI.flush();
      if (window.SMPM_INV) await window.SMPM_INV.flush();
      await loadLivret();
      if (window.SMPM_POI) await window.SMPM_POI.refresh();
      if (window.SMPM_INV && state.page === 'inventaire') await window.SMPM_INV.refresh();
      if (window.SMPM_FICHES) await window.SMPM_FICHES.sync();
    } finally {
      setSyncBusy(false);
      if (window.SMPM_FICHES) window.SMPM_FICHES.render();
    }
  }
  window.addEventListener('online', () => setSyncBusy(syncBusy));
  window.addEventListener('offline', () => setSyncBusy(syncBusy));

  // ---------- démarrage ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // Toucher une notification alors que l'application est ouverte : le service worker demande la page
    navigator.serviceWorker.addEventListener('message', e => {
      if (!(e.data && e.data.type === 'goto' && e.data.page)) return;
      // application encore en chargement (ou écran de connexion) : page ouverte dès l'entrée
      if (state.data && !$('#view-app').hidden) ouvrirDepuisNotif(e.data.page, e.data.notif);
      else { startPage = e.data.page; startNotif = e.data.notif || null; }
    });
    // version affichée = celle du service worker qui sert réellement la page
    const showVersion = () => {
      const sw = navigator.serviceWorker.controller, el = document.getElementById('app-version');
      if (!sw || !el) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = e => { if (e.data) { el.textContent = 'v' + e.data; el.hidden = false; } };
      sw.postMessage('version', [ch.port2]);
    };
    showVersion();
    // Nouvelle version installée pendant l'utilisation : la page affichée est encore l'ancienne.
    // Rechargement automatique (même page) si aucune saisie n'est en cours, sinon proposé par un message.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const typing = () => {
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'search') return true;
      const poiForm = document.getElementById('poi-form');
      return (poiForm && !poiForm.hidden) || state.page === 'bug' || state.page === 'infos' || !!(window.SMPM_INV && window.SMPM_INV.busy());
    };
    const reloadNow = () => {
      if (reloading) return;
      reloading = true;
      const p = state.data && state.page && state.page !== 'livret' ? '?page=' + encodeURIComponent(state.page) : '';
      location.replace(location.pathname + p);
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      showVersion();
      if (!hadController) return;                      // première installation : rien à recharger
      if (!typing()) return reloadNow();
      showFlash({ kind: 'info', text: 'Nouvelle version de l’application installée.', link: null });
      const box = $('#flash');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = 'Recharger maintenant';
      b.addEventListener('click', reloadNow);
      box.firstChild.append(' ', b);
    });
  }
  init();
})();
