/**
 * SMPM 84 – Déclaration de FMPA depuis l'application
 *
 * À ajouter comme NOUVEAU fichier « Fmpa.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs et Livret.gs.
 *
 * 1. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'fmpa_form':    result = fmpaForm_(b.token); break;
 *        case 'fmpa_submit':  result = fmpaSubmit_(b.token, b.answers, b.submission_id); break;
 *        case 'fmpa_list':    result = fmpaList_(b.token, b.scope); break;
 *        case 'fmpa_get':     result = fmpaGet_(b.token, b.id); break;
 *        case 'fmpa_update':  result = fmpaUpdate_(b.token, b.id, b.answers, b.version); break;
 * 2. Exécuter une fois testFmpaForm() puis testFmpaMapping() depuis l'éditeur
 *    (autorisations FormApp et Sheets ; le journal montre ce qui est lu et rapproché).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Principe : l'application ne recopie pas les questions en dur. Elle lit la structure du
 * « Formulaire FMPA » (questions, choix, sections, grille de présence) et la déclaration est
 * soumise AU FORMULAIRE LUI-MÊME. La réponse arrive donc dans le sheet FMPA (onglet des réponses)
 * exactement comme une saisie Google Form, et les traitements existants déclenchés à l'envoi
 * du formulaire (PDF, livrets, notifications) continuent de fonctionner sans modification.
 * Une question ajoutée ou modifiée dans le formulaire apparaît automatiquement dans l'app
 * (au plus tard 10 minutes après, durée du cache).
 *
 * Accès : chef d'unité, chef de section, conseiller technique, administrateur (rôle ou is_admin).
 *
 * Consultation et modification des FMPA enregistrées (ligne du sheet FMPA) :
 *   - administrateur et conseiller technique : toutes les FMPA ;
 *   - chef de section : les FMPA de son secteur ;
 *   - chef d'unité (IMP3 responsable) : ses FMPA, modifiables pendant 24 h après la déclaration,
 *     ensuite en lecture seule (la modification passe par le N+1).
 * La modification réécrit uniquement les cellules changées de la ligne, sans renvoyer le formulaire :
 * les traitements déclenchés à l'envoi (PDF, livrets) ne sont pas relancés.
 */

const FMPA = {
  FORM_ID: '1sxlalnS_lZ4hwFxnG5aLuH8lCOd5Qu2_ggSkOCdEKi0',   // « Formulaire FMPA » (dossier FMPA/Formulaire)
  SHEET_ID: '13zgDaHG8xEfirsGFZmRfsQ4Dwjm8r27fsQKmDOn0Iq4',  // sheet « FMPA » (base des FMPA)
  SHEET_NAME: 'test_fmpa',                                    // onglet qui reçoit les réponses
  ROLES: ['chef_unite', 'chef_section', 'ctd', 'admin'],
  EDIT_HOURS: 24,           // délai de modification pour le chef d'unité qui a organisé la FMPA
  CACHE_KEY: 'fmpa_form_v1',
  CACHE_SEC: 600,           // structure du formulaire : 10 min
  DEDUP_SEC: 6 * 3600,      // un même envoi (submission_id) n'est jamais soumis deux fois
  // En-têtes du sheet FMPA (comparés sans crochets, accents ni ponctuation)
  COL: {
    NUM: "NUMERO D'ALERTE", HORO: 'HORODATEUR', DATE: 'DATE', SECTEUR: 'SECTEUR',
    LIEU: 'LIEU', CU: 'IMP3 RESPONSABLE', DUREE: 'DUREE FMPA',
  },
};

// ============================ Accès ============================

function fmpaAuth_(token) {
  const a = auth_(token);
  const role = deriveRole_(a.p.pt, a.p.row, a.acc);
  const admin = isAdminSmpm_(a.acc);
  if (!admin && FMPA.ROLES.indexOf(role) < 0) {
    throw new Error("Déclaration réservée aux chefs d'unité, chefs de section et administrateurs");
  }
  return a;
}

// ============================ Lecture du formulaire ============================

function fmpaForm_(token) {
  const a = fmpaAuth_(token);
  return Object.assign({ ok: true, form: fmpaDef_() }, contexteFmpa_(a));
}

/** Structure du formulaire, mise en cache 10 min. */
function fmpaDef_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(FMPA.CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const def = lireFormulaireFmpa_();
  try { cache.put(FMPA.CACHE_KEY, JSON.stringify(def), FMPA.CACHE_SEC); } catch (e) { /* trop gros */ }
  return def;
}

/** Personnel (pour la grille de présence) et identité de l'utilisateur. */
function contexteFmpa_(a) {
  const { pt, row } = a.p;
  return {
    personnes: personnesFmpa_(pt),
    moi: {
      nom: String(pt.cell(row, H.NOM) || '').trim().toUpperCase(),
      secteur: String(pt.cell(row, H.SECTEUR) || '').trim().toUpperCase(),
    },
  };
}

/** Nom (en majuscules) -> { prenom, secteur, actif } pour enrichir la grille de présence. */
function personnesFmpa_(pt) {
  const out = {};
  for (let i = 1; i < pt.values.length; i++) {
    const nom = String(pt.cell(i, H.NOM) || '').trim().toUpperCase();
    if (!nom) continue;
    out[nom] = {
      prenom: String(pt.cell(i, H.PRENOM) || '').trim(),
      secteur: String(pt.cell(i, H.SECTEUR) || '').trim().toUpperCase(),
      actif: isTrue_(pt.cell(i, H.ACTIF)),
    };
  }
  return out;
}

/**
 * Structure du formulaire :
 * { title, description, sections: [ { title, help, next, items: [ ... ] } ] }
 * next (fin de section) : 'next' | 'submit' | index de section.
 */
function lireFormulaireFmpa_() {
  const form = FormApp.openById(FMPA.FORM_ID);
  const T = FormApp.ItemType;
  const items = form.getItems();

  // index de section de chaque saut de page (la 1re section est implicite)
  const pageIndex = {};
  let n = 0;
  items.forEach(it => { if (it.getType() === T.PAGE_BREAK) pageIndex[it.getId()] = ++n; });

  const goto = (type, page) => {
    const P = FormApp.PageNavigationType;
    if (type === P.SUBMIT) return 'submit';
    if (type === P.RESTART) return 'restart';
    if (type === P.GO_TO_PAGE && page && pageIndex[page.getId()] !== undefined) return pageIndex[page.getId()];
    return 'next';
  };

  const sections = [{ title: '', help: '', next: 'next', items: [] }];
  items.forEach(it => {
    if (it.getType() === T.PAGE_BREAK) {
      const pb = it.asPageBreakItem();
      // La navigation d'un saut de page décrit la sortie de la section qui le PRÉCÈDE.
      let nav = 'next';
      try { nav = goto(pb.getPageNavigationType(), pb.getGoToPage()); } catch (e) {}
      sections[sections.length - 1].next = nav;
      sections.push({ title: it.getTitle(), help: it.getHelpText(), next: 'next', items: [] });
      return;
    }
    const d = itemDef_(it, goto);
    if (d) sections[sections.length - 1].items.push(d);
  });
  sections[sections.length - 1].next = 'submit';

  return { title: form.getTitle(), description: form.getDescription(), sections };
}

function choicesDef_(choices, goto) {
  return choices.map(c => {
    let go = null;
    try {
      const nav = goto(c.getPageNavigationType(), c.getGotoPage());
      if (nav !== 'next') go = nav;
    } catch (e) { /* pas de navigation sur ce choix */ }
    return { v: c.getValue(), go };
  });
}

function itemDef_(it, goto) {
  const T = FormApp.ItemType;
  const d = { id: it.getId(), title: it.getTitle(), help: it.getHelpText() };
  switch (it.getType()) {
    case T.TEXT: {
      const x = it.asTextItem();
      return Object.assign(d, { type: 'text', required: x.isRequired() });
    }
    case T.PARAGRAPH_TEXT: {
      const x = it.asParagraphTextItem();
      return Object.assign(d, { type: 'paragraph', required: x.isRequired() });
    }
    case T.MULTIPLE_CHOICE: {
      const x = it.asMultipleChoiceItem();
      return Object.assign(d, { type: 'radio', required: x.isRequired(), other: x.hasOtherOption(), choices: choicesDef_(x.getChoices(), goto) });
    }
    case T.LIST: {
      const x = it.asListItem();
      return Object.assign(d, { type: 'list', required: x.isRequired(), choices: choicesDef_(x.getChoices(), goto) });
    }
    case T.CHECKBOX: {
      const x = it.asCheckboxItem();
      return Object.assign(d, { type: 'checkbox', required: x.isRequired(), other: x.hasOtherOption(), choices: x.getChoices().map(c => ({ v: c.getValue(), go: null })) });
    }
    case T.SCALE: {
      const x = it.asScaleItem();
      return Object.assign(d, { type: 'scale', required: x.isRequired(), min: x.getLowerBound(), max: x.getUpperBound(), minLabel: x.getLeftLabel(), maxLabel: x.getRightLabel() });
    }
    case T.DATE: {
      const x = it.asDateItem();
      return Object.assign(d, { type: 'date', required: x.isRequired() });
    }
    case T.DATETIME: {
      const x = it.asDateTimeItem();
      return Object.assign(d, { type: 'datetime', required: x.isRequired() });
    }
    case T.TIME: {
      const x = it.asTimeItem();
      return Object.assign(d, { type: 'time', required: x.isRequired() });
    }
    case T.DURATION: {
      const x = it.asDurationItem();
      return Object.assign(d, { type: 'duration', required: x.isRequired() });
    }
    case T.GRID: {
      const x = it.asGridItem();
      return Object.assign(d, { type: 'grid', required: x.isRequired(), rows: x.getRows(), cols: x.getColumns() });
    }
    case T.CHECKBOX_GRID: {
      const x = it.asCheckboxGridItem();
      return Object.assign(d, { type: 'checkgrid', required: x.isRequired(), rows: x.getRows(), cols: x.getColumns() });
    }
    case T.SECTION_HEADER:
      return Object.assign(d, { type: 'header' });
    default:
      return null;   // image, vidéo : non affichées
  }
}

// ============================ Envoi ============================

/**
 * answers : { [itemId]: valeur } — texte, liste de textes (cases à cocher),
 * tableau aligné sur les lignes pour une grille (null = ligne non cochée).
 */
function fmpaSubmit_(token, answers, submissionId) {
  const a = fmpaAuth_(token);
  // Encadrer une FMPA demande la qualification IMP 3 (Roles.gs)
  if (!isAdminSmpm_(a.acc) && !encadreFmpa_(a.p.pt, a.p.row)) throw new Error("Déclaration de FMPA réservée aux chefs d'unité (IMP3)");
  if (!answers || typeof answers !== 'object') throw new Error('Déclaration vide');

  const cache = CacheService.getScriptCache();
  const sid = submissionId ? String(submissionId).replace(/[^\w-]/g, '').slice(0, 60) : '';
  const key = sid ? 'fmpa_sid_' + sid : '';
  if (key) {
    const done = cache.get(key);
    if (done) return JSON.parse(done);    // renvoi après coupure réseau : déjà soumis
    // Déclaration faite hors ligne et renvoyée tard (au-delà du cache) : on cherche son identifiant dans le Journal
    const deja = sidDansJournal_(sid);
    if (deja) return { ok: true, response_id: deja, deja: true, at: new Date().toISOString() };
  }

  const form = FormApp.openById(FMPA.FORM_ID);
  if (!form.isAcceptingResponses()) throw new Error("Le formulaire FMPA n'accepte plus de réponses");

  const resp = form.createResponse();
  let n = 0;
  Object.keys(answers).forEach(id => {
    const it = form.getItemById(Number(id));
    if (!it) throw new Error('Le formulaire a été modifié : rechargez la page de déclaration');
    let r;
    try { r = itemResponse_(it, answers[id]); }
    catch (e) { throw new Error('Réponse refusée pour « ' + it.getTitle() + ' » : ' + e.message); }
    if (r) { resp.withItemResponse(r); n++; }
  });
  if (!n) throw new Error('Déclaration vide');

  const sent = resp.submit();
  try { journalSheet_().appendRow([new Date(), a.id, 'declaration_fmpa', sid, sent.getId()]); } catch (e) {}

  const out = { ok: true, response_id: sent.getId(), at: new Date().toISOString() };
  if (key) cache.put(key, JSON.stringify(out), FMPA.DEDUP_SEC);
  return out;
}

/** Identifiant de réponse si cette déclaration (submission_id) a déjà été soumise ; parcourt les 2000 dernières lignes du Journal. */
function sidDansJournal_(sid) {
  try {
    const sh = journalSheet_();
    const n = sh.getLastRow();
    if (n < 2) return '';
    const from = Math.max(2, n - 1999);
    const rows = sh.getRange(from, 3, n - from + 1, 3).getValues();     // colonnes champ, ancienne valeur, nouvelle valeur
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === 'declaration_fmpa' && String(rows[i][1]) === sid) return String(rows[i][2] || 'ok');
    }
  } catch (e) { /* Journal indisponible : on s'en remet au cache */ }
  return '';
}

function vide_(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return !v.some(x => !vide_(x));
  return String(v).trim() === '';
}

function itemResponse_(it, v) {
  if (vide_(v)) return null;
  const T = FormApp.ItemType;
  const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s)); if (!m) throw new Error('heure invalide'); return [Number(m[1]), Number(m[2])]; };
  const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); if (!m) throw new Error('date invalide'); return [Number(m[1]), Number(m[2]) - 1, Number(m[3])]; };

  switch (it.getType()) {
    case T.TEXT:            return it.asTextItem().createResponse(String(v).trim());
    case T.PARAGRAPH_TEXT:  return it.asParagraphTextItem().createResponse(String(v).trim());
    case T.MULTIPLE_CHOICE: return it.asMultipleChoiceItem().createResponse(String(v));
    case T.LIST:            return it.asListItem().createResponse(String(v));
    case T.CHECKBOX:        return it.asCheckboxItem().createResponse([].concat(v).filter(x => !vide_(x)).map(String));
    case T.SCALE:           return it.asScaleItem().createResponse(Number(v));
    case T.DATE: {
      const [y, m, d] = ymd(v);
      return it.asDateItem().createResponse(new Date(y, m, d));
    }
    case T.DATETIME: {
      const [y, m, d] = ymd(v);
      const [h, mi] = hm(String(v).split('T')[1] || '');
      return it.asDateTimeItem().createResponse(new Date(y, m, d, h, mi));
    }
    case T.TIME: {
      const [h, mi] = hm(v);
      return it.asTimeItem().createResponse(h, mi);
    }
    case T.DURATION: {
      const [h, mi] = hm(v);
      return it.asDurationItem().createResponse(h, mi, 0);
    }
    case T.GRID: {
      const x = it.asGridItem();
      const rows = x.getRows(), cols = x.getColumns();
      const arr = rows.map((_, i) => {
        const c = v[i];
        if (vide_(c)) return null;
        if (cols.indexOf(c) < 0) throw new Error('colonne inconnue « ' + c + ' »');
        return c;
      });
      return x.createResponse(arr);
    }
    case T.CHECKBOX_GRID: {
      const x = it.asCheckboxGridItem();
      const arr = x.getRows().map((_, i) => (vide_(v[i]) ? null : [].concat(v[i]).map(String)));
      return x.createResponse(arr);
    }
  }
  return null;
}

// ============================ FMPA enregistrées ============================

/** Clé de comparaison : sans crochets, accents ni ponctuation, en majuscules. « [DUREE FMPA] » = « Durée FMPA ». */
function cle_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\[\]]/g, ' ')
    .replace(/[œŒ]/g, 'OE').replace(/[æÆ]/g, 'AE')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function memeValeur_(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b);
}

/** Profil de l'utilisateur pour les droits sur les FMPA. */
function profilFmpa_(a) {
  const { pt, row } = a.p;
  const role = deriveRole_(pt, row, a.acc);
  const admin = isAdminSmpm_(a.acc);
  // Sections dirigées : onglet « CT et CdS » (Roles.gs). Un CTD peut aussi diriger une section (ISS).
  let sections = fonctionDe_(pt, row).sections.map(cle_);
  if (!sections.length && role === 'chef_section') {
    const s = a.acc.ct.col('section') >= 0 ? String(a.acc.ct.cell(a.acc.row, 'section') || '') : '';
    sections = [cle_(s || pt.cell(row, H.SECTEUR))].filter(Boolean);
  }
  return {
    nom: cle_(pt.cell(row, H.NOM)),
    role, admin,
    ctd: role === 'ctd',
    chefSection: sections.length > 0,
    sections,
    section: sections[0] || '',
  };
}

/** Chefs de section actifs par secteur (colonne « CHEFS DE SECTION » de la liste du personnel) : le N+1. */
function chefsSectionFmpa_(pt) {
  const fct = chefsParSection_(pt);          // onglet « CT et CdS » (Roles.gs)
  if (Object.keys(fct).length) return fct;
  const out = {};
  if (pt.col('CHEFS DE SECTION') < 0) return out;
  for (let i = 1; i < pt.values.length; i++) {
    if (!isTrue_(pt.cell(i, 'CHEFS DE SECTION')) || !isTrue_(pt.cell(i, H.ACTIF))) continue;
    const k = cle_(pt.cell(i, H.SECTEUR));
    (out[k] = out[k] || []).push((String(pt.cell(i, H.PRENOM) || '').trim() + ' ' + String(pt.cell(i, H.NOM) || '').trim()).trim());
  }
  return out;
}

function fmpaTable_() {
  const sh = SpreadsheetApp.openById(FMPA.SHEET_ID).getSheetByName(FMPA.SHEET_NAME);
  if (!sh) throw new Error('Onglet « ' + FMPA.SHEET_NAME + ' » introuvable dans le sheet FMPA');
  const nr = sh.getLastRow(), nc = sh.getLastColumn();
  const values = nr > 0 ? sh.getRange(1, 1, nr, nc).getValues() : [[]];
  const keys = values[0].map(cle_);
  const c = name => keys.indexOf(cle_(name));
  const C = FMPA.COL;
  return {
    sh, values, keys,
    col: { num: c(C.NUM), horo: c(C.HORO), date: c(C.DATE), secteur: c(C.SECTEUR), lieu: c(C.LIEU), cu: c(C.CU), duree: c(C.DUREE) },
  };
}

/** Résumé d'une ligne ; null si la ligne n'est pas une FMPA (pas d'horodateur). L'id est l'horodateur en ms. */
function metaFmpa_(t, i, r) {
  r = r || t.values[i];
  const C = t.col;
  const v = k => (C[k] >= 0 ? r[C[k]] : '');
  const horo = v('horo');
  if (!(horo instanceof Date) || isNaN(horo)) return null;
  const date = v('date');
  let repos = 0, tt = 0;
  r.forEach(x => {
    const s = cle_(x);
    if (s === 'REPOS') repos++;
    else if (s === 'TEMPS DE TRAVAIL') tt++;
  });
  return {
    id: String(horo.getTime()),
    numero: v('num') === '' ? '' : String(v('num')),
    horodateur: horo.toISOString(),
    date: date instanceof Date ? Utilities.formatDate(date, 'Europe/Paris', 'yyyy-MM-dd') : String(date || ''),
    secteur: cle_(v('secteur')),
    lieu: String(v('lieu') || '').trim(),
    cu: String(v('cu') || '').trim().toUpperCase(),
    duree: Number(String(v('duree')).replace(',', '.')) || 0,
    repos, tt, presents: repos + tt,
  };
}

/**
 * Droits sur une FMPA :
 * admin / CT : tout ; chef de section : modification de son secteur, consultation des autres ;
 * chef d'unité responsable : 24 h, puis lecture seule.
 */
function droitsFmpa_(m, prof, chefs) {
  if (prof.admin || prof.ctd) return { voir: true, modifier: true, par: 'admin' };
  if (prof.chefSection && m.secteur && prof.sections.indexOf(m.secteur) >= 0) return { voir: true, modifier: true, par: 'section' };
  if (prof.nom && cle_(m.cu) === prof.nom) {
    const fin = new Date(m.horodateur).getTime() + FMPA.EDIT_HOURS * 3600e3;
    if (Date.now() < fin) return { voir: true, modifier: true, par: 'cu', jusqua: new Date(fin).toISOString() };
    return { voir: true, modifier: false, motif: 'delai', n1: (chefs && chefs[m.secteur]) || [] };
  }
  if (prof.chefSection) return { voir: true, modifier: false, motif: 'secteur' };
  return { voir: false, modifier: false, motif: 'droits' };
}

function trouverFmpa_(t, id) {
  const ms = Number(id);
  const h = t.col.horo;
  if (h < 0 || !ms) throw new Error('FMPA introuvable');
  for (let i = 1; i < t.values.length; i++) {
    const d = t.values[i][h];
    if (d instanceof Date && d.getTime() === ms) return i;
  }
  throw new Error('FMPA introuvable : elle a peut-être été supprimée du sheet');
}

/**
 * Liste des FMPA.
 * scope : 'mine' (FMPA encadrées par l'utilisateur), 'secteur' (chef de section, ancien menu),
 *         'toutes' (admin, CT : modification ; chef de section : consultation, modification de son secteur).
 */
function fmpaList_(token, scope) {
  const a = fmpaAuth_(token);
  const prof = profilFmpa_(a);
  scope = scope || 'mine';
  if (scope === 'toutes' && !(prof.admin || prof.ctd || prof.chefSection)) throw new Error('Accès réservé aux administrateurs, conseillers techniques et chefs de section');
  if (scope === 'secteur' && !prof.chefSection) throw new Error('Accès réservé aux chefs de section');

  const t = fmpaTable_();
  const chefs = chefsSectionFmpa_(a.p.pt);
  const out = [];
  for (let i = 1; i < t.values.length; i++) {
    const m = metaFmpa_(t, i);
    if (!m) continue;
    if (scope === 'mine' && cle_(m.cu) !== prof.nom) continue;
    if (scope === 'secteur' && prof.sections.indexOf(m.secteur) < 0) continue;
    const d = droitsFmpa_(m, prof, chefs);
    if (!d.voir) continue;
    m.droits = { modifier: d.modifier, par: d.par || '', jusqua: d.jusqua || '', motif: d.motif || '' };
    out.push(m);
  }
  out.sort((x, y) => (x.date !== y.date ? (x.date < y.date ? 1 : -1) : (x.horodateur < y.horodateur ? 1 : -1)));
  return { ok: true, scope, section: prof.section, fmpa: out, maj: new Date().toISOString() };
}

/** Rapproche chaque question du formulaire de sa (ses) colonne(s) dans le sheet, par le titre. */
function mappingFmpa_(def, keys) {
  const idx = k => keys.reduce((acc, x, i) => (x === k && k ? acc.concat(i) : acc), []);
  const map = {};
  def.sections.forEach(s => s.items.forEach(it => {
    if (it.type === 'header') return;
    if (it.rows) map[it.id] = { rows: it.rows.map(r => idx(cle_(r))) };
    else map[it.id] = { cols: idx(cle_(it.title)) };
  }));
  return map;
}

/** Sépare « a, b, c » en retrouvant les choix connus (un choix peut contenir une virgule). */
function splitChoix_(s, known) {
  const parts = String(s).split(/,\s*/).map(p => p.trim()).filter(Boolean);
  const byKey = {};
  known.forEach(k => { byKey[cle_(k)] = k; });
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let found = false;
    for (let j = Math.min(parts.length, i + 4); j > i + 1 && !found; j--) {
      const k = cle_(parts.slice(i, j).join(', '));
      if (byKey[k]) { out.push(byKey[k]); i = j - 1; found = true; }
    }
    if (!found) out.push(byKey[cle_(parts[i])] || parts[i]);
  }
  return out;
}

/** Ligne du sheet -> réponses au format de l'application ({ [itemId]: valeur }). */
function lireReponsesFmpa_(def, map, r) {
  const tz = 'Europe/Paris';
  const ans = {};
  const vide = x => x === '' || x === null || x === undefined || String(x).trim() === '';
  def.sections.forEach(s => s.items.forEach(it => {
    const m = map[it.id];
    if (!m) return;
    if (it.rows) {
      const arr = m.rows.map(ix => {
        const raw = ix.map(c => r[c]).find(x => !vide(x));
        if (raw === undefined) return null;
        if (it.type === 'checkgrid') {
          const parts = splitChoix_(raw, it.cols);
          return parts.length ? parts : null;
        }
        return it.cols.find(c => cle_(c) === cle_(raw)) || String(raw).trim();
      });
      if (arr.some(Boolean)) ans[it.id] = arr;
      return;
    }
    if (!m.cols.length) return;
    const raw = r[m.cols[0]];
    if (vide(raw)) return;
    const d = raw instanceof Date ? raw : null;
    switch (it.type) {
      case 'date': {
        if (d) ans[it.id] = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
        else {
          const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw));
          ans[it.id] = x ? `${x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}` : String(raw);
        }
        break;
      }
      case 'datetime': ans[it.id] = d ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm") : String(raw); break;
      case 'time':
      case 'duration': ans[it.id] = d ? Utilities.formatDate(d, tz, 'HH:mm') : String(raw); break;
      case 'checkbox': ans[it.id] = splitChoix_(raw, it.choices.map(c => c.v)); break;
      default: {
        const c = it.choices && it.choices.find(ch => cle_(ch.v) === cle_(raw));
        ans[it.id] = c ? c.v : String(raw).trim();
      }
    }
  }));
  return ans;
}

/** Valeur de l'application -> valeur de cellule (dates en Date, nombres en nombre si la colonne en contient). */
function celluleFmpa_(it, v, old) {
  if (vide_(v)) return '';
  switch (it.type) {
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (!m) throw new Error('Date invalide pour « ' + it.title + ' »');
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    case 'checkbox': return [].concat(v).filter(x => !vide_(x)).join(', ');
    default: {
      const s = String(v).trim();
      if ((typeof old === 'number' || old === '') && /^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
      return s;
    }
  }
}

function versionFmpa_(r) { return sha_('v', JSON.stringify(r)); }

/** Une FMPA : réponses rapprochées du formulaire, droits, version (contrôle des modifications concurrentes). */
function fmpaGet_(token, id) {
  const a = fmpaAuth_(token);
  const prof = profilFmpa_(a);
  const t = fmpaTable_();
  const i = trouverFmpa_(t, id);
  const r = t.values[i];
  const m = metaFmpa_(t, i);
  const d = droitsFmpa_(m, prof, chefsSectionFmpa_(a.p.pt));
  if (!d.voir) throw new Error("Vous n'avez pas accès à cette FMPA");
  const def = fmpaDef_();
  m.answers = lireReponsesFmpa_(def, mappingFmpa_(def, t.keys), r);
  m.version = versionFmpa_(r);
  m.droits = d;
  return Object.assign({ ok: true, form: def, fmpa: m }, contexteFmpa_(a));
}

/**
 * Modifie une FMPA : seules les cellules changées sont réécrites (les formules éventuelles sont préservées).
 * answers contient les questions des sections affichées ; null = réponse effacée.
 */
function fmpaUpdate_(token, id, answers, version) {
  const a = fmpaAuth_(token);
  const prof = profilFmpa_(a);
  if (!answers || typeof answers !== 'object') throw new Error('Aucune modification');

  const t = fmpaTable_();
  const i = trouverFmpa_(t, id);
  const r = t.values[i];
  const m = metaFmpa_(t, i);
  const chefs = chefsSectionFmpa_(a.p.pt);
  const d = droitsFmpa_(m, prof, chefs);
  if (!d.modifier) {
    throw new Error(d.motif === 'delai'
      ? 'Délai de ' + FMPA.EDIT_HOURS + ' h dépassé : la modification doit être faite par le chef de section (N+1)'
      : "Vous n'avez pas le droit de modifier cette FMPA");
  }
  if (version && version !== versionFmpa_(r)) {
    throw new Error('Cette FMPA a été modifiée entre-temps par quelqu’un d’autre : rouvrez-la avant de recommencer');
  }

  const def = fmpaDef_();
  const map = mappingFmpa_(def, t.keys);
  const items = {};
  def.sections.forEach(s => s.items.forEach(it => { items[it.id] = it; }));

  const writes = {};          // index de colonne -> nouvelle valeur
  Object.keys(answers).forEach(qid => {
    const it = items[qid], mp = map[qid];
    if (!it || !mp) return;
    const v = answers[qid];
    if (it.rows) {
      it.rows.forEach((_, k) => {
        const cols = mp.rows[k];
        if (!cols.length) return;
        const val = Array.isArray(v) ? v[k] : null;
        let cell = '';
        if (!vide_(val)) {
          if (it.type === 'checkgrid') cell = [].concat(val).join(', ');
          else if (it.cols.indexOf(val) < 0) throw new Error('Colonne inconnue « ' + val + ' »');
          else cell = val;
        }
        // une personne peut avoir plusieurs colonnes (anciennes versions du formulaire) :
        // on garde la colonne déjà renseignée, sinon la première, et on vide les autres
        const deja = cols.find(c => String(r[c]).trim() !== '');
        const cible = deja === undefined ? cols[0] : deja;
        cols.forEach(c => { writes[c] = c === cible ? cell : ''; });
      });
      return;
    }
    if (!mp.cols.length) return;
    const old = r[mp.cols[0]];
    // même jour calendaire : on ne réécrit pas la date (évite un faux changement lié au fuseau)
    if (it.type === 'date' && old instanceof Date && Utilities.formatDate(old, 'Europe/Paris', 'yyyy-MM-dd') === String(v || '').slice(0, 10)) return;
    const cell = celluleFmpa_(it, v, old);
    mp.cols.forEach(c => { writes[c] = cell; });
  });

  const changes = Object.keys(writes).map(Number).filter(c => !memeValeur_(r[c], writes[c]));
  if (changes.length) {
    const lo = Math.min.apply(null, changes), hi = Math.max.apply(null, changes);
    const rng = t.sh.getRange(i + 1, lo + 1, 1, hi - lo + 1);
    const formulas = rng.getFormulas()[0];
    if (formulas.some(Boolean)) {
      changes.forEach(c => t.sh.getRange(i + 1, c + 1).setValue(writes[c]));
    } else {
      const row = r.slice(lo, hi + 1);
      changes.forEach(c => { row[c - lo] = writes[c]; });
      rng.setValues([row]);
    }
    const champs = changes.map(c => cle_(t.values[0][c])).join(', ');
    try { journalSheet_().appendRow([new Date(), a.id, 'modif_fmpa', id, (changes.length + ' champ(s) : ' + champs).slice(0, 1000)]); } catch (e) {}
  }

  const nr = t.sh.getRange(i + 1, 1, 1, t.values[0].length).getValues()[0];
  const nm = metaFmpa_(t, i, nr);
  nm.version = versionFmpa_(nr);
  nm.droits = droitsFmpa_(nm, prof, chefs);
  return { ok: true, changed: changes.length, fmpa: nm };
}

/** À exécuter depuis l'éditeur : vérifie le rapprochement questions du formulaire <-> colonnes du sheet FMPA. */
function testFmpaMapping() {
  const def = lireFormulaireFmpa_();
  const t = fmpaTable_();
  const map = mappingFmpa_(def, t.keys);
  const lignes = ['Colonnes clés : ' + JSON.stringify(t.col)];
  def.sections.forEach(s => s.items.forEach(it => {
    const m = map[it.id];
    if (!m) return;
    if (m.rows) {
      const manquants = it.rows.filter((_, k) => !m.rows[k].length);
      lignes.push('[grille] ' + it.title + ' : ' + (it.rows.length - manquants.length) + '/' + it.rows.length + ' noms rapprochés' +
        (manquants.length ? ' — sans colonne : ' + manquants.join(', ') : ''));
    } else {
      lignes.push((m.cols.length ? 'OK   ' : 'ABSENT ') + it.title + (m.cols.length ? ' -> colonne ' + (m.cols[0] + 1) : ''));
    }
  }));
  const n = t.values.slice(1).filter((_, k) => metaFmpa_(t, k + 1)).length;
  lignes.push(n + ' FMPA lues dans « ' + FMPA.SHEET_NAME + ' »');
  Logger.log(lignes.join('\n'));
}

/** À exécuter une fois depuis l'éditeur : accorde l'accès FormApp et affiche la structure lue. */
function testFmpaForm() {
  CacheService.getScriptCache().remove(FMPA.CACHE_KEY);
  const def = lireFormulaireFmpa_();
  const lignes = [def.title + ' — ' + def.sections.length + ' section(s)'];
  def.sections.forEach((s, i) => {
    lignes.push('§' + i + ' ' + (s.title || '(début)') + ' → ' + s.next);
    s.items.forEach(q => lignes.push('   [' + q.type + (q.required ? '*' : '') + '] ' + q.title +
      (q.rows ? ' (' + q.rows.length + ' lignes × ' + q.cols.join('/') + ')' : '') +
      (q.choices ? ' (' + q.choices.length + ' choix)' : '')));
  });
  Logger.log(lignes.join('\n'));
}

// ============================ Correction de l'indice de risque ============================

/**
 * À exécuter UNE FOIS depuis l'éditeur Apps Script (aucun redéploiement nécessaire).
 * Corrige l'onglet « FMPA_test » du sheet FMPA, qui calcule l'indice de risque du compte rendu
 * PDF et du SMS envoyé au chef d'unité, pour qu'il soit identique à celui affiché dans l'application :
 *   - H11 (SOIEC CNF réalisé ?) lisait la colonne 16 (Reconnaissance du site) au lieu de la 18 ;
 *   - I17 (somme des points) s'arrêtait à I15 et oubliait « Autres difficultés » (I16).
 * Sans effet si les formules sont déjà corrigées ; le journal indique ce qui a été modifié.
 */
function corrigerIndiceRisque() {
  const sh = SpreadsheetApp.openById(FMPA.SHEET_ID).getSheetByName('FMPA_test');
  if (!sh) throw new Error('Onglet « FMPA_test » introuvable dans le sheet FMPA');
  const lignes = [];
  const corriger = (cell, attendue, ancienne) => {
    const r = sh.getRange(cell);
    const f = r.getFormula().replace(/\s/g, '').toUpperCase();
    if (f === attendue.replace(/\s/g, '').toUpperCase()) { lignes.push(cell + ' déjà correcte : ' + attendue); return; }
    if (!ancienne.test(f)) { lignes.push(cell + ' NON MODIFIÉE (formule inattendue : ' + r.getFormula() + ')'); return; }
    const avant = r.getFormula();
    r.setFormula(attendue);
    lignes.push(cell + ' corrigée : ' + attendue + ' (avant : ' + avant + ')');
  };
  corriger('H11', '=VLOOKUP($A$1,test_fmpa!$1:$1298,18,FALSE)', /^=VLOOKUP\(\$A\$1,TEST_FMPA!\$1:\$\d+,16,FALSE\)$/);
  corriger('I17', '=SUM(I4:I16)', /^=SUM\(I4:I15\)$/);
  SpreadsheetApp.flush();
  Logger.log(lignes.join('\n'));
}
