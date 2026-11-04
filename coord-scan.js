// Lecture de coordonnées GPS dans une photo (OCR Tesseract, entièrement sur l'appareil) ou dans un texte collé.
// Formats reconnus : degrés minutes (44°10,25' N) et degrés minutes secondes (44°10'15" N), hémisphère
// avant ou après (N, S, E, W, O, Nord, Sud, Est, Ouest), texte autour, plusieurs coordonnées dans la même image.
// Exposé : window.SMPM_COORD = { analyser(texte), lireImage(fichier, progression) }.
(function () {
  'use strict';

  // ---------- analyse du texte ----------
  const DEG = '[°º˚*]';
  const MIN = "['’′´`‘]";
  const SEC = '(?:"|”|″|“|\'\'|’’|′′)';
  const NB = '\\d{1,2}(?:[.,]\\d+)?';
  // degrés, minutes (+ secondes facultatives, avec ou sans signe si les minutes ont le leur)
  const RE_NUM = new RegExp(
    `(\\d{1,3})\\s*(?:${DEG}|o(?=\\s*\\d))\\s*(${NB})\\s*(?:(${MIN})\\s*(?:(${NB})(?!\\s*${DEG})(?!\\s*\\d)\\s*${SEC}?)?|${SEC}|min\\b)?`, 'g');
  const RE_HEM = /(?:^|[^A-Za-zÀ-ÿ])(Nord|Sud|Est|Ouest|[NSEWO])(?![A-Za-zÀ-ÿ])/g;
  const HEMI = { NORD: 'N', SUD: 'S', EST: 'E', OUEST: 'W', N: 'N', S: 'S', E: 'E', W: 'W', O: 'W' };
  const num = s => Number(String(s).replace(',', '.'));

  function nettoyer(t) {
    return String(t || '')
      .replace(/[   ]/g, ' ')
      .replace(/(\d)\s*[oO°]\s*(?=\d)/g, '$1°')        // « 44o10 » lu par l'OCR
      .replace(/(\d)\s*,\s*(?=\d{1,2}\s*[°º˚*])/g, '$1 ') // virgule entre deux coordonnées
      .replace(/[´`‘]/g, "'");
  }

  function analyser(texte) {
    const t = nettoyer(texte);
    const nums = [];
    let m;
    RE_NUM.lastIndex = 0;
    while ((m = RE_NUM.exec(t))) {
      const d = Number(m[1]), mi = num(m[2]), se = m[4] !== undefined ? num(m[4]) : 0;
      if (mi >= 60 || se >= 60 || d > 180) continue;
      nums.push({ deb: m.index, fin: m.index + m[0].length, val: d + mi / 60 + se / 3600, dms: m[4] !== undefined, brut: m[0].trim() });
    }
    if (!nums.length) return [];
    const hems = [];
    RE_HEM.lastIndex = 0;
    while ((m = RE_HEM.exec(t))) {
      const deb = m.index + m[0].length - m[1].length;
      hems.push({ deb, fin: deb + m[1].length, h: HEMI[m[1].toUpperCase()] });
      RE_HEM.lastIndex = deb + m[1].length;
    }
    // hémisphère collé avant (pre) ou après (post) chaque nombre (seulement des espaces ou ponctuation légère entre)
    const proche = s => /^[\s:=.,;()\-]{0,3}$/.test(s);
    nums.forEach(n => {
      const av = hems.filter(h => h.fin <= n.deb && proche(t.slice(h.fin, n.deb))).pop();
      const ap = hems.find(h => h.deb >= n.fin && proche(t.slice(n.fin, h.deb)));
      n.pre = av ? av.h : ''; n.post = ap ? ap.h : '';
    });
    const res = [];
    for (let i = 0; i < nums.length - 1; i++) {
      const a = nums[i], b = nums[i + 1];
      if (b.deb - a.fin > 30) continue;                    // trop loin : pas la même coordonnée
      // lettres d'hémisphère : avant les nombres (N 44°…) ou après (44°… N) ; la lecture complète et cohérente l'emporte
      const ns = h => h === 'N' || h === 'S', ew = h => h === 'E' || h === 'W';
      const essais = [[a.pre, b.pre, 'pre'], [a.post, b.post, 'post'], [a.pre || a.post, b.pre || b.post, '']];
      let choix = null;
      for (const [ha, hb, k] of essais) {
        if (ns(ha) && ew(hb)) { choix = { lat: a, lng: b, hl: ha, ho: hb, k }; break; }
        if (ew(ha) && ns(hb)) { choix = { lat: b, lng: a, hl: hb, ho: ha, k }; break; }
      }
      if (!choix) {
        const ha = a.pre || a.post, hb = b.pre || b.post;
        if (!ha && !hb) { if (a.dms || b.dms || /[°º˚*]/.test(a.brut + b.brut)) choix = { lat: a, lng: b, hl: '', ho: '', k: '' }; }
        else if ((ns(ha) && !hb) || (!ha && ew(hb))) choix = { lat: a, lng: b, hl: ha, ho: hb, k: '' };
        else if (ew(ha) && !hb) choix = { lat: b, lng: a, hl: '', ho: ha, k: '' };
      }
      if (!choix || choix.lat.val > 90) continue;
      const la = choix.hl === 'S' ? -choix.lat.val : choix.lat.val, lo = choix.ho === 'W' ? -choix.lng.val : choix.lng.val;
      if (!res.some(r => Math.abs(r.lat - la) < 1e-6 && Math.abs(r.lng - lo) < 1e-6)) {
        const d0 = Math.min(a.deb, b.deb) - (choix.k === 'pre' ? 2 : 0), d1 = Math.max(a.fin, b.fin) + (choix.k === 'post' ? 2 : 0);
        res.push({ lat: la, lng: lo, texte: t.slice(Math.max(0, d0), d1).replace(/\s+/g, ' ').trim(),
          format: a.dms || b.dms ? 'DMS' : 'DM' });
      }
      i++;
    }
    return res;
  }

  // ---------- OCR ----------
  const base = p => new URL(p, document.baseURI).href;
  let worker = null, workerP = null, arret = null;
  function charger(src) {
    return new Promise((ok, ko) => {
      if (window.Tesseract) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Module de lecture indisponible (premier usage : réseau nécessaire).'));
      document.head.append(s);
    });
  }
  let progression = () => {};
  async function obtenirWorker() {
    clearTimeout(arret);
    if (worker) return worker;
    if (!workerP) {
      workerP = (async () => {
        await charger(base('vendor/tesseract/tesseract.min.js'));
        const w = await window.Tesseract.createWorker('eng', 1, {
          workerPath: base('vendor/tesseract/worker.min.js'),
          corePath: base('vendor/tesseract/tesseract-core-lstm.wasm.js'),
          langPath: base('vendor/tesseract'),
          logger: m => progression(m),
        });
        worker = w;
        return w;
      })().catch(e => { workerP = null; throw e; });
    }
    return workerP;
  }

  // Image réduite (2000 px max) et passée en niveaux de gris contrastés : lecture plus rapide et plus fiable
  function preparer(fichier) {
    return new Promise((ok, ko) => {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        g.filter = 'grayscale(1) contrast(1.4)';
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Image illisible.')); };
      img.src = url;
    });
  }

  async function lireImage(fichier, onProgress) {
    progression = onProgress || (() => {});
    const [w, c] = await Promise.all([obtenirWorker(), preparer(fichier)]);
    const r = await w.recognize(c);
    // module gardé 3 min pour un scan suivant, puis libéré (mémoire du téléphone)
    arret = setTimeout(() => { if (worker) { worker.terminate(); worker = null; workerP = null; } }, 180000);
    return (r && r.data && r.data.text) || '';
  }

  window.SMPM_COORD = { analyser, lireImage };
})();
