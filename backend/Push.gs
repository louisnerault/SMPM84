/**
 * SMPM 84 – Notifications push (Firebase Cloud Messaging, API HTTP v1)
 *
 * À ajouter comme NOUVEAU fichier « Push.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs, Fmpa.gs, Validation.gs…
 *
 * Installation (une fois) :
 * 1. Firebase : créer un projet sur https://console.firebase.google.com (Google Analytics inutile),
 *    puis dans Paramètres du projet :
 *      - Général > Vos applications > ajouter une application Web : recopier apiKey, authDomain,
 *        projectId, messagingSenderId et appId dans config.js (FIREBASE) de l'application ;
 *      - Cloud Messaging > Certificats Web Push > Générer une paire de clés : recopier la clé publique
 *        dans config.js (FIREBASE.vapidKey) ;
 *      - Comptes de service > Générer une nouvelle clé privée : un fichier .json est téléchargé.
 * 2. Apps Script : Paramètres du projet > Propriétés du script > ajouter la propriété
 *      FCM_SERVICE_ACCOUNT  =  tout le contenu du fichier .json (ne jamais le mettre dans le dépôt GitHub).
 *    Puis supprimer le fichier .json de l'ordinateur.
 * 3. Dans Code.gs, ajouter ces lignes dans le switch de doPost() :
 *        case 'push_register':   result = pushRegister_(b.token, b.fcm, b.appareil, b.ancien); break;
 *        case 'push_unregister': result = pushUnregister_(b.token, b.fcm); break;
 *        case 'push_test':       result = pushTest_(b.token); break;
 *        case 'push_send':       result = pushSend_(b.token, b.titre, b.message, b.cible); break;
 * 4. Exécuter une fois installerPush() depuis l'éditeur : crée le classeur des abonnements
 *    (« SMPM 84 – Abonnements push », dans le Drive du propriétaire du script), vérifie la clé Firebase
 *    et installe le déclencheur qui signale les nouvelles demandes de validation toutes les 5 minutes.
 * 5. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Messages envoyés :
 *   - nouvelle demande de validation des thèmes -> chef d'unité destinataire (déclencheur, 5 min) ;
 *   - demande validée ou rejetée -> équipier concerné (Validation.gs, cuDecide_) ;
 *   - message libre : administrateur et conseiller technique -> tous, encadrement ou une section ;
 *     chef de section -> sa section.
 * Les personnes sont identifiées par leur NOM (clé cle_), comme dans le reste du serveur.
 * Un jeton refusé par Firebase (appareil désabonné, application supprimée) est retiré automatiquement.
 */

const PUSH = {
  PROP_SHEET: 'PUSH_SHEET_ID',               // propriété du script : classeur des abonnements
  PROP_SA: 'FCM_SERVICE_ACCOUNT',            // propriété du script : clé JSON du compte de service
  PROP_VUS: 'PUSH_DEMANDES_VUES',            // propriété du script : demandes déjà signalées
  TAB: 'Abonnements',
  HEAD: ['jeton', 'nom', 'prenom', 'role', 'secteur', 'sections', 'appareil', 'cree', 'vu'],
  TTL: 86400,                                // un message non distribué est abandonné après 24 h
  MAX_PAR_PERSONNE: 5,                       // appareils gardés par personne (les plus récents)
  SECTIONS: ['NORD', 'SUD', 'CENTRE', 'NEIGE', 'ISS', 'SSSM'],
};

// ============================ Abonnements ============================

function pushSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PUSH.PROP_SHEET);
  if (!id) throw new Error('Notifications push non installées (exécuter installerPush)');
  const sh = SpreadsheetApp.openById(id).getSheetByName(PUSH.TAB);
  if (!sh) throw new Error('Onglet « ' + PUSH.TAB + ' » introuvable dans le classeur des abonnements');
  return sh;
}

/** Abonnements : [{ ligne, jeton, nom, role, secteur, sections: [] }]. */
function pushAbonnes_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, PUSH.HEAD.length).getValues().map((r, k) => ({
    ligne: k + 2,
    jeton: String(r[0] || ''),
    nom: String(r[1] || ''),
    prenom: String(r[2] || ''),
    role: String(r[3] || ''),
    secteur: String(r[4] || ''),
    sections: String(r[5] || '').split(',').filter(Boolean),
    vu: r[8] instanceof Date ? r[8].getTime() : 0,
  })).filter(x => x.jeton);
}

function pushProfil_(a) {
  const prof = profilFmpa_(a);                                  // Fmpa.gs : nom (clé), rôle, sections dirigées
  return {
    nom: prof.nom,
    prenom: String(a.p.pt.cell(a.p.row, H.PRENOM) || '').trim(),
    role: prof.admin ? 'admin' : prof.role,
    admin: prof.admin,
    secteur: cle_(a.p.pt.cell(a.p.row, H.SECTEUR)),
    sections: prof.sections,
  };
}

/** Enregistre (ou met à jour) le jeton FCM de l'appareil. Tous les membres. */
function pushRegister_(token, fcm, appareil, ancien) {
  const a = auth_(token);
  fcm = String(fcm || '').trim();
  if (!/^[\w:\-]{20,400}$/.test(fcm)) throw new Error('Abonnement invalide');
  const p = pushProfil_(a);
  if (!p.nom) throw new Error('Profil introuvable');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Serveur occupé, réessayez dans un instant');
  try {
    const sh = pushSheet_();
    const subs = pushAbonnes_(sh);
    const now = new Date();
    const ligne = [fcm, p.nom, p.prenom, p.role, p.secteur, p.sections.join(','), String(appareil || '').slice(0, 20)];
    // jeton déjà connu (éventuellement sous un autre nom : appareil partagé) -> mis à jour ; ancien jeton retiré
    const supprimer = subs.filter(x => (ancien && x.jeton === ancien)).map(x => x.ligne);
    const existant = subs.find(x => x.jeton === fcm);
    if (existant) {
      sh.getRange(existant.ligne, 1, 1, ligne.length).setValues([ligne]);
      sh.getRange(existant.ligne, 9).setValue(now);
    } else {
      sh.appendRow(ligne.concat([now, now]));
    }
    // au-delà de MAX_PAR_PERSONNE appareils, les moins récemment vus sont retirés
    const miens = subs.filter(x => x.nom === p.nom && x.jeton !== fcm && supprimer.indexOf(x.ligne) < 0)
      .sort((x, y) => y.vu - x.vu);
    miens.slice(PUSH.MAX_PAR_PERSONNE - 1).forEach(x => supprimer.push(x.ligne));
    pushSupprimerLignes_(sh, supprimer);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Désabonne un appareil (bouton « Désactiver » ou déconnexion). */
function pushUnregister_(token, fcm) {
  auth_(token);
  fcm = String(fcm || '').trim();
  if (!fcm) return { ok: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Serveur occupé, réessayez dans un instant');
  try {
    const sh = pushSheet_();
    pushSupprimerLignes_(sh, pushAbonnes_(sh).filter(x => x.jeton === fcm).map(x => x.ligne));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function pushSupprimerLignes_(sh, lignes) {
  lignes.filter((l, i, t) => t.indexOf(l) === i).sort((x, y) => y - x).forEach(l => sh.deleteRow(l));
}

// ============================ Envoi ============================

/** Jeton d'accès OAuth du compte de service (JWT RS256), en cache 50 min. */
function fcmAuth_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PUSH.PROP_SA);
  if (!raw) throw new Error('Clé Firebase absente (propriété du script ' + PUSH.PROP_SA + ')');
  const sa = JSON.parse(raw);
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_at');
  if (hit) return { at: hit, projet: sa.project_id };
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const entete = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corps = b64(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const sig = b64(Utilities.computeRsaSha256Signature(entete + '.' + corps, sa.private_key));
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: entete + '.' + corps + '.' + sig },
    muteHttpExceptions: true,
  });
  const j = JSON.parse(res.getContentText() || '{}');
  if (!j.access_token) throw new Error('Connexion à Firebase refusée : ' + (j.error_description || j.error || res.getResponseCode()));
  try { cache.put('fcm_at', j.access_token, 3000); } catch (e) { /* ignoré */ }
  return { at: j.access_token, projet: sa.project_id };
}

/**
 * Envoie un message à une liste d'abonnements. msg : { titre, corps, page, tag }.
 * Retourne le nombre d'appareils atteints ; retire les jetons refusés par Firebase.
 */
function pushEnvoyer_(subs, msg) {
  if (!subs.length) return 0;
  const auth = fcmAuth_();
  const url = 'https://fcm.googleapis.com/v1/projects/' + auth.projet + '/messages:send';
  const data = {
    title: String(msg.titre || 'SMPM 84').slice(0, 80),
    body: String(msg.corps || '').slice(0, 400),
    page: String(msg.page || ''),
    tag: String(msg.tag || ''),
  };
  const reqs = subs.map(s => ({
    url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + auth.at },
    payload: JSON.stringify({ message: {
      token: s.jeton,
      webpush: { headers: { Urgency: 'high', TTL: String(PUSH.TTL) }, data },
    } }),
  }));
  let ok = 0;
  const morts = [];
  // par paquets de 50 (limite raisonnable de UrlFetchApp.fetchAll)
  for (let i = 0; i < reqs.length; i += 50) {
    UrlFetchApp.fetchAll(reqs.slice(i, i + 50)).forEach((res, k) => {
      const code = res.getResponseCode();
      if (code === 200) { ok++; return; }
      const t = res.getContentText() || '';
      if (code === 404 || /UNREGISTERED/.test(t) || (code === 400 && /registration token/i.test(t))) morts.push(subs[i + k].jeton);
      else console.warn('FCM ' + code + ' : ' + t.slice(0, 300));
    });
  }
  if (morts.length) {
    try {
      const sh = pushSheet_();
      pushSupprimerLignes_(sh, pushAbonnes_(sh).filter(x => morts.indexOf(x.jeton) >= 0).map(x => x.ligne));
    } catch (e) { /* nettoyage au prochain envoi */ }
  }
  return ok;
}

/** Envoie à des personnes désignées par leur nom (clé cle_ ou nom en clair). Sans erreur si push non installé. */
function pushA_(noms, msg) {
  try {
    const cles = [].concat(noms).map(cle_).filter(Boolean);
    if (!cles.length || !PropertiesService.getScriptProperties().getProperty(PUSH.PROP_SA)) return 0;
    const subs = pushAbonnes_(pushSheet_()).filter(s => cles.indexOf(s.nom) >= 0);
    return pushEnvoyer_(subs, msg);
  } catch (e) {
    console.warn('Notification push non envoyée : ' + e.message);
    return 0;
  }
}

// ============================ API ============================

/** Notification de test vers les appareils de l'utilisateur. */
function pushTest_(token) {
  const a = auth_(token);
  const p = pushProfil_(a);
  const subs = pushAbonnes_(pushSheet_()).filter(s => s.nom === p.nom);
  const envoyes = pushEnvoyer_(subs, {
    titre: 'SMPM 84',
    corps: 'Notifications activées : vous serez prévenu ici des demandes et des messages du SMPM 84.',
    tag: 'smpm-test',
  });
  return { ok: true, envoyes };
}

/**
 * Message libre. cible : 'tous' | 'encadrement' | 'section:<CODE>'.
 * Administrateur et conseiller technique : toutes les cibles ; chef de section : sa ou ses sections.
 */
function pushSend_(token, titre, message, cible) {
  const a = auth_(token);
  const p = pushProfil_(a);
  const tout = p.admin || p.role === 'ctd';
  titre = String(titre || '').trim().slice(0, 60);
  message = String(message || '').trim().slice(0, 300);
  cible = String(cible || '');
  if (!titre || !message) throw new Error('Titre et message obligatoires');
  if (!tout && !p.sections.length) throw new Error("Envoi réservé à l'encadrement (chef de section, conseiller technique, administrateur)");

  let filtre;
  if (cible === 'tous' && tout) filtre = () => true;
  else if (cible === 'encadrement' && tout) filtre = s => ['chef_unite', 'chef_section', 'ctd', 'admin'].indexOf(s.role) >= 0;
  else if (/^section:/.test(cible)) {
    const sec = cle_(cible.slice(8));
    if (PUSH.SECTIONS.indexOf(sec) < 0) throw new Error('Section inconnue');
    if (!tout && p.sections.indexOf(sec) < 0) throw new Error("Vous ne pouvez écrire qu'à votre section");
    filtre = s => s.secteur === sec || s.sections.indexOf(sec) >= 0;
  } else throw new Error('Destinataires non autorisés');

  const subs = pushAbonnes_(pushSheet_()).filter(filtre);
  const personnes = subs.map(s => s.nom).filter((n, i, t) => t.indexOf(n) === i).length;
  const signature = [p.prenom, String(a.p.pt.cell(a.p.row, H.NOM) || '').trim().toUpperCase()].filter(Boolean).join(' ');
  const envoyes = pushEnvoyer_(subs, { titre, corps: message + (signature ? '\n— ' + signature : '') });
  try {
    journalSheet_().appendRow([new Date(), a.id, 'notification_push', cible,
      (titre + ' – ' + message).slice(0, 1000) + ' (' + personnes + ' pers., ' + envoyes + ' app.)']);
  } catch (e) {}
  return { ok: true, personnes, envoyes };
}

// ============================ Nouvelles demandes de validation ============================

/**
 * Déclencheur (toutes les 5 min, installé par installerPush) : signale au chef d'unité destinataire
 * chaque nouvelle demande de validation des thèmes arrivée dans le fichier CORE.
 */
function pushNouvellesDemandes() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PUSH.PROP_SA) || !props.getProperty(PUSH.PROP_SHEET)) return;
  const t = coreTable_();                                       // Validation.gs
  const enAttente = [];
  for (let i = 1; i < t.values.length; i++) {
    const d = demande_(t, i, null, {});
    if (d) enAttente.push(d);
  }
  const vuesRaw = props.getProperty(PUSH.PROP_VUS);
  const vues = vuesRaw ? JSON.parse(vuesRaw) : null;
  props.setProperty(PUSH.PROP_VUS, JSON.stringify(enAttente.map(d => d.id)));
  if (!vues) return;                                            // première exécution : rien n'est « nouveau »

  const nouvelles = enAttente.filter(d => vues.indexOf(d.id) < 0 && d.cu);
  if (!nouvelles.length) return;
  // Regroupées par chef d'unité : un seul message s'il en arrive plusieurs
  const parCu = {};
  nouvelles.forEach(d => { (parCu[cle_(d.cu)] = parCu[cle_(d.cu)] || []).push(d); });
  Object.keys(parCu).forEach(cu => {
    const l = parCu[cu];
    const total = enAttente.filter(d => cle_(d.cu) === cu).length;
    const d = l[0];
    const date = d.date ? ' (FMPA du ' + d.date.split('-').reverse().join('/') + ')' : '';
    pushA_([cu], {
      titre: 'Validation des livrets',
      corps: l.length > 1
        ? l.length + ' nouvelles demandes de validation de thèmes (' + total + ' en attente).'
        : d.agent + ' demande la validation de ses thèmes' + date + '.',
      page: 'fmpa-valid',
      tag: 'smpm-cu-validation',
    });
  });
}

// ============================ Installation et test ============================

/** À exécuter une fois depuis l'éditeur. Sans risque si on le relance. */
function installerPush() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PUSH.PROP_SHEET);
  if (!id) {
    const ss = SpreadsheetApp.create('SMPM 84 – Abonnements push');
    const sh = ss.getSheets()[0].setName(PUSH.TAB);
    sh.getRange(1, 1, 1, PUSH.HEAD.length).setValues([PUSH.HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    id = ss.getId();
    props.setProperty(PUSH.PROP_SHEET, id);
    Logger.log('Classeur des abonnements créé : ' + ss.getUrl());
  } else {
    Logger.log('Classeur des abonnements : https://docs.google.com/spreadsheets/d/' + id);
  }
  const auth = fcmAuth_();
  Logger.log('Connexion à Firebase réussie (projet ' + auth.projet + ').');

  ScriptApp.getProjectTriggers()
    .filter(tr => tr.getHandlerFunction() === 'pushNouvellesDemandes')
    .forEach(tr => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('pushNouvellesDemandes').timeBased().everyMinutes(5).create();
  pushNouvellesDemandes();                                      // mémorise les demandes déjà en attente
  Logger.log('Déclencheur installé : nouvelles demandes de validation signalées toutes les 5 minutes.');
}

/** À exécuter depuis l'éditeur : abonnements enregistrés (aucun envoi). */
function testPush() {
  const subs = pushAbonnes_(pushSheet_());
  Logger.log(subs.length + ' appareil(s) abonné(s) :');
  subs.forEach(s => Logger.log(' - ' + s.nom + ' (' + s.role + ', ' + s.secteur + ')'));
}
