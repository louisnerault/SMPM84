// FMPA : déclaration, consultation et modification (chefs d'unité et au-delà, administrateurs).
// Le formulaire est construit à partir de la structure du Google Form « Formulaire FMPA »
// renvoyée par l'API (action fmpa_form) ; l'envoi soumet la réponse au formulaire lui-même
// (action fmpa_submit), qui alimente le sheet FMPA comme une saisie classique.
// Brouillon enregistré sur l'appareil à chaque saisie : rien n'est perdu hors ligne.
// Une FMPA enregistrée s'ouvre dans le même formulaire (action fmpa_get), en lecture seule
// ou modifiable selon les droits renvoyés par le serveur ; l'enregistrement passe par fmpa_update.
(() => {
  'use strict';

  const KEY_FORM = 'smpm_fmpa_form';
  const KEY_DRAFT = 'smpm_fmpa_draft';
  const KEY_OUTBOX = 'smpm_fmpa_outbox';

  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };

  const S = {
    def: null, sig: '', personnes: {}, moi: {},
    answers: {}, sid: '', loaded: false, loading: false, sending: false, done: null,
    grids: [],            // { item, presence } — pour le compteur
    mode: 'declare',      // 'declare' | 'edit' (FMPA modifiable) | 'view' (lecture seule)
    rec: null,            // FMPA ouverte : { id, version, droits, meta, origin }
    decl: null,           // déclaration en cours, mise de côté pendant la consultation d'une FMPA
  };
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fmtDate = s => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10).split('-').reverse().join('/') : (s || ''));
  const fmtDateTime = iso => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const app = () => window.SMPM_APP;
  const norm = s => String(s || '').trim().toUpperCase();
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const newSid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

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

  // ---------- chargement ----------
  function open() {
    if (S.mode !== 'declare') {
      // retour à la déclaration : on reprend celle mise de côté
      S.mode = 'declare';
      S.rec = null;
      if (S.decl) { S.answers = S.decl.answers; S.sid = S.decl.sid; S.draftAt = S.decl.draftAt; S.decl = null; }
      else if (S.def) restoreDeclaration();
      else { S.answers = {}; S.sid = ''; }
      setState('');
      $('#fmpa-msg').textContent = '';
    }
    if (!S.def) {
      const cached = store.getJSON(KEY_FORM);
      if (cached && cached.form) apply(cached);
    }
    renderPending();
    flush();
    if (S.done) { showDone(); return; }
    if (!S.loaded && !S.loading) load();
    else render();
  }

  // ---------- FMPA enregistrée : consultation / modification ----------
  async function openRecord(id, origin) {
    if (S.mode === 'declare' && S.def) S.decl = { answers: S.answers, sid: S.sid, draftAt: S.draftAt };
    S.mode = 'view';
    S.rec = { id, origin, loading: true };
    S.answers = {};
    S.done = null;
    $('#fmpa-msg').textContent = '';
    $('#fmpa-form').replaceChildren();
    $('#fmpa-form').hidden = true;
    $('#fmpa-bar').hidden = true;
    renderHead();
    setState('Chargement de la FMPA…');
    try {
      const res = await app().api('fmpa_get', { token: app().token(), id });
      if (!S.rec || S.rec.id !== id) return;              // l'utilisateur est parti entre-temps
      applyDef(res);
      setRecord(res.fmpa);
      setState('');
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      setState(err instanceof app().NetworkError ? 'Réseau indisponible : impossible d’ouvrir cette FMPA hors ligne.'
        : err.message === 'Action inconnue' ? 'La consultation des FMPA n’est pas encore activée sur le serveur.' : err.message, true);
    }
  }

  function setRecord(f) {
    const { answers, version, droits } = f;
    S.rec = Object.assign({}, S.rec, { id: f.id, version, droits, meta: f, loading: false });
    S.answers = JSON.parse(JSON.stringify(answers || {}));
    S.mode = droits && droits.modifier ? 'edit' : 'view';
    render();
  }

  async function load() {
    S.loading = true;
    setState(S.def ? 'Mise à jour du formulaire…' : 'Chargement du formulaire…');
    try {
      const res = await app().api('fmpa_form', { token: app().token() });
      store.set(KEY_FORM, JSON.stringify({ form: res.form, personnes: res.personnes, moi: res.moi }));
      S.loaded = true;
      apply(res);
      setState('');
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (err instanceof app().NetworkError) {
        setState(S.def
          ? 'Hors ligne : formulaire enregistré sur cet appareil. Vous pouvez remplir la déclaration, l’envoi se fera une fois en ligne.'
          : 'Hors ligne : le formulaire n’a encore jamais été chargé sur cet appareil.', !S.def);
      } else if (err.message === 'Action inconnue') {
        setState('La déclaration de FMPA n’est pas encore activée sur le serveur.', true);
      } else {
        setState(err.message, true);
      }
      if (S.def) render();
    } finally {
      S.loading = false;
    }
  }

  function signature(form) {
    return (form.sections || []).map(s => s.items.map(i => i.id + ':' + i.type + ':' + (i.rows ? i.rows.length : '')).join(',')).join('|');
  }

  // Structure du formulaire et personnel : communs à la déclaration et à la consultation
  function applyDef(res) {
    const sig = signature(res.form);
    const changed = sig !== S.sig;
    S.def = res.form;
    S.personnes = res.personnes || S.personnes || {};
    S.moi = res.moi || S.moi || {};
    S.sig = sig;
    store.set(KEY_FORM, JSON.stringify({ form: S.def, personnes: S.personnes, moi: S.moi }));
    return changed;
  }

  function apply(res) {
    const changed = applyDef(res) || !S.sid;
    if (S.mode !== 'declare') {
      // structure rafraîchie pendant qu'une FMPA est ouverte : la déclaration sera reprise au retour
      if (changed) S.decl = null;
      return;
    }
    if (changed) restoreDeclaration();
    render();
  }

  // Déclaration en cours : brouillon de l'appareil s'il correspond au formulaire, sinon préremplissage
  function restoreDeclaration() {
    const draft = store.getJSON(KEY_DRAFT);
    if (draft && draft.sig === S.sig && draft.answers) {
      S.answers = draft.answers;
      S.sid = draft.sid || newSid();
      S.draftAt = draft.ts;
    } else {
      S.answers = {};
      S.sid = newSid();
      S.draftAt = null;
      defaults();
    }
  }

  // Préremplissage : date du jour, chef d'unité = utilisateur, secteur de l'utilisateur
  function defaults() {
    items().forEach(it => {
      if (it.type === 'date' && /date/i.test(it.title)) S.answers[it.id] = today();
      if ((it.type === 'list' || it.type === 'radio') && it.choices) {
        const vals = it.choices.map(c => c.v);
        const mine = vals.find(v => norm(v) === S.moi.nom);
        if (mine && /imp ?3|responsable|chef/i.test(it.title)) S.answers[it.id] = mine;
        const sect = vals.find(v => norm(v) === S.moi.secteur);
        if (sect && /secteur/i.test(it.title)) S.answers[it.id] = sect;
      }
    });
  }

  const items = () => (S.def ? S.def.sections.flatMap(s => s.items) : []);

  // ---------- brouillon ----------
  let saveTimer = null;
  function saveDraft() {
    if (S.mode !== 'declare') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.set(KEY_DRAFT, JSON.stringify({ sig: S.sig, sid: S.sid, answers: S.answers, ts: Date.now() }));
    }, 250);
  }
  function clearDraft() {
    store.del(KEY_DRAFT);
    S.answers = {};
    S.sid = newSid();
    S.draftAt = null;
    defaults();
    render();
    window.scrollTo(0, 0);
  }

  function setAnswer(it, v) {
    S.answers[it.id] = v;
    saveDraft();
    if (it.choices && it.choices.some(c => c.go !== null)) updateSections();
    clearInvalid(it.id);
    updateCounter();
  }

  // ---------- sections visibles (navigation du formulaire) ----------
  function path() {
    const secs = S.def.sections;
    const seen = [];
    let i = 0;
    while (typeof i === 'number' && i < secs.length && !seen.includes(i)) {
      seen.push(i);
      let next = secs[i].next;
      secs[i].items.forEach(it => {
        if (!it.choices) return;
        const c = it.choices.find(ch => ch.v === S.answers[it.id]);
        if (c && c.go !== null) next = c.go;
      });
      if (next === 'next') i += 1;
      else if (typeof next === 'number') i = next;
      else break;            // 'submit' ou 'restart'
    }
    return seen;
  }

  function updateSections() {
    const visible = path();
    document.querySelectorAll('#fmpa-form .fmpa-sec').forEach(sec => {
      sec.hidden = !visible.includes(Number(sec.dataset.sec));
    });
    updateCounter();
  }

  // ---------- rendu ----------
  function setState(msg, isError) {
    const p = $('#fmpa-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  // En-tête : titre, retour à la liste, droits sur la FMPA ouverte
  function renderHead() {
    const head = $('#fmpa-head');
    if (S.mode === 'declare') {
      head.replaceChildren(el('h1', { text: 'Nouvelle FMPA' }));
      return;
    }
    const r = S.rec || {};
    const m = r.meta || {};
    const nodes = [];
    if (r.origin) {
      nodes.push(el('div', { class: 'sub-head' }, el('button', {
        type: 'button', class: 'link', text: '← ' + (window.SMPM_FMPA_LIST ? window.SMPM_FMPA_LIST.label(r.origin) : 'Retour'),
        onclick: () => app().goto(r.origin),
      })));
    }
    nodes.push(el('h1', { text: m.date ? `FMPA du ${fmtDate(m.date)}` : 'FMPA' }));
    if (m.id) {
      const bits = [m.numero ? `N° ${m.numero}` : '', m.cu ? `CU ${m.cu}` : '', m.horodateur ? `déclarée le ${fmtDateTime(m.horodateur)}` : ''].filter(Boolean);
      nodes.push(el('p', { class: 'muted small fmpa-meta-line', text: bits.join(' · ') }));
      nodes.push(droitsBox(r.droits || {}, m));
    }
    head.replaceChildren(...nodes);
  }

  function droitsBox(d, m) {
    if (d.modifier) {
      const t = d.par === 'cu' && d.jusqua
        ? `Modifiable jusqu’au ${fmtDateTime(d.jusqua)} (24 h après la déclaration). Ensuite, les modifications passeront par votre chef de section.`
        : d.par === 'section' ? `Modifiable en tant que chef de section ${cap(m.secteur)}.`
        : 'Modifiable en tant qu’administrateur.';
      return el('p', { class: 'fmpa-rights ok-box', text: t });
    }
    const n1 = (d.n1 || []).join(', ');
    const t = d.motif === 'delai'
      ? `Lecture seule : le délai de 24 h est dépassé. Pour toute modification, contactez votre N+1${n1 ? ' : ' + n1 + ' (chef de section ' + cap(m.secteur) + ')' : ' (chef de section)'}.`
      : d.motif === 'secteur' ? `Lecture seule : cette FMPA relève du secteur ${cap(m.secteur)}. Vous modifiez les FMPA de votre secteur.`
      : 'Lecture seule.';
    return el('p', { class: 'fmpa-rights ro-box', text: t });
  }
  const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

  function render() {
    const root = $('#fmpa-form');
    const done = $('#fmpa-done');
    renderHead();
    root.classList.toggle('fmpa-ro', S.mode === 'view');
    if (S.done) {
      root.hidden = true;
      $('#fmpa-bar').hidden = true;
      done.hidden = false;
      return;
    }
    done.hidden = true;
    if (!S.def || (S.mode !== 'declare' && (!S.rec || S.rec.loading))) {
      root.replaceChildren(); root.hidden = true; $('#fmpa-bar').hidden = true; return;
    }
    root.hidden = false;
    S.grids = [];

    const head = [];
    if (S.mode === 'declare' && S.draftAt) {
      const when = new Date(S.draftAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      head.push(el('div', { class: 'fmpa-draft' },
        el('span', { text: `Brouillon du ${when} restauré.` }),
        el('button', { type: 'button', class: 'link', text: 'Repartir de zéro', onclick: () => { if (confirm('Effacer le brouillon en cours ?')) clearDraft(); } })));
    }
    if (S.mode === 'declare' && S.def.description) head.push(el('p', { class: 'muted small fmpa-desc', text: S.def.description }));

    const secs = S.def.sections.map((sec, i) => {
      const box = el('section', { class: 'fmpa-sec', 'data-sec': String(i) });
      if (sec.title) box.append(el('h2', { class: 'section-title', text: sec.title }));
      if (sec.help) box.append(el('p', { class: 'muted small', text: sec.help }));
      sec.items.forEach(it => box.append(renderItem(it)));
      return box;
    });
    root.replaceChildren(...head, ...secs);

    // Lecture seule : réponses figées, seules la recherche et les filtres de la grille restent actifs
    if (S.mode === 'view') {
      root.querySelectorAll('input, select, textarea, button').forEach(n => {
        if (!n.closest('.grid-tools')) n.disabled = true;
      });
    }
    const send = $('#fmpa-send');
    send.hidden = S.mode === 'view';
    send.textContent = S.mode === 'edit' ? 'Enregistrer' : 'Envoyer';
    $('#fmpa-bar').hidden = false;
    updateSections();
  }

  function field(it, ...body) {
    const wrap = el('div', { class: 'fmpa-q', 'data-q': String(it.id) });
    const label = el('p', { class: 'fmpa-label', id: 'q-' + it.id },
      it.title, it.required ? el('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null);
    wrap.append(label);
    if (it.help) wrap.append(el('p', { class: 'fmpa-help', text: it.help }));
    wrap.append(...body);
    wrap.append(el('p', { class: 'fmpa-err', role: 'alert' }));
    return wrap;
  }

  function renderItem(it) {
    const v = S.answers[it.id];
    const lab = 'q-' + it.id;
    switch (it.type) {
      case 'header':
        return el('div', { class: 'fmpa-header' },
          it.title ? el('h3', { text: it.title }) : null,
          it.help ? el('p', { class: 'muted small', text: it.help }) : null);

      case 'text':
        return field(it, el('input', {
          type: 'text',
          inputmode: /dur[ée]e|nombre|heures?|num[ée]ro/i.test(it.title) ? 'decimal' : null,
          'aria-labelledby': lab, value: v || '', maxlength: '500',
          oninput: e => setAnswer(it, e.target.value),
        }));

      case 'paragraph':
        return field(it, el('textarea', {
          'aria-labelledby': lab, rows: '3', maxlength: '4000',
          oninput: e => setAnswer(it, e.target.value),
        }, v || ''));

      case 'date':
        return field(it, el('input', { type: 'date', 'aria-labelledby': lab, value: v || '', onchange: e => setAnswer(it, e.target.value) }));
      case 'datetime':
        return field(it, el('input', { type: 'datetime-local', 'aria-labelledby': lab, value: v || '', onchange: e => setAnswer(it, e.target.value) }));
      case 'time':
        return field(it, el('input', { type: 'time', 'aria-labelledby': lab, value: v || '', onchange: e => setAnswer(it, e.target.value) }));
      case 'duration':
        return field(it, el('input', {
          type: 'text', inputmode: 'numeric', placeholder: 'hh:mm', pattern: '\\d{1,2}:\\d{2}',
          'aria-labelledby': lab, value: v || '', oninput: e => setAnswer(it, e.target.value),
        }));

      case 'list': {
        const sel = el('select', { 'aria-labelledby': lab, onchange: e => setAnswer(it, e.target.value) },
          el('option', { value: '', text: 'Choisir…' }),
          ...it.choices.map(c => el('option', { value: c.v, text: c.v })),
          // réponse enregistrée qui ne figure plus dans les choix du formulaire
          v && !it.choices.some(c => c.v === v) ? el('option', { value: v, text: v }) : null);
        sel.value = v || '';
        return field(it, sel);
      }

      case 'radio':
        return field(it, renderChoices(it, false));
      case 'checkbox':
        return field(it, renderChoices(it, true));

      case 'scale': {
        const box = el('div', { class: 'fmpa-scale', role: 'radiogroup', 'aria-labelledby': lab });
        for (let n = it.min; n <= it.max; n++) {
          const b = el('button', {
            type: 'button', class: 'pill', 'aria-pressed': String(String(v) === String(n)), text: String(n),
            onclick: () => { setAnswer(it, String(v) === String(n) ? '' : String(n)); rerenderItem(it); },
          });
          box.append(b);
        }
        return field(it, box, (it.minLabel || it.maxLabel)
          ? el('p', { class: 'fmpa-scale-legend' }, el('span', { text: it.minLabel || '' }), el('span', { text: it.maxLabel || '' }))
          : null);
      }

      case 'grid':
      case 'checkgrid':
        return field(it, renderGrid(it));
    }
    return el('div');
  }

  function rerenderItem(it) {
    const old = document.querySelector(`#fmpa-form .fmpa-q[data-q="${it.id}"]`);
    if (old) old.replaceWith(renderItem(it));
  }

  // Choix unique (radio) ou multiple (cases) : grandes zones tactiles
  function renderChoices(it, multi) {
    const v = S.answers[it.id];
    const sel = multi ? [].concat(v || []) : v;
    const known = it.choices.map(c => c.v);
    const otherVal = multi ? sel.find(x => !known.includes(x)) : (v && !known.includes(v) ? v : '');
    const name = 'q' + it.id;
    const box = el('div', { class: 'fmpa-choices' + (multi ? ' multi' : ''), role: multi ? 'group' : 'radiogroup', 'aria-labelledby': 'q-' + it.id });

    it.choices.forEach(c => {
      const checked = multi ? sel.includes(c.v) : sel === c.v;
      const input = el('input', {
        type: multi ? 'checkbox' : 'radio', name, value: c.v, checked,
        onchange: e => {
          if (multi) {
            const cur = [].concat(S.answers[it.id] || []).filter(x => x !== c.v);
            if (e.target.checked) cur.push(c.v);
            // conserve l'ordre du formulaire, puis la réponse « Autre »
            const ordered = known.filter(k => cur.includes(k)).concat(cur.filter(x => !known.includes(x)));
            setAnswer(it, ordered);
          } else {
            setAnswer(it, c.v);
            const o = box.querySelector('.fmpa-other input[type="text"]');
            if (o) o.value = '';
          }
        },
      });
      // Un 2e appui sur un choix unique déjà coché le désélectionne (question facultative)
      if (!multi && !it.required) {
        input.addEventListener('click', e => {
          if (e.target.dataset.was === '1') { e.target.checked = false; setAnswer(it, ''); }
        });
        input.addEventListener('pointerdown', e => { e.target.dataset.was = e.target.checked ? '1' : '0'; });
        input.addEventListener('keydown', e => { e.target.dataset.was = '0'; });
      }
      box.append(el('label', { class: 'choice' }, input, el('span', { text: c.v })));
    });

    if (it.other) {
      const txt = el('input', {
        type: 'text', placeholder: 'Autre…', value: otherVal || '', 'aria-label': 'Autre réponse',
        oninput: e => {
          const t = e.target.value;
          if (multi) {
            const cur = [].concat(S.answers[it.id] || []).filter(x => known.includes(x));
            if (t.trim()) cur.push(t);
            setAnswer(it, cur);
          } else {
            box.querySelectorAll('input[type="radio"]').forEach(r => { r.checked = false; });
            setAnswer(it, t);
          }
        },
      });
      box.append(el('div', { class: 'choice fmpa-other' }, txt));
    }
    return box;
  }

  // ---------- grille (présence : repos / temps de travail) ----------
  const isPresence = it => it.cols.some(c => /repos|travail|tt\b/i.test(c));
  function shortLabel(c) {
    if (c.length <= 8) return c;
    const words = c.split(/\s+/).filter(w => w.length > 2);
    return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : c;
  }
  function personOf(row) { return S.personnes[norm(row)] || null; }

  function gridValue(it) {
    const v = S.answers[it.id];
    return it.rows.map((_, i) => (Array.isArray(v) ? v[i] : (v && v[i])) || null);
  }

  function renderGrid(it) {
    const presence = isPresence(it);
    const multi = it.type === 'checkgrid';
    S.grids.push({ it, presence });
    const wrap = el('div', { class: 'grid' + (presence ? ' presence' : ''), 'data-grid': String(it.id) });

    const rows = it.rows.map((label, i) => {
      const p = personOf(label);
      return { i, label: label.trim(), p, actif: !p || p.actif !== false, secteur: p ? p.secteur : '' };
    });
    const secteurs = Array.from(new Set(rows.filter(r => r.actif && r.secteur).map(r => r.secteur))).sort();

    // barre d'outils : recherche + filtres
    const state = { q: '', f: S.mode === 'view' ? 'coches' : 'tous' };
    const search = el('input', { type: 'search', placeholder: 'Rechercher un nom', 'aria-label': 'Rechercher un nom', class: 'grid-search' });
    const chips = el('div', { class: 'grid-filters', role: 'group', 'aria-label': 'Filtrer la liste' });
    const filters = [['tous', 'Tous'], ...secteurs.map(s => [s, s.charAt(0) + s.slice(1).toLowerCase()]), ['coches', 'Cochés']];
    filters.forEach(([k, t]) => chips.append(el('button', {
      type: 'button', class: 'pill', 'data-f': k, 'aria-pressed': String(k === state.f), text: t,
      onclick: () => { state.f = k; chips.querySelectorAll('.pill').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === k))); applyFilter(); },
    })));
    search.addEventListener('input', () => { state.q = norm(search.value); applyFilter(); });

    const tools = el('div', { class: 'grid-tools' }, search, chips);
    if (rows.length > 6) wrap.append(tools);

    const mkRow = r => {
      const li = el('li', { class: 'grid-row', 'data-row': String(r.i) });
      const who = el('div', { class: 'who' }, el('strong', { text: r.label }));
      const sub = [r.p && r.p.prenom, r.secteur && (r.secteur.charAt(0) + r.secteur.slice(1).toLowerCase())].filter(Boolean).join(' · ');
      if (sub) who.append(el('span', { text: sub }));
      const seg = el('div', { class: 'seg', role: multi ? 'group' : 'radiogroup', 'aria-label': r.label });
      it.cols.forEach(c => seg.append(el('button', {
        type: 'button', 'data-col': c, 'aria-label': `${r.label} : ${c}`, title: c, text: shortLabel(c),
        onclick: () => toggleCell(it, r.i, c, li),
      })));
      li.append(who, seg);
      paintRow(it, li, r.i);
      return li;
    };

    const active = rows.filter(r => r.actif);
    const inactive = rows.filter(r => !r.actif);
    const list = el('ul', { class: 'grid-list' }, ...active.map(mkRow));
    wrap.append(list);
    let inactList = null;
    if (inactive.length) {
      inactList = el('ul', { class: 'grid-list' }, ...inactive.map(mkRow));
      wrap.append(el('details', { class: 'grid-inactive' },
        el('summary', { text: `Personnel inactif (${inactive.length})` }), inactList));
    }
    const empty = el('p', { class: 'muted small center', hidden: true, text: S.mode === 'view' ? 'Personne de cochée.' : 'Aucun nom ne correspond.' });
    wrap.append(empty);

    // légende des abréviations
    const abbr = it.cols.filter(c => shortLabel(c) !== c);
    if (abbr.length) wrap.append(el('p', { class: 'muted small grid-legend', text: abbr.map(c => `${shortLabel(c)} = ${c}`).join(' · ') }));

    const actions = el('div', { class: 'grid-actions' },
      el('button', { type: 'button', class: 'link', text: 'Tout décocher', onclick: () => {
        if (!gridValue(it).some(Boolean) || !confirm('Décocher toutes les personnes de cette liste ?')) return;
        setAnswer(it, it.rows.map(() => null));
        wrap.querySelectorAll('.grid-row').forEach(li => paintRow(it, li, Number(li.dataset.row)));
        applyFilter();
      } }));
    wrap.append(actions);

    function applyFilter() {
      const val = gridValue(it);
      let shown = 0;
      wrap.querySelectorAll('.grid-row').forEach(li => {
        const r = rows[Number(li.dataset.row)];
        const okQ = !state.q || norm(r.label).includes(state.q) || norm(r.p && r.p.prenom).includes(state.q);
        const okF = state.f === 'tous' || (state.f === 'coches' ? !!val[r.i] && [].concat(val[r.i]).length > 0 : r.secteur === state.f);
        li.hidden = !(okQ && okF);
        if (!li.hidden) shown++;
      });
      empty.hidden = shown > 0;
      if (inactList && (state.q || state.f !== 'tous')) {
        const d = inactList.closest('details');
        if (inactList.querySelector('.grid-row:not([hidden])')) d.open = true;
      }
    }
    if (state.f !== 'tous') applyFilter();
    return wrap;
  }

  function toggleCell(it, i, c, li) {
    const val = gridValue(it);
    if (it.type === 'checkgrid') {
      const cur = [].concat(val[i] || []);
      val[i] = cur.includes(c) ? cur.filter(x => x !== c) : cur.concat(c);
      if (!val[i].length) val[i] = null;
    } else {
      val[i] = val[i] === c ? null : c;
    }
    setAnswer(it, val);
    paintRow(it, li, i);
  }

  function paintRow(it, li, i) {
    const cur = gridValue(it)[i];
    const on = [].concat(cur || []);
    li.classList.toggle('checked', on.length > 0);
    li.querySelectorAll('.seg button').forEach(b => {
      const pressed = on.includes(b.dataset.col);
      b.setAttribute('aria-pressed', String(pressed));
      b.dataset.kind = /repos/i.test(b.dataset.col) ? 'repos' : /travail|tt/i.test(b.dataset.col) ? 'tt' : '';
    });
  }

  // ---------- compteur en direct ----------
  function counts() {
    const visible = path();
    const visibleIds = new Set(visible.flatMap(i => S.def.sections[i].items.map(x => x.id)));
    const per = {};
    let total = 0;
    S.grids.filter(g => g.presence && visibleIds.has(g.it.id)).forEach(g => {
      gridValue(g.it).forEach(v => {
        const vals = [].concat(v || []);
        if (!vals.length) return;
        total++;
        vals.forEach(c => { per[c] = (per[c] || 0) + 1; });
      });
    });
    // détail dans l'ordre des colonnes du formulaire (Repos, puis Temps de Travail)
    const order = S.grids.flatMap(g => g.it.cols);
    const sorted = {};
    Object.keys(per).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(k => { sorted[k] = per[k]; });
    return { total, per: sorted, hasPresence: S.grids.some(g => g.presence) };
  }

  function updateCounter() {
    if (!S.def) return;
    const { total, per, hasPresence } = counts();
    const box = $('#fmpa-count');
    box.hidden = !hasPresence;
    $('#fmpa-count-n').textContent = String(total);
    $('#fmpa-count-label').textContent = total > 1 ? 'personnes cochées' : 'personne cochée';
    $('#fmpa-count-detail').textContent = Object.keys(per).map(c => `${per[c]} ${shortLabel(c).toLowerCase() === 'repos' ? 'repos' : shortLabel(c)}`).join(' · ');
    // compteur repris dans l'en-tête de chaque grille
    S.grids.forEach(g => {
      const n = gridValue(g.it).filter(v => [].concat(v || []).length).length;
      const q = document.querySelector(`#fmpa-form .fmpa-q[data-q="${g.it.id}"] .fmpa-label`);
      if (!q) return;
      let badge = q.querySelector('.grid-badge');
      if (!badge) { badge = el('span', { class: 'grid-badge' }); q.append(badge); }
      badge.textContent = `${n} / ${g.it.rows.length}`;
    });
  }

  // ---------- file d'attente des déclarations (hors ligne) ----------
  // Chaque déclaration est d'abord écrite sur l'appareil, puis envoyée dès que le réseau le permet.
  // L'identifiant d'envoi (sid) garantit côté serveur qu'une déclaration n'est jamais enregistrée deux fois.
  const outbox = () => store.getJSON(KEY_OUTBOX) || [];
  function saveOutbox(list) {
    if (list.length) store.set(KEY_OUTBOX, JSON.stringify(list));
    else store.del(KEY_OUTBOX);
    renderPending();
  }
  function queue(entry) { saveOutbox(outbox().filter(e => e.sid !== entry.sid).concat(entry)); }
  function patchEntry(sid, patch) { saveOutbox(outbox().map(e => (e.sid === sid ? Object.assign({}, e, patch) : e))); }
  function removeEntry(sid) { saveOutbox(outbox().filter(e => e.sid !== sid)); }
  // Une déclaration n'est envoyée qu'avec la session de la personne qui l'a faite
  const mine = e => !e.owner || !S.moi.nom || e.owner === S.moi.nom;
  const pendingList = () => outbox().filter(mine);

  async function flush() {
    if (S.flushing || !navigator.onLine || !app() || !app().token()) return;
    if (!S.moi.nom) { const c = store.getJSON(KEY_FORM); if (c && c.moi) S.moi = c.moi; }
    const todo = outbox().filter(e => e.status === 'pending' && mine(e));
    if (!todo.length) return;
    S.flushing = true;
    S.flushNote = '';
    renderPending();
    if (S.done && !$('#fmpa-done').hidden) showDone();
    let sent = 0;
    try {
      for (const e of todo) {
        try {
          await app().api('fmpa_submit', { token: app().token(), answers: e.answers, submission_id: e.sid });
          removeEntry(e.sid);
          sent++;
        } catch (err) {
          if (err instanceof app().NetworkError) break;                 // toujours pas de réseau : on réessaiera
          if (app().AUTH_ERRORS.includes(err.message)) {                // session à renouveler : la déclaration reste en attente
            S.flushNote = 'Reconnectez-vous pour envoyer les déclarations en attente.';
            break;
          }
          patchEntry(e.sid, { status: 'error', error: err.message });   // refusée par le serveur : à reprendre
        }
      }
    } finally {
      S.flushing = false;
    }
    if (sent) {
      S.lastSent = { n: sent, at: Date.now() };
      if (window.SMPM_FMPA_LIST) window.SMPM_FMPA_LIST.invalidate();
    }
    renderPending();
    if (S.done && !$('#fmpa-done').hidden) showDone();
  }

  // Bandeau « en attente d'envoi » (page de déclaration et Mes FMPA) et pastille du menu
  function renderPending() {
    const list = pendingList();
    const dot = document.querySelector('#nav-fmpa .pending-dot');
    if (dot) dot.hidden = !list.length;
    const burgerDot = document.querySelector('#btn-menu .pending-dot');
    if (burgerDot) burgerDot.hidden = !list.length;
    document.querySelectorAll('[data-fmpa-pending]').forEach(box => box.replaceChildren(...pendingNodes(list)));
  }

  function pendingNodes(list) {
    const recent = S.lastSent && Date.now() - S.lastSent.at < 5 * 60e3;
    if (!list.length) {
      if (!recent) return [];
      const n = S.lastSent.n;
      return [el('div', { class: 'outbox outbox-ok', role: 'status' },
        el('span', { text: `✓ ${n} déclaration${n > 1 ? 's' : ''} en attente ${n > 1 ? 'ont été envoyées' : 'a été envoyée'}.` }),
        el('button', { type: 'button', class: 'link', 'aria-label': 'Masquer', text: '×', onclick: () => { S.lastSent = null; renderPending(); } }))];
    }
    const waiting = list.filter(e => e.status === 'pending');
    const offline = !navigator.onLine;
    const head = el('div', { class: 'outbox-head' },
      el('strong', { text: `${list.length} déclaration${list.length > 1 ? 's' : ''} en attente d’envoi` }),
      waiting.length ? el('button', {
        type: 'button', class: 'pill', disabled: offline || S.flushing,
        text: S.flushing ? 'Envoi…' : offline ? 'En attente du réseau' : 'Envoyer maintenant',
        onclick: () => flush(),
      }) : null);
    const ul = el('ul', { class: 'outbox-list' }, ...list.map(e => {
      const when = new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const li = el('li', { class: e.status === 'error' ? 'is-error' : '' },
        el('span', { text: [e.recap || 'FMPA', e.total ? `${e.total} pers.` : ''].filter(Boolean).join(' · ') }),
        el('small', { text: e.status === 'error' ? `Refusée : ${e.error}` : `Saisie le ${when}` }));
      if (e.status === 'error') {
        li.append(el('div', { class: 'outbox-actions' },
          el('button', { type: 'button', class: 'link', text: 'Réessayer', onclick: () => { patchEntry(e.sid, { status: 'pending', error: '' }); flush(); } }),
          el('button', { type: 'button', class: 'link', text: 'Reprendre', onclick: () => resume(e) }),
          el('button', { type: 'button', class: 'link danger', text: 'Supprimer', onclick: () => { if (confirm('Supprimer définitivement cette déclaration non envoyée ?')) removeEntry(e.sid); } })));
      }
      return li;
    }));
    const nodes = [head, ul];
    if (S.flushNote) nodes.push(el('p', { class: 'small', text: S.flushNote }));
    else if (offline) nodes.push(el('p', { class: 'small', text: 'Envoi automatique dès le retour du réseau.' }));
    return [el('div', { class: 'outbox', role: 'status' }, ...nodes)];
  }

  // Remet une déclaration refusée dans le formulaire pour la corriger
  function resume(e) {
    const current = S.mode === 'declare' ? S.answers : (S.decl && S.decl.answers);
    if (current && Object.keys(current).length && store.get(KEY_DRAFT) &&
        !confirm('Une déclaration est déjà en cours sur cet appareil. La remplacer par celle à reprendre ?')) return;
    if (!S.def) { const c = store.getJSON(KEY_FORM); if (c && c.form) applyDef(c); }
    removeEntry(e.sid);
    store.set(KEY_DRAFT, JSON.stringify({ sig: S.sig, sid: e.sid, answers: e.answers, ts: e.ts }));
    S.decl = null;
    S.done = null;
    S.mode = 'edit';            // force la reprise du brouillon à l'ouverture
    app().goto('fmpa');
  }

  window.addEventListener('online', () => { renderPending(); flush(); });
  window.addEventListener('offline', renderPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (navigator.onLine && outbox().some(e => e.status === 'pending')) flush(); }, 60e3);

  // ---------- validation et envoi ----------
  function clearInvalid(id) {
    const q = document.querySelector(`#fmpa-form .fmpa-q[data-q="${id}"]`);
    if (q) { q.classList.remove('invalid'); $('.fmpa-err', q).textContent = ''; }
  }

  function isEmpty(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return !v.some(x => !isEmpty(x));
    return String(v).trim() === '';
  }

  function validate(visibleItems) {
    const errors = [];
    visibleItems.forEach(it => {
      if (it.type === 'header') return;
      const v = S.answers[it.id];
      let msg = '';
      if (it.required) {
        if (it.type === 'grid' || it.type === 'checkgrid') {
          if (gridValue(it).some(x => isEmpty(x))) msg = 'Une réponse est requise pour chaque ligne.';
        } else if (isEmpty(v)) msg = 'Réponse obligatoire.';
      }
      if (!msg && it.type === 'duration' && !isEmpty(v) && !/^\d{1,2}:\d{2}$/.test(String(v).trim())) msg = 'Format attendu : hh:mm';
      if (msg) errors.push([it, msg]);
    });
    document.querySelectorAll('#fmpa-form .fmpa-q.invalid').forEach(q => { q.classList.remove('invalid'); $('.fmpa-err', q).textContent = ''; });
    errors.forEach(([it, msg]) => {
      const q = document.querySelector(`#fmpa-form .fmpa-q[data-q="${it.id}"]`);
      if (q) { q.classList.add('invalid'); $('.fmpa-err', q).textContent = msg; }
    });
    return errors;
  }

  async function submit() {
    if (S.sending || !S.def || S.mode === 'view') return;
    const editing = S.mode === 'edit';
    const msg = $('#fmpa-msg');
    msg.textContent = '';
    msg.className = 'fmpa-msg';
    const visible = path();
    const visibleItems = visible.flatMap(i => S.def.sections[i].items);
    const errors = validate(visibleItems);
    if (errors.length) {
      msg.textContent = errors.length > 1 ? `${errors.length} réponses à compléter.` : 'Une réponse est à compléter.';
      msg.classList.add('error');
      const first = document.querySelector('#fmpa-form .fmpa-q.invalid');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const offline = !navigator.onLine;
    if (offline && editing) {
      msg.textContent = 'Hors ligne : enregistrement impossible. Gardez cette page ouverte et réessayez dès que le réseau revient.';
      msg.classList.add('error');
      return;
    }

    const answers = {};
    visibleItems.forEach(it => {
      if (it.type === 'header') return;
      const v = it.type === 'grid' || it.type === 'checkgrid' ? gridValue(it) : S.answers[it.id];
      if (!isEmpty(v)) answers[it.id] = typeof v === 'string' ? v.trim() : v;
      else if (editing) answers[it.id] = null;          // réponse effacée : la cellule sera vidée
    });

    const { total, per } = counts();
    const recap = summary(answers);
    const lines = [editing ? 'Enregistrer les modifications de cette FMPA ?' : 'Envoyer la déclaration de FMPA ?', ''];
    if (recap) lines.push(recap);
    if (S.grids.some(g => g.presence)) {
      lines.push(`${total} personne${total > 1 ? 's' : ''} cochée${total > 1 ? 's' : ''}` +
        (Object.keys(per).length ? ' (' + Object.keys(per).map(c => `${per[c]} ${c.toLowerCase()}`).join(', ') + ')' : ''));
    }
    if (offline) lines.push('', 'Pas de réseau : la déclaration sera gardée sur cet appareil et envoyée automatiquement dès le retour du réseau.');
    if (!confirm(lines.join('\n'))) return;

    // Déclaration : passe toujours par la file d'attente de l'appareil, puis envoi immédiat si possible
    if (!editing) {
      const entry = { sid: S.sid, answers, recap, total, owner: S.moi.nom || '', ts: Date.now(), status: 'pending', error: '' };
      queue(entry);
      finishDeclaration(entry);
      if (!offline) flush();
      return;
    }

    S.sending = true;
    const btn = $('#fmpa-send');
    btn.disabled = true;
    btn.textContent = editing ? 'Enregistrement…' : 'Envoi en cours…';
    if (editing) {
      try {
        const res = await app().api('fmpa_update', { token: app().token(), id: S.rec.id, answers, version: S.rec.version });
        const f = Object.assign({}, res.fmpa, { answers: S.answers });
        const origin = S.rec.origin;
        S.rec = { id: f.id, origin };
        setRecord(f);
        if (window.SMPM_FMPA_LIST) window.SMPM_FMPA_LIST.invalidate();
        msg.textContent = res.changed ? `Modifications enregistrées (${res.changed} champ${res.changed > 1 ? 's' : ''}).` : 'Aucune modification à enregistrer.';
        msg.classList.add('ok');
      } catch (err) {
        if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
        msg.textContent = err instanceof app().NetworkError ? 'Réseau indisponible : réessayez dans un instant.' : err.message;
        msg.classList.add('error');
      } finally {
        S.sending = false;
        btn.disabled = false;
        btn.textContent = S.mode === 'edit' ? 'Enregistrer' : 'Envoyer';
      }
      return;
    }
  }

  // Résumé lisible : date, secteur et lieu s'ils existent dans le formulaire
  function summary(answers) {
    const pick = re => {
      const it = items().find(x => re.test(x.title) && answers[x.id] !== undefined && answers[x.id] !== null && x.type !== 'grid');
      return it ? answers[it.id] : '';
    };
    const d = pick(/^\W*date/i);
    const date = /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : d;
    return [date, pick(/secteur/i), pick(/^\W*lieu\b(?!.*fmpa)/i)].filter(Boolean).join(' · ');
  }

  function finishDeclaration(entry) {
    S.done = { recap: entry.recap, total: entry.total, sid: entry.sid };
    store.del(KEY_DRAFT);
    S.answers = {};
    S.sid = newSid();
    S.draftAt = null;
    showDone();
  }

  function showDone() {
    const d = S.done;
    const waiting = outbox().some(e => e.sid === d.sid);
    const err = outbox().find(e => e.sid === d.sid && e.status === 'error');
    $('#fmpa-done').dataset.state = err ? 'error' : waiting ? 'queued' : 'sent';
    $('#fmpa-done-icon').textContent = err ? '!' : waiting ? '⏳' : '✓';
    $('#fmpa-done-title').textContent = err ? 'Déclaration non envoyée' : waiting ? (S.flushing ? 'Envoi en cours…' : 'Déclaration enregistrée sur l’appareil') : 'Déclaration envoyée';
    $('#fmpa-done-note').textContent = err ? err.error.replace(/[.!]?\s*$/, '.') + ' Vous pouvez la reprendre ou la renvoyer depuis le bandeau ci-dessus.'
      : waiting ? 'Pas de réseau pour l’instant : elle sera envoyée automatiquement dès son retour, même si vous fermez cette page. Rouvrez simplement l’application.'
      : 'Elle est enregistrée dans le sheet FMPA, comme une saisie du formulaire.';
    $('#fmpa-done-recap').textContent = [d.recap, S.grids.some(g => g.presence) ? `${d.total} personne${d.total > 1 ? 's' : ''} ${waiting || err ? 'cochée' : 'déclarée'}${d.total > 1 ? 's' : ''}` : '']
      .filter(Boolean).join(' — ');
    setState('');
    render();
    window.scrollTo(0, 0);
  }

  function restart() {
    S.done = null;
    defaults();
    render();
    window.scrollTo(0, 0);
  }

  // Déconnexion. Volontaire : rien ne reste sur l'appareil. Session expirée : les déclarations
  // non envoyées sont gardées et partiront après reconnexion de la même personne.
  function reset(all) {
    store.del(KEY_FORM);
    store.del(KEY_DRAFT);
    if (all === true) store.del(KEY_OUTBOX);
    Object.assign(S, { def: null, sig: '', personnes: {}, moi: {}, answers: {}, sid: '', loaded: false, done: null, grids: [], mode: 'declare', rec: null, decl: null, lastSent: null, flushNote: '' });
    renderPending();
  }

  $('#fmpa-send').addEventListener('click', submit);
  $('#fmpa-again').addEventListener('click', restart);

  window.SMPM_FMPA = { open, openRecord, reset, flush, pending: () => pendingList().length, renderPending };
  renderPending();
})();
