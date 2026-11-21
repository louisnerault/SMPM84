// Espace RH (rh.html) : responsables RH des centres, extérieurs à la spécialité. Pas de menu ; pensé pour l'ordinateur.
// Aucun lien depuis l'écran de connexion des spécialistes : l'adresse est envoyée dans l'e-mail d'invitation.
// Connexion par e-mail et mot de passe ; activation et mot de passe oublié par code reçu PAR E-MAIL.
// Consultation seule, sur une période choisie, des heures des agents SMPM actifs de leurs centres (action rh_fmpa, Rh.gs) :
//   - barre « FMPA » : heures comptées dans le quota SMPM du niveau de l'agent, repos et temps de travail distingués,
//     zone supplémentaire en rouge en cas de dépassement ; FMPA hors quota (Neige, ISS, SSH…) indiquées à part ;
//   - barre « Chef de section » (agents inscrits dans l'onglet DATA) : heures de la fonction, sans le détail des journées.
// Jeton propre (clé smpm_rh_token, préfixe « rh_ ») ; les données des agents ne sont pas gardées sur l'appareil.
(() => {
  'use strict';

  const API_URL = window.SMPM_CONFIG.API_URL;
  const KEY_TOKEN = 'smpm_rh_token';
  const KEY_EMAIL = 'smpm_rh_email';
  const AUTH_ERRORS = ['Session invalide', 'Session expirée', 'Accès révoqué'];
  // Vue RH du CTD et des administrateurs (menu Administration › Vue RH) : rh.html?vue=admin, avec le jeton de l'application,
  // tous les centres ; pas de connexion RH ni de déconnexion ici (retour à l'application).
  const VUE_ADMIN = new URLSearchParams(location.search).get('vue') === 'admin';
  const KEY_APP_TOKEN = 'smpm_token';
  const MARGE = 0.25;            // zone au-delà du quota : 25 % de la longueur du quota
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmtH = n => nf.format(n || 0) + ' h';
  const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  const SECT = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSH: 'SSH', CAN: 'Canyon', DEPT: 'Départementale' };
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
    document.body.classList.toggle('rh-connecte', v === 'app');
    $('#rh-logout').hidden = v !== 'app' || VUE_ADMIN;
    $('#rh-retour').hidden = !VUE_ADMIN;
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
    $('#rh-sub').textContent = 'Espace RH · SMPM 84';
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

  // ---------- période ----------
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function periode(code) {
    const y = new Date().getFullYear(), m = new Date().getMonth();
    if (code === 's1') return [`${y}-01-01`, `${y}-06-30`];
    if (code === 's2') return [`${y}-07-01`, `${y}-12-31`];
    if (code === 'mois') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    if (code === 'prec') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    return [`${y}-01-01`, `${y}-12-31`];
  }
  function fixerPeriode(du, au) {
    const f = $('#rh-filtres');
    f.elements.du.value = du;
    f.elements.au.value = au;
    document.querySelectorAll('.rh-raccourcis button').forEach(b => {
      const [d, a] = periode(b.dataset.per);
      b.classList.toggle('actif', d === du && a === au);
    });
  }
  $('#rh-filtres').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    let du = f.elements.du.value, au = f.elements.au.value;
    if (!du || !au) return;
    if (au < du) [du, au] = [au, du];
    fixerPeriode(du, au);
    charger();
  });
  document.querySelectorAll('.rh-raccourcis button').forEach(b => b.addEventListener('click', () => {
    const [du, au] = periode(b.dataset.per);
    fixerPeriode(du, au);
    charger();
  }));
  fixerPeriode(...periode('annee'));

  // ---------- chargement ----------
  async function charger() {
    const token = store.get(VUE_ADMIN ? KEY_APP_TOKEN : KEY_TOKEN);
    const f = $('#rh-filtres');
    $('#rh-state').textContent = S.data ? 'Mise à jour…' : 'Chargement des heures… (cela peut prendre quelques secondes)';
    $('#rh-state').classList.remove('error');
    document.body.classList.add('rh-charge');
    try {
      const r = await api('rh_fmpa', { token, du: f.elements.du.value, au: f.elements.au.value });
      S.data = r;
      if (r.vue_admin) { $('#rh-title').textContent = r.qui || 'Vue RH'; $('#rh-sub').textContent = 'Vue RH · tous les centres'; }
      fixerPeriode(r.du, r.au);
      $('#rh-state').textContent = '';
      remplirCentres();
      rendre();
    } catch (x) {
      if (VUE_ADMIN) { $('#rh-state').textContent = AUTH_ERRORS.includes(x.message) ? 'Session de l’application terminée : reconnectez-vous à l’application SMPM 84.' : x.message; $('#rh-state').classList.add('error'); return; }
      if (AUTH_ERRORS.includes(x.message)) { deconnecter(); $('#rh-form-login .error').textContent = x.message === 'Accès révoqué' ? 'Votre accès a été révoqué.' : 'Session terminée : reconnectez-vous.'; return; }
      $('#rh-state').textContent = x.message;
      $('#rh-state').classList.add('error');
    } finally { document.body.classList.remove('rh-charge'); }
  }

  function remplirCentres() {
    const d = S.data;
    $('#rh-centres').textContent = (d.vue_admin ? `Vue RH du CTD et des administrateurs : ${d.centres.length} centres` : (d.centres.length > 1 ? 'Centres : ' : 'Centre : ') + d.centres.join(', '))
      + ` · période du ${fmtD(d.du)} au ${fmtD(d.au)}` + (d.annees > 1 ? ` (${d.annees} années civiles : quotas annuels additionnés)` : '');
    const sc = $('#rh-centre'), avant = sc.value;
    sc.hidden = d.centres.length < 2;
    sc.replaceChildren(new Option(d.vue_admin ? 'Tous les centres' : 'Tous mes centres', ''), ...d.centres.map(c => new Option(c, c)));
    if (d.centres.includes(avant)) sc.value = avant;
  }

  // ---------- barres ----------
  const totalB = b => (b ? b.repos + b.travail : 0);
  const depasse = b => !!b && b.quota > 0 && totalB(b) > b.quota;
  const part = b => (b && b.quota > 0 ? totalB(b) / b.quota : 0);

  function seg(cls, frac, titre) {
    const s = el('span', { class: 'rh-seg ' + cls, title: titre });
    s.style.width = `${Math.max(0, frac) * 100}%`;
    return s;
  }

  /** Barre de progression : repos puis temps de travail jusqu'au quota, dépassement en rouge dans la zone ajoutée. */
  function barre(libelle, b) {
    const tot = totalB(b);
    let enfants, txt;
    if (b.quota > 0) {
      const echelle = b.quota * (1 + MARGE);
      const rIn = Math.min(b.repos, b.quota);
      const tIn = Math.min(b.travail, b.quota - rIn);
      const over = Math.max(0, tot - b.quota);
      const overVu = Math.min(over, b.quota * MARGE);
      const marge = el('span', { class: 'rh-marge' });
      marge.style.left = `${100 / (1 + MARGE)}%`;
      const marque = el('span', { class: 'rh-quota-marque', title: `Quota : ${fmtH(b.quota)}` });
      marque.style.left = `${100 / (1 + MARGE)}%`;
      enfants = [marge,
        seg('rh-c-repos', rIn / echelle, `Repos : ${fmtH(b.repos)}`),
        seg('rh-c-tt', tIn / echelle, `Temps de travail : ${fmtH(b.travail)}`),
        seg('rh-c-over', overVu / echelle, `Dépassement : ${fmtH(over)}`),
        marque];
      txt = [
        el('strong', { text: `${fmtH(tot)} / ${fmtH(b.quota)}` }),
        el('span', { class: 'muted', text: ` (${Math.round(100 * tot / b.quota)} %)` }),
        over > 0 ? el('span', { class: 'rh-over-txt', text: ` · dépassement +${fmtH(over)}` + (over > overVu ? ' ▶' : '') }) : null,
      ];
    } else {
      const echelle = Math.max(tot, 1) / 0.8;
      enfants = [seg('rh-c-repos', b.repos / echelle, `Repos : ${fmtH(b.repos)}`), seg('rh-c-tt', b.travail / echelle, `Temps de travail : ${fmtH(b.travail)}`)];
      txt = [el('strong', { text: fmtH(tot) }), el('span', { class: 'muted', text: ' (pas de quota défini)' })];
    }
    return el('div', { class: 'rh-barre-ligne' },
      el('span', { class: 'rh-barre-lib', text: libelle }),
      el('div', { class: 'rh-barre', role: 'img',
        'aria-label': `${libelle} : ${fmtH(tot)} sur ${b.quota ? fmtH(b.quota) : 'aucun quota'}, dont ${fmtH(b.repos)} en repos et ${fmtH(b.travail)} en temps de travail` },
        ...enfants),
      el('span', { class: 'rh-barre-txt' }, ...txt,
        el('span', { class: 'rh-barre-split muted', text: `repos ${fmtH(b.repos)} · TT ${fmtH(b.travail)}` })));
  }

  // ---------- liste ----------
  function filtres() {
    const q = fold($('#rh-search').value), c = $('#rh-centre').value, tri = $('#rh-tri').value;
    const l = S.data.agents.filter(a => (!c || fold(a.affectation) === fold(c)) && (!q || fold(a.nom + ' ' + a.prenom).includes(q)));
    const maxPart = a => Math.max(part(a.fmpa), part(a.cds));
    const dep = a => Number(depasse(a.fmpa) || depasse(a.cds));
    if (tri === 'quota') l.sort((a, b) => maxPart(b) - maxPart(a));
    if (tri === 'depasse') l.sort((a, b) => (dep(b) - dep(a)) || maxPart(b) - maxPart(a));
    return l;
  }

  function tuile(lbl, val, cls) { return el('div', { class: 'rh-tuile ' + (cls || '') }, el('strong', { text: val }), el('span', { text: lbl })); }

  function rendre() {
    const list = filtres();
    const t = list.reduce((s, a) => {
      s.r += a.fmpa.repos + a.fmpa.horsQuota.repos; s.t += a.fmpa.travail + a.fmpa.horsQuota.travail;
      if (a.cds) { s.cr += a.cds.repos; s.ct += a.cds.travail; s.c = true; }
      if (depasse(a.fmpa) || depasse(a.cds)) s.d++;
      return s;
    }, { r: 0, t: 0, cr: 0, ct: 0, d: 0, c: false });
    $('#rh-totaux').replaceChildren(...[
      tuile('agents', String(list.length)),
      tuile('FMPA en repos', fmtH(t.r), 'rh-t-repos'),
      tuile('FMPA en temps de travail', fmtH(t.t), 'rh-t-tt'),
      t.c ? tuile('chef de section : repos / TT', `${fmtH(t.cr)} / ${fmtH(t.ct)}`) : null,
      tuile('en dépassement de quota', String(t.d), t.d ? 'rh-t-over' : ''),
    ].filter(Boolean));
    $('#rh-csv').hidden = !list.length;
    if (!S.data.agents.length) {
      $('#rh-list').replaceChildren(el('li', { class: 'muted center rh-vide', text: 'Aucun agent SMPM actif n’est affecté à vos centres.' }));
      return;
    }
    $('#rh-list').replaceChildren(...list.map(ligne));
    if (!list.length) $('#rh-list').append(el('li', { class: 'muted center rh-vide', text: 'Aucun agent ne correspond à la recherche.' }));
  }

  function chip(pos) { return el('span', { class: 'chip ' + (pos === 'Repos' ? 'rh-chip-repos' : 'rh-chip-tt'), text: pos }); }

  function detail(a) {
    const f = a.fmpa;
    const blocs = [el('h4', { text: `FMPA (${f.details.length})` })];
    blocs.push(f.details.length
      ? el('div', { class: 'rh-table-wrap' }, el('table', { class: 'rh-table' },
        el('thead', null, el('tr', null, ['Date', 'Durée', 'Position', 'Lieu', 'Secteur', 'Quota'].map(x => el('th', { text: x })))),
        el('tbody', null, f.details.map(d => el('tr', null,
          el('td', { text: fmtD(d.date) }), el('td', { text: fmtH(d.heures) }), el('td', null, chip(d.position)),
          el('td', { text: d.lieu || '—' }), el('td', { text: SECT[d.secteur] || d.secteur || '—' }),
          el('td', { text: d.quota ? 'compté' : 'hors quota', class: d.quota ? '' : 'muted' }))))))
      : el('p', { class: 'muted small', text: 'Aucune FMPA sur la période.' }));
    if (a.cds) {
      const n = a.cds.details.length;
      blocs.push(el('h4', { text: `Chef de section (${n} journée${n > 1 ? 's' : ''})` }));
      blocs.push(n
        ? el('div', { class: 'rh-table-wrap' }, el('table', { class: 'rh-table rh-table-cds' },
          el('thead', null, el('tr', null, ['Date', 'Durée', 'Position'].map(x => el('th', { text: x })))),
          el('tbody', null, a.cds.details.map(d => el('tr', null,
            el('td', { text: fmtD(d.date) }), el('td', { text: fmtH(d.heures) }), el('td', null, chip(d.position)))))))
        : el('p', { class: 'muted small', text: 'Aucune journée de chef de section sur la période.' }));
    }
    return el('div', { class: 'rh-detail' }, blocs);
  }

  function ligne(a) {
    const cle = a.nom + '|' + a.prenom;
    const ouvert = S.ouverts.has(cle);
    const hq = a.fmpa.horsQuota.repos + a.fmpa.horsQuota.travail;
    const corps = detail(a);
    corps.hidden = !ouvert;
    const btn = el('button', { type: 'button', class: 'rh-agent-btn', 'aria-expanded': String(ouvert) },
      el('div', { class: 'rh-agent-id' },
        el('strong', { text: `${a.nom} ${a.prenom}` }),
        el('span', { class: 'muted small', text: [a.grade, a.niveau, a.affectation].filter(Boolean).join(' · ') }),
        hq ? el('span', { class: 'muted small', text: `+ ${fmtH(hq)} de FMPA hors quota (repos ${fmtH(a.fmpa.horsQuota.repos)}, TT ${fmtH(a.fmpa.horsQuota.travail)})` }) : null),
      el('div', { class: 'rh-agent-barres' },
        barre('FMPA', a.fmpa),
        a.cds ? barre('Chef de section', a.cds) : null),
      el('span', { class: 'rh-chev', 'aria-hidden': 'true', text: '›' }));
    btn.addEventListener('click', () => {
      const o = corps.hidden;
      corps.hidden = !o;
      btn.setAttribute('aria-expanded', String(o));
      if (o) S.ouverts.add(cle); else S.ouverts.delete(cle);
    });
    return el('li', { class: 'rh-agent' + (depasse(a.fmpa) || depasse(a.cds) ? ' rh-agent-over' : '') }, btn, corps);
  }

  function csv() {
    const esc = v => { const s = String(v === null || v === undefined ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const h = n => String(n).replace('.', ',');
    const lignes = [['Nom', 'Prénom', 'Grade', 'Niveau', 'Centre', 'Type', 'Date', 'Durée (h)', 'Position', 'Lieu', 'Secteur', 'Compté dans le quota']];
    filtres().forEach(a => {
      const base = [a.nom, a.prenom, a.grade, a.niveau, a.affectation];
      a.fmpa.details.forEach(d => lignes.push(base.concat(['FMPA', fmtD(d.date), h(d.heures), d.position, d.lieu, SECT[d.secteur] || d.secteur, d.quota ? 'oui' : 'non'])));
      if (a.cds) a.cds.details.forEach(d => lignes.push(base.concat(['Chef de section', fmtD(d.date), h(d.heures), d.position, '', '', ''])));
    });
    // point-virgule et BOM : ouverture directe dans Excel en français
    const blob = new Blob(['﻿' + lignes.map(l => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const lien = el('a', { href: URL.createObjectURL(blob), download: `Heures_SMPM84_${S.data.du}_${S.data.au}.csv` });
    document.body.append(lien); lien.click(); lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 5000);
  }

  $('#rh-centre').addEventListener('change', () => { if (S.data) rendre(); });
  $('#rh-tri').addEventListener('change', () => { if (S.data) rendre(); });
  $('#rh-search').addEventListener('input', () => { if (S.data) rendre(); });
  $('#rh-csv').addEventListener('click', csv);

  // ---------- démarrage ----------
  (async () => {
    if (VUE_ADMIN) {
      show('app');
      $('#rh-title').textContent = 'Vue RH';
      $('#rh-sub').textContent = 'Tous les centres';
      if (!store.get(KEY_APP_TOKEN)) {
        $('#rh-state').textContent = 'Connectez-vous d’abord à l’application SMPM 84 (CTD ou administrateur).';
        $('#rh-state').classList.add('error');
        return;
      }
      return charger();
    }
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
