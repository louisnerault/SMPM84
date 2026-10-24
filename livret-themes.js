// Mon livret › Thèmes vus : tableau des thèmes vus en FMPA, d'après l'onglet LOGS du livret individuel.
// Données : le livret déjà chargé par app.js (action livret) — séances de LOGS (thèmes par catégorie)
// et référentiel complet des thèmes (cases à cocher du formulaire des thèmes), pour montrer aussi
// les thèmes jamais vus. Consultable hors ligne avec la dernière version du livret.
(() => {
  'use strict';

  const KEY_ONLY = 'smpm_tv_only';
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  // Clé de comparaison : sans accents, ponctuation ni casse (les en-têtes de LOGS et les titres du formulaire varient un peu)
  const cle = s => String(s || '').replace(/[œŒ]/g, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const S = { year: String(new Date().getFullYear()), only: store.get(KEY_ONLY) === '1' };

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

  // Libellé de catégorie plus court pour l'affichage
  const label = t => String(t || '')
    .replace(/^\s*(NEIGE|ISS)\s*-\s*Th[eè]mes abord[ée]s\s*$/i, (m, s) => (s.toUpperCase() === 'NEIGE' ? 'Neige' : 'ISS'))
    .replace(/^\s*Th[eè]mes\s+CANYON\s*$/i, 'Canyon')
    .replace(/^\s*Th[eè]mes\s+SSH\s*$/i, 'SSH')
    .trim();

  function open() { render(); }

  /** Construit les catégories : référentiel (ordre du formulaire) complété par ce qui figure dans LOGS. */
  function table(L, year) {
    const seances = (L.seances || []).filter(s => year === 'all' || s.date.startsWith(year));
    const cats = [];
    const byKey = {};
    const addCat = titre => {
      const k = cle(titre);
      if (!byKey[k]) { byKey[k] = { titre, rows: [], rowByKey: {} }; cats.push(byKey[k]); }
      return byKey[k];
    };
    const addRow = (cat, theme) => {
      const k = cle(theme);
      if (!cat.rowByKey[k]) { cat.rowByKey[k] = { theme, dates: [] }; cat.rows.push(cat.rowByKey[k]); }
      return cat.rowByKey[k];
    };
    (L.referentiel || []).forEach(r => { const c = addCat(r.titre); r.choix.forEach(t => addRow(c, t)); });
    seances.forEach(s => Object.keys(s.cats).forEach(titre => {
      const c = addCat(titre);
      s.cats[titre].forEach(t => {
        const row = addRow(c, t);
        if (!row.dates.some(d => d.date === s.date)) row.dates.push({ date: s.date, cu: s.cu });
      });
    }));
    cats.forEach(c => c.rows.forEach(r => r.dates.sort((a, b) => (a.date < b.date ? 1 : -1))));
    return { cats, seances };
  }

  function render() {
    const tab = $('#tab-livret-themes');
    if (!tab || tab.hidden) return;
    const L = app() && app().livret ? app().livret() : null;
    const stateEl = $('#tv-state');
    const box = $('#tv-tables');
    $('#tv-only').checked = S.only;

    if (!L) {
      stateEl.textContent = 'Chargement du livret…';
      box.replaceChildren(); $('#tv-stats').replaceChildren(); $('#tv-year').replaceChildren();
      return;
    }
    if (!L.seances) {
      stateEl.textContent = 'Les thèmes vus seront disponibles après la mise à jour du serveur.';
      box.replaceChildren(); $('#tv-stats').replaceChildren();
      return;
    }
    stateEl.textContent = L.referentiel ? '' : 'Liste complète des thèmes indisponible : seuls les thèmes déjà vus sont affichés.';

    // Années : celles des séances + l'année en cours, et « toutes »
    const years = Array.from(new Set([String(new Date().getFullYear())].concat(L.seances.map(s => s.date.slice(0, 4))))).sort().reverse();
    if (S.year !== 'all' && !years.includes(S.year)) S.year = years[0];
    const sel = $('#tv-year');
    sel.replaceChildren(...years.map(y => new Option(y, y)), new Option('Toutes les années', 'all'));
    sel.value = S.year;

    const { cats, seances } = table(L, S.year);
    const all = S.year === 'all';
    const fmt = d => { const [y, m, j] = d.split('-'); return all ? `${j}/${m}/${y.slice(2)}` : `${j}/${m}`; };

    // Synthèse
    const total = cats.reduce((n, c) => n + c.rows.length, 0);
    const vus = cats.reduce((n, c) => n + c.rows.filter(r => r.dates.length).length, 0);
    $('#tv-stats').replaceChildren(...[
      [L.referentiel ? `${vus} / ${total}` : String(vus), 'thèmes vus'],
      [String(seances.length), seances.length > 1 ? 'séances' : 'séance'],
      [String(cats.filter(c => c.rows.some(r => r.dates.length)).length), 'catégories'],
    ].map(([v, l]) => el('div', null, el('strong', { text: v }), el('span', { text: l }))));

    const visibles = cats.filter(c => !S.only || c.rows.some(r => r.dates.length));
    if (!visibles.length) {
      box.replaceChildren(el('p', { class: 'muted center small', text: all ? 'Aucun thème enregistré dans votre livret.' : `Aucun thème enregistré en ${S.year}.` }));
      return;
    }

    box.replaceChildren(...visibles.map(c => {
      const n = c.rows.filter(r => r.dates.length).length;
      const rows = c.rows.filter(r => !S.only || r.dates.length);
      const det = el('details', { class: 'tv-cat' + (n ? '' : ' tv-cat-zero') });
      det.open = n > 0;
      det.append(el('summary', null,
        el('span', { class: 'tv-cat-title', text: label(c.titre) }),
        el('span', { class: 'tv-cat-count', text: L.referentiel ? `${n} / ${c.rows.length}` : String(n) })));
      det.append(el('table', { class: 'tv-table' },
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Thème' }),
          el('th', { scope: 'col', class: 'tv-n', text: 'Vu' }),
          el('th', { scope: 'col', text: 'Dates' }))),
        el('tbody', null, ...rows.map(r => el('tr', { class: r.dates.length ? '' : 'tv-zero' },
          el('th', { scope: 'row', text: r.theme }),
          el('td', { class: 'tv-n', text: r.dates.length ? String(r.dates.length) : '—' }),
          el('td', { class: 'tv-dates' }, ...r.dates.map(d => el('span', { title: d.cu ? `CU ${d.cu}` : null, text: fmt(d.date) }))))))));
      return det;
    }));
  }

  $('#tv-year').addEventListener('change', e => { S.year = e.target.value; render(); });
  $('#tv-only').addEventListener('change', e => { S.only = e.target.checked; store.set(KEY_ONLY, S.only ? '1' : '0'); render(); });

  window.SMPM_THEMES_VUS = { open, render };
})();
