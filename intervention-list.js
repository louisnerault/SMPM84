// Listes des interventions (action itv_list) :
//   interv-mes    : comptes rendus dont l'utilisateur est le chef d'unité ;
//   interv-toutes : toutes les interventions (conseillers techniques et administrateurs, modification sans délai).
// Un appui ouvre l'intervention dans le formulaire (fmpa.js, instance SMPM_ITV), modifiable pendant
// 24 h après l'envoi, ensuite en lecture seule. Dernière liste gardée sur l'appareil (consultation hors ligne).
(() => {
  'use strict';

  const PAGES = {
    'interv-mes': { scope: 'mine', title: 'Mes interventions', intro: 'Interventions dont vous êtes le chef d’unité. Modifiables pendant 24 h après l’envoi.' },
    'interv-toutes': { scope: 'toutes', title: 'Toutes les interventions', intro: 'Toutes les interventions enregistrées. Vous pouvez les consulter et les modifier sans limite de délai.' },
  };
  const KEY = scope => 'smpm_itv_list_' + scope;
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const S = { page: 'interv-mes', data: {}, stale: {}, fresh: {}, q: '' };
  const conf = () => PAGES[S.page];

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

  function open(page) {
    if (PAGES[page] && page !== S.page) { S.page = page; S.q = ''; $('#itvl-search').value = ''; }
    const { scope, title, intro } = conf();
    $('#itvl-title').textContent = title;
    $('#itvl-intro').textContent = intro;
    $('#itvl-pending').hidden = scope !== 'mine';
    setState('');
    if (!S.data[scope]) S.data[scope] = store.getJSON(KEY(scope));
    if (S.data[scope]) render();
    else { $('#itvl-list').replaceChildren(); $('#itvl-tools').hidden = true; $('#itvl-empty').hidden = true; $('#itvl-count').textContent = ''; }
    if (!S.data[scope] || S.stale[scope] || !S.fresh[scope]) load(scope);
  }

  async function load(scope) {
    setState(S.data[scope] ? 'Mise à jour…' : 'Chargement…');
    try {
      const res = await app().api('itv_list', { token: app().token(), scope });
      // Une seule réponse alimente les deux listes (« toutes » seulement pour CT et administrateurs)
      const lists = { mine: res.mine || (res.scope !== 'toutes' ? res.interventions : null), toutes: res.toutes || (res.scope === 'toutes' ? res.interventions : null) };
      if (!lists[scope]) {
        S.data[scope] = null;
        $('#itvl-list').replaceChildren();
        $('#itvl-empty').hidden = true;
        $('#itvl-tools').hidden = true;
        setState(res.version
          ? 'Le serveur ne renvoie pas la liste complète pour votre compte (réservée aux conseillers techniques et administrateurs).'
          : 'Le serveur exécute encore une ancienne version d’Intervention.gs : recollez la dernière version puis redéployez (Déployer › Gérer les déploiements › Nouvelle version).', true);
        return;
      }
      Object.keys(lists).forEach(k => {
        if (!lists[k]) return;
        S.data[k] = { interventions: lists[k], maj: res.maj };
        S.stale[k] = false;
        S.fresh[k] = true;
        store.set(KEY(k), JSON.stringify(S.data[k]));
      });
      if (conf().scope !== scope) return;
      setState('');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (conf().scope !== scope) return;
      const d = S.data[scope];
      const maj = d && d.maj ? new Date(d.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (d ? `Hors ligne : liste du ${maj}.` : 'Hors ligne : liste indisponible sur cet appareil.')
        : err.message === 'Action inconnue' ? 'La liste des interventions n’est pas encore activée sur le serveur.' : err.message, !d);
    }
  }

  function setState(msg, isError) {
    const p = $('#itvl-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  function render() {
    const { scope } = conf();
    const d = S.data[scope];
    const all = (d && d.interventions) || [];
    $('#itvl-tools').hidden = all.length < 6;
    const q = fold(S.q).trim();
    const list = all.filter(f => !q || fold([f.commune, f.departement, f.cu, f.date.split('-').reverse().join('/')].join(' ')).includes(q));
    $('#itvl-count').textContent = all.length ? `${list.length} intervention${list.length > 1 ? 's' : ''}` : '';
    const empty = $('#itvl-empty');
    empty.hidden = list.length > 0;
    empty.textContent = all.length ? 'Aucune intervention ne correspond.' : scope === 'mine' ? 'Aucune intervention enregistrée à votre nom.' : 'Aucune intervention enregistrée.';
    $('#itvl-list').replaceChildren(...list.map(f => card(f, scope)));
  }

  function card(f, scope) {
    const [y, m, d] = (f.date || '').split('-').map(Number);
    const btn = el('button', { type: 'button', class: 'fmpal-item', onclick: () => openOne(f) },
      el('time', { class: 'fmpa-date', datetime: f.date },
        el('strong', { text: d ? String(d) : '–' }), el('span', { text: d ? `${MOIS[(m || 1) - 1]} ${String(y).slice(2)}` : '' })),
      el('div', { class: 'fmpa-body' },
        el('p', { class: 'fmpa-lieu', text: f.commune || 'Commune non renseignée' }),
        el('p', { class: 'fmpa-meta', text: [scope !== 'mine' && f.cu ? `CU ${f.cu}` : '', f.debut ? `Début ${f.debut}` : '', f.departement].filter(Boolean).join(' · ') }),
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
    window.SMPM_ITV.openRecord(f.id, S.page);
  }

  function label(page) { return (PAGES[page] && PAGES[page].title) || 'Retour'; }
  function invalidate() { Object.keys(PAGES).forEach(p => { S.stale[PAGES[p].scope] = true; }); }
  function reset() {
    Object.keys(PAGES).forEach(p => store.del(KEY(PAGES[p].scope)));
    store.del('smpm_itv_list');      // ancienne clé
    Object.assign(S, { page: 'interv-mes', data: {}, stale: {}, fresh: {}, q: '' });
    $('#itvl-search').value = '';
  }

  $('#itvl-search').addEventListener('input', e => { S.q = e.target.value; render(); });

  window.SMPM_ITV_LIST = { open, invalidate, reset, label };
})();
