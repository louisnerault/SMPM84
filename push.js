// Notifications push (Firebase Cloud Messaging), encart « Notifications » de « Mon profil ».
// - Chaque membre peut activer les notifications sur son téléphone : l'appareil reçoit un jeton FCM,
//   enregistré côté serveur (action push_register) avec son nom, sa fonction et son secteur.
// - Le serveur (backend/Push.gs) envoie ensuite les messages : nouvelle demande de validation au chef
//   d'unité, décision sur une demande à l'équipier, messages de l'encadrement.
// - Les messages arrivent même application fermée : ils sont affichés par le service worker (sw.js, « push »).
// - iPhone/iPad : iOS 16.4 minimum et application ajoutée à l'écran d'accueil.
// - Désactivé tant que la configuration Firebase (config.js > FIREBASE) n'est pas renseignée.
// - Déconnexion : l'appareil est désabonné (appareil partagé).
// - À l'ouverture : fenêtre d'invitation tant que ce téléphone n'est pas abonné (« Ne plus me le proposer » possible).
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

  // Délais maximaux de chaque étape de l'activation : au-delà, message explicite au lieu d'une attente muette.
  const DELAI = { permission: 60e3, sw: 15e3, firebase: 20e3, fcm: 20e3, serveur: 45e3 };
  const ERR = {
    permission: "Pas de réponse à la demande d'autorisation. Autorisez les notifications pour SMPM 84 (ou pour Chrome) dans les réglages du téléphone, puis touchez de nouveau le bouton.",
    refus: "Autorisation non accordée : touchez de nouveau le bouton et choisissez « Autoriser ». Si aucune fenêtre ne s'affiche, autorisez les notifications dans les réglages du téléphone.",
    sw: "L'application n'est pas complètement installée sur ce téléphone. Fermez-la complètement, rouvrez-la avec du réseau, puis réessayez.",
    firebase: "Impossible de charger le module de notifications. Vérifiez la connexion internet, puis réessayez.",
    fcm: "Ce téléphone ne parvient pas à joindre le service de notifications de Google (téléphone sans services Google, comme certains Huawei, économiseur de données ou navigateur non compatible). Sur Android, utilisez Chrome.",
  };
  /** Promesse limitée dans le temps : rejetée avec le message donné si elle n'aboutit pas à temps. */
  function avecDelai(promesse, ms, message) {
    let t;
    return Promise.race([
      promesse,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); }),
    ]).finally(() => clearTimeout(t));
  }

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
    const [{ initializeApp }, m] = await avecDelai(Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-messaging.js'),
    ]), DELAI.firebase, ERR.firebase);
    if (!(await m.isSupported())) throw new Error('Notifications non prises en charge sur cet appareil');
    const c = cfg();
    const fb = initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, messagingSenderId: c.messagingSenderId, appId: c.appId });
    S.messaging = { m, inst: m.getMessaging(fb) };
    return S.messaging;
  }

  /** Jeton FCM de l'appareil, lié au service worker de l'application (pas de second service worker). */
  async function jetonFcm() {
    const reg = await avecDelai(navigator.serviceWorker.ready, DELAI.sw, ERR.sw);
    const { m, inst } = await messaging();
    const t = await avecDelai(m.getToken(inst, { vapidKey: cfg().vapidKey, serviceWorkerRegistration: reg }), DELAI.fcm, ERR.fcm);
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
  async function enregistrer(force, etape) {
    if (!app() || !app().token() || !navigator.onLine) return;
    if (etape) etape('Abonnement de ce téléphone…');
    const fcm = await jetonFcm();
    const old = store.get(KEY_FCM);
    const last = Number(store.get(KEY_SYNC) || 0);
    if (!force && fcm === old && Date.now() - last < RESYNC_MS) return;
    if (etape) etape('Enregistrement auprès du serveur…');
    await app().api('push_register', { token: app().token(), fcm, appareil: appareil(), ancien: old && old !== fcm ? old : '' }, { timeout: DELAI.serveur });
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
      'granted': store.get(KEY_FCM) ? 'Notifications activées sur ce téléphone.' : 'Notifications autorisées, mais ce téléphone n\'est pas encore abonné : touchez « Activer les notifications ».',
    }[e];
    $('#push-text').textContent = txt;
    $('#btn-push-on').hidden = !(e === 'default' || (e === 'granted' && !store.get(KEY_FCM)));
    $('#btn-push-test').hidden = !(e === 'granted' && store.get(KEY_FCM));
    $('#btn-push-off').hidden = !(e === 'granted' && store.get(KEY_FCM));
    renderEnvoi();
  }

  /** Activation ; ui (facultatif) : bouton et zone de messages de la fenêtre d'invitation. Renvoie l'état final. */
  async function activer(ui) {
    if (S.busy) return null;
    S.busy = true;
    const parInvite = ui && ui.btn;
    const btn = parInvite ? ui.btn : $('#btn-push-on');
    const say = parInvite ? ui.msg : msg;
    const libelle = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Activation en cours…'; }
    say('Demande d\'autorisation…');
    let resultat = 'erreur';
    try {
      const p = await avecDelai(Promise.resolve(Notification.requestPermission()), DELAI.permission, ERR.permission);
      if (p === 'denied') { say(''); resultat = 'denied'; return resultat; }   // l'encart explique comment rétablir l'autorisation
      if (p !== 'granted') throw new Error(ERR.refus);
      if (!navigator.onLine) throw new Error('Connexion nécessaire pour terminer l\'activation');
      await enregistrer(true, t => say(t));
      say('Notifications activées.');
      resultat = 'ok';
    } catch (err) {
      if (app() && app().AUTH_ERRORS.includes(err.message)) { app().logout(); return null; }
      say(err.message || 'Activation impossible', true);
    } finally {
      S.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = libelle; }
      render();
    }
    return resultat;
  }

  // ---------- fenêtre d'invitation à l'ouverture ----------
  // Proposée à chaque ouverture de l'application tant que ce téléphone n'est pas abonné,
  // sauf si l'utilisateur a choisi « Ne plus me le proposer » (mémorisé sur l'appareil).
  const KEY_INVITE_OFF = 'smpm_push_invite_off';
  let inviteVue = false;                                   // une seule fois par ouverture

  /** Situation de l'appareil qui justifie l'invitation, ou null. */
  function besoinInvite() {
    const e = etat();
    if (e === 'default' || e === 'ios-install' || e === 'denied') return e;
    if (e === 'granted' && !store.get(KEY_FCM)) return 'default';
    return null;
  }

  function inviter() {
    if (inviteVue || !S.session || store.get(KEY_INVITE_OFF)) return;
    const cas = besoinInvite();
    if (!cas || (cas === 'default' && !navigator.onLine)) return;   // hors ligne : activation impossible, on proposera plus tard
    // Laisser passer la fenêtre « Nouveautés » ou toute autre fenêtre ouverte
    if (document.querySelector('dialog[open]')) { setTimeout(inviter, 800); return; }
    inviteVue = true;

    const dlg = document.createElement('dialog');
    dlg.className = 'ann-dialog push-invite';
    dlg.setAttribute('aria-labelledby', 'push-invite-title');
    const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt) n.textContent = txt; return n; };
    const h = el('h2', '', '🔔 Activez les notifications');
    h.id = 'push-invite-title';
    const intro = el('p', '', 'Vous n\'avez pas encore activé les notifications sur ce téléphone. Elles vous préviennent immédiatement, même application fermée :');
    const ul = el('ul', 'push-invite-list');
    [
      'la réponse à vos demandes (FMPA validée ou refusée, point d\'intérêt accepté…) ;',
      'les FMPA proposées au planning, les inscriptions et les informations de rendez-vous ;',
      'les messages de l\'encadrement et les alertes de la spécialité ;',
      'les demandes à traiter si vous encadrez (validations, propositions).',
    ].forEach(t => ul.append(el('li', '', t)));
    const fin = el('p', 'muted small', 'Vous ne recevez que ce qui vous concerne. Vous pouvez les désactiver à tout moment dans « Mon profil ».');
    const consigne = el('p', 'push-invite-consigne');
    if (cas === 'ios-install') consigne.textContent = 'Sur iPhone et iPad, ajoutez d\'abord l\'application à l\'écran d\'accueil (bouton Partager, puis « Sur l\'écran d\'accueil »), ouvrez-la depuis son icône, puis activez les notifications.';
    else if (cas === 'denied') consigne.textContent = 'Les notifications sont actuellement bloquées pour l\'application : autorisez-les dans les réglages du téléphone (Notifications > SMPM 84 ou Chrome), puis rouvrez l\'application.';
    else consigne.hidden = true;
    const ok = el('p', 'ok small'); ok.setAttribute('role', 'status');
    const err = el('p', 'error small'); err.setAttribute('role', 'alert');
    const say = (t, isErr) => { ok.textContent = isErr ? '' : (t || ''); err.textContent = isErr ? (t || '') : ''; };

    const btns = el('div', 'ann-dialog-btns push-invite-btns');
    const plusTard = el('button', 'push-invite-later', cas === 'default' ? 'Plus tard' : 'Fermer');
    plusTard.type = 'button';
    plusTard.addEventListener('click', () => dlg.close());
    btns.append(plusTard);
    if (cas === 'default') {
      const go = el('button', 'primary', 'Activer les notifications');
      go.type = 'button';
      go.addEventListener('click', async () => {
        plusTard.disabled = true;
        const r = await activer({ btn: go, msg: say });
        plusTard.disabled = false;
        if (r === 'ok') { go.hidden = true; plusTard.textContent = 'Fermer'; setTimeout(() => { if (dlg.open) dlg.close(); }, 1500); }
        else if (r === 'denied') {
          go.hidden = true; plusTard.textContent = 'Fermer';
          consigne.hidden = false;
          consigne.textContent = 'Autorisation refusée. Pour la rétablir : réglages du téléphone > Notifications > SMPM 84 (ou Chrome), puis rouvrez l\'application.';
        }
      });
      btns.append(go);
    }
    const jamais = el('button', 'link push-invite-never', 'Ne plus me le proposer');
    jamais.type = 'button';
    jamais.addEventListener('click', () => { store.set(KEY_INVITE_OFF, '1'); dlg.close(); });

    dlg.append(h, intro, ul, fin, consigne, ok, err, btns, jamais);
    dlg.addEventListener('cancel', e => { if (S.busy) e.preventDefault(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
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
      if (session) setTimeout(inviter, 1200);   // après l'affichage de l'accueil (et des Nouveautés)
      if (session && etat() === 'granted') enregistrer(!store.get(KEY_FCM)).then(render).catch(err => { if (!store.get(KEY_FCM)) msg(err.message || 'Abonnement impossible', true); });
    },
    /** Déconnexion : désabonne l'appareil (appel avant la suppression du jeton de session). */
    reset(sessionToken) {
      const fcm = store.get(KEY_FCM);
      store.del(KEY_FCM);
      store.del(KEY_SYNC);
      S.session = null;
      inviteVue = false;
      render();
      if (fcm && sessionToken && app()) app().api('push_unregister', { token: sessionToken, fcm }).catch(() => {});
      if (fcm && S.messaging) S.messaging.m.deleteToken(S.messaging.inst).catch(() => {});
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const on = $('#btn-push-on'), off = $('#btn-push-off'), test = $('#btn-push-test'), form = $('#push-send-form');
    if (on) on.addEventListener('click', () => activer());
    if (off) off.addEventListener('click', desactiver);
    if (test) test.addEventListener('click', tester);
    if (form) form.addEventListener('submit', envoyer);
    // Retour sur l'application (ex. après avoir autorisé les notifications dans les réglages)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      render();
      if (S.session && !S.busy && etat() === 'granted' && !store.get(KEY_FCM)) {
        enregistrer(true).then(() => { msg('Notifications activées.'); render(); })
          .catch(err => msg(err.message || 'Abonnement impossible', true));
      }
    });
  });
})();
