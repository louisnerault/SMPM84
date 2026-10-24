/**
 * SMPM 84 – Validation des thèmes FMPA par les chefs d'unité
 *
 * À ajouter comme NOUVEAU fichier « Validation.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs, Livret.gs et Fmpa.gs.
 *
 * 1. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'cu_list':      result = cuList_(b.token); break;
 *        case 'cu_decide':    result = cuDecide_(b.token, b.id, b.decision, b.motif); break;
 * 2. Exécuter une fois testValidation() depuis l'éditeur (autorisations Sheets et envoi de mails ;
 *    le journal montre les colonnes du fichier CORE et les demandes en attente).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Circuit existant (inchangé) : l'équipier remplit le formulaire « thèmes FMPA » ; la réponse arrive
 * dans le fichier CORE (onglet « formulaire thèmes »), qui alimente la feuille « validation CU » de chaque
 * chef d'unité et lui envoie un mail. L'application lit directement le CORE et applique le même
 * traitement que le script « SMPM : validation thèmes FMPA et CORE » :
 *   - VALIDER : la ligne du CORE est copiée en tête de l'onglet LOGS du livret de l'agent (ligne 2,
 *     mêmes colonnes, sauf la dernière), l'année de la FMPA est écrite en colonne D, la demande est
 *     marquée « validé » puis retirée du CORE (une copie est gardée dans l'onglet ARCHIVES s'il existe),
 *     et l'agent reçoit un mail ;
 *   - REJETER : la demande est marquée « rejeté », retirée du CORE (copie dans ARCHIVES) et l'agent
 *     reçoit un mail, avec le motif saisi par le chef d'unité s'il y en a un.
 * Les deux circuits peuvent cohabiter : une demande déjà traitée (colonne C remplie) ou déjà retirée
 * du CORE est refusée proprement.
 *
 * Droits :
 *   - l'appréciation de la FMPA par l'agent n'est envoyée qu'au conseiller technique et aux administrateurs,
 *     jamais au chef d'unité destinataire (celui qui a encadré la manœuvre) ;
 *   - chef d'unité et chef de section : les demandes qui leur sont adressées (colonne « Chef d'unité responsable ») ;
 *   - administrateur et conseiller technique : toutes les demandes.
 */

const VALID = {
  CORE_ID: '1Gj-PUuXy-HOTr3cft4O45dwJpgjUe5DpvAmME3aYpwQ',   // fichier CORE
  CORE_SHEET: 'formulaire thèmes',
  ARCHIVE_SHEET: 'ARCHIVES',
  COL_CU: 1, COL_HORO: 2, COL_STATUT: 3, COL_ANNEE: 4,          // colonnes utilisées par le script existant (1 = A)
  MAINTENANCE: false,                                          // true : aucun mail envoyé
  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeo0dvcjm2M6Fh4Jdi2I5ejw-K6nJsRKGzdyu-DlGPHUSNYtw/viewform',
  // En-têtes (comparés avec cle_ : sans accents ni ponctuation)
  H_AGENT: 'Qui êtes-vous?',
  H_DATE: 'Date de la FMPA',
  H_CU: "Chef d'unité responsable",
};

// ============================ Lecture du CORE ============================

function coreTable_() {
  const sh = SpreadsheetApp.openById(VALID.CORE_ID).getSheetByName(VALID.CORE_SHEET);
  if (!sh) throw new Error('Onglet « ' + VALID.CORE_SHEET + ' » introuvable dans le fichier CORE');
  const nr = sh.getLastRow(), nc = sh.getLastColumn();
  const values = nr > 0 ? sh.getRange(1, 1, nr, nc).getValues() : [[]];
  const head = values[0].map(h => String(h).trim());
  const keys = head.map(cle_);
  const c = name => keys.indexOf(cle_(name));
  const cuHead = c(VALID.H_CU);
  return {
    sh, values, head, nc,
    col: {
      cu: cuHead >= 0 ? cuHead : VALID.COL_CU - 1,
      horo: VALID.COL_HORO - 1,
      statut: VALID.COL_STATUT - 1,
      agent: c(VALID.H_AGENT),
      date: c(VALID.H_DATE),
    },
    themes: LIVRET.LOGS_THEMES.map(cle_),
  };
}

/** Demande lisible par l'application ; null si la ligne n'est pas une demande en attente. */
function demande_(t, i, pt, parNom) {
  const r = t.values[i];
  const C = t.col;
  const horo = r[C.horo];
  if (!(horo instanceof Date) || isNaN(horo)) return null;
  if (String(r[C.statut] || '').trim()) return null;            // déjà traitée
  const agent = C.agent >= 0 ? String(r[C.agent] || '').trim() : '';
  const date = C.date >= 0 ? r[C.date] : '';
  const p = parNom[cle_(agent)];

  const themes = [], infos = [];
  const skip = [C.cu, C.horo, C.statut, VALID.COL_ANNEE - 1, C.agent, C.date];
  for (let k = 0; k < t.nc; k++) {
    if (skip.indexOf(k) >= 0) continue;
    const v = r[k];
    if (v === '' || v === null || v === undefined) continue;
    const titre = t.head[k] || '';
    if (t.themes.indexOf(cle_(titre)) >= 0) {
      const items = String(v).split(',').map(s => s.trim()).filter(Boolean);
      if (items.length) themes.push({ titre, items });
    } else if (titre && !/^HORODATEUR|ADRESSE E MAIL$/.test(cle_(titre))) {
      infos.push({ titre, valeur: v instanceof Date ? Utilities.formatDate(v, 'Europe/Paris', 'dd/MM/yyyy') : String(v) });
    }
  }
  return {
    id: String(horo.getTime()) + '_' + cle_(agent).replace(/ /g, '_'),
    horodateur: horo.toISOString(),
    date: date instanceof Date ? Utilities.formatDate(date, 'Europe/Paris', 'yyyy-MM-dd') : String(date || ''),
    agent: agent.toUpperCase(),
    prenom: p ? p.prenom : '',
    secteur: p ? p.secteur : '',
    cu: String(r[C.cu] || '').trim().toUpperCase(),
    themes, infos,
  };
}

/** Nom (clé) -> { ligne, prenom, secteur } d'après la liste du personnel. */
function personnelParNom_(pt) {
  const out = {};
  for (let i = 1; i < pt.values.length; i++) {
    const k = cle_(pt.cell(i, H.NOM));
    if (!k || out[k]) continue;
    out[k] = { ligne: i, prenom: String(pt.cell(i, H.PRENOM) || '').trim(), secteur: cle_(pt.cell(i, H.SECTEUR)) };
  }
  return out;
}

/** Peut-on traiter cette demande ? 'cu' (adressée à l'utilisateur), 'admin' (administrateur, CT) ou ''. */
function droitDemande_(d, prof) {
  if (prof.nom && cle_(d.cu) === prof.nom) return 'cu';
  if (prof.admin || prof.ctd) return 'admin';
  return '';
}

// ============================ API ============================

/** Demandes en attente visibles par l'utilisateur. */
function cuList_(token) {
  const a = fmpaAuth_(token);
  const prof = profilFmpa_(a);
  const t = coreTable_();
  const parNom = personnelParNom_(a.p.pt);
  const out = [];
  for (let i = 1; i < t.values.length; i++) {
    const d = demande_(t, i, a.p.pt, parNom);
    if (!d) continue;
    const par = droitDemande_(d, prof);
    if (!par) continue;
    d.par = par;
    // Appréciation de la FMPA par l'agent : réservée à l'encadrement (conseiller technique, administrateur).
    // Jamais transmise au chef d'unité destinataire de la demande, c'est-à-dire celui qui a encadré la manœuvre.
    if (par === 'cu') d.infos = d.infos.filter(x => !/APPRECIATION/.test(cle_(x.titre)));
    out.push(d);
  }
  out.sort((x, y) => (x.horodateur < y.horodateur ? -1 : 1));   // les plus anciennes d'abord
  return {
    ok: true,
    demandes: out,
    aMoi: out.filter(d => d.par === 'cu').length,
    maj: new Date().toISOString(),
  };
}

/**
 * Valide ou rejette une demande. decision : 'valider' | 'rejeter' ; motif facultatif (rejet).
 */
function cuDecide_(token, id, decision, motif) {
  const a = fmpaAuth_(token);
  const prof = profilFmpa_(a);
  if (decision !== 'valider' && decision !== 'rejeter') throw new Error('Décision inconnue');
  motif = String(motif || '').trim().slice(0, 500);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Serveur occupé, réessayez dans un instant');
  try {
    const t = coreTable_();
    const pt = a.p.pt;
    const parNom = personnelParNom_(pt);

    // Retrouver la ligne au moment de l'action (des lignes ont pu être supprimées entre-temps)
    let i = -1, d = null;
    for (let k = 1; k < t.values.length; k++) {
      const dk = demandeBrute_(t, k);
      if (dk === id) { i = k; break; }
    }
    if (i < 0) throw new Error('Demande introuvable : elle a peut-être déjà été traitée');
    d = demande_(t, i, pt, parNom);
    if (!d) throw new Error('Cette demande a déjà été traitée');
    if (!droitDemande_(d, prof)) throw new Error("Cette demande n'est pas adressée à vous");

    const p = parNom[cle_(d.agent)];
    const mail = p ? String(pt.cell(p.ligne, 'Email') || '').trim() : '';
    const lien = p ? String(pt.cell(p.ligne, 'Lien livret') || '').trim() : '';
    const valideur = String(pt.cell(a.p.row, H.NOM) || '').trim().toUpperCase();
    const dateTxt = d.date ? d.date.split('-').reverse().join('/') : '';
    const ligne = i + 1;
    const row = t.values[i];

    if (decision === 'valider') {
      const idLivret = p ? String(pt.cell(p.ligne, H.ID) || '').trim() : '';
      if (!idLivret) throw new Error('Aucun livret associé à ' + d.agent + ' dans la liste du personnel');
      let logs;
      try { logs = SpreadsheetApp.openById(idLivret).getSheetByName(LIVRET.SHEET_LOGS); }
      catch (e) { throw new Error('Livret de ' + d.agent + ' inaccessible'); }
      if (!logs) throw new Error('Onglet LOGS introuvable dans le livret de ' + d.agent);

      // Comme valide_et_copy() : ligne insérée en tête, colonnes 1 à (dernière - 1), année en colonne D
      const n = Math.max(1, t.nc - 1);
      const copie = row.slice(0, n);
      const dFmpa = t.col.date >= 0 ? row[t.col.date] : null;
      if (n >= VALID.COL_ANNEE && dFmpa instanceof Date) copie[VALID.COL_ANNEE - 1] = Utilities.formatDate(dFmpa, 'Europe/Paris', 'yyyy');
      logs.insertRowAfter(1);
      logs.getRange(2, 1, 1, n).setValues([copie]);
      try { CacheService.getScriptCache().remove('livret2_' + idLivret); } catch (e) {}

      t.sh.getRange(ligne, VALID.COL_STATUT).setValue('validé');
      archiverEtRetirer_(t.sh, ligne, t.nc);
      mailAgent_(mail, 'Validation des thèmes dans votre livret de formation',
        'Bonjour,\n\nLe chef d\'unité ' + valideur + ' a validé les thèmes vus lors de votre FMPA du ' + dateTxt + '.\n\n' +
        (lien ? 'Vous pouvez consulter votre livret individuel en utilisant ce lien : ' + lien + '\n' : '') +
        'Ils apparaissent aussi dans l\'application SMPM 84.');
    } else {
      t.sh.getRange(ligne, VALID.COL_STATUT).setValue('rejeté');
      archiverEtRetirer_(t.sh, ligne, t.nc);
      mailAgent_(mail, 'Thèmes FMPA : Demande rejetée',
        'Bonjour,\n\nLe chef d\'unité ' + valideur + ' a rejeté votre demande de validation des thèmes vus lors de votre FMPA du ' + dateTxt + '.\n\n' +
        (motif ? 'Motif : ' + motif + '\n\n' : '') +
        'Rapprochez-vous du chef d\'unité concerné et renouvelez votre demande via ce lien : ' + VALID.FORM_URL);
    }

    try {
      journalSheet_().appendRow([new Date(), a.id, decision === 'valider' ? 'validation_themes' : 'rejet_themes', id,
        (d.agent + ' – FMPA du ' + dateTxt + (motif ? ' – ' + motif : '')).slice(0, 1000)]);
    } catch (e) {}
    return { ok: true, decision, id };
  } finally {
    lock.releaseLock();
  }
}

/** Identifiant d'une ligne du CORE (sans filtrer sur le statut). */
function demandeBrute_(t, i) {
  const r = t.values[i];
  const horo = r[t.col.horo];
  if (!(horo instanceof Date) || isNaN(horo)) return '';
  const agent = t.col.agent >= 0 ? String(r[t.col.agent] || '').trim() : '';
  return String(horo.getTime()) + '_' + cle_(agent).replace(/ /g, '_');
}

/** Copie la ligne traitée dans ARCHIVES (si l'onglet existe) puis la retire du CORE, comme purge_core(). */
function archiverEtRetirer_(sh, ligne, nc) {
  const arch = sh.getParent().getSheetByName(VALID.ARCHIVE_SHEET);
  if (arch) {
    const data = sh.getRange(ligne, 1, 1, nc).getValues();
    arch.insertRowAfter(1);
    arch.getRange(2, 1, 1, nc).setValues(data);
  }
  sh.deleteRow(ligne);
}

function mailAgent_(mail, sujet, corps) {
  if (VALID.MAINTENANCE || !mail || mail.indexOf('@') < 0) return;
  try { MailApp.sendEmail(mail, sujet, corps, { name: 'SMPM 84' }); } catch (e) { /* le traitement reste fait */ }
}

// ============================ Test ============================

/** À exécuter depuis l'éditeur : colonnes du CORE rapprochées et demandes en attente (aucune écriture). */
function testValidation() {
  const t = coreTable_();
  Logger.log('Colonnes du CORE (' + t.nc + ') :');
  t.head.forEach((h, k) => {
    const role = k === t.col.cu ? '  <- chef d\'unité' : k === t.col.horo ? '  <- horodateur'
      : k === t.col.statut ? '  <- statut' : k === t.col.agent ? '  <- agent' : k === t.col.date ? '  <- date FMPA'
      : t.themes.indexOf(cle_(h)) >= 0 ? '  <- thèmes' : '';
    Logger.log('  ' + String.fromCharCode(65 + (k % 26)) + (k >= 26 ? '+' : '') + ' : ' + h + role);
  });
  if (t.col.agent < 0) Logger.log('ATTENTION : colonne « ' + VALID.H_AGENT + ' » introuvable');
  if (t.col.date < 0) Logger.log('ATTENTION : colonne « ' + VALID.H_DATE + ' » introuvable');
  let n = 0;
  for (let i = 1; i < t.values.length; i++) {
    const r = t.values[i];
    if (!(r[t.col.horo] instanceof Date) || String(r[t.col.statut] || '').trim()) continue;
    n++;
    Logger.log('En attente : ' + r[t.col.agent] + ' -> CU ' + r[t.col.cu] + ' (FMPA du ' + r[t.col.date] + ')');
  }
  Logger.log(n + ' demande(s) en attente');
  MailApp.getRemainingDailyQuota();   // déclenche l'autorisation d'envoi de mails
}
