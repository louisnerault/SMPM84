// FMPA : déclaration, consultation et modification (chefs d'unité et au-delà, administrateurs).
// Le formulaire est construit à partir de la structure du Google Form « Formulaire FMPA »
// renvoyée par l'API (action fmpa_form) ; l'envoi soumet la réponse au formulaire lui-même
// (action fmpa_submit), qui alimente le sheet FMPA comme une saisie classique.
// Brouillon enregistré sur l'appareil à chaque saisie : rien n'est perdu hors ligne.
// Une FMPA enregistrée s'ouvre dans le même formulaire (action fmpa_get), en lecture seule
// ou modifiable selon les droits renvoyés par le serveur ; l'enregistrement passe par fmpa_update.
//
// Le même moteur sert à la déclaration d'intervention (Intervention › Nouvelle intervention) :
// createDeclarer() est instancié deux fois, avec ses propres éléments de page (préfixe « fmpa » ou
// « itv »), ses clés de stockage et ses actions d'API. L'intervention ajoute le pointage GPS sur carte.
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  // Pastille du burger : une déclaration en attente, FMPA ou intervention
  const pendingBy = {};
  function paintBurgerDot() {
    const dot = document.querySelector('#btn-menu .pending-dot');
    if (dot) dot.hidden = !Object.keys(pendingBy).some(k => pendingBy[k] > 0);
  }
  // Autres rubriques avec envois en attente (ex. points d'intérêt créés hors ligne, poi.js)
  window.SMPM_PENDING_DOT = (k, n) => { pendingBy[k] = n; paintBurgerDot(); };

  function createDeclarer(C) {
    const KEY_FORM = C.keys.form;
    const KEY_DRAFT = C.keys.draft;
    const KEY_OUTBOX = C.keys.outbox;
    const byId = name => document.getElementById(C.p + '-' + name);
    const FORM_SEL = '#' + C.p + '-form';
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
        byId('msg').textContent = '';
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
      byId('msg').textContent = '';
      byId('form').replaceChildren();
      byId('form').hidden = true;
      byId('bar').hidden = true;
      renderHead();
      setState(C.rec.loading);
      try {
        const res = await app().api(C.api.get, { token: app().token(), id });
        if (!S.rec || S.rec.id !== id) return;              // l'utilisateur est parti entre-temps
        applyDef(res);
        setRecord(res[C.rec.key]);
        setState('');
      } catch (err) {
        if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
        setState(err instanceof app().NetworkError ? C.rec.offline
          : err.message === 'Action inconnue' ? C.rec.notActive : err.message, true);
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
        const res = await app().api(C.api.form, { token: app().token() });
        store.set(KEY_FORM, JSON.stringify({ form: res.form, personnes: res.personnes, moi: res.moi }));
        S.loaded = true;
        S.loadedAt = Date.now();
        apply(res);
        setState('');
      } catch (err) {
        if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
        if (err instanceof app().NetworkError) {
          setState(S.def
            ? app().netLabel() + ' : formulaire enregistré sur cet appareil. Vous pouvez remplir la déclaration, l’envoi se fera une fois en ligne.'
            : app().netLabel() + ' : le formulaire n’a encore jamais été chargé sur cet appareil.', !S.def);
        } else if (err.message === 'Action inconnue') {
          setState(C.txt.notActive, true);
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
      // Personnel inactif retiré des listes de choix (une réponse déjà enregistrée reste affichée)
      (S.def.sections || []).forEach(sec => sec.items.forEach(it => {
        if (it.choices) it.choices = it.choices.filter(c => !isInactiveName(c.v));
        if (C.imp3List && isImp3Item(it)) it.choices = imp3Choices(it.choices);
      }));
      return changed;
    }

    // Liste « IMP3 responsable » : personnel actif titulaire de l'IMP3, d'après la liste du personnel
    // gardée sur l'appareil (avec le formulaire, à défaut l'annuaire). Sans cette information, on garde
    // les choix du Google Form. Le serveur ajoute au formulaire un IMP3 qui n'y figure pas encore.
    const isImp3Item = it => (it.type === 'list' || it.type === 'radio') && (C.imp3Re || /imp\s*3/i).test(it.title);
    function imp3Names() {
      const pers = S.personnes || {};
      const noms = Object.keys(pers);
      if (noms.some(n => typeof pers[n].imp3 === 'boolean')) {
        return noms.filter(n => pers[n].imp3 && pers[n].actif !== false);
      }
      const ann = store.getJSON('smpm_annuaire');
      const list = (ann && ann.personnes) || [];
      return list.filter(p => (p.qualifs || []).some(q => norm(q).replace(/\s/g, '') === 'IMP3') && p.actif !== false)
        .map(p => norm(p.nom)).filter(Boolean);
    }
    function imp3Choices(choices) {
      const noms = imp3Names();
      if (!noms.length) return choices;
      // La personne qui remplit est toujours proposée (et présélectionnée), même sans l'IMP3 :
      // c'est son rôle (chef de section, CT, administrateur) qui l'autorise à déclarer
      if (S.moi && S.moi.nom) noms.push(norm(S.moi.nom));
      // seulement pour une liste de noms (pas une question OUI / NON dont le titre parlerait du chef d'unité)
      const connus = new Set(Object.keys(S.personnes || {}).concat(noms));
      if ((choices || []).length && !choices.some(c => connus.has(norm(c.v)))) return choices;
      const go = {};
      (choices || []).forEach(c => { go[norm(c.v)] = c.go; });
      return Array.from(new Set(noms)).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
        .map(n => ({ v: n, go: go[n] === undefined ? null : go[n] }));
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
        // Chef d'unité laissé vide dans le brouillon : l'utilisateur est présélectionné
        if (C.imp3List && S.moi && S.moi.nom) items().forEach(it => {
          if (isImp3Item(it) && !S.answers[it.id] && (it.choices || []).some(c => norm(c.v) === norm(S.moi.nom))) {
            S.answers[it.id] = it.choices.find(c => norm(c.v) === norm(S.moi.nom)).v;
          }
        });
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
      updateNav();
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
      document.querySelectorAll(FORM_SEL + ' .fmpa-sec').forEach(sec => {
        sec.hidden = !visible.includes(Number(sec.dataset.sec));
      });
      updateCounter();
      updateNav(visible);
    }

    // ---------- liens rapides vers les rubriques (en tête du formulaire) ----------
    // Une pastille par rubrique visible ; elle passe au vert quand la rubrique est complète
    // (toutes les questions obligatoires remplies, ou au moins une réponse s'il n'y en a pas).
    let spy = null;
    const answerable = it => it.type !== 'header';
    function filled(it) {
      if (it.type === 'grid' || it.type === 'checkgrid') {
        const g = gridValue(it);
        return it.required ? !g.some(isEmpty) : g.some(x => !isEmpty(x));
      }
      const v = S.answers[it.id];
      if (isEmpty(v)) return false;
      if (C.gps && isGpsItem(it)) return !!parseLatLng(v);
      if (it.type === 'duration') return /^\d{1,2}:\d{2}$/.test(String(v).trim());
      return true;
    }
    function secStatus(i) {
      const its = S.def.sections[i].items.filter(answerable);
      if (!its.length) return null;
      const req = its.filter(it => it.required);
      const any = its.some(filled);
      if (req.length ? req.every(filled) : any) return 'done';
      return any ? 'partial' : 'empty';
    }
    const secLabel = (sec, i) => (sec.title || '').trim() || `Rubrique ${i + 1}`;

    function renderNav() {
      const nav = el('nav', { class: 'secnav', 'aria-label': 'Rubriques du formulaire' });
      const ul = el('ul', { class: 'secnav-list' });
      S.def.sections.forEach((sec, i) => {
        if (!sec.items.some(answerable)) return;
        const label = secLabel(sec, i);
        ul.append(el('li', { 'data-nav': String(i) }, el('a', {
          href: '#' + C.p + '-sec-' + i, title: label,
          onclick: e => {
            e.preventDefault();
            const target = byId('sec-' + i);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }, el('span', { class: 'secnav-n', 'aria-hidden': 'true' }), el('span', { class: 'secnav-t', text: label }),
          el('span', { class: 'sr-only secnav-s' }))));
      });
      nav.append(ul);
      return ul.children.length > 1 ? nav : null;
    }

    function updateNav(visible) {
      const nav = document.querySelector(FORM_SEL + ' .secnav');
      if (!nav || !S.def) return;
      visible = visible || path();
      let n = 0;
      nav.querySelectorAll('li[data-nav]').forEach(li => {
        const i = Number(li.dataset.nav);
        li.hidden = !visible.includes(i);
        if (li.hidden) return;
        n += 1;
        const st = secStatus(i);
        const bad = !!document.querySelector(`${FORM_SEL} .fmpa-sec[data-sec="${i}"] .fmpa-q.invalid`);
        li.dataset.state = bad ? 'bad' : st || 'empty';
        li.querySelector('.secnav-n').textContent = st === 'done' && !bad ? '✓' : String(n);
        li.querySelector('.secnav-s').textContent = bad ? ' (à corriger)' : st === 'done' ? ' (complète)' : st === 'partial' ? ' (en cours)' : '';
      });
    }

    // Rubrique affichée à l'écran : pastille soulignée et ramenée dans la barre
    function watchSections() {
      if (spy) { spy.disconnect(); spy = null; }
      const nav = document.querySelector(FORM_SEL + ' .secnav');
      if (!nav || !('IntersectionObserver' in window)) return;
      const seen = new Map();
      spy = new IntersectionObserver(entries => {
        entries.forEach(e => seen.set(e.target, e.isIntersecting ? e.boundingClientRect.top : null));
        let best = null, top = Infinity;
        seen.forEach((t, sec) => { if (t !== null && !sec.hidden && t < top) { top = t; best = sec; } });
        if (!best) return;
        nav.querySelectorAll('li[data-nav]').forEach(li => {
          const on = li.dataset.nav === best.dataset.sec;
          const a = li.querySelector('a');
          if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
          if (on) {
            const list = nav.querySelector('.secnav-list');
            const l = li.offsetLeft - list.offsetLeft, r = l + li.offsetWidth;
            if (l < list.scrollLeft || r > list.scrollLeft + list.clientWidth) list.scrollTo({ left: l - 16, behavior: 'smooth' });
          }
        });
      }, { rootMargin: '-70px 0px -55% 0px' });
      document.querySelectorAll(FORM_SEL + ' .fmpa-sec').forEach(sec => spy.observe(sec));
    }

    // ---------- indice de risque (FMPA) ----------
    // Même calcul que l'onglet FMPA_test du sheet FMPA (colonne SCORE, cellule I17 = SOMME(I4:I16),
    // corrigée par corrigerIndiceRisque() de backend/Fmpa.gs) :
    //   - météo, lieu, caractéristiques : chiffre en tête de la réponse (0 à 4, sinon 5) ;
    //   - effectif : 0 si « ≤ 7 spécialistes », sinon 1 ; communication CODIS : nombre en tête ;
    //   - reconnaissance, SOIEC CNF, équipements, communication sur site : 1 si NON ;
    //   - danger particulier : 1 sauf NON ; autorisation du site : 0 si OUI, sinon 1 ;
    //   - temps de marche d'approche : chiffre en tête / 5 ; autres difficultés : 1 sauf NON.
    // Niveau (couleurs du compte rendu PDF, TEMPLATE_FMPA) : ≤ 5 vert (jaune si manœuvre de nuit),
    // ≤ 10 jaune, ≤ 15 orange, au-delà rouge.
    const lead = v => { const c = String(v || '').trim().charAt(0); return /[0-4]/.test(c) ? Number(c) : 5; };
    const leadNum = v => { const n = parseFloat(String(v || '').split(' - ')[0].replace(',', '.')); return isNaN(n) ? 0 : n; };
    const isNon = v => fold(v) === 'non';
    const RISK_RULES = [
      { k: 'meteo', re: /meteo/, pts: lead },
      { k: 'lieu', re: /lieu de la fmpa/, pts: lead },
      { k: 'carac', re: /caracteristique/, pts: lead },
      { k: 'effectif', re: /effectif/, pts: v => (/(≤|<=)\s*7/.test(String(v || '')) ? 0 : 1) },
      { k: 'codis', re: /codis/, pts: leadNum },
      { k: 'reco', re: /reconnaissance/, pts: v => (isNon(v) ? 1 : 0) },
      { k: 'danger', re: /danger/, pts: v => (isNon(v) ? 0 : 1) },
      { k: 'soiec', re: /soiec.*cnf|cnf.*soiec/, pts: v => (isNon(v) ? 1 : 0) },
      { k: 'equip', re: /equipement/, pts: v => (isNon(v) ? 1 : 0) },
      { k: 'comsite', re: /communication sur site/, pts: v => (isNon(v) ? 1 : 0) },
      { k: 'autor', re: /autorisation/, pts: v => (fold(v) === 'oui' ? 0 : 1) },
      { k: 'marche', re: /marche d.?approche|temps de marche/, pts: v => lead(v) / 5 },
      { k: 'autres', re: /autres? difficult/, pts: v => (isNon(v) ? 0 : 1) },
    ];
    const RISK_LEVELS = [
      null,
      { color: 'VERT', label: 'Risque faible', msg: 'Bonne manœuvre.' },
      { color: 'JAUNE', label: 'Risque modéré', msg: 'Restez vigilants sur les points relevés.' },
      { color: 'ORANGE', label: 'Risque élevé', msg: 'Renforcez la sécurité avant de débuter.' },
      { color: 'ROUGE', label: 'Risque très élevé', msg: 'NE DÉBUTEZ PAS LA MANŒUVRE, contactez votre chef de secteur.' },
    ];

    function riskOf(visibleItems) {
      const pool = visibleItems.filter(it => it.type !== 'header' && it.type !== 'grid' && it.type !== 'checkgrid');
      const used = new Set();
      const find = re => pool.find(it => !used.has(it.id) && re.test(fold(it.title)));
      const lines = [];
      RISK_RULES.forEach(r => {
        const it = find(r.re);
        if (!it) return;
        used.add(it.id);
        const v = S.answers[it.id];
        lines.push({ title: it.title, answer: Array.isArray(v) ? v.join(', ') : String(v || '—'), pts: r.pts(v) });
      });
      if (lines.length < 4) return null;                    // analyse de risque absente ou sautée
      const indice = Math.round(lines.reduce((s, l) => s + l.pts, 0) * 10) / 10;
      const nuitIt = find(/nuit/);
      const nuit = nuitIt && fold(S.answers[nuitIt.id]) === 'oui';
      const reposIt = find(/repos de securite/);
      const reposV = reposIt ? fold(S.answers[reposIt.id]) : '';
      let level = indice <= 5 ? 1 : indice <= 10 ? 2 : indice <= 15 ? 3 : 4;
      const night = level === 1 && nuit;
      if (night) level = 2;
      return {
        indice, level, lines, night,
        repos: reposIt && reposV && reposV !== 'ok' && reposV !== 'oui',
      };
    }

    const fmtPts = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    function riskNode(r) {
      if (!r) return el('p', { class: 'risk-none muted small', text: 'Analyse de risque non renseignée : indice non calculé.' });
      const L = RISK_LEVELS[r.level];
      const scale = el('ol', { class: 'risk-scale', 'aria-hidden': 'true' },
        ...['0–5', '6–10', '11–15', '> 15'].map((t, n) => el('li', { class: 'lv' + (n + 1) + (n + 1 === r.level ? ' on' : ''), text: t })));
      const notes = [];
      if (r.night) notes.push('Manœuvre de nuit : niveau relevé d’un cran.');
      if (r.repos) notes.push('Des spécialistes sont peut-être en repos de sécurité.');
      const table = el('table', { class: 'risk-table' },
        el('tbody', {}, ...r.lines.map(l => el('tr', { class: l.pts ? 'pos' : '' },
          el('th', { scope: 'row', text: l.title }), el('td', { text: l.answer }), el('td', { class: 'pts', text: fmtPts(l.pts) })))),
        el('tfoot', {}, el('tr', {}, el('th', { scope: 'row', colspan: '2', text: 'Indice' }), el('td', { class: 'pts', text: fmtPts(r.indice) }))));
      return el('div', { class: 'risk lv' + r.level, role: 'group', 'aria-label': `Indice de risque : ${L.color}` },
        el('div', { class: 'risk-head' },
          el('span', { class: 'risk-badge', text: L.color }),
          el('div', { class: 'risk-title' },
            el('strong', { text: L.label }),
            el('span', { text: `Indice de risque : ${fmtPts(r.indice)}` }))),
        scale,
        el('p', { class: 'risk-msg', text: L.msg }),
        ...notes.map(t => el('p', { class: 'risk-note', text: '⚠ ' + t })),
        el('details', { class: 'risk-detail' }, el('summary', { text: 'Détail du calcul' }), table));
    }

    // ---------- fenêtre de confirmation dans la page ----------
    function askConfirm({ title, nodes, ok, okDanger }) {
      return new Promise(resolve => {
        const prev = document.activeElement;
        const titleId = C.p + '-mdl-title';
        const btnNo = el('button', { type: 'button', class: 'mdl-cancel', text: 'Revenir au formulaire' });
        const btnOk = el('button', { type: 'button', class: 'primary mdl-ok' + (okDanger ? ' danger' : ''), text: ok });
        const box = el('div', { class: 'mdl', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
          el('h2', { id: titleId, class: 'mdl-title', text: title }),
          el('div', { class: 'mdl-body' }, ...nodes),
          el('div', { class: 'mdl-actions' }, btnNo, btnOk));
        const scrim = el('div', { class: 'mdl-scrim' }, box);
        const overflow = document.body.style.overflow;
        function close(v) {
          document.removeEventListener('keydown', onKey, true);
          scrim.remove();
          document.body.style.overflow = overflow;
          if (prev && prev.focus) prev.focus({ preventScroll: true });
          resolve(v);
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); close(false); }
          else if (e.key === 'Tab') {
            const f = Array.from(box.querySelectorAll('button, summary, [href]')).filter(n => !n.disabled && n.offsetParent);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
        btnNo.addEventListener('click', () => close(false));
        btnOk.addEventListener('click', () => close(true));
        scrim.addEventListener('click', e => { if (e.target === scrim) close(false); });
        document.addEventListener('keydown', onKey, true);
        document.body.append(scrim);
        document.body.style.overflow = 'hidden';
        box.focus();
      });
    }

    // ---------- rendu ----------
    function setState(msg, isError) {
      const p = byId('state');
      p.textContent = msg || '';
      p.classList.toggle('error', !!isError);
    }

    // En-tête : titre, retour à la liste, droits sur la FMPA ouverte
    function renderHead() {
      const head = byId('head');
      if (S.mode === 'declare') {
        head.replaceChildren(el('h1', { text: C.txt.title }));
        return;
      }
      const r = S.rec || {};
      const m = r.meta || {};
      const nodes = [];
      if (r.origin) {
        nodes.push(el('div', { class: 'sub-head' }, el('button', {
          type: 'button', class: 'link', text: '← ' + C.rec.back(r.origin),
          onclick: () => app().goto(r.origin),
        })));
      }
      nodes.push(el('h1', { text: C.rec.title(m, fmtDate) }));
      if (m.id) {
        const bits = C.rec.bits(m, fmtDateTime).filter(Boolean);
        nodes.push(el('p', { class: 'muted small fmpa-meta-line', text: bits.join(' · ') }));
        nodes.push(droitsBox(r.droits || {}, m));
      }
      head.replaceChildren(...nodes);
    }

    function droitsBox(d, m) {
      if (C.rec.droits) return el('p', { class: 'fmpa-rights ' + (d.modifier ? 'ok-box' : 'ro-box'), text: C.rec.droits(d, m, fmtDateTime) });
      if (d.modifier) {
        const t = d.par === 'cu' && d.jusqua
          ? `Modifiable jusqu’au ${fmtDateTime(d.jusqua)} (24 h après la déclaration). Ensuite, les modifications passeront par votre chef de section.`
          : d.par === 'section' ? `Modifiable en tant que chef de section ${cap(m.secteur)}.`
          : 'Modifiable.';
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
      const root = byId('form');
      const done = byId('done');
      renderHead();
      root.classList.toggle('fmpa-ro', S.mode === 'view');
      if (S.done) {
        root.hidden = true;
        byId('bar').hidden = true;
        done.hidden = false;
        return;
      }
      done.hidden = true;
      if (!S.def || (S.mode !== 'declare' && (!S.rec || S.rec.loading))) {
        root.replaceChildren(); root.hidden = true; byId('bar').hidden = true; return;
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
        const box = el('section', { class: 'fmpa-sec', 'data-sec': String(i), id: C.p + '-sec-' + i });
        if (sec.title) box.append(el('h2', { class: 'section-title', text: sec.title }));
        if (sec.help) box.append(el('p', { class: 'muted small', text: sec.help }));
        sec.items.forEach(it => box.append(renderItem(it)));
        return box;
      });
      const nav = renderNav();
      root.replaceChildren(...(nav ? [nav] : []), ...head, ...secs);

      // Lecture seule : réponses figées, seules la recherche et les filtres de la grille restent actifs
      if (S.mode === 'view') {
        root.querySelectorAll('input, select, textarea, button').forEach(n => {
          if (!n.closest('.grid-tools')) n.disabled = true;
        });
      }
      const send = byId('send');
      send.hidden = S.mode === 'view';
      send.textContent = S.mode === 'edit' ? 'Enregistrer' : 'Envoyer';
      byId('bar').hidden = false;
      updateSections();
      watchSections();
    }

    function field(it, ...body) {
      const wrap = el('div', { class: 'fmpa-q', 'data-q': String(it.id) });
      const label = el('p', { class: 'fmpa-label', id: 'q-' + it.id },
        it.title, it.required ? el('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null);
      wrap.append(label);
      if (it.help) wrap.append(el('p', { class: 'fmpa-help', text: it.help }));
      wrap.append(...body.filter(b => b !== null && b !== undefined));
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
          if (C.gps && isGpsItem(it)) return field(it, gpsWidget(v, val => setAnswer(it, val)));
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

        case 'list':
        case 'radio':
          if (it.choices.length > LONG_LIST) return field(it, renderSearch(it));
          if (it.type === 'radio') return field(it, renderChoices(it, false));
        // falls through
        case 'list-select': {
          const sel = el('select', { 'aria-labelledby': lab, onchange: e => setAnswer(it, e.target.value) },
            el('option', { value: '', text: 'Choisir…' }),
            ...it.choices.map(c => el('option', { value: c.v, text: c.v })),
            // réponse enregistrée qui ne figure plus dans les choix du formulaire
            v && !it.choices.some(c => c.v === v) ? el('option', { value: v, text: v }) : null);
          sel.value = v || '';
          return field(it, sel);
        }

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
      const old = document.querySelector(`${FORM_SEL} .fmpa-q[data-q="${it.id}"]`);
      if (old) old.replaceWith(renderItem(it));
    }

    // Liste très longue (communes…) : champ de recherche avec suggestions, sans défilement
    const LONG_LIST = 40;
    const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-'’\s]+/g, ' ').trim();
    function renderSearch(it) {
      const v = S.answers[it.id] || '';
      const known = it.choices.map(c => c.v);
      const keys = known.map(fold);
      const box = el('div', { class: 'qsearch' });
      const listId = 'qs-' + C.p + '-' + it.id;
      const what = /commune/i.test(it.title) ? 'une commune' : /d[ée]partement/i.test(it.title) ? 'un département' : 'dans la liste';
      const input = el('input', {
        type: 'search', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
        'aria-labelledby': 'q-' + it.id, placeholder: `Rechercher ${what}…`, value: v, autocomplete: 'off', enterkeyhint: 'done',
      });
      const ul = el('ul', { class: 'qsearch-list', id: listId, role: 'listbox', hidden: true });
      const hint = el('p', { class: 'muted small qsearch-hint' });
      let shown = [];
      let active = -1;

      function pick(val) {
        input.value = val;
        setAnswer(it, val);
        close();
        paint();
      }
      function close() { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
      function paint() {
        const cur = S.answers[it.id] || '';
        box.classList.toggle('picked', !!cur && known.includes(cur));
        hint.textContent = cur && !known.includes(cur) && !it.other ? 'Choisissez une valeur dans les suggestions.' : '';
      }
      function suggest() {
        const q = fold(input.value);
        if (!q) { close(); return; }
        const starts = [], inside = [];
        keys.forEach((k, i) => {
          if (k.startsWith(q)) starts.push(i);
          else if (k.includes(q)) inside.push(i);
        });
        shown = starts.concat(inside).slice(0, 8);
        const items = shown.map((i, n) => el('li', {
          role: 'option', id: listId + '-' + n, 'aria-selected': 'false', text: known[i],
          onpointerdown: e => { e.preventDefault(); pick(known[i]); },
        }));
        if (!shown.length) {
          items.push(it.other && input.value.trim()
            ? el('li', { role: 'option', class: 'qsearch-other', text: `Utiliser « ${input.value.trim()} »`, onpointerdown: e => { e.preventDefault(); pick(input.value.trim()); } })
            : el('li', { class: 'qsearch-none', text: 'Aucun résultat' }));
        }
        ul.replaceChildren(...items);
        ul.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
      }
      function move(d) {
        const opts = ul.querySelectorAll('[role="option"]');
        if (!opts.length) return;
        active = (active + d + opts.length) % opts.length;
        opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
        input.setAttribute('aria-activedescendant', opts[active].id || '');
      }

      input.addEventListener('input', () => {
        const exact = known.find(k => fold(k) === fold(input.value));
        setAnswer(it, exact || (it.other ? input.value.trim() : ''));
        if (!exact && !it.other && input.value.trim()) S.answers[it.id] = '';
        suggest();
        paint();
      });
      input.addEventListener('focus', () => { if (input.value && !known.includes(input.value)) suggest(); });
      input.addEventListener('blur', () => setTimeout(close, 120));
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (ul.hidden) suggest(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Escape') close();
        else if (e.key === 'Enter') {
          e.preventDefault();
          const opts = ul.querySelectorAll('[role="option"]');
          const o = opts[active >= 0 ? active : 0];
          if (o && !ul.hidden) o.dispatchEvent(new Event('pointerdown'));
          else input.blur();
        }
      });
      box.append(input, ul, hint);
      paint();
      return box;
    }

    // Bilan victime (intervention) : code couleur de la case sélectionnée.
    // NB = blanc, BV = vert, BR = rouge, DCD = noir. Ne s'applique qu'aux questions dont le titre
    // mentionne « bilan » ou « victime », et seulement aux 4 libellés attendus.
    function bilanCode(it, val) {
      if (!/bilan|victime/i.test(it.title || '')) return '';
      const s = String(val || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
      if (/^nb$|non bless/.test(s)) return 'nb';
      if (/^bv$|bilan vert|^vert$/.test(s)) return 'bv';
      if (/^br$|bilan rouge|^rouge$/.test(s)) return 'br';
      if (/^dcd$|deced/.test(s)) return 'dcd';
      return '';
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
        const bilan = !multi ? bilanCode(it, c.v) : '';
        box.append(el('label', { class: 'choice' + (bilan ? ' bilan-' + bilan : '') }, input, el('span', { text: c.v })));
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


    // ---------- coordonnées GPS (intervention) ----------
    // La question réponse courte « Coordonnées GPS » du formulaire est remplie depuis la carte
    // (ou la position du téléphone), au format « latitude, longitude » en degrés décimaux.
    const GPS_RE = /gps|coordonn/i;
    const isGpsItem = it => it.type === 'text' && (it.gps === true || GPS_RE.test(it.title));
    const VAUCLUSE = [44.0, 5.15];

    // « 44.123456, 5.123456 » -> [lat, lng] ; accepte la virgule décimale et le point-virgule
    function parseLatLng(v) {
      const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
      if (!m) return null;
      const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
      return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
    }
    const fmtLatLng = (lat, lng) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    function gpsWidget(value, onChange) {
      const box = el('div', { class: 'gps' });
      const input = el('input', {
        type: 'text', inputmode: 'decimal', placeholder: 'ex. 44.174130, 5.278690', value: value || '',
        'aria-label': 'Coordonnées GPS (latitude, longitude)', autocomplete: 'off',
      });
      const note = el('p', { class: 'muted small gps-note', role: 'status' });
      const links = el('p', { class: 'small gps-links' });
      const mapBox = el('div', { class: 'gps-map', hidden: !S.mapOpen });
      const btnMap = el('button', { type: 'button', class: 'pill', 'aria-expanded': String(!!S.mapOpen), text: S.mapOpen ? 'Masquer la carte' : 'Pointer sur la carte' });
      const btnLoc = el('button', { type: 'button', class: 'pill', text: 'Ma position' });
      const btnClr = el('button', { type: 'button', class: 'link', text: 'Effacer' });
      let map = null, marker = null;

      function paintLinks(ll) {
        links.replaceChildren();
        btnClr.hidden = !ll;
        if (!ll) return;
        const q = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
        links.append(
          el('a', { href: `https://www.google.com/maps/search/?api=1&query=${q}`, target: '_blank', rel: 'noopener', text: 'Google Maps' }), ' · ',
          el('a', { href: `https://www.geoportail.gouv.fr/carte?c=${ll[1].toFixed(6)},${ll[0].toFixed(6)}&z=16&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`, target: '_blank', rel: 'noopener', text: 'Géoportail' }));
      }
      function set(ll, from) {
        const txt = ll ? fmtLatLng(ll[0], ll[1]) : '';
        if (from !== 'input') input.value = txt;
        onChange(from === 'input' ? input.value.trim() : txt);
        paintLinks(ll);
        if (map && ll) {
          if (!marker) marker = makeMarker(ll); else marker.setLatLng(ll);
          if (from !== 'map') map.setView(ll, Math.max(map.getZoom(), 15));
        }
        if (map && !ll && marker) { marker.remove(); marker = null; }
      }
      function makeMarker(ll) {
        const L = window.L;
        const m = L.marker(ll, { draggable: !box.closest('.fmpa-ro') }).addTo(map);
        m.on('dragend', () => { const p = m.getLatLng(); set([p.lat, p.lng], 'map'); });
        return m;
      }

      async function openMap() {
        mapBox.hidden = false;
        S.mapOpen = true;
        btnMap.textContent = 'Masquer la carte';
        btnMap.setAttribute('aria-expanded', 'true');
        if (map) { map.invalidateSize(); return; }
        note.textContent = 'Chargement de la carte…';
        try { await loadLeaflet(); }
        catch (e) {
          note.textContent = navigator.onLine ? 'La carte n’a pas pu être chargée. Utilisez « Ma position » ou saisissez les coordonnées.'
            : 'Hors ligne : la carte n’est pas disponible. Utilisez « Ma position » ou saisissez les coordonnées.';
          return;
        }
        note.textContent = 'Touchez la carte pour placer le point, faites glisser le repère pour l’ajuster.';
        const L = window.L;
        const ll = parseLatLng(input.value);
        map = L.map(mapBox, { center: ll || VAUCLUSE, zoom: ll ? 15 : 9, zoomControl: true });
        const wmts = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${fmt}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
        const ign = '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';
        const layers = {
          'Plan IGN': L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 19, attribution: ign }),
          'Photo aérienne': L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 19, attribution: ign }),
          'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }),
        };
        layers['Plan IGN'].addTo(map);
        L.control.layers(layers, null, { collapsed: true }).addTo(map);
        L.control.scale({ imperial: false }).addTo(map);
        if (ll) marker = makeMarker(ll);
        map.on('click', e => { if (!box.closest('.fmpa-ro')) set([e.latlng.lat, e.latlng.lng], 'map'); });
        setTimeout(() => map.invalidateSize(), 50);
      }
      function closeMap() {
        mapBox.hidden = true;
        S.mapOpen = false;
        btnMap.textContent = 'Pointer sur la carte';
        btnMap.setAttribute('aria-expanded', 'false');
      }

      btnMap.addEventListener('click', () => (mapBox.hidden ? openMap() : closeMap()));
      btnLoc.addEventListener('click', () => {
        if (!navigator.geolocation) { note.textContent = 'La géolocalisation n’est pas disponible sur cet appareil.'; return; }
        btnLoc.disabled = true;
        note.textContent = 'Recherche de votre position…';
        navigator.geolocation.getCurrentPosition(pos => {
          btnLoc.disabled = false;
          const { latitude, longitude, accuracy } = pos.coords;
          set([latitude, longitude], 'loc');
          note.textContent = `Position relevée (précision ± ${Math.round(accuracy)} m). Vérifiez-la sur la carte si besoin.`;
        }, err => {
          btnLoc.disabled = false;
          note.textContent = err.code === 1 ? 'Accès à la position refusé : autorisez la localisation pour cette application, ou pointez sur la carte.'
            : 'Position introuvable pour l’instant. Réessayez à découvert, ou pointez sur la carte.';
        }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
      });
      btnClr.addEventListener('click', () => { set(null, 'clear'); note.textContent = ''; });
      input.addEventListener('input', () => {
        const ll = parseLatLng(input.value);
        set(ll, 'input');
        note.textContent = input.value.trim() && !ll ? 'Format attendu : latitude, longitude en degrés décimaux (ex. 44.174130, 5.278690).' : '';
      });
      input.addEventListener('blur', () => { const ll = parseLatLng(input.value); if (ll) set(ll, 'clear-input'); });

      box.append(el('div', { class: 'gps-row' }, input), el('div', { class: 'gps-actions' }, btnMap, btnLoc, btnClr), note, mapBox, links);
      paintLinks(parseLatLng(value));
      if (S.mapOpen) setTimeout(openMap, 0);
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
    // Nom d'une personne inactive : « NOM », « NOM Prénom » ou « Prénom NOM »
    function isInactiveName(v) {
      const k = norm(v).replace(/\s+/g, ' ');
      if (!k) return false;
      const p = S.personnes[k];
      if (p) return p.actif === false;
      return Object.keys(S.personnes).some(nom => {
        const q = S.personnes[nom];
        if (!q || q.actif !== false || !q.prenom) return false;
        const pr = norm(q.prenom);
        return k === nom + ' ' + pr || k === pr + ' ' + nom;
      });
    }

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

      // Personnel inactif retiré de la liste, sauf s'il est déjà coché (FMPA enregistrée)
      const initial = gridValue(it);
      const shown = rows.filter(r => r.actif || initial[r.i]);
      const list = el('ul', { class: 'grid-list' }, ...shown.map(mkRow));
      wrap.append(list);
      const inactList = null;
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
      const box = byId('count');
      box.hidden = !hasPresence;
      byId('count-n').textContent = String(total);
      byId('count-label').textContent = total > 1 ? 'personnes cochées' : 'personne cochée';
      byId('count-detail').textContent = Object.keys(per).map(c => `${per[c]} ${shortLabel(c).toLowerCase() === 'repos' ? 'repos' : shortLabel(c)}`).join(' · ');
      // compteur repris dans l'en-tête de chaque grille
      S.grids.forEach(g => {
        const n = gridValue(g.it).filter(v => [].concat(v || []).length).length;
        const q = document.querySelector(`${FORM_SEL} .fmpa-q[data-q="${g.it.id}"] .fmpa-label`);
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

    function flush() {
      if (S.flushing) return S.flushP;
      S.flushP = flushRun();
      return S.flushP;
    }
    async function flushRun() {
      if (!navigator.onLine || !app() || !app().token()) return;
      if (!S.moi.nom) { const c = store.getJSON(KEY_FORM); if (c && c.moi) S.moi = c.moi; }
      const todo = outbox().filter(e => e.status === 'pending' && mine(e));
      if (!todo.length) return;
      S.flushing = true;
      S.flushNote = '';
      renderPending();
      if (S.done && !byId('done').hidden) showDone();
      let sent = 0;
      try {
        for (const e of todo) {
          try {
            await app().api(C.api.submit, { token: app().token(), answers: e.answers, submission_id: e.sid });
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
        if (C.onSent) C.onSent();
      }
      renderPending();
      if (S.done && !byId('done').hidden) showDone();
    }

    // Bandeau « en attente d'envoi » (page de déclaration et Mes FMPA) et pastille du menu
    function renderPending() {
      const list = pendingList();
      const dot = document.querySelector(C.navDot);
      if (dot) dot.hidden = !list.length;
      pendingBy[C.p] = list.length;
      paintBurgerDot();
      document.querySelectorAll(`[data-${C.p}-pending]`).forEach(box => box.replaceChildren(...pendingNodes(list)));
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
          el('span', { text: [e.recap || C.txt.short, e.total ? `${e.total} pers.` : ''].filter(Boolean).join(' · ') }),
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
      app().goto(C.page);
    }

    window.addEventListener('online', () => { renderPending(); flush(); });
    window.addEventListener('offline', renderPending);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
    setInterval(() => { if (navigator.onLine && outbox().some(e => e.status === 'pending')) flush(); }, 60e3);

    // ---------- validation et envoi ----------
    function clearInvalid(id) {
      const q = document.querySelector(`${FORM_SEL} .fmpa-q[data-q="${id}"]`);
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
        if (!msg && C.gps && isGpsItem(it) && !isEmpty(v) && !parseLatLng(v)) msg = 'Coordonnées attendues : latitude, longitude (ex. 44.174130, 5.278690).';
        if (!msg && it.type === 'duration' && !isEmpty(v) && !/^\d{1,2}:\d{2}$/.test(String(v).trim())) msg = 'Format attendu : hh:mm';
        if (msg) errors.push([it, msg]);
      });
      // Le chef d'unité responsable doit figurer parmi les personnes cochées
      const cuIt = visibleItems.find(it => (it.type === 'list' || it.type === 'radio') && /imp ?3|responsable|chef/i.test(it.title) && !isEmpty(S.answers[it.id]));
      const pres = visibleItems.filter(it => (it.type === 'grid' || it.type === 'checkgrid') && isPresence(it));
      if (cuIt && pres.length) {
        const cu = norm(S.answers[cuIt.id]).replace(/\s+/g, ' ');
        const same = row => {
          const r = norm(row).replace(/\s+/g, ' ');
          return r === cu || r.startsWith(cu + ' ') || r.endsWith(' ' + cu) || cu.startsWith(r + ' ') || cu.endsWith(' ' + r);
        };
        const coche = pres.some(it => gridValue(it).some((v, i) => [].concat(v || []).length && same(it.rows[i])));
        if (!coche) {
          const m = `Le chef d'unité responsable (${S.answers[cuIt.id]}) doit faire partie des personnes cochées.`;
          errors.push([cuIt, m]);
          pres.forEach(it => errors.push([it, m]));
        }
      }
      document.querySelectorAll(FORM_SEL + ' .fmpa-q.invalid').forEach(q => { q.classList.remove('invalid'); $('.fmpa-err', q).textContent = ''; });
      errors.forEach(([it, msg]) => {
        const q = document.querySelector(`${FORM_SEL} .fmpa-q[data-q="${it.id}"]`);
        if (q) { q.classList.add('invalid'); $('.fmpa-err', q).textContent = msg; }
      });
      updateNav();
      return errors;
    }

    async function submit() {
      if (S.sending || S.asking || !S.def || S.mode === 'view') return;
      const editing = S.mode === 'edit';
      const msg = byId('msg');
      msg.textContent = '';
      msg.className = 'fmpa-msg';
      const visible = path();
      const visibleItems = visible.flatMap(i => S.def.sections[i].items);
      const errors = validate(visibleItems);
      if (errors.length) {
        const cuErr = errors.find(([, m]) => /chef d'unité responsable/.test(m));
        msg.textContent = cuErr ? cuErr[1] + ' Cochez-le avant d’envoyer.' : errors.length > 1 ? `${errors.length} réponses à compléter.` : 'Une réponse est à compléter.';
        msg.classList.add('error');
        const first = document.querySelector(FORM_SEL + ' .fmpa-q.invalid');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const offline = !navigator.onLine;
      if (offline && editing) {
        msg.textContent = app().netLabel() + ' : enregistrement impossible. Gardez cette page ouverte et réessayez dès que le réseau revient.';
        msg.classList.add('error');
        return;
      }

      const answers = {};
      visibleItems.forEach(it => {
        if (it.type === 'header') return;
        const v = it.type === 'grid' || it.type === 'checkgrid' ? gridValue(it) : S.answers[it.id];
        const ll = C.gps && isGpsItem(it) ? parseLatLng(v) : null;
      if (ll) answers[it.id] = fmtLatLng(ll[0], ll[1]);
      else if (!isEmpty(v)) answers[it.id] = typeof v === 'string' ? v.trim() : v;
        else if (editing) answers[it.id] = null;          // réponse effacée : la cellule sera vidée
      });

      const { total, per } = counts();
      const recap = summary(answers);
      const lines = [];
      if (recap) lines.push(recap);
      const gpsIt = C.gps ? items().find(isGpsItem) : null;
      if (gpsIt && answers[gpsIt.id]) lines.push('GPS : ' + answers[gpsIt.id]);
      if (S.grids.some(g => g.presence)) {
        lines.push(`${total} personne${total > 1 ? 's' : ''} cochée${total > 1 ? 's' : ''}` +
          (Object.keys(per).length ? ' (' + Object.keys(per).map(c => `${per[c]} ${c.toLowerCase()}`).join(', ') + ')' : ''));
      }
      // Fenêtre de validation : indice de risque (FMPA), récapitulatif, puis envoi
      const risk = C.risk ? riskOf(visibleItems) : null;
      const nodes = [];
      if (C.risk) nodes.push(riskNode(risk));
      if (lines.length) nodes.push(el('ul', { class: 'mdl-recap' }, ...lines.map(t => el('li', { text: t }))));
      if (offline) nodes.push(el('p', { class: 'mdl-offline', text: 'Pas de réseau : la déclaration sera gardée sur cet appareil et envoyée automatiquement dès le retour du réseau.' }));
      const red = risk && risk.level === 4;
      S.asking = true;
      const ok = await askConfirm({
        title: editing ? C.rec.confirm : C.txt.confirm,
        nodes,
        ok: editing ? 'Enregistrer' : red ? 'Envoyer malgré tout' : 'Envoyer',
        okDanger: red,
      }).finally(() => { S.asking = false; });
      if (!ok) return;

      // Déclaration : passe toujours par la file d'attente de l'appareil, puis envoi immédiat si possible
      if (!editing) {
        const entry = { sid: S.sid, answers, recap, total, owner: S.moi.nom || '', ts: Date.now(), status: 'pending', error: '' };
        queue(entry);
        if (C.returnHome) return sendAndReturn(entry, offline);
        if (!offline) {
          const hide = savingOverlay('Enregistrement de la ' + C.txt.short + '…');
          try { await flush(); } finally { await hide(); }
        }
        finishDeclaration(entry);
        return;
      }

      S.sending = true;
      const btn = byId('send');
      btn.disabled = true;
      btn.textContent = editing ? 'Enregistrement…' : 'Envoi en cours…';
      if (editing) {
        const hide = savingOverlay('Enregistrement des modifications…');
        try {
          const res = await app().api(C.api.update, { token: app().token(), id: S.rec.id, answers, version: S.rec.version });
          const f = Object.assign({}, res[C.rec.key], { answers: S.answers });
          const origin = S.rec.origin;
          S.rec = { id: f.id, origin };
          setRecord(f);
          if (C.onSent) C.onSent();
          msg.textContent = res.changed ? `Modifications enregistrées (${res.changed} champ${res.changed > 1 ? 's' : ''}).` : 'Aucune modification à enregistrer.';
          msg.classList.add('ok');
        } catch (err) {
          if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
          msg.textContent = err instanceof app().NetworkError ? 'Réseau indisponible : réessayez dans un instant.' : err.message;
          msg.classList.add('error');
        } finally {
          await hide();
          S.sending = false;
          btn.disabled = false;
          btn.textContent = S.mode === 'edit' ? 'Enregistrer' : 'Envoyer';
        }
        return;
      }
    }

    // Voile d'enregistrement : animation plein écran pendant l'envoi au serveur
    function savingOverlay(text) {
      const box = el('div', { class: 'saving', role: 'status', 'aria-live': 'polite' },
        el('div', { class: 'saving-card' },
          el('div', { class: 'saving-spin', 'aria-hidden': 'true' }),
          el('p', { class: 'saving-txt', text }),
          el('div', { class: 'saving-track', 'aria-hidden': 'true' }, el('div', { class: 'saving-fill' }))));
      document.body.append(box);
      const shownAt = Date.now();
      // reste affiché au moins 0,6 s pour ne pas clignoter
      return () => new Promise(r => setTimeout(() => { box.remove(); r(); }, Math.max(0, 600 - (Date.now() - shownAt))));
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

    // Envoi puis retour à l'accueil avec un message (intervention) : envoyée, ou gardée sur l'appareil
    async function sendAndReturn(entry, offline) {
      store.del(KEY_DRAFT);
      S.answers = {};
      S.sid = newSid();
      S.draftAt = null;
      S.mapOpen = false;
      const btn = byId('send');
      if (!offline) {
        S.sending = true;
        btn.disabled = true;
        btn.textContent = 'Envoi en cours…';
        const hide = savingOverlay(C.txt.saving || ('Enregistrement de l’' + C.txt.short.toLowerCase() + '…'));
        try { await flush(); } finally {
          await hide();
          S.sending = false;
          btn.disabled = false;
          btn.textContent = 'Envoyer';
        }
      }
      const left = outbox().find(e => e.sid === entry.sid);
      const status = !left ? 'sent' : left.status === 'error' ? 'error' : 'queued';
      // Envoi immédiat : le message de retour suffit, pas de « déclaration en attente envoyée »
      if (status === 'sent' && S.lastSent && S.lastSent.n === 1) { S.lastSent = null; renderPending(); }
      defaults();
      render();
      C.returnHome(status, left);
    }

    function finishDeclaration(entry) {
      S.done = { recap: entry.recap, total: entry.total, sid: entry.sid };
      S.mapOpen = false;
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
      byId('done').dataset.state = err ? 'error' : waiting ? 'queued' : 'sent';
      byId('done-icon').textContent = err ? '!' : waiting ? '⏳' : '✓';
      byId('done-title').textContent = err ? 'Déclaration non envoyée' : waiting ? (S.flushing ? 'Envoi en cours…' : 'Déclaration enregistrée sur l’appareil') : 'Déclaration envoyée';
      byId('done-note').textContent = err ? err.error.replace(/[.!]?\s*$/, '.') + ' Vous pouvez la reprendre ou la renvoyer depuis le bandeau ci-dessus.'
        : waiting ? 'Pas de réseau pour l’instant : elle sera envoyée automatiquement dès son retour, même si vous fermez cette page. Rouvrez simplement l’application.'
        : C.txt.sentNote;
      byId('done-recap').textContent = [d.recap, S.grids.some(g => g.presence) ? `${d.total} personne${d.total > 1 ? 's' : ''} ${waiting || err ? 'cochée' : 'déclarée'}${d.total > 1 ? 's' : ''}` : '']
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
      Object.assign(S, { def: null, sig: '', personnes: {}, moi: {}, answers: {}, sid: '', loaded: false, done: null, mapOpen: false, grids: [], mode: 'declare', rec: null, decl: null, lastSent: null, flushNote: '' });
      renderPending();
    }

    byId('send').addEventListener('click', submit);
    byId('again').addEventListener('click', restart);

    // Préchargement discret (ouverture de l'application en ligne) : le formulaire est alors gardé
    // sur l'appareil et la saisie reste possible plus tard sans réseau, même sans avoir ouvert la page.
    function prefetch() {
      if (S.loading || !navigator.onLine || !app() || !app().token()) return;
      if (!S.def) { const c = store.getJSON(KEY_FORM); if (c && c.form) applyDef(c); }
      if (S.loaded && S.loadedAt && Date.now() - S.loadedAt < 10 * 60e3) return;
      load();
    }

    renderPending();
    return { open, openRecord, reset, flush, prefetch, pending: () => pendingList().length, renderPending };
  }

  // Leaflet (carte) : chargé à la première ouverture de la carte seulement, depuis le dépôt
  let leafletP = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    const base = './vendor/leaflet/';   // Leaflet 1.9.4 embarqué (fonctionne hors ligne)
    leafletP = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = base + 'leaflet.css';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = base + 'leaflet.js';
      js.onload = () => (window.L ? resolve() : reject(new Error('Leaflet')));
      js.onerror = () => { leafletP = null; js.remove(); reject(new Error('Leaflet')); };
      document.head.append(js);
    });
    return leafletP;
  }

  window.SMPM_FMPA = createDeclarer({
    p: 'fmpa', page: 'fmpa', navDot: '#nav-fmpa .pending-dot', risk: true, imp3List: true,
    keys: { form: 'smpm_fmpa_form', draft: 'smpm_fmpa_draft', outbox: 'smpm_fmpa_outbox' },
    api: { form: 'fmpa_form', submit: 'fmpa_submit', get: 'fmpa_get', update: 'fmpa_update' },
    rec: {
      key: 'fmpa', loading: 'Chargement de la FMPA…', confirm: 'Enregistrer les modifications de cette FMPA ?',
      offline: 'Réseau indisponible : impossible d’ouvrir cette FMPA hors ligne.',
      notActive: 'La consultation des FMPA n’est pas encore activée sur le serveur.',
      back: origin => (window.SMPM_FMPA_LIST ? window.SMPM_FMPA_LIST.label(origin) : 'Retour'),
      title: (m, fd) => (m.date ? `FMPA du ${fd(m.date)}` : 'FMPA'),
      bits: (m, fdt) => [m.numero ? `N° ${m.numero}` : '', m.cu ? `CU ${m.cu}` : '', m.horodateur ? `déclarée le ${fdt(m.horodateur)}` : ''],
    },
    txt: {
      title: 'Nouvelle FMPA', short: 'FMPA', confirm: 'Envoyer la déclaration de FMPA ?',
      saving: 'Enregistrement de la FMPA…',
      notActive: 'La déclaration de FMPA n’est pas encore activée sur le serveur.',
      sentNote: 'Elle est enregistrée dans le sheet FMPA, comme une saisie du formulaire.',
    },
    // Après l'envoi : retour automatique sur « Mes FMPA », avec un message selon le résultat
    returnHome: (status, entry) => {
      const a = window.SMPM_APP;
      if (status === 'sent') {
        a.flash({ kind: 'ok', text: 'FMPA envoyée. Vous pouvez la modifier pendant 24 h depuis cette liste.' });
      } else if (status === 'queued') {
        a.flash({ kind: 'info', text: 'FMPA enregistrée sur l’appareil : elle sera envoyée automatiquement dès le retour du réseau.' });
      } else {
        a.flash({ kind: 'error', text: `FMPA non envoyée : ${String((entry && entry.error) || 'refusée par le serveur').replace(/[.!]?\s*$/, '.')} Vous pouvez la reprendre ou la renvoyer depuis le bandeau ci-dessous.` });
      }
      a.goto('fmpa-mes');
    },
    onSent: () => { if (window.SMPM_FMPA_LIST) window.SMPM_FMPA_LIST.invalidate(); },
  });

  window.SMPM_ITV = createDeclarer({
    p: 'itv', page: 'interv-new', navDot: '#nav-interv .pending-dot', gps: true,
    imp3List: true, imp3Re: /chef d.?unit|imp\s*3/i,   // liste « Chef d'unité » = IMP3 actifs du personnel
    keys: { form: 'smpm_itv_form', draft: 'smpm_itv_draft', outbox: 'smpm_itv_outbox' },
    api: { form: 'itv_form', submit: 'itv_submit', get: 'itv_get', update: 'itv_update' },
    rec: {
      key: 'intervention', loading: 'Chargement de l’intervention…', confirm: 'Enregistrer les modifications de cette intervention ?',
      offline: 'Réseau indisponible : impossible d’ouvrir cette intervention hors ligne.',
      notActive: 'La consultation des interventions n’est pas encore activée sur le serveur.',
      back: origin => (window.SMPM_ITV_LIST ? window.SMPM_ITV_LIST.label(origin) : 'Mes interventions'),
      title: (m, fd) => (m.date ? `Intervention du ${fd(m.date)}` : 'Intervention'),
      bits: (m, fdt) => [m.commune, m.debut ? `début ${m.debut}` : '', m.horodateur ? `envoyée le ${fdt(m.horodateur)}` : ''],
      droits: (d, m, fdt) => (d.modifier
        ? (d.par === 'cu' && d.jusqua ? `Modifiable jusqu’au ${fdt(d.jusqua)} (24 h après l’envoi).` : 'Modifiable.')
        : d.motif === 'delai' ? 'Lecture seule : le délai de modification de 24 h est dépassé.' : 'Lecture seule.'),
    },
    returnHome: (status, entry) => {
      const a = window.SMPM_APP;
      if (status === 'sent') {
        a.flash({ kind: 'ok', text: 'Intervention envoyée. Vous pouvez la modifier pendant 24 h depuis', link: { label: 'Mes interventions', page: 'interv-mes' } });
      } else if (status === 'queued') {
        a.flash({ kind: 'info', text: 'Données enregistrées, elles seront envoyées lorsque le réseau sera disponible.' });
      } else {
        a.flash({ kind: 'error', text: `Intervention non envoyée : ${String((entry && entry.error) || 'refusée par le serveur').replace(/[.!]?\s*$/, '.')} Vous pouvez la reprendre depuis`, link: { label: 'Mes interventions', page: 'interv-mes' } });
      }
      a.goto(a.home());
    },
    onSent: () => { if (window.SMPM_ITV_LIST) window.SMPM_ITV_LIST.invalidate(); },
    txt: {
      title: 'Nouvelle intervention', short: 'Intervention', confirm: 'Envoyer le compte rendu d’intervention ?',
      notActive: 'La saisie des interventions n’est pas encore activée sur le serveur.',
      sentNote: 'Elle est enregistrée dans le sheet « Interventions SMPM », comme une saisie du formulaire.',
    },
  });
})();
