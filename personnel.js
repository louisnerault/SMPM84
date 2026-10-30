// Gestion du personnel (menu « Chefs de section › Mes spécialistes », actions personnel_list / personnel_update :
// backend/Personnel.gs). Droits (contrôlés par le serveur, à garder cohérents) :
//   - chef de section : le personnel actif de sa ou ses sections (NORD, SUD, CENTRE : secteur SMPM ;
//     NEIGE, ISS, SSSM : qualification correspondante) — grade, centre, e-mail, téléphone, qualifications ;
//   - conseiller technique et administrateurs : tout le personnel, actif ou non, plus le secteur et la case actif,
//     et la création d'un spécialiste (action personnel_create : fiche, dossier et livret individuel).
// Les données ne sont gardées qu'en mémoire (pas sur l'appareil) : la rubrique demande le réseau.
(() => {
  'use strict';

  const QUALIFS = ['IMP 1', 'IMP 2', 'IMP 3', 'NEIGE', 'ISS', 'SSH', 'CAN', 'SSSM'];
  const SECTEURS = { NORD: 'Nord', CENTRE: 'Centre', SUD: 'Sud' };
  const SECTIONS = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSSM: 'SSSM' };

  const $ = sel => document.querySelector(sel);
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const S = { data: null, loading: false, edit: null, busy: false };

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
  function pretty(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('33')) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('0')) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
    return String(tel || '');
  }
  function setState(t, err) { const p = $('#pers-state'); p.textContent = t || ''; p.classList.toggle('error', !!err); }
  const tout = () => !!(S.data && S.data.droits && S.data.droits.tout);
  const peut = champ => !!(S.data && S.data.droits && (S.data.droits.champs || []).includes(champ));

  function open() {
    if (S.data) render();
    if (!S.loading) load();
  }

  async function load() {
    S.loading = true;
    setState(S.data ? 'Mise à jour…' : 'Chargement du personnel…');
    try {
      const res = await app().api('personnel_list', { token: app().token() });
      S.data = { personnes: res.personnes || [], droits: res.droits || {} };
      setState('');
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      setState(err instanceof app().NetworkError
        ? `${app().netLabel()} : la gestion du personnel demande le réseau.`
        : err.message, true);
    } finally { S.loading = false; }
  }

  function intro() {
    const d = S.data.droits;
    $('#pers-intro').textContent = d.tout
      ? 'Tout le personnel SMPM. Touchez « Modifier » pour corriger une fiche.'
      : `Personnel de votre section (${(d.sections || []).map(s => SECTIONS[s] || s).join(', ')}). Touchez « Modifier » pour corriger une fiche.`;
    $('#pers-inactifs-wrap').hidden = !d.tout;
    $('#pers-new').hidden = !d.creer;
    const sel = $('#pers-secteur');
    if (sel.options.length <= 1) Object.keys(SECTEURS).forEach(k => sel.append(new Option(SECTEURS[k], k)));
  }

  function filtre(list) {
    const q = fold($('#pers-search').value.trim());
    const sec = $('#pers-secteur').value;
    const inactifs = tout() && $('#pers-inactifs').checked;
    return list.filter(p => {
      if (!p.actif && !inactifs) return false;
      if (sec && p.secteur !== sec) return false;
      if (!q) return true;
      return fold([p.nom, p.prenom, p.grade, p.affectation, p.secteur, p.email].join(' ')).includes(q);
    });
  }

  function render() {
    if (!S.data) return;
    intro();
    const list = filtre(S.data.personnes);
    $('#pers-count').textContent = list.length + (list.length > 1 ? ' personnes' : ' personne');
    const empty = $('#pers-empty');
    empty.hidden = list.length > 0;
    empty.textContent = S.data.personnes.length ? 'Aucune personne ne correspond à la recherche.' : 'Aucune personne dans votre périmètre.';
    $('#pers-list').replaceChildren(...list.map(card));
  }

  function card(p) {
    const qualifs = QUALIFS.filter(q => p.qualifs[q] && p.qualifs[q].acquis)
      .map(q => el('li', { text: q.replace(' ', '') + (p.qualifs[q].annee ? ' ' + p.qualifs[q].annee : '') }));
    return el('li', { class: 'ann-card' + (p.actif ? '' : ' pers-inactif') },
      el('div', { class: 'ann-head' },
        el('h3', { class: 'ann-name' }, `${p.nom} ${p.prenom}`, el('span', { class: 'ann-grade', text: p.grade })),
        p.actif ? null : el('span', { class: 'chip chip-ro', text: 'Inactif' })),
      el('p', { class: 'ann-meta', text: [SECTEURS[p.secteur] || p.secteur, p.affectation].filter(Boolean).join(' · ') }),
      qualifs.length ? el('ul', { class: 'chips ann-chips' }, qualifs) : el('p', { class: 'ann-meta', text: 'Aucune qualification' }),
      el('p', { class: 'ann-meta', text: [p.telephone ? pretty(p.telephone) : 'Pas de téléphone', p.email || 'Pas d’e-mail'].join(' · ') }),
      el('div', { class: 'pers-actions' },
        el('button', { type: 'button', class: 'link', text: 'Modifier', onclick: () => edit(p) })));
  }

  // ---------- fiche de modification ----------
  function edit(p) {
    S.edit = p;
    const f = $('#pers-form');
    $('#pers-dialog-title').textContent = `${p.prenom} ${p.nom}`;
    const choices = app().gradeChoices(p.grade);
    f.elements.grade.replaceChildren(...choices.map(c => new Option(c.label, c.code)));
    f.elements.grade.value = p.grade;
    $('#pers-affectations').replaceChildren(...app().affectations().map(a => new Option(a, a)));
    f.elements.affectation.value = p.affectation;
    f.elements.email.value = p.email;
    f.elements.telephone.value = p.telephone;
    f.elements.telephone.disabled = !p.tel_modifiable;
    $('#pers-tel-note').hidden = p.tel_modifiable;
    $('#pers-secteur-field').hidden = !peut('secteur');
    f.elements.secteur.value = p.secteur;
    $('#pers-actif-field').hidden = !peut('actif');
    f.elements.actif.checked = p.actif;

    const an = new Date().getFullYear();
    $('#pers-qualifs').replaceChildren(...QUALIFS.filter(q => p.qualifs[q]).map(q => {
      const v = p.qualifs[q];
      const box = el('input', { type: 'checkbox', 'data-q': q });
      box.checked = v.acquis;
      const year = v.annee === null ? null
        : el('input', { type: 'number', inputmode: 'numeric', min: 1970, max: an, step: 1, placeholder: 'Année', 'data-an': q, 'aria-label': 'Année d’obtention ' + q, value: v.annee || '' });
      if (year) { year.disabled = !v.acquis; box.addEventListener('change', () => { year.disabled = !box.checked; }); }
      return el('div', { class: 'pers-q' }, el('label', { class: 'ann-check' }, box, ' ' + q.replace(' ', '')), year);
    }));
    $('#pers-error').textContent = '';
    $('#pers-save').disabled = false;
    $('#pers-dialog').showModal();
  }

  function collect() {
    const p = S.edit, f = $('#pers-form');
    const changes = {}, avant = {};
    ['grade', 'affectation', 'email', 'telephone'].forEach(k => {
      if (k === 'telephone' && !p.tel_modifiable) return;
      const v = f.elements[k].value.trim();
      const cur = k === 'telephone' ? String(p[k] || '').replace(/\D/g, '') : String(p[k] || '');
      const cmp = k === 'telephone' ? v.replace(/\D/g, '') : (k === 'email' ? v.toLowerCase() : v);
      if (cmp !== (k === 'email' ? cur.toLowerCase() : cur)) { changes[k] = v; avant[k] = p[k]; }
    });
    if (peut('secteur') && f.elements.secteur.value !== p.secteur) { changes.secteur = f.elements.secteur.value; avant.secteur = p.secteur; }
    if (peut('actif') && f.elements.actif.checked !== p.actif) { changes.actif = f.elements.actif.checked; avant.actif = p.actif; }
    const q = {}, qa = {};
    document.querySelectorAll('#pers-qualifs [data-q]').forEach(box => {
      const code = box.dataset.q, cur = p.qualifs[code];
      const yearEl = document.querySelector(`#pers-qualifs [data-an="${code}"]`);
      const acquis = box.checked;
      const annee = yearEl ? (acquis ? yearEl.value.trim() : String(cur.annee || '')) : undefined;
      const changed = acquis !== cur.acquis || (yearEl && annee !== String(cur.annee || ''));
      if (!changed) return;
      q[code] = yearEl ? { acquis, annee } : { acquis };
      qa[code] = cur;
    });
    if (Object.keys(q).length) { changes.qualifs = q; avant.qualifs = qa; }
    return { changes, avant };
  }

  async function save(e) {
    e.preventDefault();
    if (S.busy) return;
    const { changes, avant } = collect();
    if (!Object.keys(changes).length) { $('#pers-dialog').close(); return; }
    if ('actif' in changes && !changes.actif &&
        !confirm(`Passer ${S.edit.prenom} ${S.edit.nom} en inactif ? La personne ne pourra plus se connecter à l'application.`)) return;
    S.busy = true;
    $('#pers-save').disabled = true;
    $('#pers-error').textContent = '';
    try {
      const res = await app().api('personnel_update', { token: app().token(), nom: S.edit.nom, changes, avant });
      const i = S.data.personnes.findIndex(x => x.nom === S.edit.nom);
      if (i >= 0) {
        if (res.visible === false) S.data.personnes.splice(i, 1);
        else S.data.personnes[i] = res.personne;
      }
      $('#pers-dialog').close();
      render();
      setState(`Fiche de ${res.personne.prenom} ${res.personne.nom} enregistrée.`);
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      $('#pers-error').textContent = err instanceof app().NetworkError
        ? `${app().netLabel()} : modification impossible.` : err.message;
      $('#pers-save').disabled = false;
    } finally { S.busy = false; }
  }

  // ---------- création d'un spécialiste (conseiller technique, administrateurs) ----------
  function create() {
    const f = $('#pers-new-form');
    f.reset();
    f.elements.grade.replaceChildren(new Option('Choisir…', ''), ...app().gradeChoices('').map(c => new Option(c.label, c.code)));
    $('#pers-affectations').replaceChildren(...app().affectations().map(a => new Option(a, a)));
    const telOk = !!(S.data && S.data.droits && S.data.droits.tel_creation);
    $('#pers-new-tel-field').hidden = !telOk;
    f.elements.telephone.disabled = !telOk;
    const an = new Date().getFullYear();
    $('#pers-new-qualifs').replaceChildren(...QUALIFS.map(q => {
      const box = el('input', { type: 'checkbox', 'data-q': q });
      const year = q === 'SSSM' ? null
        : el('input', { type: 'number', inputmode: 'numeric', min: 1970, max: an, step: 1, placeholder: 'Année', 'data-an': q, 'aria-label': 'Année d’obtention ' + q, disabled: true });
      if (year) box.addEventListener('change', () => { year.disabled = !box.checked; if (box.checked && !year.value) year.value = an; });
      return el('div', { class: 'pers-q' }, el('label', { class: 'ann-check' }, box, ' ' + q.replace(' ', '')), year);
    }));
    $('#pers-new-error').textContent = '';
    $('#pers-new-save').disabled = false;
    $('#pers-new-save').textContent = 'Créer';
    $('#pers-new-dialog').showModal();
    f.elements.nom.focus();
  }

  async function createSave(e) {
    e.preventDefault();
    if (S.busy) return;
    const f = $('#pers-new-form');
    const v = k => f.elements[k].value.trim();
    const personne = {
      nom: v('nom').toUpperCase(), prenom: v('prenom'), grade: v('grade'), affectation: v('affectation'),
      secteur: v('secteur'), email: v('email').toLowerCase(), telephone: f.elements.telephone.disabled ? '' : v('telephone'), qualifs: {},
    };
    document.querySelectorAll('#pers-new-qualifs [data-q]').forEach(box => {
      if (!box.checked) return;
      const year = document.querySelector(`#pers-new-qualifs [data-an="${box.dataset.q}"]`);
      personne.qualifs[box.dataset.q] = year ? { acquis: true, annee: year.value.trim() } : { acquis: true };
    });
    if (!confirm(`Créer ${personne.prenom} ${personne.nom} (${SECTEURS[personne.secteur] || personne.secteur}) ? Son dossier et son livret individuel seront créés dans Drive.`)) return;
    S.busy = true;
    $('#pers-new-save').disabled = true;
    $('#pers-new-save').textContent = 'Création…';
    $('#pers-new-error').textContent = '';
    try {
      const res = await app().api('personnel_create', { token: app().token(), personne });
      if (S.data) {
        S.data.personnes.push(res.personne);
        S.data.personnes.sort((x, y) => (x.nom + ' ' + x.prenom).localeCompare(y.nom + ' ' + y.prenom, 'fr'));
      }
      $('#pers-new-dialog').close();
      $('#pers-search').value = res.personne.nom;
      render();
      setState(`${res.personne.prenom} ${res.personne.nom} a été créé, avec son dossier et son livret individuel.`);
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      $('#pers-new-error').textContent = err instanceof app().NetworkError
        ? `${app().netLabel()} : création impossible.` : err.message;
      $('#pers-new-save').disabled = false;
      $('#pers-new-save').textContent = 'Créer';
    } finally { S.busy = false; }
  }

  function reset() { S.data = null; S.edit = null; $('#pers-list').replaceChildren(); $('#pers-new').hidden = true; }

  $('#pers-search').addEventListener('input', render);
  $('#pers-secteur').addEventListener('change', render);
  $('#pers-inactifs').addEventListener('change', render);
  $('#pers-form').addEventListener('submit', save);
  $('#pers-cancel').addEventListener('click', () => $('#pers-dialog').close());
  $('#pers-new').addEventListener('click', create);
  $('#pers-new-form').addEventListener('submit', createSave);
  $('#pers-new-cancel').addEventListener('click', () => $('#pers-new-dialog').close());

  window.SMPM_PERSONNEL = { open, reset };
})();
