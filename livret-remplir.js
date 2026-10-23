// Mon livret › Remplir mon livret : saisie des thèmes vus en FMPA (tous les membres).
// Remplace le formulaire Google « SMPM : Validation thèmes FMPA » : la structure du formulaire est lue
// par l'API (action themes_form) et la saisie lui est soumise (themes_submit). Elle arrive donc dans le
// fichier CORE comme avant, puis le chef d'unité la valide (FMPA › Validation des livrets).
// « Qui êtes-vous ? » est rempli par le serveur avec le nom de l'utilisateur connecté.
// Brouillon gardé sur l'appareil ; hors ligne, la saisie attend sur l'appareil et part au retour du réseau.
(() => {
  'use strict';

  const KEY_FORM = 'smpm_themes_form';
  const KEY_DRAFT = 'smpm_themes_draft';
  const KEY_OUTBOX = 'smpm_themes_outbox';
  const KEY_MES = 'smpm_themes_mes';

  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const newSid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const fmtDate = s => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10).split('-').reverse().join('/') : (s || ''));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const S = {
    def: null, sig: '', moi: {}, answers: {}, sid: '', draftAt: null,
    loaded: false, loading: false, done: null, flushing: false, mes: null,
  };

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
    if (!S.def) {
      const c = store.getJSON(KEY_FORM);
      if (c && c.form) apply(c, false);
    }
    if (!S.mes) S.mes = store.getJSON(KEY_MES);
    renderOutbox();
    renderMes();
    flush();
    if (S.done) { showDone(); return; }
    render();
    if (!S.loaded && !S.loading) load();
    loadMes();
  }

  async function load() {
    S.loading = true;
    setState(S.def ? '' : 'Chargement du formulaire…');
    try {
      const res = await app().api('themes_form', { token: app().token() });
      S.loaded = true;
      apply(res, true);
      setState('');
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (err instanceof app().NetworkError) {
        setState(S.def
          ? 'Hors ligne : formulaire enregistré sur cet appareil. Vous pouvez saisir vos thèmes, l’envoi se fera une fois en ligne.'
          : 'Hors ligne : le formulaire n’a encore jamais été chargé sur cet appareil.', !S.def);
      } else if (err.message === 'Action inconnue') {
        setState('La saisie des thèmes n’est pas encore activée sur le serveur.', true);
      } else {
        setState(err.message, true);
      }
    } finally {
      S.loading = false;
    }
  }

  async function loadMes() {
    if (!navigator.onLine || !app() || !app().token()) return;
    try {
      const res = await app().api('themes_mes', { token: app().token() });
      S.mes = { demandes: res.demandes || [], maj: res.maj };
      store.set(KEY_MES, JSON.stringify(S.mes));
      renderMes();
    } catch (err) { /* liste facultative : on garde la dernière connue */ }
  }

  const signature = form => (form.sections || []).map(s => s.items.map(i => i.id + ':' + i.type + ':' + (i.choices ? i.choices.length : '')).join(',')).join('|');

  function apply(res, fresh) {
    const sig = signature(res.form);
    const changed = sig !== S.sig;
    S.def = res.form;
    S.moi = res.moi || S.moi || {};
    S.sig = sig;
    if (fresh) store.set(KEY_FORM, JSON.stringify({ form: S.def, moi: S.moi }));
    if (changed || !S.sid) restore();
    if (!S.done) render();
  }

  // Saisie en cours : brouillon de l'appareil s'il correspond au formulaire, sinon préremplissage
  function restore() {
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

  // Préremplissage : date du jour, niveau d'après les qualifications
  function defaults() {
    items().forEach(it => {
      if (it.type === 'date' && /date/i.test(it.title)) S.answers[it.id] = today();
    });
    if (S.moi.niveauItem && S.moi.niveau) S.answers[S.moi.niveauItem] = S.moi.niveau;
  }

  const items = () => (S.def ? S.def.sections.flatMap(s => s.items) : []);
  const isAgent = it => S.moi.agentItem && it.id === S.moi.agentItem;

  // ---------- brouillon ----------
  let saveTimer = null;
  function saveDraft() {
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
    if (!document.querySelector('#lr-form .fmpa-q.invalid')) $('#lr-msg').textContent = '';
  }

  // ---------- sections visibles (sauts de section du formulaire) ----------
  function path() {
    const secs = S.def.sections;
    const seen = [];
    let i = 0;
    while (typeof i === 'number' && i < secs.length && !seen.includes(i)) {
      seen.push(i);
      let next = secs[i].next;
      let attente = false;
      secs[i].items.forEach(it => {
        if (!it.choices) return;
        const branche = it.choices.some(ch => ch.go !== null);
        const c = it.choices.find(ch => ch.v === S.answers[it.id]);
        if (c && c.go !== null) next = c.go;
        // question qui oriente la suite (ex. spécialité) sans réponse : on n'affiche pas encore la suite
        else if (branche && it.required && !c) attente = true;
      });
      if (attente) break;
      if (next === 'next') i += 1;
      else if (typeof next === 'number') i = next;
      else break;
    }
    return seen;
  }

  function updateSections() {
    const visible = path();
    document.querySelectorAll('#lr-form .fmpa-sec').forEach(sec => {
      sec.hidden = !visible.includes(Number(sec.dataset.sec));
    });
  }

  // ---------- rendu ----------
  function setState(msg, isError) {
    const p = $('#lr-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  function render() {
    const root = $('#lr-form');
    $('#lr-done').hidden = true;
    if (!S.def) { root.replaceChildren(); root.hidden = true; $('#lr-bar').hidden = true; return; }
    root.hidden = false;

    const head = [];
    if (S.draftAt) {
      const when = new Date(S.draftAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      head.push(el('div', { class: 'fmpa-draft' },
        el('span', { text: `Brouillon du ${when} restauré.` }),
        el('button', { type: 'button', class: 'link', text: 'Repartir de zéro', onclick: () => { if (confirm('Effacer la saisie en cours ?')) clearDraft(); } })));
    }
    // Identité : remplace la question « Qui êtes-vous ? »
    const nomComplet = [S.moi.prenom, S.moi.nom].filter(Boolean).join(' ');
    head.push(el('p', { class: 'lr-agent' }, el('span', { text: 'Agent' }), el('strong', { text: nomComplet || '—' })));
    if (S.moi.agentItem && !S.moi.agentValeur) {
      head.push(el('p', { class: 'fmpa-msg error', text: `Votre nom (${S.moi.nom}) ne figure pas dans la liste du formulaire : l’envoi sera refusé. Prévenez l’administrateur.` }));
    }

    const secs = S.def.sections.map((sec, i) => {
      const box = el('section', { class: 'fmpa-sec', 'data-sec': String(i) });
      if (sec.title) box.append(el('h2', { class: 'section-title', text: sec.title }));
      if (sec.help) box.append(el('p', { class: 'muted small', text: sec.help }));
      sec.items.forEach(it => { if (!isAgent(it)) box.append(renderItem(it)); });
      return box;
    });
    root.replaceChildren(...head, ...secs);
    $('#lr-bar').hidden = false;
    updateSections();
  }

  function field(it, ...body) {
    const wrap = el('div', { class: 'fmpa-q', 'data-q': String(it.id) });
    wrap.append(el('p', { class: 'fmpa-label', id: 'lq-' + it.id },
      it.title, it.required ? el('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null));
    if (it.help) wrap.append(el('p', { class: 'fmpa-help', text: it.help }));
    wrap.append(...body.filter(b => b !== null && b !== undefined));
    wrap.append(el('p', { class: 'fmpa-err', role: 'alert' }));
    return wrap;
  }

  function renderItem(it) {
    const v = S.answers[it.id];
    const lab = 'lq-' + it.id;
    switch (it.type) {
      case 'header':
        return el('div', { class: 'fmpa-header' },
          it.title ? el('h3', { text: it.title }) : null,
          it.help ? el('p', { class: 'muted small', text: it.help }) : null);
      case 'text':
        return field(it, el('input', {
          type: 'text', inputmode: /longueur|corde|m[eè]tres?|nombre|dur[ée]e/i.test(it.title) ? 'decimal' : null,
          'aria-labelledby': lab, value: v || '', maxlength: '500', oninput: e => setAnswer(it, e.target.value),
        }));
      case 'paragraph':
        return field(it, el('textarea', { 'aria-labelledby': lab, rows: '3', maxlength: '4000', oninput: e => setAnswer(it, e.target.value) }, v || ''));
      case 'date':
        return field(it, el('input', { type: 'date', max: today(), 'aria-labelledby': lab, value: v || '', onchange: e => setAnswer(it, e.target.value) }));
      case 'time':
      case 'duration':
        return field(it, el('input', { type: 'time', 'aria-labelledby': lab, value: v || '', onchange: e => setAnswer(it, e.target.value) }));
      case 'list': {
        const sel = el('select', { 'aria-labelledby': lab, onchange: e => setAnswer(it, e.target.value) },
          el('option', { value: '', text: 'Choisir…' }),
          ...it.choices.map(c => el('option', { value: c.v, text: c.v })));
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
          box.append(el('button', {
            type: 'button', class: 'pill', 'aria-pressed': String(String(v) === String(n)), text: String(n),
            onclick: () => { setAnswer(it, String(v) === String(n) ? '' : String(n)); rerenderItem(it); },
          }));
        }
        return field(it, box, (it.minLabel || it.maxLabel)
          ? el('p', { class: 'fmpa-scale-legend' }, el('span', { text: it.minLabel || '' }), el('span', { text: it.maxLabel || '' }))
          : null);
      }
    }
    return el('div');
  }

  function rerenderItem(it) {
    const old = document.querySelector(`#lr-form .fmpa-q[data-q="${it.id}"]`);
    if (old) old.replaceWith(renderItem(it));
  }

  function renderChoices(it, multi) {
    const v = S.answers[it.id];
    const sel = multi ? [].concat(v || []) : v;
    const known = it.choices.map(c => c.v);
    const otherVal = multi ? sel.find(x => !known.includes(x)) : (v && !known.includes(v) ? v : '');
    const name = 'lq' + it.id;
    const box = el('div', { class: 'fmpa-choices' + (multi ? ' multi' : ''), role: multi ? 'group' : 'radiogroup', 'aria-labelledby': 'lq-' + it.id });
    it.choices.forEach(c => {
      const input = el('input', {
        type: multi ? 'checkbox' : 'radio', name, value: c.v, checked: multi ? sel.includes(c.v) : sel === c.v,
        onchange: e => {
          if (multi) {
            const cur = [].concat(S.answers[it.id] || []).filter(x => x !== c.v);
            if (e.target.checked) cur.push(c.v);
            setAnswer(it, known.filter(k => cur.includes(k)).concat(cur.filter(x => !known.includes(x))));
          } else {
            setAnswer(it, c.v);
            const o = box.querySelector('.fmpa-other input[type="text"]');
            if (o) o.value = '';
          }
        },
      });
      if (!multi && !it.required) {
        input.addEventListener('click', e => { if (e.target.dataset.was === '1') { e.target.checked = false; setAnswer(it, ''); } });
        input.addEventListener('pointerdown', e => { e.target.dataset.was = e.target.checked ? '1' : '0'; });
        input.addEventListener('keydown', e => { e.target.dataset.was = '0'; });
      }
      box.append(el('label', { class: 'choice' }, input, el('span', { text: c.v })));
    });
    if (it.other) {
      box.append(el('div', { class: 'choice fmpa-other' }, el('input', {
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
      })));
    }
    return box;
  }

  // ---------- demandes en attente de validation ----------
  function renderMes() {
    const box = $('#lr-mes');
    const list = (S.mes && S.mes.demandes) || [];
    if (!list.length) { box.replaceChildren(); return; }
    box.replaceChildren(el('div', { class: 'lr-mes' },
      el('p', { class: 'lr-mes-title', text: `En attente de validation (${list.length})` }),
      el('ul', null, ...list.map(d => el('li', null,
        el('strong', { text: d.date ? `FMPA du ${fmtDate(d.date)}` : 'FMPA' }),
        el('span', { text: [d.cu ? `CU ${d.cu}` : '', d.themes ? `${d.themes} thème${d.themes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') }))))));
  }

  // ---------- file d'attente (hors ligne) ----------
  const outbox = () => store.getJSON(KEY_OUTBOX) || [];
  function saveOutbox(list) {
    if (list.length) store.set(KEY_OUTBOX, JSON.stringify(list));
    else store.del(KEY_OUTBOX);
    renderOutbox();
  }
  const mine = e => !e.owner || !S.moi.nom || e.owner === S.moi.nom;
  const pendingList = () => outbox().filter(mine);
  function patchEntry(sid, patch) { saveOutbox(outbox().map(e => (e.sid === sid ? Object.assign({}, e, patch) : e))); }
  function removeEntry(sid) { saveOutbox(outbox().filter(e => e.sid !== sid)); }

  async function flush() {
    if (S.flushing || !navigator.onLine || !app() || !app().token()) return;
    if (!S.moi.nom) { const c = store.getJSON(KEY_FORM); if (c && c.moi) S.moi = c.moi; }
    const todo = outbox().filter(e => e.status === 'pending' && mine(e));
    if (!todo.length) return;
    S.flushing = true;
    renderOutbox();
    let sent = 0;
    try {
      for (const e of todo) {
        try {
          await app().api('themes_submit', { token: app().token(), answers: e.answers, submission_id: e.sid });
          removeEntry(e.sid);
          sent++;
        } catch (err) {
          if (err instanceof app().NetworkError) break;
          if (app().AUTH_ERRORS.includes(err.message)) break;
          patchEntry(e.sid, { status: 'error', error: err.message });
        }
      }
    } finally {
      S.flushing = false;
    }
    renderOutbox();
    if (S.done && !$('#lr-done').hidden) showDone();
    if (sent) loadMes();
  }

  function renderOutbox() {
    const box = $('#lr-outbox');
    if (!box) return;
    const list = pendingList();
    if (!list.length) { box.replaceChildren(); return; }
    const waiting = list.filter(e => e.status === 'pending');
    const offline = !navigator.onLine;
    box.replaceChildren(el('div', { class: 'outbox', role: 'status' },
      el('div', { class: 'outbox-head' },
        el('strong', { text: `${list.length} saisie${list.length > 1 ? 's' : ''} en attente d’envoi` }),
        waiting.length ? el('button', {
          type: 'button', class: 'pill', disabled: offline || S.flushing,
          text: S.flushing ? 'Envoi…' : offline ? 'En attente du réseau' : 'Envoyer maintenant', onclick: () => flush(),
        }) : null),
      el('ul', { class: 'outbox-list' }, ...list.map(e => {
        const li = el('li', { class: e.status === 'error' ? 'is-error' : '' },
          el('span', { text: e.recap || 'Thèmes FMPA' }),
          el('small', { text: e.status === 'error' ? `Refusée : ${e.error}` : `Saisie le ${new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` }));
        if (e.status === 'error') {
          li.append(el('div', { class: 'outbox-actions' },
            el('button', { type: 'button', class: 'link', text: 'Réessayer', onclick: () => { patchEntry(e.sid, { status: 'pending', error: '' }); flush(); } }),
            el('button', { type: 'button', class: 'link', text: 'Reprendre', onclick: () => resume(e) }),
            el('button', { type: 'button', class: 'link danger', text: 'Supprimer', onclick: () => { if (confirm('Supprimer définitivement cette saisie non envoyée ?')) removeEntry(e.sid); } })));
        }
        return li;
      })),
      offline ? el('p', { class: 'small', text: 'Envoi automatique dès le retour du réseau.' }) : null));
  }

  function resume(e) {
    if (Object.keys(S.answers).length && store.get(KEY_DRAFT) &&
        !confirm('Une saisie est déjà en cours. La remplacer par celle à reprendre ?')) return;
    removeEntry(e.sid);
    store.set(KEY_DRAFT, JSON.stringify({ sig: S.sig, sid: e.sid, answers: e.answers, ts: e.ts }));
    S.done = null;
    restore();
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('online', () => { renderOutbox(); flush(); });
  window.addEventListener('offline', renderOutbox);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });

  // ---------- validation et envoi ----------
  function clearInvalid(id) {
    const q = document.querySelector(`#lr-form .fmpa-q[data-q="${id}"]`);
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
      if (it.type === 'header' || isAgent(it)) return;
      const v = S.answers[it.id];
      let msg = '';
      if (it.required && isEmpty(v)) msg = 'Réponse obligatoire.';
      if (!msg && it.type === 'date' && v && v > today()) msg = 'La date ne peut pas être dans le futur.';
      if (msg) errors.push([it, msg]);
    });
    document.querySelectorAll('#lr-form .fmpa-q.invalid').forEach(q => { q.classList.remove('invalid'); $('.fmpa-err', q).textContent = ''; });
    errors.forEach(([it, msg]) => {
      const q = document.querySelector(`#lr-form .fmpa-q[data-q="${it.id}"]`);
      if (q) { q.classList.add('invalid'); $('.fmpa-err', q).textContent = msg; }
    });
    return errors;
  }

  const pick = (answers, re) => {
    const it = items().find(x => re.test(x.title) && !isEmpty(answers[x.id]));
    return it ? answers[it.id] : '';
  };
  const recapOf = answers => {
    const d = pick(answers, /date/i);
    const cu = pick(answers, /chef d.?unit/i);
    const nb = items().filter(it => it.type === 'checkbox').reduce((s, it) => s + [].concat(answers[it.id] || []).length, 0);
    return {
      text: [d ? `FMPA du ${fmtDate(d)}` : '', nb ? `${nb} thème${nb > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      cu: String(cu || ''),
      nb,
    };
  };

  function submit() {
    if (!S.def) return;
    const msg = $('#lr-msg');
    msg.textContent = '';
    msg.className = 'fmpa-msg';
    const visibleItems = path().flatMap(i => S.def.sections[i].items);
    const errors = validate(visibleItems);
    if (errors.length) {
      msg.textContent = errors.length > 1 ? `${errors.length} réponses à compléter.` : 'Une réponse est à compléter.';
      msg.classList.add('error');
      const first = document.querySelector('#lr-form .fmpa-q.invalid');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const answers = {};
    visibleItems.forEach(it => {
      if (it.type === 'header' || isAgent(it)) return;
      const v = S.answers[it.id];
      if (!isEmpty(v)) answers[it.id] = typeof v === 'string' ? v.trim() : v;
    });
    const r = recapOf(answers);
    if (!r.nb) {
      msg.textContent = 'Cochez au moins un thème vu pendant la FMPA.';
      msg.classList.add('error');
      return;
    }
    const offline = !navigator.onLine;
    const lines = ['Envoyer vos thèmes au chef d’unité pour validation ?', '', r.text];
    if (r.cu) lines.push(`Chef d’unité : ${r.cu}`);
    if (offline) lines.push('', 'Pas de réseau : la saisie sera gardée sur cet appareil et envoyée automatiquement dès le retour du réseau.');
    if (!confirm(lines.join('\n'))) return;

    const entry = { sid: S.sid, answers, recap: r.text, cu: r.cu, owner: S.moi.nom || '', ts: Date.now(), status: 'pending', error: '' };
    saveOutbox(outbox().filter(e => e.sid !== entry.sid).concat(entry));
    S.done = { recap: r.text, cu: r.cu, sid: entry.sid };
    store.del(KEY_DRAFT);
    S.answers = {};
    S.sid = newSid();
    S.draftAt = null;
    defaults();
    showDone();
    if (!offline) flush();
  }

  function showDone() {
    const d = S.done;
    const waiting = outbox().some(e => e.sid === d.sid);
    const err = outbox().find(e => e.sid === d.sid && e.status === 'error');
    $('#lr-form').hidden = true;
    $('#lr-bar').hidden = true;
    $('#lr-msg').textContent = '';
    const done = $('#lr-done');
    done.hidden = false;
    done.dataset.state = err ? 'error' : waiting ? 'queued' : 'sent';
    $('#lr-done-icon').textContent = err ? '!' : waiting ? '⏳' : '✓';
    $('#lr-done-title').textContent = err ? 'Saisie non envoyée' : waiting ? (S.flushing ? 'Envoi en cours…' : 'Saisie enregistrée sur l’appareil') : 'Saisie envoyée';
    $('#lr-done-recap').textContent = d.recap + (d.cu ? ` — chef d’unité ${d.cu}` : '');
    $('#lr-done-note').textContent = err ? err.error.replace(/[.!]?\s*$/, '.') + ' Vous pouvez la reprendre depuis le bandeau ci-dessus.'
      : waiting ? 'Pas de réseau pour l’instant : elle partira automatiquement dès son retour. Rouvrez simplement l’application.'
      : 'Votre chef d’unité est prévenu. Vous recevrez un mail quand il aura validé (ou rejeté) vos thèmes ; ils apparaîtront alors dans Mes heures.';
    setState('');
    window.scrollTo(0, 0);
  }

  function again() {
    S.done = null;
    render();
    window.scrollTo(0, 0);
  }

  // Déconnexion volontaire : rien ne reste sur l'appareil. Session expirée : les saisies non envoyées sont gardées.
  function reset(all) {
    [KEY_FORM, KEY_DRAFT, KEY_MES].forEach(k => store.del(k));
    if (all === true) store.del(KEY_OUTBOX);
    Object.assign(S, { def: null, sig: '', moi: {}, answers: {}, sid: '', draftAt: null, loaded: false, done: null, mes: null });
    renderOutbox();
  }

  $('#lr-send').addEventListener('click', submit);
  $('#lr-again').addEventListener('click', again);

  window.SMPM_THEMES = { open, flush, reset, pending: () => pendingList().length };
})();
