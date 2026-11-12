// Clochette des notifications (à côté du bouton ☰).
// - Liste les notifications reçues ces 60 derniers jours (historique serveur, backend/Push.gs : notif_list),
//   y compris pour les membres qui n'ont pas activé les notifications push sur leur téléphone.
// - Pastille rouge : nombre de notifications non lues.
// - Chaque notification non lue peut être « marquée comme lue » ; « Tout marquer comme lu » pour toutes.
// - « Supprimer les lues » retire de la clochette, pour cette personne seulement, les notifications déjà lues.
// - Chaque notification peut être cochée pour être supprimée avec « Supprimer la sélection ».
//   « Tout cocher » / « Tout décocher » sélectionne ou désélectionne toute la liste.
//   Toucher une notification ouvre la page concernée (si elle en a une) et la marque comme lue.
// - Rafraîchie à l'ouverture de l'application, au retour sur l'application, à la réception
//   d'une notification push (message du service worker) et toutes les 10 minutes.
// - Dernière liste gardée sur l'appareil (consultation hors ligne), effacée à la déconnexion.
// - Une suppression est mémorisée sur l'appareil (KEY_SUPP) tant que le serveur ne l'a pas enregistrée :
//   la notification reste masquée et la suppression est renvoyée au prochain rafraîchissement
//   (hors ligne, serveur occupé, liste rechargée au même moment…).
(() => {
  'use strict';

  const KEY = 'smpm_notifs';
  const KEY_SUPP = 'smpm_notifs_supp';
  const POLL_MS = 10 * 60e3;
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    del() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };
  const app = () => window.SMPM_APP;
  // gen : incrémenté à chaque action locale (lecture, suppression) ; une liste demandée avant l'action est ignorée
  const S = { on: false, items: [], sel: new Set(), loading: false, error: '', last: 0, timer: 0, gen: 0, envoi: false };

  // Suppressions pas encore confirmées par le serveur (identifiants), gardées sur l'appareil
  const supp = {
    get() { try { const l = JSON.parse(localStorage.getItem(KEY_SUPP) || '[]'); return Array.isArray(l) ? l.map(String) : []; } catch (e) { return []; } },
    set(l) { try { if (l.length) localStorage.setItem(KEY_SUPP, JSON.stringify(l.slice(-200))); else localStorage.removeItem(KEY_SUPP); } catch (e) {} },
    add(ids) { supp.set(supp.get().concat(ids).filter((id, i, t) => t.indexOf(id) === i)); },
    del(ids) { supp.set(supp.get().filter(id => !ids.includes(id))); },
  };
  // Liste reçue du serveur, sans les notifications dont la suppression est en attente
  const sansSupp = items => { const att = supp.get(); return att.length ? items.filter(x => !att.includes(x.id)) : items; };
  function poser(items) {
    S.items = sansSupp(items || []);
    S.sel = new Set([...S.sel].filter(id => S.items.some(x => x.id === id)));
    store.set(S.items);
  }

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
    $('#notif-supp').hidden = !S.items.some(x => x.lu);
    const nSel = S.sel.size;
    const toutCoche = !!S.items.length && S.items.every(x => S.sel.has(x.id));
    $('#notif-sel-all').hidden = S.items.length < 2;
    $('#notif-sel-all').textContent = toutCoche ? 'Tout décocher' : 'Tout cocher';
    $('#notif-del-sel').hidden = !nSel;
    $('#notif-del-sel').textContent = `Supprimer la sélection (${nSel})`;
    status.textContent = S.error || (S.loading && !S.items.length ? 'Chargement…' : (!S.items.length ? 'Aucune notification.' : ''));
    status.classList.toggle('error', !!S.error);
    list.textContent = '';
    S.items.forEach(x => {
      const li = document.createElement('li');
      li.className = 'notif-item' + (x.lu ? '' : ' unread');
      const ck = document.createElement('input');
      ck.type = 'checkbox'; ck.className = 'notif-check'; ck.checked = S.sel.has(x.id);
      ck.setAttribute('aria-label', 'Sélectionner : ' + x.titre);
      ck.addEventListener('change', () => { if (ck.checked) S.sel.add(x.id); else S.sel.delete(x.id); render(); });
      const body = document.createElement(x.page ? 'button' : 'div');
      body.className = 'notif-body';
      if (x.page) { body.type = 'button'; body.addEventListener('click', () => ouvrir(x)); }
      const t = document.createElement('strong'); t.textContent = x.titre;
      const p = document.createElement('p'); p.textContent = x.corps;
      const d = document.createElement('small'); d.className = 'muted'; d.textContent = fmtDate(x.date);
      body.append(t, p, d);
      li.append(ck, body);
      if (!x.lu) {
        const m = document.createElement('button');
        m.type = 'button'; m.className = 'link notif-mark'; m.textContent = 'Marquer comme lue';
        m.addEventListener('click', () => marquer([x.id], 'clochette'));
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
    const gen = S.gen;
    let relancer = false;
    try {
      const r = await a.api('notif_list', { token: a.token() });
      // une lecture ou une suppression a eu lieu pendant l'appel : cette liste est déjà périmée
      if (gen !== S.gen) { relancer = true; return; }
      poser(r.items);
      S.error = '';
      S.last = Date.now();
      envoyerSupp();
    } catch (e) {
      if (a.AUTH_ERRORS && a.AUTH_ERRORS.includes(e.message)) return a.logout();
      // serveur pas encore à jour (action inconnue) : clochette discrète, pas d'erreur affichée
      S.error = S.items.length ? '' : (navigator.onLine ? 'Notifications indisponibles pour le moment.' : 'Hors ligne.');
    } finally {
      S.loading = false;
      render();
      if (relancer) setTimeout(charger, 3000);
    }
  }

  // Envoie au serveur les suppressions en attente. Renvoie '' si tout est enregistré, sinon le motif.
  async function envoyerSupp() {
    const a = app(), ids = supp.get();
    if (!ids.length || S.envoi || !a || !a.token()) return '';
    if (!navigator.onLine) return 'hors ligne';
    S.envoi = true;
    const gen = S.gen;
    try {
      const r = await a.api('notif_delete', { token: a.token(), ids });
      const reste = (r.items || []).filter(x => ids.includes(x.id)).map(x => x.id);
      supp.del(ids.filter(id => !reste.includes(id)));      // enregistrées par le serveur
      if (gen === S.gen) { poser(r.items); render(); }
      return reste.length ? 'le serveur ne les a pas retirées' : '';
    } catch (e) {
      if (a.AUTH_ERRORS && a.AUTH_ERRORS.includes(e.message)) { a.logout(); return ''; }
      return e.message || 'erreur';
    } finally {
      S.envoi = false;
    }
  }

  // mode (inscrit côté serveur) : 'clic' notification touchée, 'liste' ouverte dans la clochette,
  // 'clochette' Marquer comme lue ; 'tout' déduit par le serveur
  async function marquer(ids, mode) {
    const a = app();
    // affichage immédiat, puis confirmation du serveur
    const gen = ++S.gen;
    S.items.forEach(x => { if (ids === 'tout' || ids.includes(x.id)) x.lu = true; });
    store.set(S.items);
    render();
    if (!a || !navigator.onLine) return;
    try {
      const r = await a.api('notif_read', { token: a.token(), ids, mode: mode || '' });
      if (gen !== S.gen) return;
      poser(r.items || S.items);
      render();
    } catch (e) {
      if (a.AUTH_ERRORS && a.AUTH_ERRORS.includes(e.message)) return a.logout();
    }
  }

  // Retire de la clochette, pour cette personne : 'lues' (toutes les lues) ou liste d'identifiants choisis (serveur : notif_delete)
  async function supprimer(ids) {
    const tous = ids === 'lues';
    const liste = (tous ? S.items.filter(x => x.lu).map(x => x.id) : ids).map(String);
    const n = liste.length;
    if (!n) return;
    const q = tous ? 'Supprimer les notifications lues' : `Supprimer ${n} notification${n > 1 ? 's' : ''}`;
    if (!confirm(q + ' ? Elles ne seront plus affichées dans votre clochette.')) return;
    S.gen++;
    supp.add(liste);
    poser(S.items);
    S.error = '';
    render();
    const motif = await envoyerSupp();
    if (motif && supp.get().length) {
      S.error = motif === 'hors ligne'
        ? 'Hors ligne : la suppression sera enregistrée au retour du réseau.'
        : `Suppression pas encore enregistrée sur le serveur (${motif}) : nouvel essai automatique.`;
      render();
    }
  }

  function ouvrir(x) {
    if (!x.lu) marquer([x.id], 'liste');
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
      if (!S.items.length) S.items = sansSupp(store.get() || []);
      render();
      clearInterval(S.timer);
      if (S.on) {
        S.timer = setInterval(() => { if (document.visibilityState === 'visible') charger(); }, POLL_MS);
        if (!offline) charger();
      }
    },
    refresh: () => charger(),
    open: () => { if (S.on) ouvrirPanneau(); },
    /** Notification push touchée : marquée lue (date et heure inscrites dans l'historique du serveur). */
    lue: (id, mode) => { if (S.on && id) marquer([String(id)], mode); },
    close: fermer,
    reset() {
      S.on = false; S.items = []; S.last = 0; S.error = ''; S.gen++; S.sel = new Set();
      clearInterval(S.timer);
      store.del();
      supp.set([]);
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
    $('#notif-supp').addEventListener('click', () => supprimer('lues'));
    $('#notif-sel-all').addEventListener('click', () => {
      const toutCoche = S.items.every(x => S.sel.has(x.id));
      S.sel = toutCoche ? new Set() : new Set(S.items.map(x => x.id));
      render();
    });
    $('#notif-del-sel').addEventListener('click', () => supprimer([...S.sel]));
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
