// Clochette des notifications (à côté du bouton ☰).
// - Liste les notifications reçues ces 60 derniers jours (historique serveur, backend/Push.gs : notif_list),
//   y compris pour les membres qui n'ont pas activé les notifications push sur leur téléphone.
// - Pastille rouge : nombre de notifications non lues.
// - Chaque notification non lue peut être « marquée comme lue » ; « Tout marquer comme lu » pour toutes.
//   Toucher une notification ouvre la page concernée (si elle en a une) et la marque comme lue.
// - Rafraîchie à l'ouverture de l'application, au retour sur l'application, à la réception
//   d'une notification push (message du service worker) et toutes les 10 minutes.
// - Dernière liste gardée sur l'appareil (consultation hors ligne), effacée à la déconnexion.
(() => {
  'use strict';

  const KEY = 'smpm_notifs';
  const POLL_MS = 10 * 60e3;
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    del() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };
  const app = () => window.SMPM_APP;
  const S = { on: false, items: [], loading: false, error: '', last: 0, timer: 0 };

  const fmtDate = t => {
    const d = new Date(t), now = new Date();
    const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return "Aujourd'hui " + h;
    const hier = new Date(now); hier.setDate(now.getDate() - 1);
    if (d.toDateString() === hier.toDateString()) return 'Hier ' + h;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + h;
  };
  const nonLues = () => S.items.filter(x => !x.lu).length;

  function renderCount() {
    const n = nonLues(), c = $('#notif-count'), b = $('#btn-notif');
    if (!c || !b) return;
    c.hidden = !n;
    c.textContent = n > 99 ? '99+' : String(n);
    b.setAttribute('aria-label', n ? `Notifications : ${n} non lue${n > 1 ? 's' : ''}` : 'Notifications');
    b.title = b.getAttribute('aria-label');
  }

  function render() {
    renderCount();
    const list = $('#notif-list'), status = $('#notif-status');
    if (!list) return;
    $('#notif-all').hidden = !nonLues();
    status.textContent = S.error || (S.loading && !S.items.length ? 'Chargement…' : (!S.items.length ? 'Aucune notification.' : ''));
    status.classList.toggle('error', !!S.error);
    list.textContent = '';
    S.items.forEach(x => {
      const li = document.createElement('li');
      li.className = 'notif-item' + (x.lu ? '' : ' unread');
      const body = document.createElement(x.page ? 'button' : 'div');
      body.className = 'notif-body';
      if (x.page) { body.type = 'button'; body.addEventListener('click', () => ouvrir(x)); }
      const t = document.createElement('strong'); t.textContent = x.titre;
      const p = document.createElement('p'); p.textContent = x.corps;
      const d = document.createElement('small'); d.className = 'muted'; d.textContent = fmtDate(x.date);
      body.append(t, p, d);
      li.append(body);
      if (!x.lu) {
        const m = document.createElement('button');
        m.type = 'button'; m.className = 'link notif-mark'; m.textContent = 'Marquer comme lue';
        m.addEventListener('click', () => marquer([x.id]));
        li.append(m);
      }
      list.append(li);
    });
  }

  async function charger() {
    const a = app();
    if (!S.on || !a || !a.token() || !navigator.onLine || S.loading) return;
    S.loading = true;
    render();
    try {
      const r = await a.api('notif_list', { token: a.token() });
      S.items = r.items || [];
      S.error = '';
      S.last = Date.now();
      store.set(S.items);
    } catch (e) {
      if (a.AUTH_ERRORS && a.AUTH_ERRORS.includes(e.message)) return a.logout();
      // serveur pas encore à jour (action inconnue) : clochette discrète, pas d'erreur affichée
      S.error = S.items.length ? '' : (navigator.onLine ? 'Notifications indisponibles pour le moment.' : 'Hors ligne.');
    } finally {
      S.loading = false;
      render();
    }
  }

  async function marquer(ids) {
    const a = app();
    // affichage immédiat, puis confirmation du serveur
    S.items.forEach(x => { if (ids === 'tout' || ids.includes(x.id)) x.lu = true; });
    store.set(S.items);
    render();
    if (!a || !navigator.onLine) return;
    try {
      const r = await a.api('notif_read', { token: a.token(), ids });
      S.items = r.items || S.items;
      store.set(S.items);
      render();
    } catch (e) {
      if (a.AUTH_ERRORS && a.AUTH_ERRORS.includes(e.message)) return a.logout();
    }
  }

  function ouvrir(x) {
    if (!x.lu) marquer([x.id]);
    fermer();
    if (x.page && app()) app().goto(x.page);
  }

  function ouvrirPanneau() {
    $('#notif-panel').hidden = false;
    $('#notif-scrim').hidden = false;
    $('#btn-notif').setAttribute('aria-expanded', 'true');
    render();
    if (Date.now() - S.last > 30e3) charger();
  }
  function fermer() {
    const p = $('#notif-panel');
    if (!p || p.hidden) return;
    p.hidden = true;
    $('#notif-scrim').hidden = true;
    $('#btn-notif').setAttribute('aria-expanded', 'false');
  }

  window.SMPM_NOTIFS = {
    /** Entrée dans l'application : affiche la clochette et charge la liste. */
    setSession(session, offline) {
      S.on = !!session;
      $('#btn-notif').hidden = !S.on;
      if (!S.items.length) S.items = store.get() || [];
      render();
      clearInterval(S.timer);
      if (S.on) {
        S.timer = setInterval(() => { if (document.visibilityState === 'visible') charger(); }, POLL_MS);
        if (!offline) charger();
      }
    },
    refresh: () => charger(),
    open: () => { if (S.on) ouvrirPanneau(); },
    close: fermer,
    reset() {
      S.on = false; S.items = []; S.last = 0; S.error = '';
      clearInterval(S.timer);
      store.del();
      fermer();
      const b = $('#btn-notif'); if (b) b.hidden = true;
      render();
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-notif').addEventListener('click', () => ($('#notif-panel').hidden ? ouvrirPanneau() : fermer()));
    $('#notif-close').addEventListener('click', fermer);
    $('#notif-scrim').addEventListener('click', fermer);
    $('#notif-all').addEventListener('click', () => marquer('tout'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.last > 60e3) charger();
    });
    window.addEventListener('online', () => charger());
    // notification push reçue application ouverte : le service worker prévient la page
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'notif') setTimeout(charger, 1500);
      });
    }
  });
})();
