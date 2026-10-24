// Demandes de validation des thèmes FMPA (rubrique FMPA > Demandes à valider).
// L'équipier saisit les thèmes vus en FMPA dans le formulaire « thèmes » ; la demande arrive dans le
// fichier CORE. Le chef d'unité désigné la valide (copie dans l'onglet LOGS du livret de l'agent)
// ou la rejette (motif facultatif). L'agent est prévenu par mail dans les deux cas.
// Actions : cu_list (liste), cu_decide (valider / rejeter). Dernière liste gardée pour l'affichage hors ligne.
(() => {
  'use strict';

  const KEY = 'smpm_cu_demandes';
  const KEY_VUES = 'smpm_cu_vues';          // demandes déjà signalées (pour ne notifier que les nouvelles)
  const REFRESH_MS = 5 * 60e3;              // compteur rafraîchi toutes les 5 min quand l'app est ouverte
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

  const S = { data: null, filtre: 'moi', busy: {}, loading: false, active: false, lastLoad: 0 };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    return n;
  }

  function open() {
    S.active = true;
    if (!S.data) S.data = store.getJSON(KEY);
    render();
    load();
  }

  /** Charge la liste ; silent : mise à jour du compteur du menu sans message. */
  async function load(silent) {
    if (S.loading) return;
    S.loading = true;
    if (!silent) setState(S.data ? 'Mise à jour…' : 'Chargement…');
    try {
      const res = await app().api('cu_list', { token: app().token() });
      S.data = { demandes: res.demandes || [], maj: res.maj };
      S.lastLoad = Date.now();
      store.set(KEY, JSON.stringify(S.data));
      if (!silent) setState('');
      render();
      signalerNouvelles();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      if (silent) return;
      const maj = S.data && S.data.maj ? new Date(S.data.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (S.data ? `Hors ligne : liste du ${maj}. Valider ou rejeter nécessite le réseau.` : 'Hors ligne : liste indisponible sur cet appareil.')
        : err.message === 'Action inconnue' ? 'La validation des thèmes n’est pas encore activée sur le serveur.' : err.message, !S.data);
    } finally { S.loading = false; }
  }

  function setState(msg, isError) {
    const p = $('#cuv-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  // Pastilles et notifications : uniquement les demandes adressées à l'utilisateur en tant que chef d'unité
  // (celles des manœuvres qu'il a encadrées). Celles qu'un CT ou un administrateur voit pour les autres ne comptent pas.
  const aMoi = () => (S.data ? S.data.demandes.filter(d => d.par === 'cu') : []);

  /** Pastilles : menu (bouton ☰, groupe FMPA, Validation des livrets) et icône de l'application. */
  function badge() {
    const n = aMoi().length;
    document.querySelectorAll('[data-cu-count]').forEach(b => {
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !n;
    });
    iconBadge(n);
  }

  // Nombre sur l'icône de l'application (API Badging : iPhone/iPad 16.4+ installée sur l'écran
  // d'accueil avec notifications autorisées, Chrome/Edge sur ordinateur ; non disponible sur Android)
  function iconBadge(n) {
    try {
      if (!('setAppBadge' in navigator)) return;
      (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
    } catch (e) { /* non pris en charge */ }
  }

  // ---------- notifications ----------
  const notifPossible = () => 'Notification' in window && 'serviceWorker' in navigator;

  /** Notification système pour les demandes arrivées depuis le dernier passage (aussi : pastille de l'icône sur Android). */
  async function signalerNouvelles() {
    const mes = aMoi();
    const ids = mes.map(d => d.id);
    const vues = store.getJSON(KEY_VUES);
    store.set(KEY_VUES, JSON.stringify(ids));
    if (!vues) return;                                   // premier chargement sur l'appareil : rien de « nouveau »
    const nouvelles = mes.filter(d => !vues.includes(d.id));
    if (!nouvelles.length || !notifPossible() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && !$('#tab-fmpa-valid').hidden) return;   // déjà sous les yeux
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const d = nouvelles[0];
      const qui = [d.prenom, d.agent].filter(Boolean).join(' ');
      await reg.showNotification('Validation des livrets', {
        body: nouvelles.length > 1
          ? `${nouvelles.length} nouvelles demandes de validation de thèmes (${mes.length} en attente).`
          : `${qui || 'Un équipier'} demande la validation de ses thèmes${d.date ? ' (FMPA du ' + d.date.split('-').reverse().join('/') + ')' : ''}.`,
        tag: 'smpm-cu-validation', renotify: true,
        icon: 'assets/icon-192.png', badge: 'assets/icon-192.png',
        data: { page: 'fmpa-valid' },
      });
    } catch (e) { /* notifications indisponibles : la pastille du menu suffit */ }
  }

  // Encart d'activation (une seule demande d'autorisation, sur action de l'utilisateur)
  function renderNotif() {
    const box = $('#cuv-notif');
    if (!box) return;
    box.hidden = !(S.active && notifPossible() && Notification.permission === 'default');
  }
  function activerNotif() {
    if (!notifPossible()) return;
    Promise.resolve(Notification.requestPermission()).catch(() => {}).then(() => {
      renderNotif();
      badge();
    });
  }

  // Rafraîchissement du compteur : retour sur l'application, puis toutes les 5 min
  function refreshAuto() {
    if (!S.active || S.loading || !navigator.onLine || !app() || !app().token()) return;
    if (Date.now() - S.lastLoad < 60e3) return;
    load(true);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAuto(); });
  window.addEventListener('online', refreshAuto);
  setInterval(() => { if (document.visibilityState === 'visible') refreshAuto(); }, REFRESH_MS);

  function render() {
    badge();
    renderNotif();
    if ($('#tab-fmpa-valid').hidden) return;
    const all = (S.data && S.data.demandes) || [];
    const autres = all.filter(d => d.par !== 'cu').length;
    const filtres = $('#cuv-filtres');
    filtres.hidden = !autres;
    if (!autres) S.filtre = 'moi';
    filtres.querySelectorAll('.pill').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === S.filtre)));
    const list = S.filtre === 'moi' ? all.filter(d => d.par === 'cu') : all;

    const empty = $('#cuv-empty');
    empty.hidden = !S.data || list.length > 0;
    empty.textContent = S.filtre === 'moi'
      ? (autres ? 'Aucune demande ne vous est adressée. Voir « Toutes » pour les autres demandes en attente.' : 'Aucune demande en attente. Tout est à jour.')
      : 'Aucune demande en attente.';
    $('#cuv-list').replaceChildren(...list.map(card));
  }

  function card(d) {
    const [, m, j] = (d.date || '').split('-').map(Number);
    const li = el('li', { class: 'cuv-item' });
    const head = el('div', { class: 'cuv-head' },
      el('time', { class: 'fmpa-date', datetime: d.date },
        el('strong', { text: j ? String(j) : '–' }), el('span', { text: MOIS[(m || 1) - 1] || '' })),
      el('div', { class: 'fmpa-body' },
        el('p', { class: 'fmpa-lieu', text: [d.prenom, d.agent].filter(Boolean).join(' ') || 'Agent inconnu' }),
        el('p', { class: 'fmpa-meta', text: [
          d.secteur ? `SMPM ${cap(d.secteur)}` : '',
          d.par !== 'cu' && d.cu ? `adressée à ${d.cu}` : '',
          'demandée le ' + new Date(d.horodateur).toLocaleDateString('fr-FR'),
        ].filter(Boolean).join(' · ') })));

    const body = el('div', { class: 'cuv-content' });
    if (!d.themes.length && !d.infos.length) body.append(el('p', { class: 'muted small', text: 'Aucun thème renseigné.' }));
    d.themes.forEach(t => body.append(
      el('p', { class: 'cuv-titre', text: t.titre }),
      el('ul', { class: 'chips' }, t.items.map(x => el('li', { text: x })))));
    const infos = d.infos.filter(x => !MASQUES.some(r => r.test(cle(x.titre))));
    if (infos.length) body.append(el('dl', { class: 'cuv-infos' },
      infos.flatMap(x => [el('dt', { text: libelle(x.titre) }), el('dd', null, valeurInfo(x))])));

    const msg = el('p', { class: 'fmpa-msg', role: 'alert' });
    const motif = el('textarea', { class: 'cuv-motif', rows: '2', maxlength: '500', placeholder: 'Motif du rejet (facultatif, transmis à l’agent)', hidden: true });
    const off = !navigator.onLine;
    const busy = !!S.busy[d.id];
    const bValider = el('button', { type: 'button', class: 'primary cuv-ok', disabled: off || busy, text: 'Valider' });
    const bRejeter = el('button', { type: 'button', class: 'cuv-ko', disabled: off || busy, text: 'Rejeter' });
    const bAnnuler = el('button', { type: 'button', class: 'link', hidden: true, text: 'Annuler' });

    bValider.addEventListener('click', () => {
      if (!motif.hidden) return decide(d, 'rejeter', motif.value, msg);
      if (!confirm(`Valider les thèmes de ${d.agent} pour la FMPA du ${fr(d.date)} ? Ils seront inscrits dans son livret.`)) return;
      decide(d, 'valider', '', msg);
    });
    bRejeter.addEventListener('click', () => {
      motif.hidden = false; motif.focus();
      bRejeter.hidden = true; bAnnuler.hidden = false;
      bValider.textContent = 'Confirmer le rejet';
      bValider.classList.add('cuv-danger');
    });
    bAnnuler.addEventListener('click', () => {
      motif.hidden = true; motif.value = '';
      bRejeter.hidden = false; bAnnuler.hidden = true;
      bValider.textContent = 'Valider';
      bValider.classList.remove('cuv-danger');
    });

    li.append(head, body, motif, el('div', { class: 'cuv-actions' }, bRejeter, bAnnuler, bValider), msg);
    return li;
  }

  // Questions du formulaire « thèmes » non affichées au chef d'unité
  const MASQUES = [/QUEL EST VOTRE NIVEAU/, /SPECIALITE CONCERNEE/];
  const cle = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  /** Libellés courts pour les questions les plus longues. */
  function libelle(titre) {
    const t = cle(titre);
    if (/AISANCE/.test(t)) return 'Aisance';
    if (/APPRECIATION/.test(t)) return 'Appréciation de la FMPA';
    if (/CORDE PARCOURUE/.test(t)) return 'Corde parcourue';
    return titre;
  }

  /** Aisance : échelle visuelle de 1 à 5 ; corde parcourue : en mètres ; sinon texte brut. */
  function valeurInfo(x) {
    const t = cle(x.titre), v = String(x.valeur).trim();
    if (/APPRECIATION/.test(t)) {
      const d = /^(\d{1,2})\/01\/1900$/.exec(v);
      const n = d ? Number(d[1]) : Number((/^\s*(\d+)/.exec(v) || [])[1]);
      if (n >= 1 && n <= 10) {
        const max = Math.max(5, n);
        return el('span', { class: 'etoiles-lecture', role: 'img', 'aria-label': `${n} étoile${n > 1 ? 's' : ''} sur ${max}` },
          Array.from({ length: max }, (_, i) => el('span', { class: i < n ? 'on' : '', text: '★' })),
          el('span', { class: 'etoiles-txt', text: `${n} / ${max}` }));
      }
    }
    const echelle = /AISANCE/.test(t) ? ['Peu à l’aise', 'Très à l’aise'] : null;
    if (echelle) {
      // Le classeur peut stocker la note comme une date (5 -> 05/01/1900) : on récupère le jour
      const d = /^(\d{1,2})\/01\/1900$/.exec(v);
      const m = d ? [String(Number(d[1]))] : /^\s*([1-5])\b/.exec(v);
      const n = m ? Number(m[m.length - 1]) : NaN;
      if (n >= 1 && n <= 5) return jauge(n, echelle);
    }
    if (/CORDE PARCOURUE/.test(t)) {
      const n = Number(v.replace(',', '.').replace(/\s*m(etres?|ètres?)?$/i, ''));
      if (!isNaN(n)) return document.createTextNode(new Intl.NumberFormat('fr-FR').format(n) + ' m');
    }
    return document.createTextNode(v);
  }

  /** Échelle 1 à 5 en lecture seule : curseur positionné sur la note, graduations et légende. */
  function jauge(n, [bas, haut]) {
    return el('div', { class: 'jauge', role: 'img', 'aria-label': `${n} sur 5 (1 = ${bas}, 5 = ${haut})` },
      el('div', { class: 'jauge-track' },
        el('span', { class: 'jauge-fill', style: `width:${(n - 1) * 25}%` }),
        el('span', { class: 'jauge-thumb', style: `left:${(n - 1) * 25}%`, text: String(n) })),
      el('div', { class: 'jauge-ticks' }, [1, 2, 3, 4, 5].map(i => el('span', { class: i === n ? 'on' : '', text: String(i) }))),
      el('div', { class: 'jauge-legend' }, el('span', { text: '1 · ' + bas }), el('span', { text: '5 · ' + haut })));
  }

  const fr = iso => (iso ? iso.split('-').reverse().join('/') : '');

  async function decide(d, decision, motif, msg) {
    S.busy[d.id] = true;
    msg.className = 'fmpa-msg';
    msg.textContent = decision === 'valider' ? 'Inscription dans le livret…' : 'Envoi du rejet…';
    msg.closest('li').querySelectorAll('button, textarea').forEach(b => { b.disabled = true; });
    try {
      await app().api('cu_decide', { token: app().token(), id: d.id, decision, motif });
      S.data.demandes = S.data.demandes.filter(x => x.id !== d.id);
      store.set(KEY, JSON.stringify(S.data));
      delete S.busy[d.id];
      render();
      setState(decision === 'valider'
        ? `Thèmes de ${d.agent} validés et inscrits dans son livret. Un mail lui a été envoyé.`
        : `Demande de ${d.agent} rejetée. Un mail lui a été envoyé.`);
    } catch (err) {
      delete S.busy[d.id];
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      msg.className = 'fmpa-msg error';
      msg.textContent = err instanceof app().NetworkError ? 'Hors ligne : réessayez au retour du réseau.' : err.message;
      msg.closest('li').querySelectorAll('button, textarea').forEach(b => { b.disabled = false; });
      if (/introuvable|déjà été traitée/.test(err.message)) load(true);
    }
  }

  function reset() {
    store.del(KEY);
    store.del(KEY_VUES);
    Object.assign(S, { data: null, filtre: 'moi', busy: {}, loading: false, active: false, lastLoad: 0 });
    badge();
    renderNotif();
  }

  $('#cuv-notif-btn').addEventListener('click', activerNotif);

  $('#cuv-filtres').addEventListener('click', e => {
    const b = e.target.closest('.pill');
    if (!b) return;
    S.filtre = b.dataset.f;
    render();
  });

  // refresh : appelé à l'ouverture de l'application pour les chefs d'unité et au-delà (active le suivi du compteur)
  window.SMPM_FMPA_VALID = {
    open, reset,
    refresh: () => {
      S.active = true;
      if (!S.data) { S.data = store.getJSON(KEY); badge(); }     // compteur immédiat, même hors ligne
      return load(true);
    },
  };
})();
