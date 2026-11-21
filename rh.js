// Espace RH (rh.html) : personnes extérieures à la spécialité (services RH des centres).
// Connexion par e-mail et mot de passe ; activation et mot de passe oublié par code reçu PAR E-MAIL.
// Consultation seule des FMPA suivies par les agents SMPM actifs de leurs centres (actions rh_* : Rh.gs, dépôt privé).
// Jeton propre (clé smpm_rh_token, préfixe « rh_ ») : il n'ouvre aucune autre rubrique de l'application.
// Les données des agents ne sont pas gardées sur l'appareil (mémoire seulement).
(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_rh_token';
  const KEY_EMAIL = 'smpm_rh_email';
  const AUTH_ERRORS = ['Session invalide', 'Session expirée', 'Accès révoqué'];
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmtH = n => nf.format(n || 0) + ' h';
  const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  const SECT = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSH: 'SSH', CAN: 'Canyon' };
  const S = { data: null, email: '', ouverts: new Set() };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    return n;
  }

  async function api(action, payload) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 120000) : null;
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, payload || {})), signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Réseau trop lent, réessayez' : 'Réseau indisponible');
    } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) throw new Error('Serveur indisponible (HTTP ' + res.status + ')');
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('Réponse inattendue du serveur'); }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Erreur');
    return data;
  }

  const VIEWS = ['loading', 'login', 'activate', 'verify', 'app'];
  function show(v) {
    VIEWS.forEach(x => { $('#rh-view-' + x).hidden = x !== v; });
    document.querySelectorAll('.error').forEach(p => { p.textContent = ''; });
    if (v !== 'app') { $('#rh-title').textContent = 'SMPM 84'; $('#rh-sub').textContent = 'Espace RH'; }
    const last = store.get(KEY_EMAIL);
    if (last) document.querySelectorAll('input[name="email"]').forEach(i => { if (!i.value) i.value = last; });
  }
  function busy(form, on) { form.querySelectorAll('button, input').forEach(x => { x.disabled = on; }); }

  function entrer(token, rh) {
    store.set(KEY_TOKEN, token);
    S.data = null;
    identite(rh);
    show('app');
    charger();
  }
  function identite(rh) {
    if (!rh) return;
    $('#rh-title').textContent = `${rh.prenom || ''} ${rh.nom || ''}`.trim() || 'Espace RH';
    $('#rh-sub').textContent = rh.service ? `Espace RH · ${rh.service}` : 'Espace RH';
  }
  function deconnecter() {
    store.del(KEY_TOKEN);
    S.data = null;
    $('#rh-list').replaceChildren();
    $('#rh-totaux').replaceChildren();
    show('login');
  }

  // ---------- connexion ----------
  $('#rh-form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.error');
    const email = f.elements.email.value.trim();
    err.textContent = '';
    busy(f, true);
    try {
      const r = await api('rh_login', { email, password: f.elements.password.value });
      store.set(KEY_EMAIL, email);
      f.elements.password.value = '';
      entrer(r.token, r.rh);
    } catch (x) { err.textContent = x.message; } finally { busy(f, false); }
  });
  $('#rh-form-request').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.error');
    S.email = f.elements.email.value.trim();
    busy(f, true);
    try {
      await api('rh_request_code', { email: S.email });
      store.set(KEY_EMAIL, S.email);
      $('#rh-verify-intro').textContent = `Si ${S.email} correspond à un accès RH ouvert, un code vient d’y être envoyé (pensez à vérifier les courriers indésirables). Il est valable 10 minutes.`;
      show('verify');
      $('#rh-form-verify').elements.code.focus();
    } catch (x) { err.textContent = x.message; } finally { busy(f, false); }
  });
  $('#rh-form-verify').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.error');
    busy(f, true);
    try {
      const r = await api('rh_verify_code', { email: S.email || store.get(KEY_EMAIL), code: f.elements.code.value.trim(), password: f.elements.password.value });
      f.reset();
      entrer(r.token, r.rh);
    } catch (x) { err.textContent = x.message; } finally { busy(f, false); }
  });
  document.querySelectorAll('[data-rh-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.rhGoto)));
  $('#rh-logout').addEventListener('click', deconnecter);

  // ---------- consultation ----------
  async function charger(annee) {
    const token = store.get(KEY_TOKEN);
    $('#rh-state').textContent = S.data ? 'Mise à jour…' : 'Chargement des FMPA… (cela peut prendre quelques secondes)';
    $('#rh-state').classList.remove('error');
    try {
      const r = await api('rh_fmpa', { token, annee: annee || '' });
      S.data = r;
      $('#rh-state').textContent = '';
      remplirFiltres();
      rendre();
    } catch (x) {
      if (AUTH_ERRORS.includes(x.message)) { deconnecter(); $('#rh-form-login .error').textContent = x.message === 'Accès révoqué' ? 'Votre accès a été révoqué.' : 'Session terminée : reconnectez-vous.'; return; }
      $('#rh-state').textContent = x.message;
      $('#rh-state').classList.add('error');
    }
  }

  function remplirFiltres() {
    const d = S.data;
    const sa = $('#rh-annee');
    sa.replaceChildren(...d.annees.map(a => new Option(a, a)));
    sa.value = d.annee;
    $('#rh-centres').textContent = (d.centres.length > 1 ? 'Vos centres : ' : 'Votre centre : ') + d.centres.join(', ');
    const sc = $('#rh-centre'), avant = sc.value;
    sc.hidden = d.centres.length < 2;
    sc.replaceChildren(new Option('Tous mes centres', ''), ...d.centres.map(c => new Option(c, c)));
    if (d.centres.includes(avant)) sc.value = avant;
  }

  function filtres() {
    const q = fold($('#rh-search').value), c = $('#rh-centre').value;
    return S.data.agents.filter(a => (!c || fold(a.affectation) === fold(c)) && (!q || fold(a.nom + ' ' + a.prenom).includes(q)));
  }

  function tuile(lbl, val, cls) { return el('div', { class: 'rh-tuile ' + (cls || '') }, el('strong', { text: val }), el('span', { text: lbl })); }

  function rendre() {
    const list = filtres();
    const tot = list.reduce((t, a) => { t.nb += a.total.nb; t.h += a.total.heures; t.r += a.total.repos; t.t += a.total.travail; return t; }, { nb: 0, h: 0, r: 0, t: 0 });
    $('#rh-totaux').replaceChildren(
      tuile('agents', String(list.length)),
      tuile('FMPA suivies', String(tot.nb)),
      tuile('en repos', fmtH(tot.r), 'rh-repos'),
      tuile('en temps de travail', fmtH(tot.t), 'rh-tt'));
    $('#rh-csv').hidden = !list.length;
    if (!S.data.agents.length) {
      $('#rh-list').replaceChildren(el('li', { class: 'muted center', text: 'Aucun agent SMPM actif n’est affecté à vos centres.' }));
      return;
    }
    $('#rh-list').replaceChildren(...list.map(carte));
    if (!list.length) $('#rh-list').append(el('li', { class: 'muted center', text: 'Aucun agent ne correspond à la recherche.' }));
  }

  function carte(a) {
    const cle = a.nom + '|' + a.prenom;
    const ouvert = S.ouverts.has(cle);
    const corps = a.fmpa.length
      ? el('div', { class: 'rh-table-wrap' }, el('table', { class: 'rh-table' },
        el('thead', null, el('tr', null, ['Date', 'Durée', 'Position', 'Lieu', 'Secteur'].map(t => el('th', { text: t })))),
        el('tbody', null, a.fmpa.map(f => el('tr', null,
          el('td', { text: fmtD(f.date) }), el('td', { text: fmtH(f.heures) }),
          el('td', null, el('span', { class: 'chip ' + (f.position === 'Repos' ? 'rh-chip-repos' : 'rh-chip-tt'), text: f.position })),
          el('td', { text: f.lieu || '—' }), el('td', { text: SECT[f.secteur] || f.secteur || '—' }))))))
      : el('p', { class: 'ann-meta', text: `Aucune FMPA en ${S.data.annee}.` });
    corps.hidden = !ouvert;
    const btn = el('button', { type: 'button', class: 'rh-agent-btn', 'aria-expanded': String(ouvert) },
      el('span', null, el('strong', { text: `${a.nom} ${a.prenom}` }), ' ', el('span', { class: 'ann-grade', text: a.grade })),
      el('span', { class: 'ann-meta', text: `${a.affectation} · ${a.total.nb} FMPA · ${fmtH(a.total.heures)} (repos ${fmtH(a.total.repos)}, travail ${fmtH(a.total.travail)})` }));
    btn.addEventListener('click', () => {
      const o = corps.hidden;
      corps.hidden = !o;
      btn.setAttribute('aria-expanded', String(o));
      if (o) S.ouverts.add(cle); else S.ouverts.delete(cle);
    });
    return el('li', { class: 'ann-card rh-agent' }, btn, corps);
  }

  function csv() {
    const esc = v => { const s = String(v === null || v === undefined ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lignes = [['Nom', 'Prénom', 'Grade', 'Centre', 'Date', 'Durée (h)', 'Position', 'Lieu', 'Secteur']];
    filtres().forEach(a => a.fmpa.forEach(f => lignes.push([a.nom, a.prenom, a.grade, a.affectation, fmtD(f.date),
      String(f.heures).replace('.', ','), f.position, f.lieu, SECT[f.secteur] || f.secteur])));
    // point-virgule et BOM : ouverture directe dans Excel en français
    const blob = new Blob(['﻿' + lignes.map(l => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `FMPA_SMPM84_${S.data.annee}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $('#rh-annee').addEventListener('change', e => charger(e.target.value));
  $('#rh-centre').addEventListener('change', () => { if (S.data) rendre(); });
  $('#rh-search').addEventListener('input', () => { if (S.data) rendre(); });
  $('#rh-csv').addEventListener('click', csv);

  // ---------- démarrage ----------
  (async () => {
    const token = store.get(KEY_TOKEN);
    if (!token) return show('login');
    show('loading');
    try {
      const r = await api('rh_moi', { token });
      identite(r.rh);
      show('app');
      charger();
    } catch (x) {
      if (AUTH_ERRORS.includes(x.message)) return deconnecter();
      show('app');
      $('#rh-state').textContent = x.message;
      $('#rh-state').classList.add('error');
    }
  })();
})();
