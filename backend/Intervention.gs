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
 * Accès : chef d'unité, chef de section, conseiller technique, administrateur (rôle ou is_admin).
 */

const ITV = {
  SHEET_ID: '1a5CNbEvAfE_Jk2toGjCSS0jR8HPy56k0L7dgoiqdbeM',   // sheet « Interventions SMPM »
  FORM_ID: '',              // facultatif : identifiant d'édition du formulaire ; vide = formulaire relié au sheet
  ROLES: ['chef_unite', 'chef_section', 'ctd', 'admin'],
  CACHE_KEY: 'itv_form_v1',
  CACHE_SEC: 600,           // structure du formulaire : 10 min
  DEDUP_SEC: 6 * 3600,      // un même envoi (submission_id) n'est jamais soumis deux fois
  GPS_RE: /gps|coordonn/i,  // question qui reçoit le point pointé sur la carte
  JOURNAL: 'declaration_intervention',
};

// ============================ Accès ============================

function itvAuth_(token) {
  const a = auth_(token);
  const role = deriveRole_(a.p.pt, a.p.row, a.acc);
  const admin = isTrue_(a.acc.ct.cell(a.acc.row, 'is_admin'));
  if (!admin && ITV.ROLES.indexOf(role) < 0) {
    throw new Error("Interventions réservées aux chefs d'unité, chefs de section, conseillers techniques et administrateurs");
  }
  return a;
}

// ============================ Formulaire ============================

function itvFormulaire_() {
  if (ITV.FORM_ID) return FormApp.openById(ITV.FORM_ID);
  const ss = SpreadsheetApp.openById(ITV.SHEET_ID);
  const sh = ss.getSheets().find(s => { try { return !!s.getFormUrl(); } catch (e) { return false; } });
  const url = (sh && sh.getFormUrl()) || ss.getFormUrl();
  if (!url) throw new Error('Formulaire des interventions introuvable : renseigner ITV.FORM_ID dans Intervention.gs');
  return FormApp.openByUrl(url);
}

function itvForm_(token) {
  const a = itvAuth_(token);
  const { pt, row } = a.p;
  return {
    ok: true,
    form: itvDef_(),
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

// ============================ Test (éditeur) ============================

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
  Logger.log(lignes.join('\n'));
}
