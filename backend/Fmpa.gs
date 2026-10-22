/**
 * SMPM 84 – Déclaration de FMPA depuis l'application
 *
 * À ajouter comme NOUVEAU fichier « Fmpa.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs et Livret.gs.
 *
 * 1. Dans Code.gs, ajouter ces deux lignes dans le switch de doPost() :
 *        case 'fmpa_form':    result = fmpaForm_(b.token); break;
 *        case 'fmpa_submit':  result = fmpaSubmit_(b.token, b.answers, b.submission_id); break;
 * 2. Exécuter une fois testFmpaForm() depuis l'éditeur pour accorder l'accès aux formulaires (FormApp).
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
 */

const FMPA = {
  FORM_ID: '1sxlalnS_lZ4hwFxnG5aLuH8lCOd5Qu2_ggSkOCdEKi0',   // « Formulaire FMPA » (dossier FMPA/Formulaire)
  ROLES: ['chef_unite', 'chef_section', 'ctd', 'admin'],
  CACHE_KEY: 'fmpa_form_v1',
  CACHE_SEC: 600,           // structure du formulaire : 10 min
  DEDUP_SEC: 6 * 3600,      // un même envoi (submission_id) n'est jamais soumis deux fois
};

// ============================ Accès ============================

function fmpaAuth_(token) {
  const a = auth_(token);
  const role = deriveRole_(a.p.pt, a.p.row, a.acc);
  const admin = isTrue_(a.acc.ct.cell(a.acc.row, 'is_admin'));
  if (!admin && FMPA.ROLES.indexOf(role) < 0) {
    throw new Error("Déclaration réservée aux chefs d'unité, chefs de section et administrateurs");
  }
  return a;
}

// ============================ Lecture du formulaire ============================

function fmpaForm_(token) {
  const a = fmpaAuth_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(FMPA.CACHE_KEY);
  let def = hit ? JSON.parse(hit) : null;
  if (!def) {
    def = lireFormulaireFmpa_();
    try { cache.put(FMPA.CACHE_KEY, JSON.stringify(def), FMPA.CACHE_SEC); } catch (e) { /* trop gros */ }
  }
  const { pt, row } = a.p;
  return {
    ok: true,
    form: def,
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
  if (!answers || typeof answers !== 'object') throw new Error('Déclaration vide');

  const cache = CacheService.getScriptCache();
  const key = submissionId ? 'fmpa_sid_' + String(submissionId).replace(/[^\w-]/g, '').slice(0, 60) : '';
  if (key) {
    const done = cache.get(key);
    if (done) return JSON.parse(done);    // renvoi après coupure réseau : déjà soumis
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
  try { journalSheet_().appendRow([new Date(), a.id, 'declaration_fmpa', '', sent.getId()]); } catch (e) {}

  const out = { ok: true, response_id: sent.getId(), at: new Date().toISOString() };
  if (key) cache.put(key, JSON.stringify(out), FMPA.DEDUP_SEC);
  return out;
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
