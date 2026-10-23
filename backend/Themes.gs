/**
 * SMPM 84 – Remplir mon livret : saisie des thèmes vus en FMPA depuis l'application
 *
 * À ajouter comme NOUVEAU fichier « Themes.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs, Livret.gs, Fmpa.gs et Validation.gs (il utilise leurs fonctions).
 *
 * 1. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'themes_form':   result = themesForm_(b.token); break;
 *        case 'themes_submit': result = themesSubmit_(b.token, b.answers, b.submission_id); break;
 *        case 'themes_mes':    result = themesMes_(b.token); break;
 * 2. Exécuter une fois testThemes() depuis l'éditeur (le journal montre le formulaire trouvé et ses questions).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Principe (le même que pour la déclaration de FMPA) : l'application ne recopie pas les questions en dur.
 * Elle lit la structure du formulaire Google « SMPM : Validation thèmes FMPA » (questions, listes de thèmes,
 * sections et sauts de section) et la saisie est soumise AU FORMULAIRE LUI-MÊME. La réponse arrive donc
 * dans le fichier CORE comme une saisie Google Form, et les traitements existants (feuille « validation CU »,
 * mail au chef d'unité) continuent de fonctionner. Le chef d'unité la valide ensuite dans l'application
 * (FMPA › Validation des livrets) ou par le circuit habituel.
 * Une question ou un thème ajouté dans le formulaire apparaît automatiquement dans l'app (cache de 10 min).
 *
 * Sécurité : la réponse « Qui êtes-vous ? » est imposée par le serveur (nom de l'utilisateur connecté) ;
 * personne ne peut saisir des thèmes au nom d'un autre.
 *
 * Accès : tous les membres connectés.
 */

const THEMES = {
  // Identifiant du formulaire (dans son URL d'édition : /forms/d/<ID>/edit). Laisser vide pour le
  // retrouver automatiquement : c'est le formulaire relié à l'onglet « formulaire thèmes » du fichier CORE.
  FORM_ID: '',
  CACHE_KEY: 'themes_form_v1',
  CACHE_SEC: 600,
  DEDUP_SEC: 6 * 3600,
  H_AGENT: 'Qui êtes-vous?',
  H_NIVEAU: 'Quel est votre niveau ?',
  JOURNAL: 'saisie_themes',
};

// ============================ Formulaire ============================

function themesFormulaire_() {
  if (THEMES.FORM_ID) return FormApp.openById(THEMES.FORM_ID);
  const ss = SpreadsheetApp.openById(VALID.CORE_ID);
  const sh = ss.getSheetByName(VALID.CORE_SHEET);
  const url = (sh && sh.getFormUrl()) || ss.getFormUrl();
  if (!url) throw new Error('Formulaire des thèmes introuvable : renseigner THEMES.FORM_ID dans Themes.gs');
  return FormApp.openByUrl(url);
}

/** Même structure que la déclaration de FMPA : { title, description, sections: [ { title, help, next, items } ] }. */
function themesDef_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(THEMES.CACHE_KEY);
  if (hit) return JSON.parse(hit);

  const form = themesFormulaire_();
  const T = FormApp.ItemType;
  const items = form.getItems();
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
      let nav = 'next';
      try { nav = goto(pb.getPageNavigationType(), pb.getGoToPage()); } catch (e) {}
      sections[sections.length - 1].next = nav;
      sections.push({ title: it.getTitle(), help: it.getHelpText(), next: 'next', items: [] });
      return;
    }
    const d = itemDef_(it, goto);            // défini dans Fmpa.gs
    if (d) sections[sections.length - 1].items.push(d);
  });
  sections[sections.length - 1].next = 'submit';

  const def = { title: form.getTitle(), description: form.getDescription(), sections };
  try { cache.put(THEMES.CACHE_KEY, JSON.stringify(def), THEMES.CACHE_SEC); } catch (e) { /* trop gros */ }
  return def;
}

/** Question « Qui êtes-vous ? » et choix correspondant à l'utilisateur. */
function themesAgent_(def, nom) {
  const all = def.sections.reduce((acc, s) => acc.concat(s.items), []);
  const it = all.find(x => cle_(x.title) === cle_(THEMES.H_AGENT));
  if (!it) return { itemId: null, valeur: '' };
  const c = (it.choices || []).find(ch => cle_(ch.v) === cle_(nom));
  return { itemId: it.id, valeur: c ? c.v : '' };
}

// ============================ API ============================

function themesForm_(token) {
  const a = auth_(token);
  const { pt, row } = a.p;
  const nom = String(pt.cell(row, H.NOM) || '').trim().toUpperCase();
  const def = themesDef_();
  const ag = themesAgent_(def, nom);

  // Niveau proposé : IMP 3 si la qualification est acquise, sinon IMP 2 (modifiable par l'agent)
  const all = def.sections.reduce((acc, s) => acc.concat(s.items), []);
  const niv = all.find(x => cle_(x.title) === cle_(THEMES.H_NIVEAU));
  let niveau = '';
  if (niv && niv.choices) {
    const want = isTrue_(pt.cell(row, 'IMP 3')) ? 'IMP 3' : 'IMP 2';
    const c = niv.choices.find(ch => cle_(ch.v) === cle_(want));
    niveau = c ? c.v : '';
  }

  return {
    ok: true,
    form: def,
    moi: {
      nom,
      prenom: String(pt.cell(row, H.PRENOM) || '').trim(),
      agentItem: ag.itemId,
      agentValeur: ag.valeur,          // vide : nom absent de la liste du formulaire
      niveauItem: niv ? niv.id : null,
      niveau,
    },
  };
}

/**
 * Soumet la saisie au formulaire. answers : { [itemId]: valeur } comme pour fmpa_submit.
 * La réponse « Qui êtes-vous ? » est toujours celle de l'utilisateur connecté.
 */
function themesSubmit_(token, answers, submissionId) {
  const a = auth_(token);
  if (!answers || typeof answers !== 'object') throw new Error('Saisie vide');
  const nom = String(a.p.pt.cell(a.p.row, H.NOM) || '').trim().toUpperCase();

  const cache = CacheService.getScriptCache();
  const sid = submissionId ? String(submissionId).replace(/[^\w-]/g, '').slice(0, 60) : '';
  const key = sid ? 'themes_sid_' + sid : '';
  if (key) {
    const done = cache.get(key);
    if (done) return JSON.parse(done);
    const deja = themesSidDansJournal_(sid);
    if (deja) return { ok: true, response_id: deja, deja: true, at: new Date().toISOString() };
  }

  const form = themesFormulaire_();
  if (!form.isAcceptingResponses()) throw new Error("Le formulaire des thèmes n'accepte plus de réponses");

  const ag = themesAgent_(themesDef_(), nom);
  if (ag.itemId) {
    if (!ag.valeur) throw new Error('Votre nom (' + nom + ") ne figure pas dans la liste du formulaire des thèmes : prévenez l'administrateur");
    answers[ag.itemId] = ag.valeur;
  }

  const resp = form.createResponse();
  let n = 0;
  Object.keys(answers).forEach(id => {
    const it = form.getItemById(Number(id));
    if (!it) throw new Error('Le formulaire a été modifié : rouvrez « Remplir mon livret »');
    let r;
    try { r = itemResponse_(it, answers[id]); }                  // défini dans Fmpa.gs
    catch (e) { throw new Error('Réponse refusée pour « ' + it.getTitle() + ' » : ' + e.message); }
    if (r) { resp.withItemResponse(r); n++; }
  });
  if (n < 2) throw new Error('Saisie vide');

  const sent = resp.submit();
  try { journalSheet_().appendRow([new Date(), a.id, THEMES.JOURNAL, sid, sent.getId()]); } catch (e) {}

  const out = { ok: true, response_id: sent.getId(), at: new Date().toISOString() };
  if (key) cache.put(key, JSON.stringify(out), THEMES.DEDUP_SEC);
  return out;
}

function themesSidDansJournal_(sid) {
  try {
    const sh = journalSheet_();
    const n = sh.getLastRow();
    if (n < 2) return '';
    const from = Math.max(2, n - 1999);
    const rows = sh.getRange(from, 3, n - from + 1, 3).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === THEMES.JOURNAL && String(rows[i][1]) === sid) return String(rows[i][2] || 'ok');
    }
  } catch (e) {}
  return '';
}

/** Demandes de l'utilisateur encore en attente de validation dans le CORE. */
function themesMes_(token) {
  const a = auth_(token);
  const nom = cle_(a.p.pt.cell(a.p.row, H.NOM));
  const t = coreTable_();                                         // défini dans Validation.gs
  const parNom = personnelParNom_(a.p.pt);
  const out = [];
  for (let i = 1; i < t.values.length; i++) {
    const d = demande_(t, i, a.p.pt, parNom);
    if (!d || cle_(d.agent) !== nom) continue;
    out.push({
      date: d.date, cu: d.cu, horodateur: d.horodateur,
      themes: d.themes.reduce((s, g) => s + g.items.length, 0),
    });
  }
  out.sort((x, y) => (x.horodateur < y.horodateur ? 1 : -1));
  return { ok: true, demandes: out, maj: new Date().toISOString() };
}

// ============================ Test ============================

/** À exécuter depuis l'éditeur : formulaire trouvé, sections et questions (aucune écriture). */
function testThemes() {
  CacheService.getScriptCache().remove(THEMES.CACHE_KEY);
  const form = themesFormulaire_();
  Logger.log('Formulaire : ' + form.getTitle() + ' (' + form.getId() + ')');
  Logger.log('Accepte les réponses : ' + form.isAcceptingResponses());
  const def = themesDef_();
  def.sections.forEach((s, i) => {
    Logger.log('Section ' + i + ' « ' + (s.title || '(début)') + ' » -> ' + s.next);
    s.items.forEach(it => Logger.log('   [' + it.type + '] ' + it.title + (it.required ? ' *' : '') +
      (it.choices ? ' (' + it.choices.length + ' choix' + (it.choices.some(c => c.go !== null) ? ', avec sauts de section' : '') + ')' : '')));
  });
  const ag = themesAgent_(def, 'NERAULT');
  Logger.log('Question agent : ' + (ag.itemId ? 'trouvée' : 'INTROUVABLE (« ' + THEMES.H_AGENT + ' »)'));
}
