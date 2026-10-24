/**
 * SMPM 84 – Annuaire des spécialistes (mode intervention › Annuaire des spécialistes)
 *
 * À ajouter comme NOUVEAU fichier « Annuaire.gs » dans le projet Apps Script « Web App SMPM84 ».
 * Il n'utilise que les fonctions communes de Code.gs (auth_, isTrue_, H) et fonctionsSmpm_ de Roles.gs.
 *
 * 1. Dans Code.gs, ajouter dans le switch de doPost() :
 *        case 'annuaire': result = annuaireApi_(b.token); break;
 * 2. Exécuter une fois testAnnuaire() depuis l'éditeur (le journal indique où le numéro de
 *    téléphone a été trouvé et combien de personnes en ont un).
 * 3. Redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Accès : tous les membres connectés. Seul le personnel ACTIF est renvoyé.
 * Contenu par personne : nom, prénom, grade, secteur SMPM, centre d'affectation, qualifications
 * acquises (IMP 1/2/3, NEIGE, ISS, SSH, CAN, SSSM), fonction (CTD, chef de section), téléphone
 * et « push » (true si la personne a activé les notifications : Push.gs, envoi via push_send cible personne:<NOM>).
 *
 * Téléphone : cherché d'abord dans une colonne de la Liste du personnel (Téléphone, Telephone,
 * Tel, Portable, Mobile…), sinon dans l'onglet Comptes (même recherche de colonne), rapproché
 * par e-mail puis par nom.
 */

const ANN = {
  QUALIFS: ['IMP 1', 'IMP 2', 'IMP 3', 'NEIGE', 'ISS', 'SSH', 'CAN', 'SSSM'],
  TEL_COLS: ['telephone', 'téléphone', 'Téléphone', 'Telephone', 'TELEPHONE', 'TÉLÉPHONE', 'Tel', 'TEL', 'Tél', 'tel',
    'Portable', 'PORTABLE', 'portable', 'Mobile', 'mobile', 'MOBILE', 'phone', 'Phone', 'Numéro', 'numero', 'N° téléphone'],
  EMAIL_COLS: ['Email', 'email', 'E-mail', 'e-mail', 'mail', 'EMAIL'],
  NOM_COLS: ['nom', 'Nom', 'NOM', 'AaaaNom'],
};

function annCol_(t, names) {
  if (!t || typeof t.col !== 'function') return null;
  for (let i = 0; i < names.length; i++) if (t.col(names[i]) >= 0) return names[i];
  return null;
}

function annTxt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

/** Numéro lisible et nettoyé : « 0612345678 », « +33612345678 ». */
function annTel_(v) {
  let s = annTxt_(v).replace(/[^\d+]/g, '');
  if (!s) return '';
  if (/^\d{9}$/.test(s) && /^[67]/.test(s)) s = '0' + s;      // zéro perdu par Sheets
  if (/^0033/.test(s)) s = '+' + s.slice(2);
  return s;
}

/** Téléphones de l'onglet Comptes : { email: tel } et { NOM: tel }. */
function annTelsComptes_(acc) {
  const out = { email: {}, nom: {} };
  const ct = acc && acc.ct;
  if (!ct || !ct.values) return out;
  const cTel = annCol_(ct, ANN.TEL_COLS);
  if (!cTel) return out;
  const cMail = annCol_(ct, ANN.EMAIL_COLS), cNom = annCol_(ct, ANN.NOM_COLS);
  for (let i = 1; i < ct.values.length; i++) {
    const tel = annTel_(ct.cell(i, cTel));
    if (!tel) continue;
    if (cMail) { const m = annTxt_(ct.cell(i, cMail)).toLowerCase(); if (m) out.email[m] = tel; }
    if (cNom) { const n = annTxt_(ct.cell(i, cNom)).toUpperCase(); if (n) out.nom[n] = tel; }
  }
  return out;
}

function annuaireListe_(a) {
  const pt = a.p.pt;
  const cTel = annCol_(pt, ANN.TEL_COLS);
  const comptes = annTelsComptes_(a.acc);
  const cMail = annCol_(pt, ANN.EMAIL_COLS);
  let fonctions = [];
  try { fonctions = typeof fonctionsSmpm_ === 'function' ? fonctionsSmpm_() : []; } catch (e) { fonctions = []; }
  const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  // Personnes abonnées aux notifications push (Push.gs) : bouton cloche actif dans l'annuaire
  const abonnes = {};
  try {
    if (typeof pushAbonnes_ === 'function') pushAbonnes_(pushSheet_()).forEach(x => { abonnes[x.nom] = true; });
  } catch (e) { /* push non installé */ }

  const out = [];
  for (let i = 1; i < pt.values.length; i++) {
    const nom = annTxt_(pt.cell(i, H.NOM));
    if (!nom || !isTrue_(pt.cell(i, H.ACTIF))) continue;
    const email = cMail ? annTxt_(pt.cell(i, cMail)).toLowerCase() : '';
    let tel = cTel ? annTel_(pt.cell(i, cTel)) : '';
    if (!tel && email) tel = comptes.email[email] || '';
    if (!tel) tel = comptes.nom[nom.toUpperCase()] || '';

    const qualifs = ANN.QUALIFS.filter(q => pt.col(q) >= 0 && isTrue_(pt.cell(i, q)));
    const k = cle(nom);
    const lignes = fonctions.filter(f => (k && f.nom === k) || (email && f.email && f.email === email));
    const fct = [];
    if (lignes.some(f => f.code === 'CTD')) fct.push('CTD');
    lignes.forEach(f => { if (f.code !== 'CTD' && fct.indexOf('CdS ' + f.code) < 0) fct.push('CdS ' + f.code); });

    out.push({
      nom: nom.toUpperCase(),
      prenom: annTxt_(pt.cell(i, H.PRENOM)),
      grade: pt.col('Grade') >= 0 ? annTxt_(pt.cell(i, 'Grade')) : '',
      secteur: annTxt_(pt.cell(i, H.SECTEUR)).toUpperCase(),
      centre: pt.col('Affectation') >= 0 ? annTxt_(pt.cell(i, 'Affectation')) : '',
      qualifs,
      fonctions: fct,
      tel,
      push: !!abonnes[typeof cle_ === 'function' ? cle_(nom) : k],
    });
  }
  out.sort((x, y) => (x.nom + ' ' + x.prenom).localeCompare(y.nom + ' ' + y.prenom, 'fr'));
  return out;
}

function annuaireApi_(token) {
  const a = auth_(token);
  return { ok: true, personnes: annuaireListe_(a), maj: new Date().toISOString() };
}

/** Test depuis l'éditeur : coller un jeton de session valide (localStorage de l'app) dans JETON. */
function testAnnuaire() {
  const JETON = '';
  if (!JETON) { Logger.log('Renseigner JETON (jeton de session) puis relancer.'); return; }
  const res = annuaireApi_(JETON);
  const avecTel = res.personnes.filter(p => p.tel).length;
  Logger.log(res.personnes.length + ' personnes actives, ' + avecTel + ' avec un numéro de téléphone.');
  Logger.log(JSON.stringify(res.personnes.slice(0, 3)));
}
