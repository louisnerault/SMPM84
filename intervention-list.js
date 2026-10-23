// Mes interventions (action itv_list) : comptes rendus dont l'utilisateur est le chef d'unité.
// Un appui ouvre l'intervention dans le formulaire (fmpa.js, instance SMPM_ITV), modifiable pendant
// 24 h après l'envoi, ensuite en lecture seule. Dernière liste gardée sur l'appareil (consultation hors ligne).
(() => {
  'use strict';

  const KEY = 'smpm_itv_list';
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const S = { data: null, stale: false, fresh: false, q: '' };

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

  function open() {
    if (!S.data) S.data = store.getJSON(KEY);
    if (S.data) render();
    else { $('#itvl-list').replaceChildren(); $('#itvl-tools').hidden = true; $('#itvl-empty').hidden = true; }
    if (!S.data || S.stale || !S.fresh) load();
  }

  async function load() {
    setState(S.data ? 'Mise à jour…' : 'Chargement…');
    try {
      const res = await app().api('itv_list', { token: app().token() });
      S.data = { interventions: res.interventions || [], maj: res.maj };
      S.stale = false;
      S.fresh = true;
      store.set(KEY, JSON.stringify(S.data));
      setState('');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      const maj = S.data && S.data.maj ? new Date(S.data.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (S.data ? `Hors ligne : liste du ${maj}.` : 'Hors ligne : liste indisponible sur cet appareil.')
        : err.message === 'Action inconnue' ? 'La liste des interventions n’est pas encore activée sur le serveur.' : err.message, !S.data);
    }
  }

  function setState(msg, isError) {
    const p = $('#itvl-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  function render() {
    const all = (S.data && S.data.interventions) || [];
    $('#itvl-tools').hidden = all.length < 6;
    const q = fold(S.q).trim();
    const list = all.filter(f => !q || fold([f.commune, f.departement, f.date.split('-').reverse().join('/')].join(' ')).includes(q));
    $('#itvl-count').textContent = all.length ? `${list.length} intervention${list.length > 1 ? 's' : ''}` : '';
    const empty = $('#itvl-empty');
    empty.hidden = list.length > 0;
    empty.textContent = all.length ? 'Aucune intervention ne correspond.' : 'Aucune intervention enregistrée à votre nom.';
    $('#itvl-list').replaceChildren(...list.map(card));
  }

  function card(f) {
    const [y, m, d] = (f.date || '').split('-').map(Number);
    const btn = el('button', { type: 'button', class: 'fmpal-item', onclick: () => openOne(f) },
      el('time', { class: 'fmpa-date', datetime: f.date },
        el('strong', { text: d ? String(d) : '–' }), el('span', { text: d ? `${MOIS[(m || 1) - 1]} ${String(y).slice(2)}` : '' })),
      el('div', { class: 'fmpa-body' },
        el('p', { class: 'fmpa-lieu', text: f.commune || 'Commune non renseignée' }),
        el('p', { class: 'fmpa-meta', text: [f.debut ? `Début ${f.debut}` : '', f.departement].filter(Boolean).join(' · ') }),
        status(f.droits || {})));
    return el('li', null, btn);
  }

  function status(d) {
    if (d.modifier && d.par === 'cu' && d.jusqua) {
      const h = Math.max(0, (new Date(d.jusqua) - Date.now()) / 3600e3);
      const t = h >= 1 ? `encore ${Math.floor(h)} h` : `encore ${Math.max(1, Math.round(h * 60))} min`;
      return el('span', { class: 'chip chip-edit', text: `Modifiable · ${t}` });
    }
    if (d.modifier) return el('span', { class: 'chip chip-edit', text: 'Modifiable' });
    return el('span', { class: 'chip chip-ro', text: d.motif === 'delai' ? 'Lecture seule · délai de 24 h dépassé' : 'Lecture seule' });
  }

  function openOne(f) {
    app().goto('interv-fiche');
    window.SMPM_ITV.openRecord(f.id, 'interv-mes');
  }

  function invalidate() { S.stale = true; }
  function reset() { store.del(KEY); Object.assign(S, { data: null, stale: false, fresh: false, q: '' }); $('#itvl-search').value = ''; }

  $('#itvl-search').addEventListener('input', e => { S.q = e.target.value; render(); });

  window.SMPM_ITV_LIST = { open, invalidate, reset };
})();
