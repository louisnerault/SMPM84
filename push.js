// Notifications push (Firebase Cloud Messaging), encart « Notifications » de « Mon profil ».
// - Chaque membre peut activer les notifications sur son téléphone : l'appareil reçoit un jeton FCM,
//   enregistré côté serveur (action push_register) avec son nom, sa fonction et son secteur.
// - Le serveur (backend/Push.gs) envoie ensuite les messages : nouvelle demande de validation au chef
//   d'unité, décision sur une demande à l'équipier, messages de l'encadrement.
// - Les messages arrivent même application fermée : ils sont affichés par le service worker (sw.js, « push »).
// - iPhone/iPad : iOS 16.4 minimum et application ajoutée à l'écran d'accueil.
// - Désactivé tant que la configuration Firebase (config.js > FIREBASE) n'est pas renseignée.
// - Déconnexion : l'appareil est désabonné (appareil partagé).
(() => {
  'use strict';

  const FB_VERSION = '10.12.2';
  const KEY_FCM = 'smpm_push_fcm';            // jeton FCM de l'appareil (pour le désabonnement)
  const KEY_SYNC = 'smpm_push_sync';          // dernier envoi du jeton au serveur (ms)
  const RESYNC_MS = 24 * 3600e3;              // jeton renvoyé une fois par jour (fonction, secteur à jour)
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const app = () => window.SMPM_APP;
  const cfg = () => (window.SMPM_CONFIG && window.SMPM_CONFIG.FIREBASE) || {};
  const configured = () => !!(cfg().apiKey && cfg().projectId && cfg().messagingSenderId && cfg().appId && cfg().vapidKey);

  const S = { session: null, busy: false, messaging: null };

  // ---------- capacités de l'appareil ----------
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const supported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

  /** État affiché : 'off' (non configuré), 'ios-install', 'unsupported', 'denied', 'default', 'granted'. */
  function etat() {
    if (!configured()) return 'off';
    if (isIos() && !standalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    return Notification.permission;          // 'default' | 'granted' | 'denied'
  }

  // ---------- Firebase (chargé seulement si nécessaire) ----------
  async function messaging() {
    if (S.messaging) return S.messaging;
    const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
    const [{ initializeApp }, m] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-messaging.js'),
    ]);
    if (!(await m.isSupported())) throw new Error('Notifications non prises en charge sur cet appareil');
    const c = cfg();
    const fb = initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, messagingSenderId: c.messagingSenderId, appId: c.appId });
    S.messaging = { m, inst: m.getMessaging(fb) };
    return S.messaging;
  }

  /** Jeton FCM de l'appareil, lié au service worker de l'application (pas de second service worker). */
  async function jetonFcm() {
    const reg = await navigator.serviceWorker.ready;
    const { m, inst } = await messaging();
    const t = await m.getToken(inst, { vapidKey: cfg().vapidKey, serviceWorkerRegistration: reg });
    if (!t) throw new Error("Impossible d'obtenir l'abonnement de cet appareil");
    return t;
  }

  function appareil() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || isIos()) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac/.test(ua)) return 'Mac';
    return 'Autre';
  }

  /** Envoie le jeton au serveur (à l'activation, puis une fois par jour ou s'il a changé). */
  async function enregistrer(force) {
    if (!app() || !app().token() || !navigator.onLine) return;
    const fcm = await jetonFcm();
    const old = store.get(KEY_FCM);
    const last = Number(store.get(KEY_SYNC) || 0);
    if (!force && fcm === old && Date.now() - last < RESYNC_MS) return;
    await app().api('push_register', { token: app().token(), fcm, appareil: appareil(), ancien: old && old !== fcm ? old : '' });
    store.set(KEY_FCM, fcm);
    store.set(KEY_SYNC, String(Date.now()));
  }

  // ---------- encart « Notifications » ----------
  function msg(text, isError) {
    const ok = $('#push-status'), err = $('#push-error');
    if (!ok || !err) return;
    ok.textContent = isError ? '' : (text || '');
    err.textContent = isError ? (text || '') : '';
  }

  function render() {
    const card = $('#push-card');
    if (!card) return;
    const e = etat();
    card.hidden = !S.session || e === 'off';
    if (card.hidden) return;
    const txt = {
      'ios-install': "Sur iPhone et iPad, ajoutez d'abord l'application à l'écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »), puis ouvrez-la depuis son icône.",
      'unsupported': "Ce navigateur ne permet pas de recevoir des notifications. Sur Android, utilisez Chrome ; sur iPhone, iOS 16.4 ou plus récent.",
      'denied': "Les notifications sont bloquées pour l'application. Autorisez-les dans les réglages du téléphone (Notifications > SMPM 84), puis rouvrez l'application.",
      'default': "Recevez sur ce téléphone, même application fermée : les demandes de validation à traiter, la réponse à vos demandes et les messages de l'encadrement.",
      'granted': store.get(KEY_FCM) ? 'Notifications activées sur ce téléphone.' : 'Notifications autorisées : finalisation de l\'abonnement…',
    }[e];
    $('#push-text').textContent = txt;
    $('#btn-push-on').hidden = e !== 'default';
    $('#btn-push-test').hidden = !(e === 'granted' && store.get(KEY_FCM));
    $('#btn-push-off').hidden = !(e === 'granted' && store.get(KEY_FCM));
    renderEnvoi();
  }

  async function activer() {
    if (S.busy) return;
    S.busy = true;
    msg('');
    try {
      const p = await Promise.resolve(Notification.requestPermission());
      if (p !== 'granted') { render(); return; }
      if (!navigator.onLine) throw new Error('Connexion nécessaire pour terminer l\'activation');
      await enregistrer(true);
      msg('Notifications activées.');
    } catch (err) {
      if (app() && app().AUTH_ERRORS.includes(err.message)) return app().logout();
      msg(err.message || 'Activation impossible', true);
    } finally {
      S.busy = false;
      render();
    }
  }

  async function desactiver() {
    if (S.busy) return;
    S.busy = true;
    msg('');
    try {
      const fcm = store.get(KEY_FCM);
      if (fcm && app() && app().token()) await app().api('push_unregister', { token: app().token(), fcm });
      try { const { m, inst } = await messaging(); await m.deleteToken(inst); } catch (e) { /* déjà supprimé */ }
      store.del(KEY_FCM);
      store.del(KEY_SYNC);
      msg('Ce téléphone ne recevra plus de notifications.');
    } catch (err) {
      msg(err.message || 'Désactivation impossible', true);
    } finally {
      S.busy = false;
      render();
    }
  }

  async function tester() {
    if (S.busy) return;
    S.busy = true;
    msg('');
    try {
      await enregistrer(false);
      const r = await app().api('push_test', { token: app().token() });
      msg(r.envoyes ? 'Notification de test envoyée : elle arrive dans quelques secondes.' : 'Aucun appareil abonné trouvé : désactivez puis réactivez.', !r.envoyes);
    } catch (err) {
      msg(err.message || 'Envoi impossible', true);
    } finally {
      S.busy = false;
    }
  }

  // ---------- envoi d'un message (encadrement) ----------
  const peutEnvoyer = s => !!s && (s.is_admin === true || ['ctd', 'admin', 'chef_section'].includes(s.role));

  function renderEnvoi() {
    const box = $('#push-send');
    if (!box) return;
    box.hidden = !peutEnvoyer(S.session);
    if (box.hidden) return;
    const sel = $('#push-cible');
    if (sel.dataset.done) return;
    const s = S.session;
    const tout = s.is_admin === true || ['ctd', 'admin'].includes(s.role);
    const opts = [];
    if (tout) opts.push(['tous', 'Tous les membres'], ['encadrement', "Encadrement (chefs d'unité et plus)"]);
    const sec = app() ? app().section() : '';
    const sections = tout ? ['NORD', 'SUD', 'CENTRE', 'NEIGE', 'ISS', 'SSSM'] : [String(sec).toUpperCase()].filter(Boolean);
    sections.forEach(c => opts.push(['section:' + c, 'Section ' + (c.length > 4 ? c.charAt(0) + c.slice(1).toLowerCase() : c)]));
    sel.textContent = '';
    opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.dataset.done = '1';
  }

  async function envoyer(ev) {
    ev.preventDefault();
    const f = ev.target;
    const titre = f.titre.value.trim(), message = f.message.value.trim(), cible = f.cible.value;
    const err = $('#push-send-error'), ok = $('#push-send-status');
    err.textContent = ''; ok.textContent = '';
    if (!titre || !message) { err.textContent = 'Titre et message obligatoires'; return; }
    const libelle = f.cible.selectedOptions[0] ? f.cible.selectedOptions[0].textContent : cible;
    if (!confirm(`Envoyer cette notification à : ${libelle} ?`)) return;
    const btn = $('#btn-push-send');
    btn.disabled = true;
    try {
      const r = await app().api('push_send', { token: app().token(), titre, message, cible });
      ok.textContent = r.personnes
        ? `Envoyée à ${r.personnes} personne${r.personnes > 1 ? 's' : ''} (${r.envoyes} appareil${r.envoyes > 1 ? 's' : ''}).`
        : "Personne n'a encore activé les notifications dans ce groupe.";
      if (r.personnes) f.reset();
    } catch (e) {
      if (app().AUTH_ERRORS.includes(e.message)) return app().logout();
      err.textContent = e.message || 'Envoi impossible';
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- interface avec app.js ----------
  window.SMPM_PUSH = {
    /** Appelé à chaque chargement du profil : affiche l'encart et tient l'abonnement à jour. */
    setSession(session) {
      const changed = !S.session || !session || S.session.role !== session.role || S.session.is_admin !== session.is_admin;
      S.session = session || null;
      if (changed) { const sel = $('#push-cible'); if (sel) delete sel.dataset.done; }
      render();
      if (session && etat() === 'granted') enregistrer(false).then(render).catch(() => {});
    },
    /** Déconnexion : désabonne l'appareil (appel avant la suppression du jeton de session). */
    reset(sessionToken) {
      const fcm = store.get(KEY_FCM);
      store.del(KEY_FCM);
      store.del(KEY_SYNC);
      S.session = null;
      render();
      if (fcm && sessionToken && app()) app().api('push_unregister', { token: sessionToken, fcm }).catch(() => {});
      if (fcm && S.messaging) S.messaging.m.deleteToken(S.messaging.inst).catch(() => {});
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const on = $('#btn-push-on'), off = $('#btn-push-off'), test = $('#btn-push-test'), form = $('#push-send-form');
    if (on) on.addEventListener('click', activer);
    if (off) off.addEventListener('click', desactiver);
    if (test) test.addEventListener('click', tester);
    if (form) form.addEventListener('submit', envoyer);
    // Retour sur l'application (ex. après avoir autorisé les notifications dans les réglages)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  });
})();
