/**
 * Fonctions SMPM (hiérarchie) : lues dans l'onglet « CT et CdS » de la Liste du personnel.
 *
 * Hiérarchie, du plus haut au plus bas :
 *   CTD (conseiller technique départemental) > chef de section (NORD, SUD, CENTRE, NEIGE, ISS, SSSM)
 *   > chef d'unité (IMP3) > équipier.
 *
 * Onglet « CT et CdS » : A = nom, B = fonction (libellé), C = e-mail, F = code
 *   (CTD, NORD, SUD, CENTRE, NEIGE, ISS, SSSM). Une personne peut avoir plusieurs lignes :
 *   elle est affichée avec sa plus haute fonction et garde les droits de chacune
 *   (ex. CTD et chef de section ISS).
 *
 * Encadrer une FMPA (la déclarer) demande la qualification IMP 3, quelle que soit la fonction.
 *
 * Administration : case « is_admin » de l'onglet Comptes (ou ancien rôle forcé « admin »).
 * Elle donne tous les droits mais n'est jamais affichée : l'application montre la vraie fonction.
 *
 * Installation : ce fichier REMPLACE la fonction deriveRole_ de Code.gs (la supprimer de Code.gs),
 * puis ajouter dans doPost() :  case 'fonction': result = fonctionApi_(b.token); break;
 */

const FCT = {
  SHEET_ID: '1aKr_sX1OmAtmHA95Fl0CT8AGnlEsB37cdrZ-LIgJ8ew',  // Liste du personnel
  TAB: 'CT et CdS',
  CACHE_KEY: 'fct_v1',
  CACHE_SEC: 600,
  SECTIONS: ['NORD', 'SUD', 'CENTRE', 'NEIGE', 'ISS', 'SSSM'],
  NOMS: { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSSM: 'SSSM' },
};

function fctCle_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Lignes de l'onglet « CT et CdS » : [{ nom, libelle, email, code }], en cache 10 min. */
function fonctionsSmpm_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(FCT.CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const sh = SpreadsheetApp.openById(FCT.SHEET_ID).getSheetByName(FCT.TAB);
  const out = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(r => {
      const nom = fctCle_(r[0]), code = fctCle_(r[5]);
      if (!nom || !code) return;
      out.push({ nom, libelle: String(r[1] || '').trim(), email: String(r[2] || '').trim().toLowerCase(), code });
    });
  }
  try { cache.put(FCT.CACHE_KEY, JSON.stringify(out), FCT.CACHE_SEC); } catch (e) { /* ignoré */ }
  return out;
}

/** Fonctions d'une personne de la liste : { ctd, sections: ['ISS', …] }. Rapprochement par nom, sinon e-mail. */
function fonctionDe_(pt, row) {
  const nom = fctCle_(pt.cell(row, H.NOM));
  const email = pt.col('Email') >= 0 ? String(pt.cell(row, 'Email') || '').trim().toLowerCase() : '';
  const lignes = fonctionsSmpm_().filter(f => (nom && f.nom === nom) || (email && f.email && f.email === email));
  const sections = [];
  lignes.forEach(f => { if (f.code !== 'CTD' && sections.indexOf(f.code) < 0) sections.push(f.code); });
  return { ctd: lignes.some(f => f.code === 'CTD'), sections };
}

function roleForce_(acc) {
  if (!acc || acc.ct.col('role') < 0) return '';
  return String(acc.ct.cell(acc.row, 'role') || '').trim();
}

/** Administrateur : case is_admin (ou ancien rôle forcé « admin »). Jamais affiché. */
function isAdminSmpm_(acc) {
  if (!acc) return false;
  if (acc.ct.col('is_admin') >= 0 && isTrue_(acc.ct.cell(acc.row, 'is_admin'))) return true;
  return roleForce_(acc) === 'admin';
}

/** Qualification IMP 3 : nécessaire pour encadrer (déclarer) une FMPA. */
function encadreFmpa_(pt, row) {
  return isTrue_(pt.cell(row, 'IMP 3'));
}

/**
 * Rôle affiché et utilisé pour les droits : la plus haute fonction réelle.
 * Un rôle forcé dans Comptes (autre que « admin ») reste prioritaire.
 */
function deriveRole_(pt, row, acc) {
  const forced = roleForce_(acc);
  if (forced && forced !== 'admin') return forced;
  const f = fonctionDe_(pt, row);
  if (f.ctd) return 'ctd';
  if (f.sections.length) return 'chef_section';
  return encadreFmpa_(pt, row) ? 'chef_unite' : 'equipier';
}

/** Chefs de section par code de section (N+1) : { ISS: ['Jonathan BRES'], … }. */
function chefsParSection_(pt) {
  const noms = {};
  for (let i = 1; i < pt.values.length; i++) {
    const k = fctCle_(pt.cell(i, H.NOM));
    if (k && !noms[k]) noms[k] = (String(pt.cell(i, H.PRENOM) || '').trim() + ' ' + String(pt.cell(i, H.NOM) || '').trim()).trim();
  }
  const out = {};
  fonctionsSmpm_().forEach(f => {
    if (f.code === 'CTD') return;
    const n = noms[f.nom] || f.nom;
    (out[f.code] = out[f.code] || []);
    if (out[f.code].indexOf(n) < 0) out[f.code].push(n);
  });
  return out;
}

/** Action « fonction » : libellé affiché sous le nom, sections dirigées, droit d'encadrer une FMPA. */
function fonctionApi_(token) {
  const a = auth_(token);
  const { pt, row } = a.p;
  const role = deriveRole_(pt, row, a.acc);
  const f = fonctionDe_(pt, row);
  const sec = f.sections.map(s => FCT.NOMS[s] || s);
  let libelle;
  if (role === 'ctd') libelle = 'Conseiller technique départemental';
  else if (role === 'chef_section') libelle = 'Chef de section ' + sec.join(' / ');
  else if (role === 'chef_unite') libelle = "Chef d'unité";
  else libelle = '';                         // équipier : libellé calculé par l'application (SSSM ou non)
  return { ok: true, role, libelle, sections: f.sections, imp3: encadreFmpa_(pt, row) };
}

/** À exécuter dans l'éditeur : affiche l'onglet lu et la fonction calculée pour chacun. */
function testFonctions() {
  CacheService.getScriptCache().remove(FCT.CACHE_KEY);
  Logger.log(JSON.stringify(fonctionsSmpm_(), null, 1));
  const sh = SpreadsheetApp.openById(FCT.SHEET_ID).getSheetByName('Personnel');
  if (!sh) return;
  const v = sh.getDataRange().getValues();
  const keys = v[0].map(String);
  const pt = { values: v, col: n => keys.indexOf(n), cell: (i, n) => v[i][keys.indexOf(n)] };
  fonctionsSmpm_().forEach(f => {
    for (let i = 1; i < v.length; i++) {
      if (fctCle_(pt.cell(i, H.NOM)) !== f.nom) continue;
      Logger.log(f.nom + ' -> ' + deriveRole_(pt, i, null) + ' ' + JSON.stringify(fonctionDe_(pt, i)));
    }
  });
}
