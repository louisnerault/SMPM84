// Itinéraire sur la carte des points d'intérêt (poi.js) : tracé, étapes, profil altimétrique et suivi GPS.
// - Calcul : service d'itinéraire de la Géoplateforme IGN (moteur OSRM sur la BD TOPO), en voiture ou à pied, sans clé.
// - Profil : altitudes du terrain RGE ALTI (service altimétrique de la Géoplateforme), relevées le long du tracé.
// - Recherche : points d'intérêt de l'application, coordonnées, adresses et lieux-dits (autocomplétion Géoplateforme).
// Le réseau n'est nécessaire que pour calculer : l'itinéraire et son profil sont gardés sur l'appareil
// (localStorage) et le suivi GPS continue hors couverture.
// Aucune donnée n'est envoyée au back-end de l'application.
(() => {
  'use strict';

  const URL_ITIN = 'https://data.geopf.fr/navigation/itineraire';
  const URL_ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
  const URL_ADR = 'https://data.geopf.fr/geocodage/completion';
  const KEY = 'smpm_itin';                   // dernier itinéraire calculé (repris sans réseau)
  const KEY_MODE = 'smpm_itin_mode';
  const GARDE_H = 48;                        // durée pendant laquelle le dernier itinéraire est proposé
  const PAQUET = 120;                        // points par requête d'altitude (adresse courte, méthode GET)
  const MODES = [
    { id: 'car', nom: 'Véhicule', seuils: [8, 15] },
    { id: 'pedestrian', nom: 'À pied', seuils: [15, 30] },
  ];
  const COUL = ['#2e9e5b', '#f08c00', '#d9304f'];           // pente faible, moyenne, forte
  const VOIES = {
    route: { nom: 'Route', coul: '#1a6fd6' },
    piste: { nom: 'Chemin ou piste', coul: '#c2620a' },
    sentier: { nom: 'Sentier', coul: '#8a3fc4' },
    bac: { nom: 'Bac', coul: '#0b8fa3' },
  };

  const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtDist = m => m < 1000 ? `${m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10} m` : `${nf1.format(m / 1000)} km`;
  function fmtDuree(s) {
    const min = Math.max(1, Math.round(s / 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }
  const mode = id => MODES.find(m => m.id === id) || MODES[0];

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    return n;
  }

  // remplace le contenu d'un élément (enfants absents ignorés : replaceChildren écrirait « null »)
  const remplir = (n, ...enfants) => n.replaceChildren(...enfants.flat().filter(c => c !== null && c !== undefined && c !== false));

  // ---------- géométrie ----------
  const RAD = Math.PI / 180;
  function metres(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // distances cumulées (m) le long d'une ligne [[lat, lng], …]
  function cumul(coords) {
    const c = [0];
    for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + metres(coords[i - 1], coords[i]));
    return c;
  }
  // point situé à la distance d (m) du départ
  function pointA(coords, cum, d) {
    if (d <= 0) return coords[0];
    const fin = cum[cum.length - 1];
    if (d >= fin) return coords[coords.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
  }
  // Position projetée sur le tracé : distance parcourue d (m) et écart au tracé (m).
  // « vers » = distance déjà parcourue : à écart comparable, on garde le passage le plus proche de la progression
  // (aller-retour sur la même route, lacets).
  function projeter(coords, cum, ll, vers) {
    const k = Math.cos(ll[0] * RAD) * 111320, ky = 110540;
    let best = null, pres = null;
    for (let i = 1; i < coords.length; i++) {
      const ax = (coords[i - 1][1] - ll[1]) * k, ay = (coords[i - 1][0] - ll[0]) * ky;
      const bx = (coords[i][1] - ll[1]) * k, by = (coords[i][0] - ll[0]) * ky;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const ecart = Math.hypot(ax + dx * t, ay + dy * t);
      const d = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
      if (!best || ecart < best.ecart) best = { d, ecart };
      if (vers !== undefined && d >= vers - 150 && d <= vers + 2000 && (!pres || ecart < pres.ecart)) pres = { d, ecart };
    }
    return pres && pres.ecart <= best.ecart + 25 ? pres : best;
  }
  // polyligne encodée (précision 5) : secours si le service ne renvoie pas du GeoJSON
  function decoderPolyligne(str) {
    const out = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const axe of [0, 1]) {
        let res = 0, shift = 0, b;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
        const delta = (res & 1) ? ~(res >> 1) : (res >> 1);
        if (axe === 0) lat += delta; else lng += delta;
      }
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  }
  function lireGeom(g) {
    if (!g) return [];
    if (typeof g === 'string') return decoderPolyligne(g);
    const c = g.coordinates || (g.geometry && g.geometry.coordinates) || [];
    return c.filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [Number(p[1]), Number(p[0])]);
  }

  // ---------- réseau ----------
  class ErreurService extends Error {
    constructor(msg, http) { super(msg); this.http = http || 0; }
  }
  async function getJSON(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 25000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok) throw new ErreurService((j && j.error && (j.error.description || j.error.message)) || `HTTP ${res.status}`, res.status);
      if (!j) throw new ErreurService('Réponse illisible', res.status);
      return j;
    } catch (e) {
      if (e instanceof ErreurService) throw e;
      throw new ErreurService(e && e.name === 'AbortError' ? 'délai dépassé' : 'réseau', 0);
    } finally { clearTimeout(timer); }
  }

  // ---------- lecture de la réponse du service d'itinéraire ----------
  const SENS = {
    left: 'à gauche', right: 'à droite', 'slight left': 'légèrement à gauche', 'slight right': 'légèrement à droite',
    'sharp left': 'franchement à gauche', 'sharp right': 'franchement à droite', straight: 'tout droit', uturn: 'demi-tour',
  };
  const ANGLE = { straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180, 'sharp left': -135, left: -90, 'slight left': -45 };
  function nomVoie(a) {
    const n = a && a.name;
    if (typeof n === 'string') return n.trim();
    if (!n || typeof n !== 'object') return '';
    const t = k => String(n[k] == null ? '' : n[k]).trim();
    const rue = t('nom_1_droite') || t('nom_1_gauche') || t('cpx_toponyme_route_nommee') || t('cpx_toponyme');
    const num = t('cpx_numero').replace(/^([A-Za-z]+)(\d)/, '$1 $2');
    return rue && num && fold(rue) !== fold(num) ? `${rue} (${num})` : (rue || num);
  }
  function classeVoie(a) {
    let v = a && a.nature;
    if (v && typeof v === 'object') v = Object.values(v).find(x => typeof x === 'string' && x) || '';
    const n = fold(v);
    if (!n) return '';
    if (/sentier|escalier/.test(n)) return 'sentier';
    if (/chemin|empierr/.test(n)) return 'piste';
    if (/bac|maritime/.test(n)) return 'bac';
    return 'route';
  }
  // consigne en français à partir de la manœuvre (vocabulaire OSRM)
  function consigne(ins, nom) {
    const type = String((ins && ins.type) || '').toLowerCase();
    const mod = String((ins && ins.modifier) || '').toLowerCase();
    const sens = SENS[mod] || '';
    const sur = nom ? ` sur ${nom}` : '';
    const sortie = n => `${n}${Number(n) === 1 ? 're' : 'e'} sortie`;
    switch (type) {
      case 'depart': return 'Départ' + (nom ? ` par ${nom}` : '');
      case 'arrive': return 'Arrivée';
      case 'roundabout': case 'rotary':
        return `Au rond-point, ${ins.exit ? 'prendre la ' + sortie(ins.exit) : 'continuer'}${sur}`;
      case 'roundabout turn':
        return `Au rond-point, ${!sens || mod === 'straight' ? 'continuer tout droit' : mod === 'uturn' ? 'faire demi-tour' : 'tourner ' + sens}${sur}`;
      case 'exit roundabout': case 'exit rotary': return `Sortir du rond-point${sur}`;
      case 'turn':
        return (mod === 'uturn' ? 'Faire demi-tour' : mod === 'straight' || !sens ? 'Continuer tout droit' : `Tourner ${sens}`) + sur;
      case 'end of road': return `Au bout de la route, ${mod === 'uturn' ? 'faire demi-tour' : 'tourner ' + (sens || 'pour continuer')}${sur}`;
      case 'fork': return `À la bifurcation, rester ${sens || 'sur la voie'}${sur}`;
      case 'merge': return `S’insérer${sens && mod !== 'straight' ? ' ' + sens : ''}${sur}`;
      case 'on ramp': return `Prendre la bretelle${sens && mod !== 'straight' ? ' ' + sens : ''}${sur}`;
      case 'off ramp': return `Prendre la sortie${sens && mod !== 'straight' ? ' ' + sens : ''}${sur}`;
      default:
        return `Continuer${sens && mod !== 'straight' && mod !== 'uturn' ? ' ' + sens : ''}${sur}`;
    }
  }
  function symbole(ins) {
    const type = String((ins && ins.type) || '').toLowerCase();
    if (type === 'depart') return { t: 'dep' };
    if (type === 'arrive') return { t: 'arr' };
    if (/roundabout|rotary/.test(type)) return { t: 'rp' };
    const a = ANGLE[String((ins && ins.modifier) || '').toLowerCase()];
    return { t: 'fl', a: a === undefined ? 0 : a };
  }
  function secondes(v, unite) {
    if (typeof v === 'string' && v.includes(':')) {
      const p = v.split(':').map(Number);
      return p.reduce((s, x) => s * 60 + (x || 0), 0);
    }
    const k = /hour|heure/i.test(unite || '') ? 3600 : /min/i.test(unite || '') ? 60 : 1;
    return (Number(v) || 0) * k;
  }
  // Réponse du service -> { coords, cum, dist (m), duree (s), etapes: [{ txt, sym, dist, d0, voie, nom }] }
  function lireRoute(j) {
    const coords = lireGeom(j && j.geometry);
    if (coords.length < 2) throw new ErreurService('Aucun itinéraire trouvé entre ces deux points.', 404);
    const kD = /kilo/i.test(j.distanceUnit || '') ? 1000 : 1;
    const cum = cumul(coords);
    const etapes = [];
    let d0 = 0;
    (j.portions || []).forEach(por => (por.steps || []).forEach(s => {
      const dist = (Number(s.distance) || 0) * kD;
      const nom = nomVoie(s.attributes);
      const ins = s.instruction || null;
      etapes.push({ txt: consigne(ins, nom), sym: symbole(ins), dist, d0, voie: classeVoie(s.attributes), nom });
      d0 += dist;
    }));
    // Les distances des étapes sont ramenées à la longueur du tracé (les arrondis du service se cumulent)
    const total = cum[cum.length - 1];
    if (d0 > 0 && Math.abs(d0 - total) > 1) { const k = total / d0; etapes.forEach(e => { e.d0 *= k; e.dist *= k; }); }
    // étapes vides en double (changement d'attribut sans manœuvre) : fusionnées avec la précédente
    const nettes = [];
    etapes.forEach(e => {
      const p = nettes[nettes.length - 1];
      if (p && e.sym.t === 'fl' && e.sym.a === 0 && /^Continuer/.test(e.txt) && e.nom === p.nom && e.voie === p.voie) p.dist += e.dist;
      else nettes.push(e);
    });
    if (nettes.length && nettes[nettes.length - 1].sym.t !== 'arr') nettes.push({ txt: 'Arrivée', sym: { t: 'arr' }, dist: 0, d0: total, voie: '', nom: '' });
    return {
      coords, cum, dist: (Number(j.distance) || 0) * kD || total,
      duree: secondes(j.duration, j.timeUnit) || 0,
      etapes: nettes,
    };
  }
  async function calculer(dep, arr, modeId) {
    const url = attrs => {
      const q = new URLSearchParams({
        resource: 'bdtopo-osrm', start: `${dep[1].toFixed(6)},${dep[0].toFixed(6)}`, end: `${arr[1].toFixed(6)},${arr[0].toFixed(6)}`,
        profile: modeId, optimization: 'fastest', getSteps: 'true', getBbox: 'false', geometryFormat: 'geojson',
        distanceUnit: 'meter', timeUnit: 'second', crs: 'EPSG:4326',
      });
      if (attrs) q.set('waysAttributes', attrs);
      return URL_ITIN + '?' + q.toString();
    };
    let j;
    try { j = await getJSON(url('name|nature')); }
    catch (e) {
      // attribut refusé par le service : nouvel essai avec les attributs par défaut (noms des voies seuls)
      if (!(e instanceof ErreurService) || e.http !== 400) throw e;
      j = await getJSON(url(''));
    }
    return lireRoute(j);
  }

  // ---------- profil altimétrique ----------
  // n points régulièrement espacés le long du tracé : { d: [m], pts: [[lat, lng]] }
  function echantillonner(coords, cum, n) {
    const total = cum[cum.length - 1];
    const d = [], pts = [];
    for (let i = 0; i < n; i++) { const x = total * i / (n - 1); d.push(x); pts.push(pointA(coords, cum, x)); }
    return { d, pts };
  }
  async function altitudes(pts) {
    const z = new Array(pts.length).fill(null);
    for (let i = 0; i < pts.length; i += PAQUET) {
      const lot = pts.slice(i, i + PAQUET);
      const q = new URLSearchParams({
        lon: lot.map(p => p[1].toFixed(5)).join('|'), lat: lot.map(p => p[0].toFixed(5)).join('|'),
        resource: 'ign_rge_alti_wld', delimiter: '|', indent: 'false', measures: 'false', zonly: 'true',
      });
      const j = await getJSON(URL_ALTI + '?' + q.toString());
      (j.elevations || []).forEach((v, k) => {
        const val = Number(v && typeof v === 'object' ? v.z : v);
        if (isFinite(val) && val > -1000 && val < 9000 && i + k < z.length) z[i + k] = val;   // -99999 : pas de donnée
      });
    }
    return z;
  }
  // d, z bruts (null = pas de donnée) -> profil lissé, dénivelés et pentes
  function construireProfil(d, zBrut, seuils) {
    const n = d.length;
    const connus = zBrut.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
    if (connus.length < 2) return null;
    // trous comblés par interpolation (ou recopie aux extrémités)
    const z0 = zBrut.slice();
    for (let i = 0; i < n; i++) {
      if (z0[i] !== null) continue;
      const a = connus.filter(k => k < i).pop(), b = connus.find(k => k > i);
      z0[i] = a === undefined ? zBrut[b] : b === undefined ? zBrut[a] : zBrut[a] + (zBrut[b] - zBrut[a]) * (d[i] - d[a]) / ((d[b] - d[a]) || 1);
    }
    // lissage léger : le relevé suit le terrain, pas la chaussée (talus, murs de soutènement)
    const pas = (d[n - 1] - d[0]) / (n - 1) || 1;
    const w = pas < 15 ? 2 : 1;
    const z = z0.map((v, i) => {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) { s += z0[k]; c++; }
      return s / c;
    });
    // dénivelés cumulés avec seuil (3 m) pour ne pas additionner le bruit
    let ref = z[0], dplus = 0, dmoins = 0;
    z.forEach(v => {
      const diff = v - ref;
      if (diff >= 3) { dplus += diff; ref = v; } else if (diff <= -3) { dmoins -= diff; ref = v; }
    });
    // pente (%) autour de chaque point, sur une fenêtre d'au moins ~50 m
    const k = Math.max(1, Math.round(25 / pas));
    const pente = z.map((v, i) => {
      const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
      return (z[b] - z[a]) / ((d[b] - d[a]) || 1) * 100;
    });
    const classe = pente.map(p => (Math.abs(p) > seuils[1] ? 2 : Math.abs(p) > seuils[0] ? 1 : 0));
    const lg = [0, 0, 0];
    for (let i = 1; i < n; i++) lg[Math.max(classe[i - 1], classe[i])] += d[i] - d[i - 1];
    return { d, z, pente, classe, lg, dplus, dmoins, zmin: Math.min(...z), zmax: Math.max(...z), pmax: Math.max(...pente.map(Math.abs)) };
  }
  // Temps de marche en terrain accidenté (règle DIN 33466 : 4 km/h, 300 m/h en montée, 500 m/h en descente)
  function tempsMarche(dist, dplus, dmoins) {
    const h = dist / 4000, v = dplus / 300 + dmoins / 500;
    return (Math.max(h, v) + Math.min(h, v) / 2) * 3600;
  }
  function altA(pr, x) {
    if (!pr) return null;
    const d = pr.d;
    if (x <= d[0]) return { z: pr.z[0], pente: pr.pente[0], i: 0 };
    let lo = 0, hi = d.length - 1;
    if (x >= d[hi]) return { z: pr.z[hi], pente: pr.pente[hi], i: hi };
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - d[lo]) / ((d[hi] - d[lo]) || 1);
    return { z: pr.z[lo] + (pr.z[hi] - pr.z[lo]) * t, pente: t < 0.5 ? pr.pente[lo] : pr.pente[hi], i: t < 0.5 ? lo : hi };
  }

  // ---------- GPX ----------
  const xmlEsc = t => String(t == null ? '' : t).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function gpx(route, profil) {
    const nom = `Itinéraire vers ${route.dest.nom}`;
    const pts = route.coords.map((p, i) => {
      const a = profil ? altA(profil, route.cum[i]) : null;
      return `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${a ? `<ele>${a.z.toFixed(1)}</ele>` : ''}</trkpt>`;
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<gpx version="1.1" creator="SMPM 84" xmlns="http://www.topografix.com/GPX/1/1">\n'
      + `  <wpt lat="${route.dest.ll[0].toFixed(6)}" lon="${route.dest.ll[1].toFixed(6)}"><name>${xmlEsc(route.dest.nom)}</name></wpt>\n`
      + `  <trk>\n    <name>${xmlEsc(nom)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`;
  }

  // ---------- état ----------
  const R = {
    L: null, map: null, opts: {}, box: null, calque: null, moi: null, curseur: null,
    dest: null,                 // { nom, ll }
    dep: null,                  // départ choisi sur la carte { nom, ll } ; null = ma position
    mode: 'car',
    route: null, profil: null, profilEtat: '',
    onglet: 'etapes', ouvert: false, replie: false,
    nav: null,                  // suivi GPS en cours
    jeton: 0, attente: null, etat: '', erreur: false, pleinAuto: false,
    recherche: [], rechT: 0, rechJeton: 0,
  };
  try { const m = localStorage.getItem(KEY_MODE); if (MODES.some(x => x.id === m)) R.mode = m; } catch (e) {}

  function garde() {
    try {
      const g = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!g || !g.route || !Array.isArray(g.route.coords) || g.route.coords.length < 2) return null;
      if (Date.now() - new Date(g.route.at).getTime() > GARDE_H * 3600000) return null;
      return g;
    } catch (e) { return null; }
  }
  function sauver() {
    try {
      if (!R.route) { localStorage.removeItem(KEY); return; }
      const r = R.route;
      const route = {
        coords: r.coords.map(p => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]),
        dist: Math.round(r.dist), duree: Math.round(r.duree), dest: r.dest, dep: r.dep, mode: r.mode, at: r.at,
        etapes: r.etapes.map(e => ({ txt: e.txt, sym: e.sym, dist: Math.round(e.dist), d0: Math.round(e.d0), voie: e.voie, nom: e.nom })),
      };
      const p = R.profil;
      const profil = p ? { d: p.d.map(Math.round), z: p.z.map(v => Number(v.toFixed(1))) } : null;
      localStorage.setItem(KEY, JSON.stringify({ route, profil }));
    } catch (e) { /* stockage plein : l'itinéraire reste affiché, il ne sera simplement pas repris */ }
  }
  function reprendre() {
    const g = garde();
    if (!g) return;
    const r = g.route;
    r.cum = cumul(r.coords);
    R.route = r; R.dest = r.dest; R.mode = r.mode; R.dep = r.dep && !r.dep.gps ? r.dep : null;
    R.profil = g.profil ? construireProfil(g.profil.d, g.profil.z, mode(r.mode).seuils) : null;
    R.profilEtat = R.profil ? '' : 'absent';
    R.etat = ''; R.erreur = false; R.onglet = 'etapes';
    dessiner(); rendre(); cadrer();
  }

  // ---------- dessin sur la carte ----------
  function dessiner() {
    const L = R.L;
    if (!R.map) return;
    if (!R.calque) R.calque = L.featureGroup().addTo(R.map);
    R.calque.clearLayers();
    R.curseur = null;
    const r = R.route;
    if (!r) return;
    L.polyline(r.coords, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(R.calque);
    // tronçons colorés par type de voie quand le service l'indique ; pointillés hors route revêtue
    const avecVoies = r.etapes.some(e => e.voie);
    if (!avecVoies) L.polyline(r.coords, { color: VOIES.route.coul, weight: 5, opacity: 0.95, interactive: false }).addTo(R.calque);
    else {
      let seg = null;
      const pousser = () => { if (seg && seg.pts.length > 1) L.polyline(seg.pts, { color: (VOIES[seg.voie] || VOIES.route).coul, weight: 5, opacity: 0.95, dashArray: seg.voie && seg.voie !== 'route' ? '2 9' : null, interactive: false }).addTo(R.calque); };
      r.etapes.forEach(e => {
        if (!e.dist) return;
        const v = e.voie || 'route';
        const a = e.d0, b = e.d0 + e.dist;
        const pts = [pointA(r.coords, r.cum, a)];
        for (let i = 0; i < r.coords.length; i++) if (r.cum[i] > a && r.cum[i] < b) pts.push(r.coords[i]);
        pts.push(pointA(r.coords, r.cum, b));
        if (seg && seg.voie === v) seg.pts.push(...pts);
        else { pousser(); seg = { voie: v, pts }; }
      });
      pousser();
    }
    const rond = (ll, coul, titre) => L.circleMarker(ll, { radius: 7, weight: 3, color: '#fff', fillColor: coul, fillOpacity: 1 }).bindTooltip(titre).addTo(R.calque);
    rond(r.coords[0], '#2e9e5b', 'Départ' + (r.dep && r.dep.nom ? ' : ' + r.dep.nom : ''));
    const fin = r.coords[r.coords.length - 1];
    rond(fin, '#d9304f', 'Arrivée : ' + r.dest.nom);
    // destination hors du réseau (falaise, cavité…) : trait de liaison jusqu'au point visé
    if (metres(fin, r.dest.ll) > 25) {
      L.polyline([fin, r.dest.ll], { color: '#d9304f', weight: 3, dashArray: '4 8', interactive: false }).addTo(R.calque);
      L.circleMarker(r.dest.ll, { radius: 5, weight: 2, color: '#d9304f', fillColor: '#fff', fillOpacity: 1 }).bindTooltip(r.dest.nom).addTo(R.calque);
    }
  }
  function cadrer() {
    if (!R.map || !R.route) return;
    R.map.invalidateSize();
    // marge du côté du panneau : en bas sur téléphone, à droite sur grand écran
    const t = R.map.getSize(), h = R.box ? R.box.offsetHeight : 0, w = R.box ? R.box.offsetWidth : 0;
    const cote = w && w < t.x - 240;
    R.map.fitBounds(R.L.latLngBounds(R.route.coords).extend(R.route.dest.ll), { paddingTopLeft: [50, 30], paddingBottomRight: cote ? [w + 30, 30] : [30, Math.min(h, t.y * 0.6) + 20], maxZoom: 17 });
  }
  function montrerCurseur(x) {
    const r = R.route;
    if (!r || !R.map) return;
    const ll = pointA(r.coords, r.cum, x);
    if (!R.curseur) R.curseur = R.L.circleMarker(ll, { radius: 7, weight: 3, color: '#132238', fillColor: '#ffd43b', fillOpacity: 1, interactive: false }).addTo(R.calque);
    else R.curseur.setLatLng(ll);
    if (!R.map.getBounds().pad(-0.1).contains(ll)) R.map.panTo(ll, { animate: true });
  }

  // ---------- calcul ----------
  function dire(msg, erreur) { R.etat = msg || ''; R.erreur = !!erreur; rendreEtat(); }
  const horsLigne = () => navigator.onLine === false;
  function messageErreur(e) {
    if (e instanceof ErreurService) {
      if (e.http === 404 || /no route|not found|aucun/i.test(e.message)) return 'Aucun itinéraire trouvé entre ces deux points (hors du réseau de routes et chemins connu de l’IGN ?).';
      if (!e.http || e.http >= 500) return horsLigne() ? 'Hors ligne : le calcul d’un itinéraire demande du réseau.' : `Le service d’itinéraire de l’IGN ne répond pas (${e.message}). Réessayez dans un instant.`;
      return `Le service d’itinéraire de l’IGN a refusé la demande (${e.message}).`;
    }
    return (e && e.message) || 'Calcul impossible.';
  }
  // depuis : position déjà connue (recalcul pendant le suivi) ; sinon départ choisi ou position de l'appareil
  async function tracer(depuis) {
    if (!R.dest) return;
    const jeton = ++R.jeton;
    const recalcul = !!depuis;
    dire(recalcul ? 'Recalcul de l’itinéraire…' : 'Calcul de l’itinéraire…');
    let dep = depuis ? { nom: 'Ma position', ll: depuis, gps: true } : R.dep;
    try {
      if (!dep) {
        dire('Recherche de votre position…');
        let r;
        try { r = await R.opts.locate(); }
        catch (e) {
          if (jeton !== R.jeton) return;
          dire(e.message + ' Vous pouvez choisir le départ : appui long (ou clic droit) sur la carte, puis « Partir d’ici ».', true);
          return;
        }
        if (jeton !== R.jeton) return;
        dep = { nom: 'Ma position', ll: r.ll, gps: true };
        dire('Calcul de l’itinéraire…');
      }
      const route = await calculer(dep.ll, R.dest.ll, R.mode);
      if (jeton !== R.jeton) return;
      route.dest = R.dest; route.dep = dep; route.mode = R.mode; route.at = new Date().toISOString();
      R.route = route; R.profil = null; R.profilEtat = 'charge';
      if (R.nav) { R.nav.hors = 0; R.nav.prog = 0; R.nav.annonce = ''; }
      dire('');
      dessiner();
      rendre();
      if (!R.nav) cadrer();
      sauver();
      chargerProfil(jeton);
    } catch (e) {
      if (jeton !== R.jeton) return;
      dire(messageErreur(e), true);
    }
  }
  async function chargerProfil(jeton) {
    const r = R.route;
    if (!r) return;
    const j = jeton || R.jeton;
    R.profilEtat = 'charge'; rendreVue();
    try {
      const n = Math.max(40, Math.min(480, Math.round(r.dist / 25)));
      const ech = echantillonner(r.coords, r.cum, n);
      const z = await altitudes(ech.pts);
      if (j !== R.jeton || r !== R.route) return;
      R.profil = construireProfil(ech.d, z, mode(r.mode).seuils);
      R.profilEtat = R.profil ? '' : 'vide';
      sauver();
    } catch (e) {
      if (j !== R.jeton || r !== R.route) return;
      R.profilEtat = 'erreur';
    }
    rendre();
  }

  // ---------- interface ----------
  const ICO = {
    route: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8.2 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    croix: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  function symSvg(s) {
    const cadre = inner => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    if (s.t === 'dep') return cadre('<circle cx="12" cy="12" r="5" fill="currentColor"/>');
    if (s.t === 'arr') return cadre('<path d="M6 21V4M6 5h11l-2.5 3.5L17 12H6"/>');
    if (s.t === 'rp') return cadre('<path d="M19 12a7 7 0 1 1-2.6-5.4"/><path d="M17 2.8v4.4h-4.4"/>');
    return cadre(`<g transform="rotate(${s.a} 12 12)"><path d="M12 20V5M6 11l6-6 6 6"/></g>`);
  }

  function resume() {
    const r = R.route;
    if (!r) return '';
    const p = R.profil;
    const duree = r.mode === 'pedestrian' && p ? tempsMarche(r.dist, p.dplus, p.dmoins) : r.duree;
    return [fmtDist(r.dist), duree ? fmtDuree(duree) : '', p ? `D+ ${Math.round(p.dplus)} m` : ''].filter(Boolean).join(' · ');
  }
  function rendreEtat() {
    const n = R.box && R.box.querySelector('.itin-etat');
    if (!n) return;
    n.textContent = R.etat;
    n.classList.toggle('error', R.erreur);
    n.hidden = !R.etat;
  }
  function rendreTete() {
    if (!R.box) return;
    const t = R.box.querySelector('.itin-titre'), s = R.box.querySelector('.itin-sous');
    const r = R.route;
    if (R.nav && r) {
      t.textContent = R.nav.annonce || 'Suivi en cours…';
      s.textContent = R.nav.reste || resume();
    } else if (r || R.dest) {
      t.textContent = `Vers « ${(R.dest || r.dest).nom} »`;
      s.textContent = r ? resume() : '';
    } else {
      t.textContent = 'Itinéraire';
      s.textContent = 'Tracé, étapes et profil altimétrique';
    }
    R.box.classList.toggle('is-nav', !!R.nav);
    R.box.classList.toggle('is-replie', R.replie);
    const b = R.box.querySelector('.itin-plier');
    b.setAttribute('aria-expanded', String(!R.replie));
    b.title = R.replie ? 'Déplier' : 'Replier';
  }
  function rendre() {
    if (!R.box) return;
    R.box.hidden = !R.ouvert;
    R.map.getContainer().classList.toggle('itin-on', R.ouvert);
    rendreTete();
    const corps = R.box.querySelector('.itin-corps');
    const r = R.route;
    const rech = el('div', { class: 'itin-rech' },
      el('input', { type: 'search', class: 'itin-q', placeholder: 'Point d’intérêt, adresse, lieu-dit, coordonnées…', autocomplete: 'off', 'aria-label': 'Rechercher une destination', oninput: e => chercher(e.target.value) }),
      el('ul', { class: 'itin-res' }));
    if (!r && !R.dest) {
      const g = garde();
      remplir(corps,
        rech,
        el('p', { class: 'itin-etat small', role: 'status', hidden: true }),
        g ? el('button', { type: 'button', class: 'itin-btn itin-reprise', onclick: reprendre },
          el('strong', { text: `Reprendre : vers « ${g.route.dest.nom} »` }),
          el('span', { class: 'small', text: ` ${fmtDist(g.route.dist)} · calculé ${quand(g.route.at)}` })) : null,
        el('p', { class: 'small itin-aide', text: 'Cherchez une destination ci-dessus, ou sur la carte : « Itinéraire sur la carte » dans la bulle d’un point, ou appui long (clic droit) à l’endroit voulu.' }));
      rendreEtat();
      majHauteur();
      return;
    }
    const depNom = R.dep ? R.dep.nom : 'Ma position';
    remplir(corps,
      el('div', { class: 'itin-modes', role: 'group', 'aria-label': 'Mode de déplacement' },
        ...MODES.map(m => el('button', { type: 'button', class: 'itin-seg', 'aria-pressed': String(R.mode === m.id), text: m.nom, onclick: () => choisirMode(m.id) })),
        el('span', { class: 'itin-dep small' }, 'Départ : ', el('strong', { text: depNom }),
          R.dep ? el('button', { type: 'button', class: 'link', text: 'ma position', onclick: () => { R.dep = null; tracer(); } }) : null)),
      el('p', { class: 'itin-etat small', role: 'status', hidden: true }),
      r ? el('div', { class: 'itin-acts' },
        R.nav
          ? el('button', { type: 'button', class: 'itin-btn itin-stop', text: 'Arrêter le suivi', onclick: () => arreter() })
          : el('button', { type: 'button', class: 'itin-btn itin-go', text: 'Démarrer', onclick: demarrer }),
        el('button', { type: 'button', class: 'itin-btn', text: 'GPX', title: 'Exporter le tracé (fichier GPX)', 'aria-label': 'Exporter le tracé en fichier GPX', onclick: exporter }),
        el('button', { type: 'button', class: 'itin-btn', text: 'Voir tout', onclick: () => { if (R.nav) R.nav.suivre = false; majRecentrer(); cadrer(); } })) : null,
      r ? el('div', { class: 'itin-onglets', role: 'tablist' },
        ...[['etapes', 'Étapes'], ['profil', 'Profil']].map(([id, nom]) => el('button', { type: 'button', role: 'tab', class: 'itin-seg', 'aria-selected': String(R.onglet === id), text: nom, onclick: () => { R.onglet = id; rendre(); } }))) : null,
      r ? el('div', { class: 'itin-vue' }) : el('button', { type: 'button', class: 'itin-btn', text: 'Réessayer', onclick: () => tracer() }));
    rendreEtat();
    rendreVue();
  }
  const quand = iso => {
    const d = new Date(iso);
    const auj = new Date().toDateString() === d.toDateString();
    return (auj ? 'à ' : 'le ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ') + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };
  function rendreVue() {
    const vue = R.box && R.box.querySelector('.itin-vue');
    if (!vue || !R.route) { majHauteur(); return; }
    remplir(vue, R.onglet === 'profil' ? vueProfil() : vueEtapes());
    majCurseurNav();
    majHauteur();
  }
  function vueEtapes() {
    const r = R.route;
    return [el('ol', { class: 'itin-etapes' }, ...r.etapes.map((e, i) => el('li', { 'data-i': i },
      el('button', { type: 'button', class: 'itin-etape', onclick: () => { if (R.nav) { R.nav.suivre = false; majRecentrer(); } R.map.setView(pointA(r.coords, r.cum, e.d0), Math.max(R.map.getZoom(), 16)); } },
        el('span', { class: 'itin-sym', html: symSvg(e.sym) }),
        el('span', { class: 'itin-txt' }, e.txt, e.voie && e.voie !== 'route' ? el('em', { class: 'itin-voie', style: `color:${VOIES[e.voie].coul}`, text: ' · ' + VOIES[e.voie].nom.toLowerCase() }) : null),
        e.dist ? el('span', { class: 'itin-lg', text: fmtDist(e.dist) }) : null))))];
  }
  const G = { W: 360, H: 132, ml: 34, mr: 8, mt: 10, mb: 20 };   // dimensions du graphe (unités SVG ≈ pixels sur téléphone)
  function vueProfil() {
    const r = R.route, p = R.profil;
    if (!p) {
      const msg = { charge: 'Relevé des altitudes le long du tracé…', erreur: horsLigne() ? 'Hors ligne : le profil n’a pas pu être relevé.' : 'Le profil n’a pas pu être relevé (service altimétrique de l’IGN indisponible).', vide: 'Pas de donnée d’altitude sur ce tracé.', absent: 'Profil non relevé pour cet itinéraire.' }[R.profilEtat] || '';
      return [el('p', { class: 'small itin-aide', role: 'status', text: msg }),
        R.profilEtat !== 'charge' && R.profilEtat !== 'vide' ? el('button', { type: 'button', class: 'itin-btn', text: 'Relever le profil', onclick: () => chargerProfil() }) : null];
    }
    const m = mode(r.mode);
    const { W, H, ml, mr, mt, mb } = G;
    const total = p.d[p.d.length - 1] || 1;
    let z0 = p.zmin, z1 = p.zmax;
    if (z1 - z0 < 40) { const mil = (z0 + z1) / 2; z0 = mil - 20; z1 = mil + 20; }   // tracé plat : pas d'exagération
    const marge = (z1 - z0) * 0.08; z0 -= marge; z1 += marge;
    const X = d => ml + (W - ml - mr) * d / total;
    const Y = z => mt + (H - mt - mb) * (1 - (z - z0) / (z1 - z0));
    const bas = H - mb;
    let aires = '';
    for (let i = 1; i < p.d.length; i++) {
      const c = Math.max(p.classe[i - 1], p.classe[i]);
      aires += `<path d="M${X(p.d[i - 1]).toFixed(1)} ${bas}L${X(p.d[i - 1]).toFixed(1)} ${Y(p.z[i - 1]).toFixed(1)}L${X(p.d[i]).toFixed(1)} ${Y(p.z[i]).toFixed(1)}L${X(p.d[i]).toFixed(1)} ${bas}Z" fill="${COUL[c]}"/>`;
    }
    const ligne = p.d.map((d, i) => `${i ? 'L' : 'M'}${X(d).toFixed(1)} ${Y(p.z[i]).toFixed(1)}`).join('');
    const gradY = (p.zmax - p.zmin > 12 ? [p.zmax, (p.zmin + p.zmax) / 2, p.zmin] : [p.zmax]).map(v => `<line x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="itin-g"/><text x="${ml - 5}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('');
    const gradX = [0, 0.5, 1].map(t => `<text x="${X(total * t).toFixed(1)}" y="${H - 5}" text-anchor="${t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}">${t === 0 ? '0' : fmtDist(total * t)}</text>`).join('');
    const svg = el('div', { class: 'itin-graphe', html:
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil altimétrique : de ${Math.round(p.z[0])} m à ${Math.round(p.z[p.z.length - 1])} m, dénivelé positif ${Math.round(p.dplus)} m, négatif ${Math.round(p.dmoins)} m">`
      + `<g opacity=".85">${aires}</g><path d="${ligne}" class="itin-l"/>${gradY}${gradX}`
      + `<line class="itin-pos" x1="0" x2="0" y1="${mt}" y2="${bas}" hidden="hidden"/><line class="itin-cur" x1="0" x2="0" y1="${mt}" y2="${bas}" hidden="hidden"/></svg>` });
    const lecture = el('p', { class: 'small itin-lecture', role: 'status', text: 'Touchez le profil pour situer un point sur la carte.' });
    const g = svg.firstChild;
    const viser = ev => {
      const box = g.getBoundingClientRect();
      const x = (ev.clientX - box.left) / box.width * W;
      const d = Math.max(0, Math.min(total, (x - ml) / (W - ml - mr) * total));
      const a = altA(p, d);
      const cur = g.querySelector('.itin-cur');
      cur.removeAttribute('hidden'); cur.setAttribute('x1', X(d)); cur.setAttribute('x2', X(d));
      lecture.textContent = `À ${fmtDist(d)} du départ : ${Math.round(a.z)} m · pente ${a.pente >= 0 ? '+' : '−'}${Math.abs(Math.round(a.pente))} %`;
      montrerCurseur(d);
    };
    let appui = false;
    g.addEventListener('pointerdown', ev => { appui = true; try { g.setPointerCapture(ev.pointerId); } catch (e) {} viser(ev); });
    g.addEventListener('pointermove', ev => { if (appui || ev.pointerType === 'mouse') viser(ev); });
    ['pointerup', 'pointercancel'].forEach(t => g.addEventListener(t, () => { appui = false; }));
    const pc = v => `${Math.round(v / total * 100)} %`;
    const leg = (i, txt) => el('span', { class: 'itin-leg' }, el('i', { style: `background:${COUL[i]}` }), `${txt} (${pc(p.lg[i])})`);
    const voies = {};
    r.etapes.forEach(e => { if (e.voie && e.dist) voies[e.voie] = (voies[e.voie] || 0) + e.dist; });
    const cles = Object.keys(VOIES).filter(k => voies[k]);
    const somme = cles.reduce((s, k) => s + voies[k], 0) || 1;
    return [
      el('div', { class: 'itin-stats' },
        el('span', {}, el('b', { text: `${Math.round(p.dplus)} m` }), ' D+'),
        el('span', {}, el('b', { text: `${Math.round(p.dmoins)} m` }), ' D−'),
        el('span', {}, el('b', { text: `${Math.round(p.zmin)} – ${Math.round(p.zmax)} m` }), ' altitude'),
        el('span', {}, el('b', { text: `${Math.round(p.pmax)} %` }), ' pente max')),
      svg, lecture,
      el('div', { class: 'itin-legende small' }, leg(0, `≤ ${m.seuils[0]} %`), leg(1, `${m.seuils[0]} – ${m.seuils[1]} %`), leg(2, `> ${m.seuils[1]} %`)),
      cles.length ? el('div', { class: 'itin-voies' },
        el('div', { class: 'itin-barre', role: 'img', 'aria-label': 'Répartition par type de voie' }, ...cles.map(k => el('i', { style: `flex:${voies[k] / somme};background:${VOIES[k].coul}` }))),
        el('div', { class: 'itin-legende small' }, ...cles.map(k => el('span', { class: 'itin-leg' }, el('i', { style: `background:${VOIES[k].coul}` }), `${VOIES[k].nom} · ${fmtDist(voies[k])}`)))) : null,
      el('p', { class: 'small itin-aide', text: (r.mode === 'pedestrian' ? 'Durée à pied estimée avec le dénivelé (4 km/h, 300 m/h en montée, 500 m/h en descente). ' : '') + 'Altitudes du terrain (RGE ALTI, IGN) : ponts et tunnels ne sont pas pris en compte.' }),
    ];
  }
  // trait de la position courante sur le profil (pendant le suivi)
  function majCurseurNav() {
    const g = R.box && R.box.querySelector('.itin-graphe svg');
    if (!g || !R.profil) return;
    const pos = g.querySelector('.itin-pos');
    if (!R.nav || R.nav.prog === undefined || !R.nav.fixe) { pos.setAttribute('hidden', 'hidden'); return; }
    const total = R.profil.d[R.profil.d.length - 1] || 1;
    const x = G.ml + (G.W - G.ml - G.mr) * Math.min(1, R.nav.prog / total);
    pos.removeAttribute('hidden'); pos.setAttribute('x1', x); pos.setAttribute('x2', x);
  }
  // les commandes du bas de la carte (échelle, attribution) restent visibles au-dessus du panneau
  function majHauteur() {
    if (!R.map || !R.box) return;
    R.map.getContainer().style.setProperty('--itin-h', (R.ouvert ? R.box.offsetHeight + 8 : 0) + 'px');
  }

  function choisirMode(id) {
    if (R.mode === id) return;
    R.mode = id;
    try { localStorage.setItem(KEY_MODE, id); } catch (e) {}
    rendre();
    tracer(R.nav && R.nav.fixe ? R.nav.fixe : undefined);
  }

  // ---------- recherche d'une destination ----------
  function parseLatLng(v) {
    const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
    if (!m) return null;
    const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }
  function afficherResultats(liste, note) {
    const ul = R.box && R.box.querySelector('.itin-res');
    if (!ul) return;
    remplir(ul,
      ...liste.map(x => el('li', {}, el('button', { type: 'button', class: 'itin-resultat', onclick: () => vers({ nom: x.nom, lat: x.ll[0], lng: x.ll[1] }) },
        el('span', { class: 'itin-tag', text: x.type }), el('span', { text: x.nom })))),
      note ? el('li', { class: 'small itin-aide', text: note }) : null);
    majHauteur();
  }
  function chercher(texte) {
    clearTimeout(R.rechT);
    const q = String(texte || '').trim();
    const jeton = ++R.rechJeton;
    if (q.length < 2) return afficherResultats([]);
    const ll = parseLatLng(q);
    if (ll) return afficherResultats([{ type: 'GPS', nom: `${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}`, ll }]);
    // points d'intérêt de l'application : immédiat, sans réseau
    const mots = fold(q).split(/\s+/).filter(Boolean);
    const pois = ((R.opts.points && R.opts.points()) || [])
      .filter(p => mots.every(w => fold(p.nom).includes(w)))
      .slice(0, 5).map(p => ({ type: 'POI', nom: p.nom, ll: [p.lat, p.lng] }));
    afficherResultats(pois, horsLigne() ? 'Hors ligne : recherche limitée aux points d’intérêt.' : 'Recherche d’adresses…');
    if (horsLigne()) return;
    R.rechT = setTimeout(async () => {
      let adr = [];
      let note = '';
      try {
        const j = await getJSON(URL_ADR + '?' + new URLSearchParams({ text: q, type: 'PositionOfInterest,StreetAddress', maximumResponses: '6' }).toString(), 12000);
        adr = (j.results || []).filter(x => isFinite(x.x) && isFinite(x.y) && (x.x || x.y))
          .map(x => ({ type: /street|address|adresse/i.test(x.kind || x.classification || '') || x.street ? 'Adresse' : 'Lieu', nom: x.fulltext || [x.street, x.zipcode, x.city].filter(Boolean).join(' '), ll: [Number(x.y), Number(x.x)] }));
      } catch (e) { note = 'Recherche d’adresses indisponible pour l’instant.'; }
      if (jeton !== R.rechJeton) return;
      afficherResultats(pois.concat(adr), note || (pois.length + adr.length ? '' : 'Aucun résultat.'));
    }, 400);
  }

  // ---------- suivi GPS ----------
  function majRecentrer() {
    const b = R.box && R.box.querySelector('.itin-recentrer');
    if (b) b.hidden = !(R.nav && !R.nav.suivre);
  }
  async function verrouEcran() {
    try {
      if (!R.nav || !navigator.wakeLock || document.visibilityState !== 'visible') return;
      const v = await navigator.wakeLock.request('screen');
      if (R.nav) R.nav.verrou = v; else v.release();
    } catch (e) { /* refusé (batterie faible…) : le suivi continue, l'écran peut s'éteindre */ }
  }
  function demarrer() {
    if (!R.route || R.nav) return;
    if (!navigator.geolocation) return dire('La géolocalisation n’est pas disponible sur cet appareil.', true);
    R.nav = { suivre: true, hors: 0, prog: 0, fixe: null, annonce: 'Recherche de votre position…', reste: '', recalculA: 0, id: null, verrou: null };
    R.nav.id = navigator.geolocation.watchPosition(surPosition, err => {
      if (!R.nav) return;
      R.nav.annonce = err.code === 1 ? 'Accès à la position refusé : autorisez la localisation.' : 'Position introuvable pour l’instant…';
      rendreTete();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    verrouEcran();
    R.replie = true;
    if (R.opts.plein && !(R.opts.estPlein && R.opts.estPlein())) R.opts.plein(true);
    dire('');
    rendre();
    majRecentrer();
  }
  function arreter(msg) {
    if (!R.nav) return;
    try { navigator.geolocation.clearWatch(R.nav.id); } catch (e) {}
    try { if (R.nav.verrou) R.nav.verrou.release(); } catch (e) {}
    R.nav = null;
    R.replie = false;
    dire(msg || '');
    rendre();
    majRecentrer();
  }
  function surPosition(p) {
    const nav = R.nav, r = R.route;
    if (!nav || !r) return;
    const ll = [p.coords.latitude, p.coords.longitude];
    const acc = p.coords.accuracy || 0;
    nav.fixe = ll;
    const L = R.L;
    if (!R.moi) {
      R.moi = { halo: L.circle(ll, { radius: acc, weight: 1, fillOpacity: 0.12, interactive: false }), pt: L.circleMarker(ll, { radius: 8, weight: 3, color: '#fff', fillColor: '#1d72d8', fillOpacity: 1, interactive: false }) };
      R.moi.grp = L.layerGroup([R.moi.halo, R.moi.pt]).addTo(R.map);
    } else { R.moi.halo.setLatLng(ll).setRadius(acc); R.moi.pt.setLatLng(ll); }
    // premier relevé : zoom de conduite ; ensuite la carte suit sans toucher au zoom choisi par l'utilisateur
    if (nav.suivre) { if (nav.zoome) R.map.panTo(ll, { animate: true }); else { nav.zoome = true; R.map.setView(ll, Math.max(R.map.getZoom(), 16), { animate: true }); } }

    const pr = projeter(r.coords, r.cum, ll, nav.prog);
    const tolerance = Math.max(60, Math.min(150, acc * 1.5));
    if (pr.ecart > tolerance) {
      nav.hors++;
      if (nav.hors >= 3) {
        nav.annonce = `Hors itinéraire (à ${fmtDist(pr.ecart)} du tracé)`;
        nav.reste = horsLigne() ? 'Hors ligne : recalcul impossible, rejoignez le tracé.' : 'Recalcul…';
        if (!horsLigne() && Date.now() - nav.recalculA > 20000) { nav.recalculA = Date.now(); tracer(ll); }
        rendreTete();
      }
      return;
    }
    nav.hors = 0;
    nav.prog = pr.d;
    const total = r.cum[r.cum.length - 1];
    const reste = Math.max(0, total - pr.d);
    if (reste < 30) {
      const lien = metres(ll, r.dest.ll);
      return arreter(lien > 60 ? `Fin du tracé : « ${r.dest.nom} » est à ${fmtDist(lien)} hors du réseau de voies.` : `Vous êtes arrivé : « ${r.dest.nom} ».`);
    }
    const suiv = r.etapes.find(e => e.d0 > pr.d + 8) || r.etapes[r.etapes.length - 1];
    nav.annonce = `Dans ${fmtDist(Math.max(0, suiv.d0 - pr.d))} : ${suiv.txt.charAt(0).toLowerCase() + suiv.txt.slice(1)}`;
    const a = altA(R.profil, pr.d);
    const duree = r.duree ? r.duree * reste / (total || 1) : 0;
    nav.reste = ['Reste ' + fmtDist(reste), duree ? fmtDuree(duree) : '', a ? `alt. ${Math.round(a.z)} m` : ''].filter(Boolean).join(' · ');
    rendreTete();
    majCurseurNav();
    // étape en cours mise en évidence dans la liste
    const lis = R.box.querySelectorAll('.itin-etapes li');
    if (lis.length) {
      let cur = 0;
      r.etapes.forEach((e, i) => { if (e.d0 <= pr.d + 8) cur = i; });
      lis.forEach((li, i) => li.classList.toggle('is-cur', i === cur));
    }
  }
  document.addEventListener('visibilitychange', () => { if (R.nav && document.visibilityState === 'visible') verrouEcran(); });

  // ---------- export ----------
  function exporter() {
    const r = R.route;
    if (!r) return;
    const nom = 'itineraire_' + (fold(r.dest.nom).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'point') + '.gpx';
    const f = new File([gpx(r, R.profil)], nom, { type: 'application/gpx+xml' });
    const telecharger = () => {
      const u = URL.createObjectURL(f);
      const a = el('a', { href: u, download: nom });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      dire(`Fichier « ${nom} » téléchargé : il s’ouvre dans Iphigénie, Avenza Maps, GlobeXplorus…`);
    };
    let partage = false;
    try { partage = !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { partage = false; }
    if (!partage) return telecharger();
    navigator.share({ files: [f], title: `Itinéraire vers ${r.dest.nom}` }).catch(e => { if (!e || e.name !== 'AbortError') telecharger(); });
  }

  // ---------- ouverture / fermeture ----------
  function ouvrir() {
    // petit écran : la carte prend tout l'écran tant que le panneau est ouvert (comme une application de navigation)
    if (!R.ouvert && R.opts.plein && R.opts.estPlein && !R.opts.estPlein() && window.matchMedia('(max-width: 700px)').matches) { R.pleinAuto = true; R.opts.plein(true); }
    R.ouvert = true; R.replie = false; rendre();
  }
  function fermer() {
    R.jeton++;
    if (R.nav) arreter();
    R.ouvert = false; R.route = null; R.profil = null; R.dest = null; R.dep = null; R.etat = '';
    if (R.calque) R.calque.clearLayers();
    if (R.moi) { R.moi.grp.remove(); R.moi = null; }
    R.curseur = null;
    rendre();
    if (R.pleinAuto) { R.pleinAuto = false; if (R.opts.estPlein()) R.opts.plein(false); }
  }
  // Itinéraire vers une destination { nom, lat, lng } (appelé par poi.js) ; mis en attente tant que la carte n'existe pas
  function vers(d) {
    const dest = { nom: String(d.nom || 'Point choisi'), ll: [Number(d.lat), Number(d.lng)] };
    if (!R.map) { R.attente = dest; return; }
    R.map.closePopup();
    if (R.nav) arreter();
    R.dest = dest; R.route = null; R.profil = null;
    if (R.calque) R.calque.clearLayers();
    R.onglet = 'etapes';
    ouvrir();
    return tracer();
  }
  // Départ choisi sur la carte (appui long › « Partir d'ici »)
  function partirDe(d) {
    R.dep = { nom: String(d.nom || 'Point choisi sur la carte'), ll: [Number(d.lat), Number(d.lng)] };
    if (!R.map) return;
    R.map.closePopup();
    ouvrir();
    if (R.dest) return tracer();
    dire('Départ enregistré. Choisissez maintenant la destination.');
  }

  // Branche le module sur une carte Leaflet. opts : { locate(): Promise<{ll, acc}>, plein(on), estPlein(), points(): [{nom, lat, lng}] }
  function attacher(L, map, opts) {
    if (R.map === map) return;
    R.L = L; R.map = map; R.opts = opts || {};
    const Bouton = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const b = el('button', { type: 'button', class: 'poi-locate itin-ctrl', title: 'Itinéraire', 'aria-label': 'Itinéraire sur la carte', html: ICO.route });
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => { if (R.ouvert && !R.route && !R.dest) fermer(); else ouvrir(); });
        return b;
      },
    });
    map.addControl(new Bouton());
    R.box = el('section', { class: 'itin', hidden: true, 'aria-label': 'Itinéraire' },
      el('button', { type: 'button', class: 'itin-recentrer', hidden: true, text: 'Recentrer', onclick: () => { if (!R.nav) return; R.nav.suivre = true; majRecentrer(); if (R.nav.fixe) map.panTo(R.nav.fixe); } }),
      el('header', { class: 'itin-tete' },
        el('button', { type: 'button', class: 'itin-plier', title: 'Replier', 'aria-label': 'Replier ou déplier le panneau', html: ICO.chevron, onclick: () => { R.replie = !R.replie; rendreTete(); majHauteur(); } }),
        el('div', { class: 'itin-titres' }, el('strong', { class: 'itin-titre' }), el('span', { class: 'itin-sous small' })),
        el('button', { type: 'button', class: 'itin-fermer', title: 'Fermer l’itinéraire', 'aria-label': 'Fermer et effacer l’itinéraire', html: ICO.croix, onclick: fermer })),
      el('div', { class: 'itin-corps' }));
    map.getContainer().append(R.box);
    L.DomEvent.disableClickPropagation(R.box);
    L.DomEvent.disableScrollPropagation(R.box);
    R.box.addEventListener('contextmenu', e => e.stopPropagation());
    map.on('dragstart', () => { if (R.nav && R.nav.suivre) { R.nav.suivre = false; majRecentrer(); } });
    map.on('resize', majHauteur);
    rendre();
    if (R.attente) { const d = R.attente; R.attente = null; vers({ nom: d.nom, lat: d.ll[0], lng: d.ll[1] }); }
  }

  window.SMPM_ITIN = {
    attacher, vers, partirDe, fermer,
    actif: () => !!(R.route || R.dest || R.nav),          // un tracé est affiché : poi.js ne recadre pas la carte
    _test: { metres, cumul, pointA, projeter, decoderPolyligne, lireRoute, consigne, nomVoie, classeVoie, echantillonner, construireProfil, tempsMarche, altA, gpx, fmtDist, fmtDuree },
  };
})();
