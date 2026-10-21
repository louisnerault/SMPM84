(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_token';
  const KEY_CACHE = 'smpm_cache';
  const KEY_EMAIL = 'smpm_last_email';
  const AUTH_ERRORS = ['Session invalide', 'Session expirée', 'Accès révoqué', 'Compte inactif'];
  const ROLES = {
    equipier: 'Équipier',
    chef_unite: "Chef d'unité",
    chef_section: 'Chef de section',
    ctd: 'Conseiller technique départemental',
  };

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

  // ---------- navigation ----------
  const views = ['loading', 'login', 'activate', 'verify', 'app'];
  function show(name) {
    views.forEach(v => { $('#view-' + v).hidden = v !== name; });
    $('#btn-logout').hidden = name !== 'app';
    $$('.error, .ok').forEach(p => { p.textContent = ''; });
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

  const state = { data: null, options: null, pendingEmail: '' };

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
  }

  function renderApp() {
    const { me, session, qualifications } = state.data;
    $('#hello-name').textContent = `${me.prenom} ${me.nom}`;
    $('#hello-sub').textContent = ROLES[session.role] || session.role;
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
    if (go) { show(go.dataset.goto); prefillEmail(); }
  });

  $('#btn-logout').addEventListener('click', logout);

  $$('.tabs button').forEach(btn => btn.addEventListener('click', () => {
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    $('#tab-profil').hidden = btn.dataset.tab !== 'profil';
    $('#tab-qualifs').hidden = btn.dataset.tab !== 'qualifs';
  }));

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
