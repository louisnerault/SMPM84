// Responsables RH — gestion des comptes (menu « Administration › RH », CTD et administrateurs).
// Les RH sont des personnes extérieures à la spécialité : elles se connectent sur rh.html et consultent,
// en lecture seule, les heures (FMPA, heures chef de section) des agents SMPM de leurs centres d'affectation.
// Aucun lien depuis l'écran de connexion des spécialistes : l'adresse de rh.html est envoyée dans l'invitation.
// Actions serveur (dépôt privé, Rh.gs) : rh_admin_list, rh_admin_save, rh_admin_revoke, rh_admin_renvoyer — droits contrôlés par le serveur.
// Données gardées en mémoire seulement : la rubrique demande le réseau.
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const S = { data: null, loading: false, busy: false, edit: null };

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
  function setState(t, err) { const p = $('#rha-state'); p.textContent = t || ''; p.classList.toggle('error', !!err); }
  function vu(iso) {
    if (!iso) return 'Jamais connecté';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return 'Dernière connexion : ' + d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function open() {
    const lien = $('#rha-lien'), url = new URL('rh.html', location.href).href;
    if (lien) { lien.href = url; lien.textContent = url; }
    if (S.data) render();
    if (!S.loading) load();
  }

  async function load() {
    S.loading = true;
    setState(S.data ? 'Mise à jour…' : 'Chargement des accès RH…');
    try {
      const res = await app().api('rh_admin_list', { token: app().token() });
      S.data = { comptes: res.comptes || [], centres: res.centres || [] };
      setState('');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      setState(err instanceof app().NetworkError ? `${app().netLabel()} : la gestion des accès RH demande le réseau.` : err.message, true);
    } finally { S.loading = false; }
  }

  function statut(c) {
    if (c.revoked) return el('span', { class: 'chip chip-ro', text: 'Révoqué' });
    if (!c.active) return el('span', { class: 'chip rha-attente', text: 'Activation en attente' });
    return el('span', { class: 'chip chip-edit', text: 'Actif' });
  }

  function render() {
    const q = fold($('#rha-search').value);
    const list = S.data.comptes.filter(c => !q || fold([c.nom, c.prenom, c.email, c.service, c.centres.join(' ')].join(' ')).includes(q));
    $('#rha-count').textContent = `${list.length} responsable${list.length > 1 ? 's' : ''} RH`;
    $('#rha-empty').hidden = list.length > 0;
    $('#rha-empty').textContent = S.data.comptes.length ? 'Aucun responsable ne correspond à la recherche.' : 'Aucun responsable RH pour l’instant.';
    $('#rha-list').replaceChildren(...list.map(c => el('li', { class: 'ann-card' + (c.revoked ? ' pers-inactif' : '') },
      el('div', { class: 'ann-head' },
        el('h3', { class: 'ann-name' }, `${c.nom} ${c.prenom}`.trim()),
        statut(c)),
      el('p', { class: 'ann-meta', text: c.email }),
      el('ul', { class: 'chips ann-chips' }, c.centres.map(x => el('li', { text: x }))),
      el('p', { class: 'ann-meta', text: [vu(c.derniere_connexion), c.cree_par ? 'Créé par ' + c.cree_par : ''].filter(Boolean).join(' · ') }),
      el('div', { class: 'pers-actions rha-actions' },
        c.revoked ? null : el('button', { type: 'button', class: 'link', text: 'Renvoyer le mail', onclick: () => renvoyer(c) }),
        el('button', { type: 'button', class: 'link', text: c.revoked ? 'Rétablir' : 'Révoquer', onclick: () => revoke(c) }),
        el('button', { type: 'button', class: 'link', text: 'Modifier', onclick: () => edit(c) })))));
  }

  // ---------- fenêtre de création / modification ----------
  function dialog() {
    let d = $('#rha-dialog');
    if (d) return d;
    d = el('dialog', { id: 'rha-dialog', class: 'ann-dialog pers-dialog', 'aria-labelledby': 'rha-dialog-title' },
      el('form', { id: 'rha-form', method: 'dialog', onsubmit: save },
        el('h2', { id: 'rha-dialog-title' }),
        el('label', null, 'Nom', el('input', { type: 'text', name: 'nom', maxlength: 60, required: true, autocomplete: 'off' })),
        el('label', null, 'Prénom', el('input', { type: 'text', name: 'prenom', maxlength: 60, autocomplete: 'off' })),
        el('label', null, 'Adresse e-mail', el('input', { type: 'email', name: 'email', required: true, autocomplete: 'off' })),
        el('fieldset', { class: 'pers-qualifs' },
          el('legend', { text: 'Centres gérés' }),
          el('input', { type: 'search', id: 'rha-centres-search', placeholder: 'Filtrer les centres…', 'aria-label': 'Filtrer les centres', oninput: filtreCentres }),
          el('p', { class: 'muted small', id: 'rha-centres-n' }),
          el('div', { id: 'rha-centres', class: 'rha-centres' })),
        el('p', { class: 'muted small', id: 'rha-note' }),
        el('p', { class: 'error small', id: 'rha-error', role: 'alert' }),
        el('div', { class: 'ann-dialog-btns' },
          el('button', { type: 'button', text: 'Annuler', onclick: () => d.close() }),
          el('button', { type: 'submit', class: 'primary', id: 'rha-save', text: 'Enregistrer' }))));
    $('#tab-admin-rh').append(d);
    return d;
  }
  function compteCentres() {
    const n = document.querySelectorAll('#rha-centres input:checked').length;
    $('#rha-centres-n').textContent = n ? `${n} centre${n > 1 ? 's' : ''} coché${n > 1 ? 's' : ''}` : 'Aucun centre coché';
  }
  function filtreCentres() {
    const q = fold($('#rha-centres-search').value);
    document.querySelectorAll('#rha-centres label').forEach(l => { l.hidden = !!q && !fold(l.dataset.c).includes(q); });
  }

  function edit(c) {
    S.edit = c || null;
    const d = dialog(), f = $('#rha-form');
    $('#rha-dialog-title').textContent = c ? `Modifier le responsable RH ${c.prenom} ${c.nom}`.trim() : 'Nouveau responsable RH';
    f.elements.nom.value = c ? c.nom : '';
    f.elements.prenom.value = c ? c.prenom : '';
    f.elements.email.value = c ? c.email : '';
    const coches = new Set(((c && c.centres) || []).map(fold));
    $('#rha-centres').replaceChildren(...S.data.centres.map(x => {
      const box = el('input', { type: 'checkbox', value: x.centre, onchange: compteCentres });
      box.checked = coches.has(fold(x.centre));
      return el('label', { class: 'ann-check rha-centre', 'data-c': x.centre }, box, ` ${x.centre} `, el('span', { class: 'muted small', text: `(${x.agents})` }));
    }));
    $('#rha-centres-search').value = '';
    compteCentres();
    $('#rha-note').textContent = c
      ? 'Changer l’adresse e-mail oblige la personne à réactiver son accès (une nouvelle invitation lui est envoyée).'
      : 'Une invitation est envoyée par e-mail avec l’adresse de l’espace RH : la personne y active son accès avec un code reçu par e-mail.';
    $('#rha-error').textContent = '';
    $('#rha-save').disabled = false;
    d.showModal();
  }

  async function save(e) {
    e.preventDefault();
    if (S.busy) return;
    const f = $('#rha-form');
    const rh = {
      nom: f.elements.nom.value.trim(), prenom: f.elements.prenom.value.trim(),
      email: f.elements.email.value.trim(), service: S.edit ? S.edit.service || '' : '',
      centres: Array.from(document.querySelectorAll('#rha-centres input:checked')).map(b => b.value),
    };
    if (!rh.centres.length) { $('#rha-error').textContent = 'Cochez au moins un centre.'; return; }
    if (S.edit) rh.id = S.edit.id;
    S.busy = true;
    $('#rha-save').disabled = true;
    $('#rha-error').textContent = '';
    try {
      const res = await app().api('rh_admin_save', { token: app().token(), rh, lien: new URL('rh.html', location.href).href });
      S.data = { comptes: res.comptes || [], centres: res.centres || [] };
      $('#rha-dialog').close();
      setState(res.message || 'Enregistré');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      $('#rha-error').textContent = err instanceof app().NetworkError ? `${app().netLabel()} : réessayez avec du réseau.` : err.message;
      $('#rha-save').disabled = false;
    } finally { S.busy = false; }
  }

  async function revoke(c) {
    if (S.busy) return;
    const v = !c.revoked;
    if (v && !confirm(`Révoquer l’accès de ${c.prenom} ${c.nom} ? Elle est déconnectée immédiatement de tous ses appareils.`.trim())) return;
    S.busy = true;
    setState(v ? 'Révocation…' : 'Rétablissement…');
    try {
      const res = await app().api('rh_admin_revoke', { token: app().token(), id: c.id, revoked: v });
      S.data = { comptes: res.comptes || [], centres: res.centres || [] };
      setState(res.message || '');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      setState(err instanceof app().NetworkError ? `${app().netLabel()} : réessayez avec du réseau.` : err.message, true);
    } finally { S.busy = false; }
  }

  async function renvoyer(c) {
    if (S.busy) return;
    if (!confirm(`Renvoyer le mail de connexion à ${c.email} ?`)) return;
    S.busy = true;
    setState('Envoi du mail…');
    try {
      const res = await app().api('rh_admin_renvoyer', { token: app().token(), id: c.id, lien: new URL('rh.html', location.href).href });
      S.data = { comptes: res.comptes || [], centres: res.centres || [] };
      setState(res.message || 'Mail renvoyé');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      setState(err instanceof app().NetworkError ? `${app().netLabel()} : réessayez avec du réseau.` : err.message, true);
    } finally { S.busy = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const s = $('#rha-search'), n = $('#rha-new');
    if (s) s.addEventListener('input', () => { if (S.data) render(); });
    if (n) n.addEventListener('click', () => { if (S.data) edit(null); });
  });

  window.SMPM_RH_ADMIN = {
    open,
    reset() { S.data = null; S.edit = null; const l = $('#rha-list'); if (l) l.replaceChildren(); },
  };
})();
