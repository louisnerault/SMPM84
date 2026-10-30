// Signaler un problème (menu, tous les membres). Envoi au serveur (SMPM84-backend, Bugs.gs, action bug_report) :
// ligne dans le classeur de suivi, pièces jointes dans le Drive, mail et notification push à l'administrateur.
// - Catégorie + objet (L'application, OPS, FMPA, Matériel, Techniques, RH, Personnels).
// - Photos (5 au plus, réduites sur l'appareil) et message vocal (3 min au plus).
// - Sans réseau : le signalement est gardé sur l'appareil (IndexedDB, pièces jointes comprises)
//   et envoyé au retour de la connexion.
(() => {
  'use strict';

  const OLD_QUEUE = 'smpm_bug_queue';          // ancienne file (localStorage), reprise une fois
  const DB = 'smpm84-bugs', STORE = 'queue';
  const MAX_PHOTOS = 5;
  const MAX_VOICE_S = 180;
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;

  const CATEGORIES = {
    "L'application": ['Bug', 'Suggestion'],
    OPS: ['Intervention'],
    FMPA: ['Heures', 'Livrets'],
    'Matériel': ['Usage', 'Inventaire'],
    Techniques: ['FTE', 'Notices'],
    RH: ['Livret', 'Annuaire des spécialistes'],
    Personnels: ['Avec un CU', 'Avec le COS', 'Avec un IMP', 'Autre'],
  };
  // Page consultée juste avant -> catégorie / objet proposés
  const DEPUIS = {
    livret: ['FMPA', 'Heures'], 'livret-remplir': ['FMPA', 'Livrets'], 'livret-themes': ['FMPA', 'Livrets'],
    fmpa: ['FMPA', 'Heures'], 'fmpa-fiche': ['FMPA', 'Heures'], 'fmpa-mes': ['FMPA', 'Heures'], 'fmpa-toutes': ['FMPA', 'Heures'],
    'fmpa-valid': ['FMPA', 'Livrets'],
    'interv-new': ['OPS', 'Intervention'], 'interv-fiche': ['OPS', 'Intervention'], 'interv-mes': ['OPS', 'Intervention'], 'interv-toutes': ['OPS', 'Intervention'],
    accueil: ['OPS', 'Intervention'], annuaire: ['RH', 'Annuaire des spécialistes'],
    fiches: ['Techniques', 'FTE'], notices: ['Techniques', 'Notices'],
    'cs-specialistes': ['RH', 'Livret'],
  };

  let prev = '';
  let busy = false;
  const S = { photos: [], audio: null, rec: null, recTimer: null, recStart: 0 };

  const form = () => $('#form-bug');
  function msg(err, ok) {
    $('.error', form()).textContent = err || '';
    $('.ok', form()).textContent = ok || '';
  }

  // ---------- catégorie / objet ----------
  function setObjets(cat, objet) {
    const sel = $('#bug-objet');
    const list = CATEGORIES[cat] || [];
    sel.replaceChildren();
    if (!list.length) {
      sel.append(new Option("— Choisir d'abord la catégorie —", ''));
      sel.disabled = true;
      return;
    }
    if (list.length > 1) sel.append(new Option('— Choisir —', ''));
    list.forEach(o => sel.append(new Option(o, o)));
    sel.disabled = false;
    if (objet && list.includes(objet)) sel.value = objet;
  }

  function open(prevPage) {
    prev = prevPage || '';
    msg('', '');
    const f = form();
    const vide = !f.elements.description.value && !S.photos.length && !S.audio && !f.elements.categorie.value;
    if (vide && DEPUIS[prev]) {
      f.elements.categorie.value = DEPUIS[prev][0];
      setObjets(DEPUIS[prev][0], DEPUIS[prev][1]);
    }
    majRec();
    flush();
  }

  // ---------- photos ----------
  // Réduite sur l'appareil (1280 px max, JPEG) : envoi rapide même en 4G faible
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }

  function renderPhotos() {
    const box = $('#bug-photos');
    box.replaceChildren(...S.photos.map((src, i) => {
      const d = document.createElement('div');
      d.className = 'bug-thumb';
      const img = document.createElement('img');
      img.src = src; img.alt = `Photo ${i + 1}`;
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', `Retirer la photo ${i + 1}`);
      x.addEventListener('click', () => { S.photos.splice(i, 1); renderPhotos(); });
      d.append(img, x);
      return d;
    }));
    const add = $('#bug-photo-input').closest('.bug-add');
    const plein = S.photos.length >= MAX_PHOTOS;
    $('#bug-photo-input').disabled = plein;
    add.setAttribute('aria-disabled', String(plein));
  }

  async function addPhotos(ev) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    const place = MAX_PHOTOS - S.photos.length;
    if (files.length > place) msg(`${MAX_PHOTOS} photos au maximum : les suivantes sont ignorées.`);
    for (const file of files.slice(0, place)) {
      try { S.photos.push(await compressPhoto(file)); } catch (e) { msg(e.message); }
    }
    renderPhotos();
  }

  // ---------- message vocal ----------
  const recSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  function mimeAudio() {
    const c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
    return c.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function majRec() {
    const btn = $('#bug-rec');
    const note = $('#bug-rec-note');
    if (!recSupported()) {
      btn.disabled = true;
      note.hidden = false;
      note.textContent = "L'enregistrement vocal n'est pas disponible sur ce navigateur.";
      return;
    }
    const on = !!S.rec;
    btn.classList.toggle('is-rec', on);
    $('#bug-rec-label').textContent = on ? 'Arrêter' : (S.audio ? 'Réenregistrer' : 'Enregistrer un vocal');
    $('#bug-rec-time').hidden = !on;
  }

  function setAudio(a) {
    const el = $('#bug-audio');
    if (el.src && el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
    S.audio = a;
    $('#bug-audio-box').hidden = !a;
    if (a) el.src = URL.createObjectURL(a.blob); else el.removeAttribute('src');
    majRec();
  }

  async function toggleRec() {
    if (S.rec) { S.rec.stop(); return; }
    msg('', '');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      msg("Micro inaccessible : autorisez l'accès au micro pour SMPM 84 dans les réglages du téléphone.");
      return;
    }
    const type = mimeAudio();
    const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    const parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(S.recTimer);
      const duree = Math.round((Date.now() - S.recStart) / 1000);
      S.rec = null;
      const blob = new Blob(parts, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
      if (blob.size) setAudio({ blob, duree }); else majRec();
    };
    S.rec = rec;
    S.recStart = Date.now();
    $('#bug-rec-time').textContent = `0:00 / ${fmt(MAX_VOICE_S)}`;
    S.recTimer = setInterval(() => {
      const s = (Date.now() - S.recStart) / 1000;
      $('#bug-rec-time').textContent = `${fmt(s)} / ${fmt(MAX_VOICE_S)}`;
      if (s >= MAX_VOICE_S && S.rec) S.rec.stop();
    }, 250);
    rec.start(1000);
    majRec();
  }

  const blobToDataUrl = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Vocal illisible'));
    r.readAsDataURL(blob);
  });

  // ---------- file d'attente hors ligne (IndexedDB : les pièces jointes dépassent localStorage) ----------
  function db() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('Stockage hors ligne indisponible')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { d.close(); resolve(req ? req.result : undefined); };
      t.onerror = t.onabort = () => { d.close(); reject(t.error || new Error('Mémoire de l’appareil pleine')); };
    });
  }
  const qAdd = item => tx('readwrite', s => s.put(Object.assign({ ts: Date.now() }, item)));
  const qDel = id => tx('readwrite', s => s.delete(id));
  const qAll = () => tx('readonly', s => s.getAll()).then(l => (l || []).sort((a, b) => a.ts - b.ts));

  async function reprendreAncienneFile() {
    let old = [];
    try { old = JSON.parse(localStorage.getItem(OLD_QUEUE) || '[]'); } catch (e) { return; }
    if (!old.length) return;
    try {
      for (const it of old) await qAdd(it);
      localStorage.removeItem(OLD_QUEUE);
    } catch (e) { /* on réessaiera */ }
  }

  const id = () => 'bug-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function envoyer(item) {
    return app().api('bug_report', { token: app().token(), bug: item.bug, submission_id: item.id });
  }

  /** Envoie les signalements gardés hors ligne. */
  async function flush() {
    if (busy || !navigator.onLine || !app() || !app().token()) return;
    busy = true;
    try {
      await reprendreAncienneFile();
      const q = await qAll();
      for (const it of q) {
        try { await envoyer(it); } catch (e) { break; }   // réseau ou serveur : on réessaiera plus tard
        await qDel(it.id);
      }
    } catch (e) { /* stockage indisponible */ } finally { busy = false; }
  }

  function reset() {
    form().reset();
    setObjets('');
    S.photos = [];
    renderPhotos();
    setAudio(null);
  }

  async function submit(ev) {
    ev.preventDefault();
    if (S.rec) { msg("Arrêtez d'abord l'enregistrement vocal."); return; }
    const f = form();
    const categorie = f.elements.categorie.value;
    const objet = f.elements.objet.value;
    const description = f.elements.description.value.trim();
    if (!categorie || !objet) { msg('Choisissez la catégorie et l’objet du signalement.'); return; }
    if (description.length < 5 && !S.audio && !S.photos.length) {
      msg('Décrivez le problème en quelques mots, ou joignez un vocal ou une photo.');
      return;
    }
    const btn = $('#btn-bug');
    btn.disabled = true;
    msg('', '');
    try {
      const vEl = document.getElementById('app-version');
      const appli = categorie === "L'application";
      const item = {
        id: id(),
        bug: {
          categorie, objet,
          gravite: f.elements.gravite.value,
          description,
          page: appli ? prev : '',
          version: appli && vEl ? vEl.textContent.trim() : '',
          appareil: appli ? navigator.userAgent + ' · ' + window.innerWidth + '×' + window.innerHeight : '',
          photos: S.photos.slice(),
          vocal: S.audio ? await blobToDataUrl(S.audio.blob) : '',
          vocal_duree: S.audio ? S.audio.duree : 0,
        },
      };
      try {
        const r = await envoyer(item);
        reset();
        msg('', `Merci ! Signalement n°${r.numero} transmis à l'administrateur.`);
      } catch (e) {
        if (e instanceof app().NetworkError) {
          try {
            await qAdd(item);
            reset();
            msg('', 'Pas de réseau : le signalement est gardé sur cet appareil et sera envoyé au retour de la connexion.');
          } catch (e2) {
            msg("Pas de réseau, et le signalement n'a pas pu être gardé sur l'appareil (mémoire pleine ?). Réessayez avec le réseau.");
          }
        } else if ((app().AUTH_ERRORS || []).includes(e.message)) {
          app().logout();
        } else {
          msg(e.message || 'Envoi impossible');
        }
      }
    } finally { btn.disabled = false; }
  }

  function init() {
    const f = form();
    if (!f || f.dataset.ready) return;
    f.dataset.ready = '1';
    f.addEventListener('submit', submit);
    $('#bug-cat').addEventListener('change', e => setObjets(e.target.value));
    $('#bug-photo-input').addEventListener('change', addPhotos);
    $('#bug-rec').addEventListener('click', toggleRec);
    $('#bug-audio-del').addEventListener('click', () => setAudio(null));
    majRec();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('online', () => setTimeout(flush, 3000));
  setTimeout(flush, 5000);

  window.SMPM_BUGS = { open, flush };
})();
