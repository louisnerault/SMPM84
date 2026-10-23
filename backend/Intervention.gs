/**
 * SMPM 84 – Compte rendu d'intervention depuis l'application (Intervention › Nouvelle intervention)
 *
 * À ajouter comme NOUVEAU fichier « Intervention.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs et Fmpa.gs (il utilise leurs fonctions : auth_, deriveRole_, lireFormulaireFmpa_,
 * itemResponse_, contexteFmpa_, journalSheet_…).
 *
 * 1. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'itv_form':   result = itvForm_(b.token); break;
 *        case 'itv_submit': result = itvSubmit_(b.token, b.answers, b.submission_id, b.gps); break;
 * 2. Exécuter une fois testIntervention() depuis l'éditeur (autorisations ; le journal montre le
 *    formulaire trouvé, ses questions et l'emplacement prévu pour les coordonnées GPS).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Principe (le même que pour les FMPA) : l'application lit la structure du formulaire Google
 * « INTERVENTION - SMPM 84 » (questions, choix, sections, sauts de section) et la saisie est soumise
 * AU FORMULAIRE LUI-MÊME. La réponse arrive dans le sheet « Interventions SMPM » (onglet des réponses)
 * comme une saisie Google Form ; les onglets calculés (DB_ITV, Carto, statistiques…) continuent de
 * fonctionner. Le formulaire est retrouvé automatiquement : c'est celui relié au sheet.
 *
 * Coordonnées GPS pointées sur la carte par le chef d'unité, au format « 44.174130, 5.278690 » :
 *   - si le formulaire contient une question texte dont le titre parle de GPS ou de coordonnées,
 *     l'application y place le point (c'est la solution conseillée : rien d'autre à faire) ;
 *   - sinon, le serveur écrit le point dans la colonne « Coordonnées GPS » de l'onglet des réponses,
 *     sur la ligne de l'intervention (colonne créée en fin de tableau si elle n'existe pas).
 *
 * Accès : chef d'unité, chef de section, conseiller technique, administrateur (rôle ou is_admin).
 */

const ITV = {
  SHEET_ID: '1a5CNbEvAfE_Jk2toGjCSS0jR8HPy56k0L7dgoiqdbeM',   // sheet « Interventions SMPM »
  FORM_ID: '',              // facultatif : identifiant d'édition du formulaire ; vide = formulaire relié au sheet
  ROLES: ['chef_unite', 'chef_section', 'ctd', 'admin'],
  CACHE_KEY: 'itv_form_v1',
  CACHE_SEC: 600,
  DEDUP_SEC: 6 * 3600,
  GPS_COL: 'Coordonnées GPS',
  GPS_RE: /gps|coordonn|latitude|longitude/i,
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
  const sh = itvOngletReponses_(ss);
  const url = (sh && sh.getFormUrl()) || ss.getFormUrl();
  if (!url) throw new Error('Formulaire des interventions introuvable : renseigner ITV.FORM_ID dans Intervention.gs');
  return FormApp.openByUrl(url);
}

/** Onglet qui reçoit les réponses du formulaire (celui qui porte un lien de formulaire). */
function itvOngletReponses_(ss) {
  return ss.getSheets().find(s => { try { return !!s.getFormUrl(); } catch (e) { return false; } }) || null;
}

function itvDef_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ITV.CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const def = lireFormulaireFmpa_(itvFormulaire_());
  try { cache.put(ITV.CACHE_KEY, JSON.stringify(def), ITV.CACHE_SEC); } catch (e) { /* trop gros */ }
  return def;
}

/** La question du formulaire qui reçoit le point GPS, s'il y en a une. */
function itvQuestionGps_(def) {
  for (const sec of def.sections) {
    for (const it of sec.items) {
      if ((it.type === 'text' || it.type === 'paragraph') && ITV.GPS_RE.test(it.title)) return it;
    }
  }
  return null;
}

function itvForm_(token) {
  const a = itvAuth_(token);
  const def = itvDef_();
  const q = itvQuestionGps_(def);
  return Object.assign({ ok: true, form: def, gps: { question: q ? q.id : null, colonne: !q } }, contexteFmpa_(a));
}

// ============================ Envoi ============================

/** Coordonnées « lat, lng » normalisées à 6 décimales, ou '' si invalides. */
function itvGps_(v) {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
  if (!m) return '';
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return '';
  return lat.toFixed(6) + ', ' + lng.toFixed(6);
}

function itvSubmit_(token, answers, submissionId, gps) {
  const a = itvAuth_(token);
  if (!answers || typeof answers !== 'object') throw new Error('Compte rendu vide');

  const cache = CacheService.getScriptCache();
  const sid = submissionId ? String(submissionId).replace(/[^\w-]/g, '').slice(0, 60) : '';
  const key = sid ? 'itv_sid_' + sid : '';
  if (key) {
    const done = cache.get(key);
    if (done) return JSON.parse(done);    // renvoi après coupure réseau : déjà soumis
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
    try { r = itemResponse_(it, answers[id]); }
    catch (e) { throw new Error('Réponse refusée pour « ' + it.getTitle() + ' » : ' + e.message); }
    if (r) { resp.withItemResponse(r); n++; }
  });
  if (!n) throw new Error('Compte rendu vide');

  const sent = resp.submit();
  const point = itvGps_(gps);
  try { journalSheet_().appendRow([new Date(), a.id, ITV.JOURNAL, sid, sent.getId(), point]); } catch (e) {}

  const out = { ok: true, response_id: sent.getId(), at: new Date().toISOString() };
  if (point) {
    // Pas de question GPS dans le formulaire : le point va dans la colonne dédiée de l'onglet des réponses
    try {
      if (!itvEcrireGps_(sent, point)) out.avertissement = 'Intervention enregistrée. Les coordonnées GPS n’ont pas pu être reportées dans le sheet : elles sont conservées dans le Journal (' + point + ').';
    } catch (e) {
      out.avertissement = 'Intervention enregistrée. Coordonnées GPS non reportées dans le sheet (' + e.message + ') : elles sont conservées dans le Journal (' + point + ').';
    }
  }
  if (key) cache.put(key, JSON.stringify(out), ITV.DEDUP_SEC);
  return out;
}

/**
 * Écrit le point GPS sur la ligne de la réponse : le formulaire alimente l'onglet quelques instants
 * après l'envoi ; on cherche, parmi les dernières lignes, celle dont l'horodatage est celui de la réponse.
 */
function itvEcrireGps_(sent, point) {
  const ss = SpreadsheetApp.openById(ITV.SHEET_ID);
  const sh = itvOngletReponses_(ss);
  if (!sh) return false;
  const t = sent.getTimestamp().getTime();

  const lastCol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let col = head.findIndex(h => cle_(h) === cle_(ITV.GPS_COL)) + 1;
  if (!col) {
    col = lastCol + 1;
    if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
    sh.getRange(1, col).setValue(ITV.GPS_COL);
  }

  for (let essai = 0; essai < 6; essai++) {
    SpreadsheetApp.flush();
    const n = sh.getLastRow();
    if (n >= 2) {
      const from = Math.max(2, n - 29);
      const horo = sh.getRange(from, 1, n - from + 1, 1).getValues();
      for (let i = horo.length - 1; i >= 0; i--) {
        const d = horo[i][0];
        if (d instanceof Date && Math.abs(d.getTime() - t) < 2000) {
          sh.getRange(from + i, col).setValue(point);
          return true;
        }
      }
    }
    Utilities.sleep(1500);
  }
  return false;
}

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

// ============================ Test (éditeur) ============================

function testIntervention() {
  const form = itvFormulaire_();
  const def = lireFormulaireFmpa_(form);
  const lignes = ['Formulaire : ' + def.title + ' (' + form.getId() + ')'];
  def.sections.forEach((sec, i) => {
    lignes.push('— Section ' + i + (sec.title ? ' : ' + sec.title : '') + ' → ' + sec.next);
    sec.items.forEach(it => lignes.push('    [' + it.type + '] ' + it.title + (it.required ? ' *' : '')));
  });
  const q = itvQuestionGps_(def);
  lignes.push(q ? 'GPS : question « ' + q.title + ' »'
    : 'GPS : aucune question GPS dans le formulaire → colonne « ' + ITV.GPS_COL + ' » de l’onglet des réponses');
  const sh = itvOngletReponses_(SpreadsheetApp.openById(ITV.SHEET_ID));
  lignes.push('Onglet des réponses : ' + (sh ? sh.getName() : 'introuvable'));
  Logger.log(lignes.join('\n'));
}
