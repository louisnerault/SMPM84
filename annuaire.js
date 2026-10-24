// Annuaire des spécialistes (mode intervention, action « annuaire » : backend/Annuaire.gs).
// Personnel actif : nom prénom, grade, qualifications, secteur, centre d'affectation, fonction,
// et trois boutons Appeler / SMS / WhatsApp. Recherche plein texte + filtres secteur, centre,
// qualifications (toutes requises), avec téléphone. Dernière liste gardée sur l'appareil (hors ligne).
(() => {
  'use strict';

  const KEY = 'smpm_annuaire';
  const KEY_FILTRES = 'smpm_annuaire_filtres';
  const QUALIFS = ['IMP 1', 'IMP 2', 'IMP 3', 'NEIGE', 'ISS', 'SSH', 'CAN', 'SSSM'];
  const SECTEURS = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre' };

  const $ = sel => document.querySelector(sel);
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };
  const app = () => window.SMPM_APP;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const digits = s => String(s || '').replace(/\D/g, '');

  const F0 = () => ({ q: '', secteur: '', centre: '', qualifs: [], tel: false, tri: 'nom' });
  const S = { data: null, fresh: false, loading: false, f: Object.assign(F0(), store.getJSON(KEY_FILTRES) || {}) };

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

  // Numéro international sans « + » pour WhatsApp (France par défaut)
  function intl(tel) {
    let d = digits(tel);
    if (!d) return '';
    if (String(tel).trim().startsWith('+')) return d;
    if (d.startsWith('00')) return d.slice(2);
    if (d.length === 10 && d.startsWith('0')) return '33' + d.slice(1);
    return d;
  }
  // Affichage « 06 12 34 56 78 »
  function pretty(tel) {
    let d = digits(tel);
    if (d.length === 11 && d.startsWith('33')) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('0')) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
    return String(tel);
  }

  function open() {
    if (!S.data) S.data = store.getJSON(KEY);
    buildFilters();
    if (S.data) render();
    if (!S.fresh && !S.loading) load();
  }

  async function load() {
    S.loading = true;
    setState(S.data ? 'Mise à jour…' : 'Chargement de l’annuaire…');
    try {
      const res = await app().api('annuaire', { token: app().token() });
      S.data = { personnes: res.personnes || [], maj: res.maj || new Date().toISOString() };
      S.fresh = true;
      store.set(KEY, JSON.stringify(S.data));
      setState('');
      buildFilters();
      render();
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      const d = S.data;
      const maj = d && d.maj ? new Date(d.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (d ? `Hors ligne : annuaire du ${maj}.` : 'Hors ligne : annuaire indisponible sur cet appareil. Ouvrez-le une fois avec du réseau pour le garder hors ligne.')
        : err.message === 'Action inconnue' ? 'L’annuaire n’est pas encore activé sur le serveur (Annuaire.gs).' : err.message, !d);
    } finally { S.loading = false; }
  }

  function setState(msg, isError) {
    const p = $('#ann-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
  }

  function fillSelect(sel, values, label, current) {
    sel.replaceChildren(el('option', { value: '', text: label }),
      ...values.map(v => el('option', { value: v, text: v === '' ? '—' : (SECTEURS[v] || v) })));
    sel.value = values.includes(current) ? current : '';
  }

  function buildFilters() {
    const all = (S.data && S.data.personnes) || [];
    const uniq = key => [...new Set(all.map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    fillSelect($('#ann-secteur'), uniq('secteur'), 'Tous les secteurs', S.f.secteur);
    fillSelect($('#ann-centre'), uniq('centre'), 'Tous les centres', S.f.centre);
    S.f.secteur = $('#ann-secteur').value;
    S.f.centre = $('#ann-centre').value;
    $('#ann-tri').value = S.f.tri;
    $('#ann-tel').checked = S.f.tel;
    $('#ann-search').value = S.f.q;
    const present = QUALIFS.filter(q => all.some(p => (p.qualifs || []).includes(q)));
    const list = present.length ? present : QUALIFS;
    S.f.qualifs = S.f.qualifs.filter(q => list.includes(q));
    $('#ann-qualifs').replaceChildren(...list.map(q => el('button', {
      type: 'button', class: 'ann-qf', 'aria-pressed': String(S.f.qualifs.includes(q)), text: q,
      onclick: e => {
        const on = !S.f.qualifs.includes(q);
        S.f.qualifs = on ? [...S.f.qualifs, q] : S.f.qualifs.filter(x => x !== q);
        e.currentTarget.setAttribute('aria-pressed', String(on));
        changed();
      },
    })));
  }

  function changed() {
    store.set(KEY_FILTRES, JSON.stringify(Object.assign({}, S.f, { q: '' })));
    render();
  }

  function match(p) {
    const f = S.f;
    if (f.secteur && p.secteur !== f.secteur) return false;
    if (f.centre && p.centre !== f.centre) return false;
    if (f.tel && !p.tel) return false;
    if (f.qualifs.length && !f.qualifs.every(q => (p.qualifs || []).includes(q))) return false;
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = fold([p.nom, p.prenom, p.grade, p.secteur, p.centre, (p.qualifs || []).join(' '), (p.qualifs || []).join(' ').replace(/\s/g, ''), (p.fonctions || []).join(' '), digits(p.tel)].join(' '));
    return words.every(w => hay.includes(w) || (/^\d{2,}$/.test(w) && digits(p.tel).includes(w)));
  }

  function render() {
    const all = (S.data && S.data.personnes) || [];
    const f = S.f;
    const tri = {
      nom: (a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom, 'fr'),
      centre: (a, b) => (a.centre || '~').localeCompare(b.centre || '~', 'fr') || (a.nom + a.prenom).localeCompare(b.nom + b.prenom, 'fr'),
      secteur: (a, b) => (a.secteur || '~').localeCompare(b.secteur || '~', 'fr') || (a.nom + a.prenom).localeCompare(b.nom + b.prenom, 'fr'),
    }[f.tri] || (() => 0);
    const list = all.filter(match).sort(tri);
    const active = f.q || f.secteur || f.centre || f.tel || f.qualifs.length;
    $('#ann-reset').hidden = !active;
    $('#ann-count').textContent = all.length ? `${list.length} / ${all.length}` : '';
    const empty = $('#ann-empty');
    empty.hidden = list.length > 0 || !S.data;
    empty.textContent = all.length ? 'Aucune personne ne correspond à ces critères.' : 'Annuaire vide.';

    const items = [];
    let group = null;
    list.forEach(p => {
      if (f.tri !== 'nom') {
        const g = f.tri === 'centre' ? (p.centre || 'Centre non renseigné') : (SECTEURS[p.secteur] || p.secteur || 'Secteur non renseigné');
        if (g !== group) { group = g; items.push(el('li', { class: 'ann-group', text: g })); }
      }
      items.push(card(p));
    });
    $('#ann-list').replaceChildren(...items);
  }

  const ICONS = {
    push: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    tel: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    sms: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.7A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 14h4.5"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
  };

  function action(kind, label, href, p) {
    const name = `${p.prenom} ${p.nom}`;
    if (!href) return el('span', { class: `ann-btn ann-${kind} is-off`, 'aria-disabled': 'true', title: 'Numéro non renseigné', 'aria-label': `${label} : numéro non renseigné`, html: ICONS[kind] });
    return el('a', { class: `ann-btn ann-${kind}`, href, 'aria-label': `${label} ${name}`, target: kind === 'wa' ? '_blank' : null, rel: kind === 'wa' ? 'noopener' : null, html: ICONS[kind] });
  }

  function card(p) {
    const tel = digits(p.tel) ? String(p.tel).replace(/[^\d+]/g, '') : '';
    const wa = intl(p.tel);
    const meta = [p.secteur ? `Secteur ${SECTEURS[p.secteur] || p.secteur}` : '', p.centre || ''].filter(Boolean);
    return el('li', { class: 'ann-card' },
      el('div', { class: 'ann-head' },
        el('p', { class: 'ann-name' }, el('strong', { text: p.nom }), ' ', p.prenom, p.grade ? el('span', { class: 'ann-grade', text: p.grade }) : null),
        (p.fonctions || []).length ? el('span', { class: 'ann-fct', text: p.fonctions.join(' · ') }) : null),
      el('p', { class: 'ann-meta', text: meta.join(' · ') || 'Affectation non renseignée' }),
      (p.qualifs || []).length
        ? el('ul', { class: 'chips ann-chips' }, ...p.qualifs.map(q => el('li', { text: q })))
        : el('p', { class: 'ann-meta muted', text: 'Aucune qualification renseignée' }),
      tel ? el('p', { class: 'ann-num', text: pretty(p.tel) }) : null,
      el('div', { class: 'ann-actions' },
        action('tel', 'Appeler', tel && `tel:${tel}`, p),
        action('sms', 'SMS', tel && `sms:${tel}`, p),
        action('wa', 'WhatsApp', wa && `https://wa.me/${wa}`, p),
        p.push
          ? el('button', { type: 'button', class: 'ann-btn ann-push', 'aria-label': `Notification à ${p.prenom} ${p.nom}`, title: 'Envoyer une notification', html: ICONS.push, onclick: () => openPush(p) })
          : el('span', { class: 'ann-btn ann-push is-off', 'aria-disabled': 'true', title: 'Notifications non activées par cette personne', 'aria-label': 'Notification : non activée par cette personne', html: ICONS.push })));
  }

  // Notification push à une personne (Push.gs, push_send cible personne:<NOM>)
  let cible = null;
  function openPush(p) {
    cible = p;
    const d = $('#ann-push'), f = $('#ann-push-form');
    f.reset();
    $('#ann-push-error').textContent = '';
    $('#ann-push-to').textContent = `À ${p.prenom} ${p.nom} — votre nom est ajouté en signature.`;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    setTimeout(() => f.elements.message.focus(), 50);
  }
  function closePush() { const d = $('#ann-push'); if (d.open) d.close ? d.close() : d.removeAttribute('open'); }
  $('#ann-push-cancel').addEventListener('click', closePush);
  $('#ann-push-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = $('#ann-push-send');
    const message = f.elements.message.value.trim();
    if (!message || !cible) return;
    btn.disabled = true;
    $('#ann-push-error').textContent = '';
    try {
      const r = await app().api('push_send', { token: app().token(), titre: 'SMPM 84 – message', message, cible: 'personne:' + cible.nom });
      closePush();
      const n = r && r.envoyes;
      setState(n ? `Notification envoyée à ${cible.prenom} ${cible.nom}.` : `${cible.prenom} ${cible.nom} n’a plus d’appareil abonné : notification non distribuée.`);
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      $('#ann-push-error').textContent = err instanceof app().NetworkError ? 'Hors ligne : envoi impossible. Utilisez SMS ou appel.' : err.message;
    } finally { btn.disabled = false; }
  });

  function reset() {
    store.del(KEY);
    store.del(KEY_FILTRES);
    Object.assign(S, { data: null, fresh: false, loading: false, f: F0() });
    $('#ann-list').replaceChildren();
    setState('');
  }

  let t;
  $('#ann-search').addEventListener('input', e => { S.f.q = e.target.value; clearTimeout(t); t = setTimeout(render, 120); });
  $('#ann-secteur').addEventListener('change', e => { S.f.secteur = e.target.value; changed(); });
  $('#ann-centre').addEventListener('change', e => { S.f.centre = e.target.value; changed(); });
  $('#ann-tri').addEventListener('change', e => { S.f.tri = e.target.value; changed(); });
  $('#ann-tel').addEventListener('change', e => { S.f.tel = e.target.checked; changed(); });
  $('#ann-reset').addEventListener('click', () => { S.f = Object.assign(F0(), { tri: S.f.tri }); buildFilters(); changed(); });

  window.SMPM_ANNUAIRE = { open, reset, refresh: () => { S.fresh = false; if (!document.querySelector('#tab-annuaire').hidden) load(); } };
})();
