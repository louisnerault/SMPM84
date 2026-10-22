// Demandes de validation des thèmes FMPA (rubrique FMPA > Demandes à valider).
// L'équipier saisit les thèmes vus en FMPA dans le formulaire « thèmes » ; la demande arrive dans le
// fichier CORE. Le chef d'unité désigné la valide (copie dans l'onglet LOGS du livret de l'agent)
// ou la rejette (motif facultatif). L'agent est prévenu par mail dans les deux cas.
// Actions : cu_list (liste), cu_decide (valider / rejeter). Dernière liste gardée pour l'affichage hors ligne.
(() => {
  'use strict';

  const KEY = 'smpm_cu_demandes';
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

  const S = { data: null, filtre: 'moi', busy: {}, loading: false };

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
      store.set(KEY, JSON.stringify(S.data));
      if (!silent) setState('');
      render();
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

  /** Pastille du menu : demandes adressées à l'utilisateur. */
  function badge() {
    const n = S.data ? S.data.demandes.filter(d => d.par === 'cu').length : 0;
    document.querySelectorAll('[data-cu-count]').forEach(b => {
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !n;
    });
  }

  function render() {
    badge();
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
    if (d.infos.length) body.append(el('dl', { class: 'cuv-infos' },
      d.infos.flatMap(x => [el('dt', { text: x.titre }), el('dd', { text: x.valeur })])));

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
    Object.assign(S, { data: null, filtre: 'moi', busy: {}, loading: false });
    badge();
  }

  $('#cuv-filtres').addEventListener('click', e => {
    const b = e.target.closest('.pill');
    if (!b) return;
    S.filtre = b.dataset.f;
    render();
  });

  window.SMPM_FMPA_VALID = { open, refresh: () => load(true), reset };
})();
