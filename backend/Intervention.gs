/**
 * SMPM 84 – Compte rendu d'intervention depuis l'application (Intervention › Nouvelle intervention)
 *
 * À ajouter comme NOUVEAU fichier « Intervention.gs » dans le projet Apps Script « Web App SMPM84 ».
 * Fichier autonome : il ne dépend que des fonctions communes de Code.gs (auth_, deriveRole_, isTrue_,
 * journalSheet_, en-têtes H de la liste du personnel), pas de Fmpa.gs.
 *
 * 1. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'itv_form':   result = itvForm_(b.token); break;
 *        case 'itv_submit': result = itvSubmit_(b.token, b.answers, b.submission_id); break;
 *        case 'itv_list':   result = itvList_(b.token, b.scope); break;
 *        case 'itv_get':    result = itvGet_(b.token, b.id); break;
 *        case 'itv_update': result = itvUpdate_(b.token, b.id, b.answers, b.version); break;
 * 2. Exécuter une fois testIntervention() depuis l'éditeur (autorisations FormApp et Sheets ; le journal
 *    montre le formulaire trouvé, ses sections, ses questions et la question « Coordonnées GPS »).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Principe : l'application lit la structure du formulaire Google « INTERVENTION - SMPM 84 » (questions,
 * choix, sections, sauts de section) et le compte rendu est soumis AU FORMULAIRE LUI-MÊME. La réponse
 * arrive dans le sheet « Interventions SMPM » (onglet des réponses) comme une saisie Google Form ; les
 * onglets calculés (DB_ITV, Carto, statistiques…) continuent de fonctionner. Le formulaire est retrouvé
 * automatiquement : c'est celui relié au sheet. Une question ajoutée ou modifiée dans le formulaire
 * apparaît dans l'application (au plus tard 10 minutes après, durée du cache).
 *
 * Coordonnées GPS : le chef d'unité pointe l'intervention sur une carte (ou relève sa position) ;
 * l'application remplit la question réponse courte « Coordonnées GPS » du formulaire au format
 * « 44.174130, 5.278690 » (latitude, longitude en degrés décimaux).
 *
 * Mes interventions et modification (ligne de l'onglet des réponses) :
 *   - chef d'unité indiqué dans « Chef d'unité SMPM » : ses interventions, modifiables pendant 24 h
 *     après l'envoi, ensuite en lecture seule ;
 *   - conseiller technique et administrateur : « Toutes les interventions » (scope 'toutes'),
 *     consultation et modification sans limite de délai.
 * La modification réécrit uniquement les cellules changées de la ligne, sans renvoyer le formulaire.
 * Chaque question est rapprochée de sa colonne par son titre ; si plusieurs questions portent le même
 * titre (sections différentes), la n-ième question va dans la n-ième colonne de ce titre.
 * testIntervention() affiche ce rapprochement.
 *
 * Accès : chef d'unité, chef de section, conseiller technique, administrateur (rôle ou is_admin).
 */

const ITV = {
  VERSION: 'itv-5',         // renvoyé par itv_list : permet de vérifier quelle version est déployée
  SHEET_ID: '1a5CNbEvAfE_Jk2toGjCSS0jR8HPy56k0L7dgoiqdbeM',   // sheet « Interventions SMPM »
  FORM_ID: '',              // facultatif : identifiant d'édition du formulaire ; vide = formulaire relié au sheet
  ROLES: ['chef_unite', 'chef_section', 'ctd', 'admin'],
  CACHE_KEY: 'itv_form_v1',
  CACHE_SEC: 600,           // structure du formulaire : 10 min
  DEDUP_SEC: 6 * 3600,      // un même envoi (submission_id) n'est jamais soumis deux fois
  GPS_RE: /gps|coordonn/i,  // question qui reçoit le point pointé sur la carte
  JOURNAL: 'declaration_intervention',
  EDIT_HOURS: 24,           // délai de modification pour le chef d'unité
  // Colonnes résumées dans « Mes interventions » (titres comparés sans accents ni ponctuation)
  COL: { CU: /^CHEF D ?UNITE/, DATE: /^DATE DE L ?INTERVENTION/, DEBUT: /^HEURE DE DEBUT/, COMMUNE: /COMMUNE/, DEPT: /^DEPARTEMENT/ },
};

// ============================ Accès ============================

function itvAuth_(token) {
  const a = auth_(token);
  const role = deriveRole_(a.p.pt, a.p.row, a.acc);
  const admin = isAdminSmpm_(a.acc);
  if (!admin && ITV.ROLES.indexOf(role) < 0) {
    throw new Error("Interventions réservées aux chefs d'unité, chefs de section, conseillers techniques et administrateurs");
  }
  return a;
}

// ============================ Formulaire ============================

function itvFormulaire_() {
  if (ITV.FORM_ID) return FormApp.openById(ITV.FORM_ID);
  const ss = SpreadsheetApp.openById(ITV.SHEET_ID);
  const sh = itvOnglet_(ss);
  const url = (sh && sh.getFormUrl()) || ss.getFormUrl();
  if (!url) throw new Error('Formulaire des interventions introuvable : renseigner ITV.FORM_ID dans Intervention.gs');
  return FormApp.openByUrl(url);
}

/**
 * Onglet qui reçoit les réponses du formulaire : celui relié au même formulaire que le classeur
 * (ou à ITV.FORM_ID), sinon le premier onglet relié à un formulaire.
 */
function itvOnglet_(ss) {
  const url = s => { try { return s.getFormUrl() || ''; } catch (e) { return ''; } };
  const id = u => (/\/d\/(?:e\/)?([\w-]+)/.exec(u || '') || [])[1] || '';
  const cible = ITV.FORM_ID || id(ss.getFormUrl());
  const relies = ss.getSheets().filter(s => url(s));
  return (cible && relies.find(s => id(url(s)) === cible)) || relies[0] || null;
}

function itvForm_(token) {
  const a = itvAuth_(token);
  return Object.assign({ ok: true, form: itvDef_() }, itvContexte_(a));
}

function itvContexte_(a) {
  const { pt, row } = a.p;
  return {
    personnes: itvPersonnes_(pt),
    moi: {
      nom: String(pt.cell(row, H.NOM) || '').trim().toUpperCase(),
      secteur: String(pt.cell(row, H.SECTEUR) || '').trim().toUpperCase(),
    },
  };
}

/** Structure du formulaire, mise en cache 10 min. */
function itvDef_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ITV.CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const def = itvLireFormulaire_(itvFormulaire_());
  try { cache.put(ITV.CACHE_KEY, JSON.stringify(def), ITV.CACHE_SEC); } catch (e) { /* trop gros */ }
  return def;
}

/** Nom (en majuscules) -> { prenom, secteur, actif } : pour afficher prénom et secteur dans une liste de noms. */
function itvPersonnes_(pt) {
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
 * next (fin de section) : 'next' | 'submit' | 'restart' | index de section.
 */
function itvLireFormulaire_(form) {
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
    const d = itvItemDef_(it, goto);
    if (d) sections[sections.length - 1].items.push(d);
  });
  sections[sections.length - 1].next = 'submit';

  return { title: form.getTitle(), description: form.getDescription(), sections };
}

function itvChoix_(choices, goto) {
  return choices.map(c => {
    let go = null;
    try {
      const nav = goto(c.getPageNavigationType(), c.getGotoPage());
      if (nav !== 'next') go = nav;
    } catch (e) { /* pas de navigation sur ce choix */ }
    return { v: c.getValue(), go };
  });
}

function itvItemDef_(it, goto) {
  const T = FormApp.ItemType;
  const d = { id: it.getId(), title: it.getTitle(), help: it.getHelpText() };
  switch (it.getType()) {
    case T.TEXT: {
      const x = it.asTextItem();
      return Object.assign(d, { type: 'text', required: x.isRequired(), gps: ITV.GPS_RE.test(it.getTitle()) });
    }
    case T.PARAGRAPH_TEXT: {
      const x = it.asParagraphTextItem();
      return Object.assign(d, { type: 'paragraph', required: x.isRequired() });
    }
    case T.MULTIPLE_CHOICE: {
      const x = it.asMultipleChoiceItem();
      return Object.assign(d, { type: 'radio', required: x.isRequired(), other: x.hasOtherOption(), choices: itvChoix_(x.getChoices(), goto) });
    }
    case T.LIST: {
      const x = it.asListItem();
      return Object.assign(d, { type: 'list', required: x.isRequired(), choices: itvChoix_(x.getChoices(), goto) });
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
function itvSubmit_(token, answers, submissionId) {
  const a = itvAuth_(token);
  if (!answers || typeof answers !== 'object') throw new Error('Compte rendu vide');

  const cache = CacheService.getScriptCache();
  const sid = submissionId ? String(submissionId).replace(/[^\w-]/g, '').slice(0, 60) : '';
  const key = sid ? 'itv_sid_' + sid : '';
  if (key) {
    const done = cache.get(key);
    if (done) return JSON.parse(done);    // renvoi après coupure réseau : déjà soumis
    // Compte rendu fait hors ligne et renvoyé tard (au-delà du cache) : on cherche son identifiant dans le Journal
    const deja = itvSidDansJournal_(sid);
    if (deja) return { ok: true, response_id: deja, deja: true, at: new Date().toISOString() };
  }

  const form = itvFormulaire_();
  if (!form.isAcceptingResponses()) throw new Error("Le formulaire des interventions n'accepte plus de réponses");

  const resp = form.createResponse();
  let n = 0;
  Object.keys(answers).forEach(id => {
    const it = form.getItemById(Number(id));
    if (!it) throw new Error('Le formulaire a été modifié : rechargez la page Nouvelle intervention');
    let r;
    try { r = itvItemResponse_(it, answers[id]); }
    catch (e) { throw new Error('Réponse refusée pour « ' + it.getTitle() + ' » : ' + e.message); }
    if (r) { resp.withItemResponse(r); n++; }
  });
  if (!n) throw new Error('Compte rendu vide');

  const sent = resp.submit();
  try { journalSheet_().appendRow([new Date(), a.id, ITV.JOURNAL, sid, sent.getId()]); } catch (e) {}

  const out = { ok: true, response_id: sent.getId(), at: new Date().toISOString() };
  if (key) cache.put(key, JSON.stringify(out), ITV.DEDUP_SEC);
  return out;
}

/** Identifiant de réponse si ce compte rendu (submission_id) a déjà été soumis ; parcourt les 2000 dernières lignes du Journal. */
function itvSidDansJournal_(sid) {
  try {
    const sh = journalSheet_();
    const n = sh.getLastRow();
    if (n < 2) return '';
    const from = Math.max(2, n - 1999);
    const rows = sh.getRange(from, 3, n - from + 1, 3).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === ITV.JOURNAL && String(rows[i][1]) === sid) return String(rows[i][2] || 'ok');
    }
  } catch (e) { /* Journal indisponible : on s'en remet au cache */ }
  return '';
}

function itvVide_(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return !v.some(x => !itvVide_(x));
  return String(v).trim() === '';
}

/** « 44,1741 ; 5,2787 » -> « 44.174100, 5.278700 » ; texte laissé tel quel s'il n'est pas lisible. */
function itvGps_(v) {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
  if (!m) return String(v).trim();
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return String(v).trim();
  return lat.toFixed(6) + ', ' + lng.toFixed(6);
}

function itvItemResponse_(it, v) {
  if (itvVide_(v)) return null;
  const T = FormApp.ItemType;
  const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s)); if (!m) throw new Error('heure invalide'); return [Number(m[1]), Number(m[2])]; };
  const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); if (!m) throw new Error('date invalide'); return [Number(m[1]), Number(m[2]) - 1, Number(m[3])]; };

  switch (it.getType()) {
    case T.TEXT: {
      const txt = ITV.GPS_RE.test(it.getTitle()) ? itvGps_(v) : String(v).trim();
      return it.asTextItem().createResponse(txt);
    }
    case T.PARAGRAPH_TEXT:  return it.asParagraphTextItem().createResponse(String(v).trim());
    case T.MULTIPLE_CHOICE: return it.asMultipleChoiceItem().createResponse(String(v));
    case T.LIST:            return it.asListItem().createResponse(String(v));
    case T.CHECKBOX:        return it.asCheckboxItem().createResponse([].concat(v).filter(x => !itvVide_(x)).map(String));
    case T.SCALE:           return it.asScaleItem().createResponse(Number(v));
    case T.DATE: {
      const [y, m, d] = ymd(v);
      // Midi et non minuit : quel que soit le fuseau du classeur de réponses (souvent GMT),
      // le jour reste le même (minuit à Paris = 22 h ou 23 h la veille en temps universel).
      return it.asDateItem().createResponse(new Date(y, m, d, 12, 0, 0));
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
      const cols = x.getColumns();
      const arr = x.getRows().map((_, i) => {
        const c = v[i];
        if (itvVide_(c)) return null;
        if (cols.indexOf(c) < 0) throw new Error('colonne inconnue « ' + c + ' »');
        return c;
      });
      return x.createResponse(arr);
    }
    case T.CHECKBOX_GRID: {
      const x = it.asCheckboxGridItem();
      const arr = x.getRows().map((_, i) => (itvVide_(v[i]) ? null : [].concat(v[i]).map(String)));
      return x.createResponse(arr);
    }
  }
  return null;
}

// ============================ Interventions enregistrées ============================

/** Clé de comparaison : sans crochets, accents ni ponctuation, en majuscules. */
function itvCle_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\[\]]/g, ' ')
    .replace(/[œŒ]/g, 'OE').replace(/[æÆ]/g, 'AE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function itvProfil_(a) {
  const { pt, row } = a.p;
  const role = deriveRole_(pt, row, a.acc);
  return {
    nom: itvCle_(pt.cell(row, H.NOM)),
    admin: role === 'ctd' || isAdminSmpm_(a.acc),
  };
}

function itvTable_() {
  const sh = itvOnglet_(SpreadsheetApp.openById(ITV.SHEET_ID));
  if (!sh) throw new Error('Onglet des réponses introuvable dans le sheet « Interventions SMPM »');
  const nr = sh.getLastRow(), nc = sh.getLastColumn();
  const values = nr > 0 ? sh.getRange(1, 1, nr, nc).getValues() : [[]];
  const keys = values[0].map(itvCle_);
  const c = re => keys.findIndex(k => re.test(k));
  const C = ITV.COL;
  return {
    sh, values, keys,
    col: { horo: 0, cu: c(C.CU), date: c(C.DATE), debut: c(C.DEBUT), commune: c(C.COMMUNE), dept: c(C.DEPT) },
  };
}

/** Résumé d'une ligne ; null si ce n'est pas une réponse (pas d'horodateur). L'id est l'horodateur en ms. */
function itvMeta_(t, r) {
  const tz = 'Europe/Paris';
  const v = k => (t.col[k] >= 0 ? r[t.col[k]] : '');
  const horo = v('horo');
  if (!(horo instanceof Date) || isNaN(horo)) return null;
  const date = v('date'), debut = v('debut');
  return {
    id: String(horo.getTime()),
    horodateur: horo.toISOString(),
    date: date instanceof Date ? Utilities.formatDate(date, tz, 'yyyy-MM-dd') : String(date || ''),
    debut: debut instanceof Date ? Utilities.formatDate(debut, tz, 'HH:mm') : String(debut || ''),
    commune: String(v('commune') || '').trim(),
    departement: String(v('dept') || '').trim(),
    cu: String(v('cu') || '').trim().toUpperCase(),
  };
}

/** Droits : CT / administrateur : tout ; chef d'unité indiqué : 24 h après l'envoi, puis lecture seule. */
function itvDroits_(m, prof) {
  if (prof.admin) return { voir: true, modifier: true, par: 'admin' };
  if (prof.nom && itvCle_(m.cu) === prof.nom) {
    const fin = new Date(m.horodateur).getTime() + ITV.EDIT_HOURS * 3600e3;
    if (Date.now() < fin) return { voir: true, modifier: true, par: 'cu', jusqua: new Date(fin).toISOString() };
    return { voir: true, modifier: false, motif: 'delai' };
  }
  return { voir: false, modifier: false, motif: 'droits' };
}

function itvTrouver_(t, id) {
  const ms = Number(id);
  if (!ms) throw new Error('Intervention introuvable');
  for (let i = 1; i < t.values.length; i++) {
    const d = t.values[i][0];
    if (d instanceof Date && d.getTime() === ms) return i;
  }
  throw new Error('Intervention introuvable : elle a peut-être été supprimée du sheet');
}

/**
 * Listes des interventions, les plus récentes en premier :
 *   mine   : celles dont l'utilisateur est le chef d'unité (tout le monde) ;
 *   toutes : toutes les interventions (conseiller technique et administrateur uniquement).
 * Les deux listes sont renvoyées en une fois : la page « Toutes les interventions » ne dépend donc
 * pas du paramètre scope transmis par doPost(). interventions = liste demandée (compatibilité).
 */
function itvList_(token, scope) {
  const a = itvAuth_(token);
  const prof = itvProfil_(a);
  if (scope === 'toutes' && !prof.admin) throw new Error('Accès réservé aux conseillers techniques et administrateurs');
  const t = itvTable_();
  const mine = [], toutes = [];
  for (let i = 1; i < t.values.length; i++) {
    const m = itvMeta_(t, t.values[i]);
    if (!m) continue;
    const estMoi = itvCle_(m.cu) === prof.nom;
    if (!estMoi && !prof.admin) continue;
    const d = itvDroits_(m, prof);
    m.droits = { modifier: d.modifier, par: d.par || '', jusqua: d.jusqua || '', motif: d.motif || '' };
    if (prof.admin) toutes.push(m);
    if (estMoi) mine.push(m);
  }
  const tri = (x, y) => (x.horodateur < y.horodateur ? 1 : -1);
  mine.sort(tri);
  toutes.sort(tri);
  const out = { ok: true, version: ITV.VERSION, scope: scope === 'toutes' ? 'toutes' : 'mine', mine, maj: new Date().toISOString() };
  if (prof.admin) out.toutes = toutes;
  out.interventions = out.scope === 'toutes' ? toutes : mine;
  return out;
}

/**
 * Rapproche chaque question de sa colonne par le titre. Titres répétés (même question dans plusieurs
 * sections) : la n-ième question de ce titre va dans la n-ième colonne de ce titre.
 * Grille : une colonne par ligne, intitulée « Titre [ligne] ».
 */
function itvMapping_(def, keys) {
  const vus = {};
  const prend = k => {
    const toutes = keys.reduce((acc, x, i) => (x === k && k ? acc.concat(i) : acc), []);
    const n = vus[k] || 0;
    vus[k] = n + 1;
    return toutes.length > n ? toutes[n] : -1;
  };
  const map = {};
  def.sections.forEach(s => s.items.forEach(it => {
    if (it.type === 'header') return;
    if (it.rows) map[it.id] = { rows: it.rows.map(r => prend(itvCle_(it.title + ' ' + r))) };
    else map[it.id] = { col: prend(itvCle_(it.title)) };
  }));
  return map;
}

/** Sépare « a, b, c » en retrouvant les choix connus (un choix peut contenir une virgule). */
function itvSplit_(s, known) {
  const parts = String(s).split(/,\s*/).map(p => p.trim()).filter(Boolean);
  const byKey = {};
  known.forEach(k => { byKey[itvCle_(k)] = k; });
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let found = false;
    for (let j = Math.min(parts.length, i + 4); j > i + 1 && !found; j--) {
      const k = itvCle_(parts.slice(i, j).join(', '));
      if (byKey[k]) { out.push(byKey[k]); i = j - 1; found = true; }
    }
    if (!found) out.push(byKey[itvCle_(parts[i])] || parts[i]);
  }
  return out;
}

/** Ligne du sheet -> réponses au format de l'application ({ [itemId]: valeur }). */
function itvLireReponses_(def, map, r) {
  const tz = 'Europe/Paris';
  const ans = {};
  def.sections.forEach(s => s.items.forEach(it => {
    const m = map[it.id];
    if (!m) return;
    if (it.rows) {
      const arr = m.rows.map(c => {
        const raw = c >= 0 ? r[c] : '';
        if (itvVide_(raw)) return null;
        if (it.type === 'checkgrid') { const p = itvSplit_(raw, it.cols); return p.length ? p : null; }
        return it.cols.find(x => itvCle_(x) === itvCle_(raw)) || String(raw).trim();
      });
      if (arr.some(Boolean)) ans[it.id] = arr;
      return;
    }
    if (m.col < 0) return;
    const raw = r[m.col];
    if (itvVide_(raw)) return;
    const d = raw instanceof Date ? raw : null;
    switch (it.type) {
      case 'date': {
        if (d) ans[it.id] = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
        else {
          const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw));
          ans[it.id] = x ? x[3] + '-' + x[2].padStart(2, '0') + '-' + x[1].padStart(2, '0') : String(raw);
        }
        break;
      }
      case 'datetime': ans[it.id] = d ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm") : String(raw); break;
      case 'time':
      case 'duration': ans[it.id] = d ? Utilities.formatDate(d, tz, 'HH:mm') : String(raw); break;
      case 'checkbox': ans[it.id] = itvSplit_(raw, it.choices.map(c => c.v)); break;
      default: {
        const c = it.choices && it.choices.find(ch => itvCle_(ch.v) === itvCle_(raw));
        ans[it.id] = c ? c.v : String(raw).trim();
      }
    }
  }));
  return ans;
}

/** Valeur de l'application -> valeur de cellule. */
function itvCellule_(it, v, old) {
  if (itvVide_(v)) return '';
  switch (it.type) {
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (!m) throw new Error('Date invalide pour « ' + it.title + ' »');
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    case 'time':
    case 'duration': {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
      if (!m) throw new Error('Heure invalide pour « ' + it.title + ' »');
      return m[1].padStart(2, '0') + ':' + m[2] + ':00';
    }
    case 'checkbox': return [].concat(v).filter(x => !itvVide_(x)).join(', ');
    case 'text': if (ITV.GPS_RE.test(it.title)) return itvGps_(v);   // falls through
    default: {
      const s = String(v).trim();
      if ((typeof old === 'number' || old === '') && /^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
      return s;
    }
  }
}

function itvMemeValeur_(it, a, b) {
  if (it && (it.type === 'time' || it.type === 'duration') && a instanceof Date) {
    return Utilities.formatDate(a, 'Europe/Paris', 'HH:mm:ss') === String(b);
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b);
}

function itvVersion_(r) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(r), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(d).slice(0, 22);
}

/** Une intervention : réponses rapprochées du formulaire, droits, version (modifications concurrentes). */
function itvGet_(token, id) {
  const a = itvAuth_(token);
  const prof = itvProfil_(a);
  const t = itvTable_();
  const r = t.values[itvTrouver_(t, id)];
  const m = itvMeta_(t, r);
  const d = itvDroits_(m, prof);
  if (!d.voir) throw new Error("Vous n'avez pas accès à cette intervention");
  const def = itvDef_();
  m.answers = itvLireReponses_(def, itvMapping_(def, t.keys), r);
  m.version = itvVersion_(r);
  m.droits = d;
  return Object.assign({ ok: true, form: def, intervention: m }, itvContexte_(a));
}

/**
 * Modifie une intervention : seules les cellules changées sont réécrites (formules préservées).
 * answers contient les questions des sections affichées ; null = réponse effacée.
 */
function itvUpdate_(token, id, answers, version) {
  const a = itvAuth_(token);
  const prof = itvProfil_(a);
  if (!answers || typeof answers !== 'object') throw new Error('Aucune modification');

  const t = itvTable_();
  const i = itvTrouver_(t, id);
  const r = t.values[i];
  const d = itvDroits_(itvMeta_(t, r), prof);
  if (!d.modifier) {
    throw new Error(d.motif === 'delai'
      ? 'Délai de ' + ITV.EDIT_HOURS + ' h dépassé : cette intervention n’est plus modifiable'
      : "Vous n'avez pas le droit de modifier cette intervention");
  }
  if (version && version !== itvVersion_(r)) {
    throw new Error('Cette intervention a été modifiée entre-temps : rouvrez-la avant de recommencer');
  }

  const def = itvDef_();
  const map = itvMapping_(def, t.keys);
  const items = {};
  def.sections.forEach(s => s.items.forEach(it => { items[it.id] = it; }));

  const writes = {};          // index de colonne -> { v, it }
  Object.keys(answers).forEach(qid => {
    const it = items[qid], mp = map[qid];
    if (!it || !mp) return;
    const v = answers[qid];
    if (it.rows) {
      it.rows.forEach((_, k) => {
        const c = mp.rows[k];
        if (c < 0) return;
        const val = Array.isArray(v) ? v[k] : null;
        let cell = '';
        if (!itvVide_(val)) {
          if (it.type === 'checkgrid') cell = [].concat(val).join(', ');
          else if (it.cols.indexOf(val) < 0) throw new Error('Colonne inconnue « ' + val + ' »');
          else cell = val;
        }
        writes[c] = { v: cell, it };
      });
      return;
    }
    if (mp.col < 0) return;
    const old = r[mp.col];
    // même jour calendaire : on ne réécrit pas la date (évite un faux changement lié au fuseau)
    if (it.type === 'date' && old instanceof Date && Utilities.formatDate(old, 'Europe/Paris', 'yyyy-MM-dd') === String(v || '').slice(0, 10)) return;
    writes[mp.col] = { v: itvCellule_(it, v, old), it };
  });

  const changes = Object.keys(writes).map(Number).filter(c => !itvMemeValeur_(writes[c].it, r[c], writes[c].v));
  if (changes.length) {
    changes.forEach(c => t.sh.getRange(i + 1, c + 1).setValue(writes[c].v));
    const champs = changes.map(c => String(t.values[0][c])).join(', ');
    try { journalSheet_().appendRow([new Date(), a.id, 'modif_intervention', id, (changes.length + ' champ(s) : ' + champs).slice(0, 1000)]); } catch (e) {}
  }

  const nr = t.sh.getRange(i + 1, 1, 1, t.values[0].length).getValues()[0];
  const nm = itvMeta_(t, nr);
  nm.version = itvVersion_(nr);
  nm.droits = itvDroits_(nm, prof);
  return { ok: true, changed: changes.length, intervention: nm };
}

// ============================ Test (éditeur) ============================

/** Vérifie la lecture de la base : onglet, colonnes résumées, nombre d'interventions, les 5 plus récentes. */
function testInterventionsListe() {
  const t = itvTable_();
  const lignes = ['Version : ' + ITV.VERSION, 'Onglet lu : « ' + t.sh.getName() + ' » (' + (t.values.length - 1) + ' lignes)'];
  Object.keys(t.col).forEach(k => lignes.push('  colonne ' + k + ' : ' + (t.col[k] >= 0 ? '« ' + t.values[0][t.col[k]] + ' »' : 'INTROUVABLE')));
  const toutes = [];
  for (let i = 1; i < t.values.length; i++) { const m = itvMeta_(t, t.values[i]); if (m) toutes.push(m); }
  toutes.sort((x, y) => (x.horodateur < y.horodateur ? 1 : -1));
  lignes.push(toutes.length + ' interventions reconnues (ligne avec un horodateur en colonne A)');
  toutes.slice(0, 5).forEach(m => lignes.push('  ' + m.date + ' · ' + m.commune + ' · CU ' + m.cu));
  Logger.log(lignes.join('\n'));
}

function testIntervention() {
  const form = itvFormulaire_();
  const def = itvLireFormulaire_(form);
  const lignes = ['Formulaire : ' + def.title + ' (' + form.getId() + ')'];
  let gps = null;
  def.sections.forEach((sec, i) => {
    lignes.push('— Section ' + i + (sec.title ? ' : ' + sec.title : '') + ' → ' + sec.next);
    sec.items.forEach(it => {
      lignes.push('    [' + it.type + '] ' + it.title + (it.required ? ' *' : ''));
      if (it.gps && !gps) gps = it;
    });
  });
  lignes.push(gps ? 'GPS : question « ' + gps.title + ' » (remplie par la carte de l’application)'
    : 'GPS : aucune question réponse courte « Coordonnées GPS » trouvée dans le formulaire');

  // Rapprochement questions <-> colonnes de l'onglet des réponses (pour Mes interventions / modification)
  const t = itvTable_();
  const map = itvMapping_(def, t.keys);
  const head = t.values[0];
  const manquantes = [];
  lignes.push('', 'Onglet des réponses : ' + t.sh.getName() + ' (' + (t.values.length - 1) + ' lignes)');
  Object.keys(t.col).forEach(k => lignes.push('  colonne ' + k + ' : ' + (t.col[k] >= 0 ? head[t.col[k]] : 'introuvable')));
  def.sections.forEach(s => s.items.forEach(it => {
    const m = map[it.id];
    if (!m) return;
    if (m.rows) m.rows.forEach((c, k) => { if (c < 0) manquantes.push(it.title + ' [' + it.rows[k] + ']'); });
    else if (m.col < 0) manquantes.push(it.title);
  }));
  lignes.push(manquantes.length ? 'Questions sans colonne (non modifiables) : ' + manquantes.join(' ; ') : 'Toutes les questions ont leur colonne.');
  Logger.log(lignes.join('\n'));
}
