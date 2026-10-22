(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_token';
  const KEY_CACHE = 'smpm_cache';
  const KEY_EMAIL = 'smpm_last_email';
  const KEY_LIVRET = 'smpm_livret';
  const KEY_MODE = 'smpm_mode';
  const AUTH_ERRORS = ['Session invalide', 'Session expirée', 'Accès révoqué', 'Compte inactif'];
  // Fonction affichée sous le nom. Une personne qui cumule plusieurs casquettes
  // se voit attribuer la plus haute : c'est le rôle renvoyé par session.role.
  const ROLES = {
    equipier: 'Équipier',
    chef_unite: "Chef d'unité",
    chef_section: 'Chef de section',
    ctd: 'Conseiller technique et personnel de santé',
  };
  const SECTIONS = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS' };
  // Déclaration de FMPA : chef d'unité ou supérieur, et administrateurs
  const FMPA_ROLES = ['chef_unite', 'chef_section', 'ctd', 'admin'];
  const canDeclare = session => !!session && (session.is_admin === true || FMPA_ROLES.includes(session.role));

  function roleLabel(session, me, qualifications) {
    const base = ROLES[session.role] || session.role || '';
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

  async function api(action, payload = {}) {
    let res;
    try {
      // text/plain : évite la requête préliminaire CORS, non gérée par Apps Script
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (e) {
      throw new NetworkError('Réseau indisponible');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new NetworkError('Réponse inattendue du serveur'); }
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
    $('#mode-bar').hidden = name !== 'app';
    if (name !== 'app') {
      closeMenu();
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
    $('#drawer .drawer-nav button[aria-current="page"]').focus();
  }
  function closeMenu() {
    const drawer = $('#drawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    $('#scrim').hidden = true;
    $('#btn-menu').setAttribute('aria-expanded', 'false');
  }
  function gotoPage(name) {
    if (name === 'fmpa' && !(state.data && canDeclare(state.data.session))) name = 'livret';
    $$('.drawer-nav button').forEach(b => {
      if (b.dataset.page === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#tab-livret').hidden = name !== 'livret';
    $('#tab-profil').hidden = name !== 'infos';
    $('#tab-fiches').hidden = name !== 'fiches';
    $('#tab-accueil').hidden = name !== 'accueil';
    $('#tab-annuaire').hidden = name !== 'annuaire';
    $('#tab-fmpa').hidden = name !== 'fmpa';
    window.scrollTo(0, 0);
    if (name === 'fiches' && window.SMPM_FICHES) window.SMPM_FICHES.open();
    if (name === 'fmpa' && window.SMPM_FMPA) window.SMPM_FMPA.open();
    closeMenu();
  }

  function setOffline(flag) { $('#offline-banner').hidden = !flag; }

  function setBusy(form, busy) {
    $$('button[type="submit"]', form).forEach(b => { b.disabled = busy; });
  }

  function showError(form, msg) { $('.error', form).textContent = msg; }

  // ---------- mode intervention ----------
  // Bascule toujours visible ; en intervention, les couleurs passent au rouge
  // et l'accueil propose annuaire des spécialistes, listes des POI, fiches techniques.
  const isIntervention = () => document.body.classList.contains('mode-intervention');
  function applyMode(on) {
    document.body.classList.toggle('mode-intervention', on);
    store.set(KEY_MODE, on ? 'intervention' : 'normal');
    $('#btn-intervention').setAttribute('aria-pressed', String(on));
    $('#btn-intervention-label').textContent = on ? 'Mode intervention actif : quitter' : 'Passer en mode intervention';
    $('#drawer [data-page="accueil"]').hidden = !on;
    const meta = $('#meta-theme');
    if (meta) meta.setAttribute('content', on ? '#b3132b' : '#1d4f91');
  }
  function toggleMode() {
    const on = !isIntervention();
    applyMode(on);
    gotoPage(on ? 'accueil' : 'livret');
  }

  // ---------- session ----------
  function logout() {
    store.del(KEY_TOKEN);
    store.del(KEY_CACHE);          // important sur un appareil partagé
    store.del(KEY_LIVRET);
    store.del(KEY_MODE);
    if (window.SMPM_FMPA) window.SMPM_FMPA.reset();
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
    try {
      const data = await api('me', { token });
      let options = (cached && cached.options) || null;
      try { options = (await api('options', { token })); } catch (e) { /* on garde l'ancien */ }
      store.set(KEY_CACHE, JSON.stringify({ data, options }));
      enterApp(data, options, false);
    } catch (e) {
      if (e instanceof NetworkError && cached) return enterApp(cached.data, cached.options, true);
      if (e instanceof NetworkError) { prefillEmail(); return show('login'); }
      if (AUTH_ERRORS.includes(e.message)) { logout(); return; }
      prefillEmail();
      show('login');
    }
  }

  function prefillEmail() {
    const last = store.get(KEY_EMAIL);
    if (last) $$('input[name="email"]').forEach(i => { if (!i.value) i.value = last; });
  }

  // ---------- application ----------
  function enterApp(data, options, offline) {
    state.data = data;
    state.options = options;
    setOffline(offline);
    renderApp();
    show('app');
    applyMode(store.get(KEY_MODE) === 'intervention');
    gotoPage(isIntervention() ? 'accueil' : 'livret');
    // Livret : affichage immédiat depuis l'appareil, puis rafraîchissement si en ligne
    const cachedLivret = store.getJSON(KEY_LIVRET);
    if (cachedLivret) state.livret = cachedLivret;
    renderLivret(offline ? 'offline' : (cachedLivret ? 'refreshing' : 'loading'));
    if (!offline) loadLivret();
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
    } catch (err) {
      if (AUTH_ERRORS.includes(err.message)) return logout();
      if (err instanceof NetworkError) return renderLivret(state.livret ? 'offline' : 'error', 'Réseau indisponible.');
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
      status === 'error' ? (message || 'Livret indisponible.') + (L ? ` Données du ${majTxt}.` : '') : '';

    const formations = (L && L.formations) || [];
    const sel = $('#livret-year');
    const years = livretYears(formations, L && L.validations);
    if (!state.year || !years.includes(state.year)) state.year = years[0];
    sel.replaceChildren(...years.map(y => new Option(String(y), String(y))));
    sel.value = String(state.year);
    sel.disabled = !L;
    renderLivretYear();
  }

  // Partie qui dépend de l'année choisie dans la liste déroulante
  function renderLivretYear() {
    const L = state.livret;
    const year = state.year;
    const list = ((L && L.formations) || []).filter(f => f.date.startsWith(String(year)));
    renderCounters(L, list, year);
    renderStats(L, list);
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

      li.append(ico, txt);
      return li;
    }));
  }

  function renderCounters(L, list, year) {
    const box = $('#livret-counters');
    if (!L) { box.replaceChildren(); return; }
    const quotas = L.quotas || {};
    const hours = {};
    list.forEach(f => { const c = catOf(f.secteur); hours[c] = (hours[c] || 0) + (Number(f.heures) || 0); });

    const cards = CATS.filter(c => {
      if (c.key === 'SMPM') return true;
      const q = quotas[c.key];
      return (q && (!q.depuis || q.depuis <= year)) || hours[c.key] > 0;
    }).map(c => {
      const done = hours[c.key] || 0;
      const q = quotas[c.key] && (!quotas[c.key].depuis || quotas[c.key].depuis <= year) ? Number(quotas[c.key].quota) || 0 : 0;
      const pct = q ? Math.min(100, Math.round(done / q * 100)) : 0;
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
      big.textContent = nf.format(done);
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = q ? ` / ${nf.format(q)} h` : ' h';
      val.append(big, unit);

      card.append(head, val);
      if (q) {
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(q));
        bar.setAttribute('aria-valuenow', String(Math.min(done, q)));
        bar.setAttribute('aria-label', `${c.label} : ${fmtH(done)} sur ${fmtH(q)}`);
        const fill = document.createElement('span');
        fill.style.width = pct + '%';
        bar.append(fill);
        const note = document.createElement('p');
        if (done >= q) {
          note.className = 'counter-alert';
          note.setAttribute('role', 'note');
          note.textContent = "Vous avez atteint votre quota d'heures de formation. Vous ne devez plus effectuer de FMPA cette année.";
        } else {
          note.className = 'counter-note';
          note.textContent = `Reste ${fmtH(q - done)}`;
        }
        card.append(bar, note);
      } else {
        const note = document.createElement('p');
        note.className = 'counter-note';
        note.textContent = 'Hors quota';
        card.append(note);
      }
      return card;
    });
    box.replaceChildren(...cards);
  }

  function renderStats(L, list) {
    const box = $('#livret-stats');
    if (!L) { box.replaceChildren(); return; }
    const total = list.reduce((s, f) => s + (Number(f.heures) || 0), 0);
    const corde = list.reduce((s, f) => s + (Number(f.corde) || 0), 0);
    const items = [
      [String(list.length), list.length > 1 ? 'formations' : 'formation'],
      [fmtH(total), 'au total'],
      [nf.format(corde) + ' m', 'de corde parcourue'],
    ];
    box.replaceChildren(...items.map(([v, l]) => {
      const d = document.createElement('div');
      const b = document.createElement('strong');
      b.textContent = v;
      const s = document.createElement('span');
      s.textContent = l;
      d.append(b, s);
      return d;
    }));
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
      const extra = [f.position, f.cu ? `CU ${f.cu}` : ''].filter(Boolean).join(' · ');
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
    const { me, session, qualifications } = state.data;
    setIdentity(`${me.prenom} ${me.nom}`, roleLabel(session, me, qualifications));
    $('#info-secteur').textContent = me.secteur || '—';
    $('#drawer [data-page="fmpa"]').hidden = !canDeclare(session);

    const form = $('#form-profil');
    const sel = form.elements.grade;
    const grades = (state.options && state.options.grades) || [me.grade];
    sel.replaceChildren(...grades.map(g => new Option(g, g)));
    if (!grades.includes(me.grade) && me.grade) sel.add(new Option(me.grade, me.grade));
    sel.value = me.grade;

    const dl = $('#list-affectations');
    dl.replaceChildren(...((state.options && state.options.affectations) || []).map(a => new Option(a, a)));

    form.elements.affectation.value = me.affectation || '';
    form.elements.email.value = me.email || '';
    form.elements.telephone.value = me.telephone || '';
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

  $('#livret-year').addEventListener('change', e => {
    state.year = Number(e.target.value);
    renderLivretYear();
  });

  $('#btn-logout').addEventListener('click', logout);
  $('#btn-menu').addEventListener('click', openMenu);
  $('#btn-intervention').addEventListener('click', toggleMode);
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go && !go.disabled) gotoPage(go.dataset.go);
  });
  $('#btn-close').addEventListener('click', closeMenu);
  $('#scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  $$('.drawer-nav button').forEach(btn => btn.addEventListener('click', () => gotoPage(btn.dataset.page)));

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
    if (!Object.keys(changes).length) { $('.ok', f).textContent = 'Aucune modification.'; return; }

    setBusy(f, true);
    $('.error', f).textContent = '';
    $('.ok', f).textContent = '';
    try {
      const data = await api('update_me', { token: store.get(KEY_TOKEN), changes });
      state.data = data;
      store.set(KEY_CACHE, JSON.stringify({ data, options: state.options }));
      renderApp();
      $('.ok', f).textContent = 'Modifications enregistrées.';
    } catch (err) {
      if (AUTH_ERRORS.includes(err.message)) return logout();
      showError(f, err instanceof NetworkError ? 'Hors ligne : modification impossible.' : err.message);
    } finally { setBusy(f, false); }
  });

  window.addEventListener('online', () => { if (store.get(KEY_TOKEN)) init(); });
  window.addEventListener('offline', () => { if (!$('#view-app').hidden) { setOffline(true); lockForm($('#form-profil'), true); } });

  // Accès partagé pour les rubriques chargées à part (fmpa.js)
  window.SMPM_APP = { api, token: () => store.get(KEY_TOKEN), NetworkError, AUTH_ERRORS, logout };

  // ---------- démarrage ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
