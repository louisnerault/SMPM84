(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_token';
  const KEY_CACHE = 'smpm_cache';
  const KEY_EMAIL = 'smpm_last_email';
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
    if (name !== 'app') {
      closeMenu();
      setIdentity('SMPM 84', 'Secours en milieu périlleux et montagne');
    }
    $$('.error, .ok').forEach(p => { p.textContent = ''; });
  }

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
    $$('.drawer-nav button').forEach(b => {
      if (b.dataset.page === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#tab-profil').hidden = name !== 'infos';
    $('#tab-fiches').hidden = name !== 'fiches';
    if (name === 'fiches' && window.SMPM_FICHES) window.SMPM_FICHES.open();
    closeMenu();
  }

  function setOffline(flag) { $('#offline-banner').hidden = !flag; }

  function setBusy(form, busy) {
    $$('button[type="submit"]', form).forEach(b => { b.disabled = busy; });
  }

  function showError(form, msg) { $('.error', form).textContent = msg; }

  // ---------- session ----------
  function logout() {
    store.del(KEY_TOKEN);
    store.del(KEY_CACHE);          // important sur un appareil partagé
    state.data = null;
    show('login');
  }

  const state = { data: null, options: null, pendingEmail: '', mode: 'activate' };

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
    gotoPage('infos');
  }

  function renderApp() {
    const { me, session, qualifications } = state.data;
    setIdentity(`${me.prenom} ${me.nom}`, roleLabel(session, me, qualifications));
    $('#info-secteur').textContent = me.secteur || '—';

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

  $('#btn-logout').addEventListener('click', logout);
  $('#btn-menu').addEventListener('click', openMenu);
  $('#btn-close').addEventListener('click', closeMenu);
  $('#scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  $$('.drawer-nav button').forEach(btn => btn.addEventListener('click', () => gotoPage(btn.dataset.page)));

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    setBusy(f, true);
    try {
      const email = f.elements.email.value.trim();
      const res = await api('login', { email, password: f.elements.password.value });
      store.set(KEY_EMAIL, email);
      store.set(KEY_TOKEN, res.token);
      f.reset();
      await init();
    } catch (err) {
      showError(f, err instanceof NetworkError ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
    } finally { setBusy(f, false); }
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

  // ---------- démarrage ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
