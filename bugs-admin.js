// Administration › Signalements (administrateurs seulement).
// Liste des bugs et suggestions envoyés par les membres (Bugs.gs, dépôt privé), avec filtres ; pour chacun :
// statut, réponse et notification push (et clochette) à l'auteur. Pièces jointes : lien vers le dossier Drive.
// Actions serveur : bug_list, bug_update — droits contrôlés par le serveur.
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => window.SMPM_APP;
  const STATUTS = ['À traiter', 'En cours', 'Corrigé', 'Rejeté'];
  const REPONSES_TYPES = [
    'Merci, c’est corrigé dans la dernière version : rechargez l’application.',
    'Merci pour la suggestion, elle est notée pour une prochaine version.',
    'Pouvez-vous préciser (page, heure, ce que vous attendiez) ?',
  ];
  const S = { items: [], ouvert: null, busy: false, charge: false };

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-');
  function dateCourte(iso) {
    const d = new Date(iso);
    return (!iso || isNaN(d)) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const setState = (t, err) => { const p = $('#bga-state'); p.textContent = t || ''; p.classList.toggle('error', !!err); };

  function filtrer() {
    const st = $('#bga-statut').value, cat = $('#bga-cat').value;
    const q = $('#bga-search').value.trim().toLowerCase();
    return S.items.filter(b => {
      if (st === 'attente' ? !(b.statut === 'À traiter' || b.statut === 'En cours') : (st !== 'tous' && b.statut !== st)) return false;
      if (cat && b.categorie !== cat) return false;
      if (q && ![b.description, b.nom, b.prenom, b.objet, b.reponse, String(b.num)].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function majPastille() {
    const n = S.items.filter(b => b.statut === 'À traiter').length;
    const dot = document.querySelector('#nav-bugs .bugs-dot');
    if (dot) { dot.hidden = !n; dot.title = n + ' signalement' + (n > 1 ? 's' : '') + ' à traiter'; }
  }

  function badge(statut) { return el('span', 'bug-badge st-' + slug(statut), statut); }

  function detail(b) {
    const box = el('div', 'bug-detail');
    box.append(el('p', 'bug-texte', b.description || '(pas de description écrite)'));
    const meta = [b.page && 'Page : ' + b.page, b.version && 'Version : ' + b.version, b.appareil].filter(Boolean).join(' · ');
    if (meta) box.append(el('p', 'muted small bug-meta', meta));
    if (b.pj_url) {
      const p = el('p', 'small');
      const a = el('a', 'link', '📎 ' + (b.pj_libelle || 'Pièces jointes') + ' (ouvrir dans Drive)');
      a.href = b.pj_url; a.target = '_blank'; a.rel = 'noopener';
      p.append(a); box.append(p);
    }

    const f = el('form', 'bug-rep');
    const lSt = el('label', '', 'Statut ');
    const sel = el('select'); sel.name = 'statut';
    STATUTS.forEach(s => sel.append(new Option(s, s)));
    sel.value = b.statut;
    lSt.append(sel);
    const lRep = el('label', '', 'Réponse à l’auteur ');
    const ta = el('textarea'); ta.name = 'reponse'; ta.rows = 3; ta.maxLength = 1000;
    ta.placeholder = 'Obligatoire pour « Corrigé » et « Rejeté ». Visible par l’auteur.';
    ta.value = b.reponse || '';
    lRep.append(ta);
    const chips = el('div', 'bug-chips');
    REPONSES_TYPES.forEach(t => {
      const c = el('button', 'link small', t.length > 38 ? t.slice(0, 36) + '…' : t); c.type = 'button'; c.title = t;
      c.addEventListener('click', () => { ta.value = t; ta.focus(); });
      chips.append(c);
    });
    const lN = el('label', 'mnt-check');
    const ck = el('input'); ck.type = 'checkbox'; ck.name = 'notifier'; ck.checked = true;
    lN.append(ck, el('span', '', 'Notifier l’auteur (statut ou réponse modifié)'));
    const err = el('p', 'error'); err.setAttribute('role', 'alert');
    const ok = el('p', 'ok'); ok.setAttribute('role', 'status');
    const go = el('button', 'primary', 'Enregistrer'); go.type = 'submit';
    f.append(lSt, lRep, chips, lN, err, ok, go);
    f.addEventListener('submit', ev => { ev.preventDefault(); enregistrer(b, f, err, ok, go); });
    box.append(f);
    return box;
  }

  function carte(b) {
    const art = el('article', 'bug-carte' + (S.ouvert === b.num ? ' is-open' : ''));
    const tete = el('button', 'bug-tete'); tete.type = 'button';
    tete.setAttribute('aria-expanded', String(S.ouvert === b.num));
    const l1 = el('span', 'bug-l1');
    l1.append(el('strong', '', 'n°' + b.num), badge(b.statut));
    if (b.gravite) l1.append(el('span', 'bug-badge gr-' + slug(b.gravite), b.gravite));
    const auteur = [b.prenom, b.nom].filter(Boolean).join(' ') || 'Inconnu';
    const l2 = el('span', 'muted small', [b.categorie && b.objet ? b.categorie + ' › ' + b.objet : b.rubrique, auteur + (b.fonction ? ' (' + b.fonction + ')' : ''), dateCourte(b.date)].filter(Boolean).join(' · '));
    const l3 = el('span', 'bug-extrait', b.description ? (b.description.length > 120 ? b.description.slice(0, 120) + '…' : b.description) : '(photos / vocal)');
    tete.append(l1, l2, l3);
    tete.addEventListener('click', () => { S.ouvert = S.ouvert === b.num ? null : b.num; render(); });
    art.append(tete);
    if (S.ouvert === b.num) art.append(detail(b));
    return art;
  }

  function render() {
    majPastille();
    const l = filtrer();
    const box = $('#bga-liste');
    box.replaceChildren(...l.map(carte));
    if (S.charge) setState(l.length ? l.length + ' signalement' + (l.length > 1 ? 's' : '') + ' (sur ' + S.items.length + ')' : 'Aucun signalement pour ce filtre.');
  }

  async function load() {
    const a = app();
    if (!a) return;
    setState('Chargement…');
    try {
      const r = await a.api('bug_list', { token: a.token() });
      S.items = r.items || [];
      S.charge = true;
      render();
    } catch (err) {
      if (a.AUTH_ERRORS.includes(err.message)) return a.logout();
      setState(err instanceof a.NetworkError ? a.netLabel() + ' : signalements indisponibles.' : err.message, true);
    }
  }

  async function enregistrer(b, f, err, ok, go) {
    const a = app();
    if (S.busy) return;
    err.textContent = ''; ok.textContent = '';
    const statut = f.elements.statut.value, reponse = f.elements.reponse.value.trim();
    if ((statut === 'Corrigé' || statut === 'Rejeté') && !reponse) { err.textContent = 'Écrivez une réponse pour ce statut.'; return; }
    if (statut === b.statut && reponse === (b.reponse || '')) { ok.textContent = 'Rien à enregistrer : aucune modification.'; return; }
    S.busy = true; go.disabled = true;
    try {
      const r = await a.api('bug_update', { token: a.token(), num: b.num, statut, reponse, notifier: f.elements.notifier.checked }, { noRetry: true });
      const i = S.items.findIndex(x => x.num === b.num);
      if (i >= 0 && r.item) S.items[i] = r.item;
      render();
      const nouvelle = document.querySelector('.bug-carte.is-open .bug-rep .ok');
      if (nouvelle) nouvelle.textContent = r.notifie ? 'Enregistré : l’auteur a été notifié.' : 'Enregistré (auteur non notifié).';
    } catch (e) {
      if (a.AUTH_ERRORS.includes(e.message)) return a.logout();
      err.textContent = e instanceof a.NetworkError ? a.netLabel() + ' : réessayez quand le réseau sera disponible.' : e.message;
    } finally { S.busy = false; go.disabled = false; }
  }

  function open() { S.ouvert = null; render(); load(); }

  document.addEventListener('DOMContentLoaded', () => {
    ['#bga-statut', '#bga-cat'].forEach(s => $(s) && $(s).addEventListener('change', render));
    $('#bga-search') && $('#bga-search').addEventListener('input', render);
  });

  window.SMPM_BUGS_ADMIN = { open };
})();
