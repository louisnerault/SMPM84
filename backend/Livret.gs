/**
 * SMPM 84 – Livret individuel (compteurs d'heures FMPA et récapitulatif des formations)
 *
 * À ajouter comme NOUVEAU fichier « Livret.gs » dans le projet Apps Script « Web App SMPM84 »,
 * à côté de Code.gs (les fichiers d'un projet partagent les mêmes fonctions).
 *
 * Puis, dans Code.gs, ajouter cette ligne dans le switch de doPost() :
 *     case 'livret':       result = livret_(b.token); break;
 * et redéployer : Déployer > Gérer les déploiements > (crayon) > Version : Nouvelle version.
 *
 * Source des données : le Google Sheet du livret individuel (colonne ID_livret de la liste du personnel)
 *   - onglet « HEURES FMPA » : une ligne par FMPA à partir de la ligne 9 (B Date, C Durée, D Position,
 *     E Secteur, F Lieu, G Corde parcourue)
 *   - onglet « LOGS » : réponses au formulaire (thèmes abordés, chef d'unité), rapprochées par date
 *   - onglet « paramètres » : quotas horaires (H2:I9)
 *   - onglet « VALIDATION ANNUELLE » : critères en ligne 8 (C:F) ; pour chaque année, une ligne avec
 *     le nom de l'évaluateur puis une ligne avec l'année en B et la date. Fond VERT = validé,
 *     fond ROUGE = non validé, case vide = non effectué.
 * Les compteurs reprennent exactement les formules du livret :
 *   - SMPM = secteurs CENTRE + NORD + SUD ; quota selon le niveau (IMP3, sinon IMP2, sinon IMP1 hors SSSM) + quota SSSM
 *   - NEIGE, ISS, SSH, CAN : heures du secteur du même nom ; quota si la qualification est acquise
 */

const LIVRET = {
  SHEET_HEURES: 'HEURES FMPA',
  SHEET_LOGS: 'LOGS',
  SHEET_PARAMS: 'paramètres',
  SHEET_VALID: 'VALIDATION ANNUELLE',
  FIRST_ROW: 9,
  CACHE_SEC: 300,           // 5 min : évite de rouvrir le classeur à chaque ouverture de l'app
  SMPM_SECTEURS: ['CENTRE', 'NORD', 'SUD'],
  SPECIALITES: ['NEIGE', 'ISS', 'SSH', 'CAN'],
  QUOTAS_DEFAUT: { 'IMP 1': 70, 'IMP 2': 70, 'IMP 3': 84, NEIGE: 14, ISS: 57, SSH: 8, CAN: 7, SSSM: 21 },
  // En-têtes de LOGS contenant des thèmes (texte « a, b, c »)
  LOGS_THEMES: [
    "Thèmes chefs d'unité", 'Les matériels collectifs', 'Les principes fondamentaux',
    'Progresser au moyen de cordes', 'Mise en oeuvre des techniques ops collectives',
    'Les techniques de secours', 'NEIGE - Thèmes abordés', 'ISS - Thèmes abordés',
    'Thèmes SSH', 'Thèmes CANYON',
  ],
};

function livret_(token) {
  const a = auth_(token);
  const { pt, row } = a.p;
  const id = String(pt.cell(row, H.ID) || '').trim();
  if (!id) throw new Error('Aucun livret associé à votre fiche');

  const cache = CacheService.getScriptCache();
  const key = 'livret2_' + id;
  const hit = cache.get(key);
  let data = hit ? JSON.parse(hit) : null;
  if (!data) {
    data = lireLivret_(id, String(pt.cell(row, H.NOM) || '').trim());
    try { cache.put(key, JSON.stringify(data), LIVRET.CACHE_SEC); } catch (e) { /* trop gros : tant pis */ }
  }

  // Critères requis selon le niveau (comme la mise en forme conditionnelle du livret) :
  // le 1er pour tous, les 2e et 3e à partir d'IMP2, le 4e (commandement) pour IMP3.
  const imp2 = isTrue_(pt.cell(row, 'IMP 2')), imp3 = isTrue_(pt.cell(row, 'IMP 3'));
  const requis = [true, imp2 || imp3, imp2 || imp3, imp3];

  return {
    ok: true,
    livret: {
      formations: data.formations,
      validations: {
        criteres: (data.validations.criteres || []).map((label, i) => ({ label, requis: requis[i] !== false })),
        annees: data.validations.annees,
      },
      quotas: quotasPersonne_(pt, row, data.quotas),
      seances: data.seances || [],
      referentiel: referentielThemes_(),
      maj: new Date().toISOString(),
    },
  };
}

/**
 * Liste complète des thèmes, par catégorie, d'après les cases à cocher du formulaire des thèmes
 * (Themes.gs) : [ { titre, choix: [...] } ] dans l'ordre du formulaire. Les titres sont les en-têtes
 * de LOGS. null si Themes.gs n'est pas installé ou le formulaire inaccessible (la page n'affiche
 * alors que les thèmes déjà vus).
 */
function referentielThemes_() {
  try {
    if (typeof themesDef_ !== 'function') return null;
    const cles = LIVRET.LOGS_THEMES.map(cle_);
    const out = [];
    themesDef_().sections.forEach(s => s.items.forEach(it => {
      if (it.type !== 'checkbox' || cles.indexOf(cle_(it.title)) < 0) return;
      if (out.some(o => cle_(o.titre) === cle_(it.title))) return;
      out.push({ titre: it.title, choix: (it.choices || []).map(c => c.v) });
    }));
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

function lireLivret_(id, nom) {
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('Livret inaccessible'); }

  const tz = 'Europe/Paris';
  const ymd = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');

  // ---- formations (HEURES FMPA) ----
  const sh = ss.getSheetByName(LIVRET.SHEET_HEURES);
  if (!sh) throw new Error('Onglet « HEURES FMPA » introuvable dans le livret');
  const last = sh.getLastRow();
  const rows = last >= LIVRET.FIRST_ROW
    ? sh.getRange(LIVRET.FIRST_ROW, 2, last - LIVRET.FIRST_ROW + 1, 6).getValues()
    : [];
  const formations = [];
  rows.forEach(r => {
    const d = r[0];
    if (!(d instanceof Date) || isNaN(d)) return;
    formations.push({
      date: ymd(d),
      heures: heures_(r[1]),
      position: String(r[2] || '').trim(),
      secteur: String(r[3] || '').trim().toUpperCase(),
      lieu: String(r[4] || '').trim(),
      corde: Number(r[5]) || 0,
      themes: [],
      cu: '',
    });
  });

  // ---- thèmes et chef d'unité (LOGS), rapprochés par date ----
  let seances = [];
  const logs = ss.getSheetByName(LIVRET.SHEET_LOGS);
  if (logs && logs.getLastRow() > 1) {
    const width = Math.min(logs.getLastColumn(), 30);
    const v = logs.getRange(1, 1, logs.getLastRow(), width).getValues();
    const head = v[0].map(h => String(h).trim());
    const col = name => head.indexOf(name);
    const cDate = col('Date de la FMPA'), cNom = col('Qui êtes-vous?'), cCu = col("Chef d'unité responsable");
    const cThemes = LIVRET.LOGS_THEMES.map(col).filter(i => i >= 0);
    const parDate = {};
    for (let i = 1; i < v.length; i++) {
      const d = cDate >= 0 ? v[i][cDate] : null;
      if (!(d instanceof Date)) continue;
      if (nom && cNom >= 0 && String(v[i][cNom]).trim().toUpperCase() !== nom.toUpperCase()) continue;
      const k = ymd(d);
      const e = parDate[k] || (parDate[k] = { themes: [], cu: '', cats: {} });
      cThemes.forEach(c => String(v[i][c] || '').split(',').forEach(t => {
        t = t.trim();
        if (!t) return;
        if (e.themes.indexOf(t) < 0) e.themes.push(t);
        const cat = e.cats[head[c]] || (e.cats[head[c]] = []);      // thèmes rangés par catégorie (en-tête LOGS)
        if (cat.indexOf(t) < 0) cat.push(t);
      }));
      if (!e.cu && cCu >= 0) e.cu = String(v[i][cCu] || '').trim();
    }
    // Séances de LOGS (Mon livret › Thèmes vus) : une par date, thèmes par catégorie
    seances = Object.keys(parDate).sort().reverse()
      .filter(k => Object.keys(parDate[k].cats).length)
      .map(k => ({ date: k, cu: parDate[k].cu, cats: parDate[k].cats }));
    formations.forEach(f => {
      const e = parDate[f.date];
      if (e) { f.themes = e.themes; f.cu = e.cu; }
    });
  }

  formations.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));

  // ---- quotas (paramètres H:I) ----
  const quotas = Object.assign({}, LIVRET.QUOTAS_DEFAUT);
  const ps = ss.getSheetByName(LIVRET.SHEET_PARAMS);
  if (ps) {
    ps.getRange('H1:I15').getValues().forEach(r => {
      const k = String(r[0] || '').trim().toUpperCase();
      const n = Number(r[1]);
      if (k in quotas && n > 0) quotas[k] = n;
    });
  }
  return { formations, quotas, seances, validations: lireValidations_(ss, ymd) };
}

/**
 * Lit « VALIDATION ANNUELLE ».
 * Renvoie { criteres: [libellés], annees: { '2026': [ { statut, evaluateur, date } x 4 ] } }
 * statut : 'valide' (fond vert), 'non_valide' (fond rouge) ; un critère sans nom ni date est absent (null).
 */
function lireValidations_(ss, ymd) {
  const out = { criteres: [], annees: {} };
  const sh = ss.getSheetByName(LIVRET.SHEET_VALID);
  if (!sh || sh.getLastRow() < 8) return out;
  const n = sh.getLastRow();
  const rng = sh.getRange(1, 1, n, 6);           // A:F
  const v = rng.getValues();
  const bg = rng.getBackgrounds();

  out.criteres = v[7].slice(2, 6).map(s => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!out.criteres.length) return out;

  for (let i = 8; i < n; i++) {                   // la ligne « année » suit la ligne « nom »
    const y = Number(v[i][1]);
    if (!(y > 1900 && y < 3000)) continue;
    const names = v[i - 1], dates = v[i];
    out.annees[String(y)] = out.criteres.map((_, k) => {
      const c = k + 2;
      const nom = String(names[c] || '').trim();
      const d = dates[c];
      const date = d instanceof Date && !isNaN(d) ? ymd(d) : '';
      if (!nom && !date) return null;
      const couleur = couleur_(bg[i - 1][c]) || couleur_(bg[i][c]);
      return { statut: couleur === 'rouge' ? 'non_valide' : 'valide', evaluateur: nom, date };
    });
  }
  return out;
}

/** '#rrggbb' -> 'vert' | 'rouge' | null (blanc, gris, autre). */
function couleur_(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return null;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  if (r > g + 50 && r > b + 50) return 'rouge';
  if (g > r + 40 && g > b + 40) return 'vert';
  return null;
}

/** Durée → heures décimales (nombre, ou durée Sheets renvoyée comme Date à partir du 30/12/1899). */
function heures_(v) {
  if (v instanceof Date) {
    const ms = v.getTime() - new Date(1899, 11, 30).getTime();
    return Math.round(ms / 36e5 * 100) / 100;
  }
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * Quotas applicables à la personne (d'après la liste du personnel), comme dans « paramètres » du livret.
 * Renvoie { SMPM: { quota }, NEIGE: { quota, depuis }, ... } : seules les spécialités acquises y figurent.
 */
function quotasPersonne_(pt, row, q) {
  const has = code => isTrue_(pt.cell(row, code));
  const year = col => { const y = Number(pt.cell(row, col)); return y > 1900 ? y : null; };
  const sssm = has('SSSM'), imp2 = has('IMP 2'), imp3 = has('IMP 3');

  let smpm = 0;
  if (imp3) smpm += q['IMP 3'];
  else if (imp2) smpm += q['IMP 2'];
  else if (!sssm) smpm += q['IMP 1'];
  if (sssm) smpm += q.SSSM;

  const out = { SMPM: { quota: smpm } };
  const dates = { NEIGE: 'Date_neige', ISS: 'Date_ISS', SSH: 'Date_SSH', CAN: 'Date_CAN' };
  LIVRET.SPECIALITES.forEach(s => {
    if (has(s)) out[s] = { quota: q[s] || 0, depuis: year(dates[s]) };
  });
  return out;
}
