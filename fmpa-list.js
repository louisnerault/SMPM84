// Listes des FMPA enregistrées (action fmpa_list) :
//   fmpa-mes     : FMPA encadrées par l'utilisateur (IMP3 responsable)
//   fmpa-toutes  : toutes les FMPA (administrateurs et conseillers techniques : modification ;
//                  chefs de section : consultation, modification de leur secteur)
// Un appui sur une FMPA l'ouvre dans le formulaire (fmpa.js), en lecture seule ou modifiable.
// Dernière liste gardée sur l'appareil pour une consultation hors ligne.
(() => {
  'use strict';

  const SCOPES = {
    'fmpa-mes': { scope: 'mine', title: 'Mes FMPA', back: 'Mes FMPA' },
    'fmpa-toutes': { scope: 'toutes', title: 'Toutes les FMPA', back: 'Toutes les FMPA' },
  };
  const KEY = s => 'smpm_fmpa_list_' + s;
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  const S = { page: null, data: {}, stale: {}, q: '', year: '', secteur: '' };

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

  function label(page) { return (SCOPES[page] && SCOPES[page].back) || 'Retour'; }

  function open(page) {
    const conf = SCOPES[page];
    if (!conf) return;
    const editAll = !app().canEditAll || app().canEditAll();
    const sect = String((app().section && app().section()) || '').toUpperCase();
    // Chef de section : liste ouverte sur son secteur (filtre modifiable)
    if (S.page !== page) { S.q = ''; S.year = ''; S.secteur = page === 'fmpa-toutes' && !editAll ? sect : ''; $('#fmpal-search').value = ''; }
    S.page = page;
    $('#fmpal-title').textContent = conf.title;
    $('#fmpal-intro').textContent =
      page === 'fmpa-mes' ? 'FMPA dont vous êtes l’IMP3 responsable. Modifiables pendant 24 h après la déclaration, ensuite par votre chef de section.'
      : editAll ? 'Vous pouvez consulter et modifier toutes les FMPA.'
      : `Vous pouvez consulter toutes les FMPA et modifier celles de votre secteur${sect ? ' (' + cap(sect) + ')' : ''}.`;
    const cached = S.data[conf.scope] || store.getJSON(KEY(conf.scope));
    if (cached) { S.data[conf.scope] = cached; render(); }
    else { $('#fmpal-list').replaceChildren(); $('#fmpal-tools').hidden = true; }
    if (!cached || S.stale[conf.scope] || !S.data[conf.scope].fresh) load(conf.scope);
  }

  async function load(scope) {
    setState(S.data[scope] ? 'Mise à jour…' : 'Chargement…');
    try {
      const res = await app().api('fmpa_list', { token: app().token(), scope });
      const data = { fmpa: res.fmpa || [], maj: res.maj, fresh: true };
      S.data[scope] = data;
      S.stale[scope] = false;
      store.set(KEY(scope), JSON.stringify({ fmpa: data.fmpa, maj: data.maj }));
      setState('');
      if (SCOPES[S.page] && SCOPES[S.page].scope === scope) render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      const d = S.data[scope];
      const maj = d && d.maj ? new Date(d.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (d ? `${app().netLabel()} : liste du ${maj}.` : app().netLabel() + ' : liste indisponible sur cet appareil.')
        : err.message === 'Action inconnue' ? 'La liste des FMPA n’est pas encore activée sur le serveur.' : err.message, !d);
    }
  }

  function setState(msg, isError) {
    const p = $('#fmpal-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  function render() {
    const conf = SCOPES[S.page];
    const data = S.data[conf.scope];
    const all = (data && data.fmpa) || [];

    // filtres : année, secteur (listes larges), recherche
    const years = Array.from(new Set(all.map(f => f.date.slice(0, 4)).filter(Boolean))).sort().reverse();
    if (!S.year || (S.year !== 'all' && !years.includes(S.year))) S.year = years[0] || 'all';
    const ysel = $('#fmpal-year');
    ysel.replaceChildren(...years.map(y => new Option(y, y)), new Option('Toutes', 'all'));
    ysel.value = S.year;

    const secteurs = Array.from(new Set(all.map(f => f.secteur).filter(Boolean))).sort();
    const ssel = $('#fmpal-secteur');
    ssel.replaceChildren(new Option('Tous secteurs', ''), ...secteurs.map(s => new Option(cap(s), s)));
    ssel.value = secteurs.includes(S.secteur) ? S.secteur : '';
    ssel.hidden = conf.scope !== 'toutes' || secteurs.length < 2;
    $('#fmpal-tools').hidden = !all.length;

    const q = norm(S.q).trim();
    const list = all.filter(f =>
      (S.year === 'all' || f.date.startsWith(S.year)) &&
      (!ssel.value || f.secteur === ssel.value) &&
      (!q || norm([f.lieu, f.cu, f.secteur, f.numero].join(' ')).includes(q)));

    const total = list.reduce((s, f) => s + (Number(f.duree) || 0), 0);
    $('#fmpal-count').textContent = all.length
      ? `${list.length} FMPA${total ? ' · ' + nf.format(total) + ' h' : ''}`
      : '';

    const ol = $('#fmpal-list');
    const empty = $('#fmpal-empty');
    empty.hidden = !data || list.length > 0;
    empty.textContent = all.length ? 'Aucune FMPA ne correspond à ces filtres.' : 'Aucune FMPA enregistrée.';
    ol.replaceChildren(...list.map(f => card(f, conf.scope)));
  }

  function card(f, scope) {
    const [y, m, d] = (f.date || '').split('-').map(Number);
    const li = el('li');
    const btn = el('button', { type: 'button', class: 'fmpal-item', onclick: () => openOne(f) });

    const date = el('time', { class: 'fmpa-date', datetime: f.date },
      el('strong', { text: d ? String(d) : '–' }), el('span', { text: MOIS[(m || 1) - 1] || '' }));

    const body = el('div', { class: 'fmpa-body' });
    body.append(el('p', { class: 'fmpa-lieu', text: f.lieu || 'Lieu non renseigné' }));
    const meta = el('p', { class: 'fmpa-meta' });
    const cat = ['NORD', 'SUD', 'CENTRE'].includes(f.secteur) ? 'smpm' : (f.secteur || '').toLowerCase();
    meta.append(el('span', { class: 'tag tag-' + cat, text: cat === 'smpm' ? `SMPM ${cap(f.secteur)}` : (f.secteur || '—') }));
    const extra = [scope !== 'mine' && f.cu ? `CU ${f.cu}` : '', f.presents ? `${f.presents} présent${f.presents > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    if (extra) meta.append(document.createTextNode(' ' + extra));
    body.append(meta);
    body.append(status(f.droits || {}));

    const fig = el('div', { class: 'fmpa-fig' }, el('strong', { text: f.duree ? nf.format(f.duree) + ' h' : '' }),
      f.numero ? el('span', { text: 'N° ' + f.numero }) : null);

    btn.append(date, body, fig);
    li.append(btn);
    return li;
  }

  function status(d) {
    if (d.modifier && d.par === 'cu' && d.jusqua) {
      const h = Math.max(0, (new Date(d.jusqua) - Date.now()) / 3600e3);
      const t = h >= 1 ? `encore ${Math.floor(h)} h` : `encore ${Math.max(1, Math.round(h * 60))} min`;
      return el('span', { class: 'chip chip-edit', text: `Modifiable · ${t}` });
    }
    if (d.modifier) return el('span', { class: 'chip chip-edit', text: 'Modifiable' });
    return el('span', { class: 'chip chip-ro', text: d.motif === 'delai' ? 'Lecture seule · délai de 24 h dépassé' : d.motif === 'secteur' ? 'Lecture seule · autre secteur' : 'Lecture seule' });
  }

  function openOne(f) {
    app().goto('fmpa-fiche');
    window.SMPM_FMPA.openRecord(f.id, S.page);
  }

  function invalidate() { Object.keys(SCOPES).forEach(p => { S.stale[SCOPES[p].scope] = true; }); }

  function reset() {
    Object.keys(SCOPES).forEach(p => store.del(KEY(SCOPES[p].scope)));
    Object.assign(S, { page: null, data: {}, stale: {}, q: '', year: '', secteur: '' });
  }

  $('#fmpal-search').addEventListener('input', e => { S.q = e.target.value; render(); });
  $('#fmpal-year').addEventListener('change', e => { S.year = e.target.value; render(); });
  $('#fmpal-secteur').addEventListener('change', e => { S.secteur = e.target.value; render(); });

  window.SMPM_FMPA_LIST = { open, invalidate, reset, label, pages: Object.keys(SCOPES) };
})();
