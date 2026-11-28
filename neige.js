// Gardes postées NEIGE (menu « Chefs d'unité › Gardes postées NEIGE », action neige : back-end Neige.gs, dépôt privé).
// Cinq sous-rubriques, une par étape de la garde du Mont Serein :
//   neige-ouverture   : le chef de poste (chef d'unité qualifié NEIGE) ouvre la garde (date, heure, présents) ;
//                       l'administrateur, le CTD et le CDS neige sont prévenus. Gardes récentes en dessous.
//   neige-inventaire  : inventaire du lot neige, ou « non réalisé » avec justification ;
//   neige-manoeuvre   : durée et techniques (comptées en FMPA neige pour chaque présent), ou justification ;
//   neige-interv      : interventions pendant la garde (si oui : formulaire de saisie d'intervention) ;
//   neige-fermeture   : vérifie que les trois rubriques sont renseignées, puis ferme la garde.
// Rappel push à 18h30 au chef de poste si la garde est incomplète ; encadrement prévenu le lendemain à 9h.
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmtH = h => nf.format(h) + ' h';
  const dLong = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const dCourt = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };
  const hm = h => String(h || '').slice(0, 5).replace(':', 'h');
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const nowHm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const sid = () => 'neige-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  // Flocon (six branches) : icône de la rubrique, aussi dans le menu (index.html)
  const FLOCON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M3.34 7l17.32 10M3.34 17L20.66 7"/><path d="M9.5 3.6L12 5.6l2.5-2M9.5 20.4l2.5-2 2.5 2M4.1 9.6l3.1-.5-1.1-3M19.9 14.4l-3.1.5 1.1 3M4.1 14.4l3.1.5-1.1 3M19.9 9.6l-3.1-.5 1.1-3"/></svg>';
  const ETAPES = [
    { id: 'ouverture', page: 'neige-ouverture', nom: 'Ouverture' },
    { id: 'inventaire', page: 'neige-inventaire', nom: 'Inventaire' },
    { id: 'manoeuvre', page: 'neige-manoeuvre', nom: 'Manœuvre' },
    { id: 'interv', page: 'neige-interv', nom: 'Interventions' },
    { id: 'fermeture', page: 'neige-fermeture', nom: 'Fermeture' },
  ];
  const DUREES = [0.5, 1, 1.5, 2, 3, 4];

  let data = null;
  let etape = 'ouverture';
  let busy = false;
  let msg = '';
  let subId = sid();
  let filtre = '';
  const choix = new Set();          // présents cochés (ouverture)
  const brouillon = {};             // statut choisi (fait / non réalisé) par étape, avant enregistrement

  const root = () => $('#neige-body');
  function catch401(e) { if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return true; } return false; }

  async function call(op, extra) {
    busy = true; msg = ''; render();
    try {
      return await app().api('neige', Object.assign({ token: app().token(), op }, extra || {}));
    } catch (e) {
      if (catch401(e)) return null;
      msg = e instanceof app().NetworkError ? 'Pas de réseau : réessayez dans un instant.' : (e.message || 'Échec de l’enregistrement');
      return null;
    } finally { busy = false; }
  }

  async function load() {
    if (!app() || !app().token()) return;
    const st = $('#neige-state');
    if (st) st.textContent = data ? '' : 'Chargement…';
    try {
      data = await app().api('neige', { token: app().token(), op: 'data' });
      if (st) st.textContent = '';
    } catch (e) {
      if (catch401(e)) return;
      if (st) st.textContent = e instanceof app().NetworkError ? 'Pas de réseau : données non chargées.' : (e.message || 'Chargement impossible');
    }
    render();
  }

  // ---------- état d'une garde ----------
  const maGarde = () => data && data.postes.find(p => p.moiChef && p.statut !== 'clos');
  const gardesOuvertes = () => (data ? data.postes.filter(p => p.statut !== 'clos') : []);
  function etatEtape(p, id) {
    if (!p) return 'todo';
    if (id === 'ouverture') return 'ok';
    if (id === 'inventaire') return p.inv === 'fait' ? 'ok' : p.inv ? 'nr' : 'todo';
    if (id === 'manoeuvre') return p.man === 'fait' ? 'ok' : p.man ? 'nr' : 'todo';
    if (id === 'interv') return p.itv ? 'ok' : 'todo';
    return p.statut === 'clos' ? 'ok' : 'todo';
  }

  // ---------- éléments communs ----------
  function stepper(p) {
    return `<ol class="ng-steps">${ETAPES.map((e, i) => {
      const s = etatEtape(p, e.id);
      const sym = s === 'ok' ? '✓' : s === 'nr' ? '!' : String(i + 1);
      return `<li class="ng-step ng-${s}${e.id === etape ? ' ng-cur' : ''}"><button type="button" data-go="${e.page}" aria-current="${e.id === etape ? 'step' : 'false'}"><span class="ng-dot">${sym}</span><span class="ng-lib">${e.nom}</span></button></li>`;
    }).join('')}</ol>`;
  }

  function entete(p) {
    if (!p) {
      return `<div class="ng-hero ng-hero-off"><span class="ng-ico">${FLOCON}</span><div><strong>Aucune garde ouverte</strong><span>${data && data.peutOuvrir ? 'Ouvrez la garde pour commencer.' : 'Le chef de poste ouvre la garde depuis la rubrique Ouverture.'}</span></div></div>`;
    }
    const chips = (p.presents || []).map(x => `<li${x.label === p.chef ? ' class="ng-chef"' : ''}>${esc(x.label)}${x.label === p.chef ? ' · chef de poste' : ''}</li>`).join('');
    return `<div class="ng-hero${p.statut === 'clos' ? ' ng-hero-clos' : ''}"><span class="ng-ico">${FLOCON}</span><div>
      <strong>${esc(dLong(p.date))}</strong>
      <span>Mont Serein · ouverte à ${esc(hm(p.heure))}${p.fermeture ? ' · fermée à ' + esc(hm(p.fermeture)) : ''}</span>
      <ul class="chips ng-chips">${chips}</ul></div>
      <span class="ng-badge ${p.statut === 'clos' ? 'ng-badge-clos' : ''}">${p.statut === 'clos' ? 'Fermée' : 'En cours'}</span></div>`;
  }

  const seg = (k, val) => `<div class="seg ng-seg" role="group">
      <button type="button" data-seg="${k}" data-v="fait" aria-pressed="${val !== 'non_realise'}">Réalisé${k === 'manoeuvre' ? 'e' : ''}</button>
      <button type="button" data-seg="${k}" data-v="non_realise" aria-pressed="${val === 'non_realise'}">Non réalisé${k === 'manoeuvre' ? 'e' : ''}</button></div>`;

  const lectureSeule = p => `<p class="orga-note">${p ? `Garde de ${esc(p.chef)} : seul le chef de poste peut la renseigner.` : 'Aucune garde ouverte à votre nom.'}</p>
    ${!p && data.peutOuvrir ? '<button type="button" class="primary" data-go="neige-ouverture">Ouvrir une garde</button>' : ''}`;

  // ---------- étapes ----------
  function vueOuverture() {
    const p = maGarde();
    let h = '';
    if (p) {
      h += `<p class="orga-note">Garde ouverte. L’administrateur, le CTD et le CDS neige ont été prévenus.</p>
        <button type="button" class="primary" data-go="neige-inventaire">Continuer : inventaire du lot neige</button>`;
    } else if (data.peutOuvrir) {
      const f = filtre.toLowerCase();
      const agents = (data.agents || []).filter(a => a.cle !== data.moi.cle);
      const vus = agents.filter(a => !f || a.label.toLowerCase().includes(f));
      h += `<form class="ng-card" data-form="ouvrir">
        <h2 class="section-title">Ouvrir la garde</h2>
        <div class="ng-2col">
          <label>Date<input type="date" name="date" value="${todayIso()}" required></label>
          <label>Heure d’ouverture<input type="time" name="heure" value="${nowHm()}" required></label>
        </div>
        <label>Spécialistes présents <span class="grid-badge">${choix.size + 1}</span></label>
        <p class="muted small">Vous êtes inscrit comme chef de poste. Ajoutez le ou les autres spécialistes NEIGE.</p>
        <input type="search" class="grid-search" id="neige-filtre" placeholder="Rechercher un spécialiste NEIGE" value="${esc(filtre)}">
        <ul class="grid-list ng-agents">
          <li class="grid-row checked"><span class="who"><strong>${esc(data.moi.label)}</strong><span>Chef de poste</span></span></li>
          ${vus.map(a => `<li class="grid-row${choix.has(a.cle) ? ' checked' : ''}" data-agent="${esc(a.cle)}" role="checkbox" aria-checked="${choix.has(a.cle)}" tabindex="0"><span class="who"><strong>${esc(a.label)}</strong><span>Qualifié NEIGE</span></span><span class="ng-check">${choix.has(a.cle) ? '✓' : ''}</span></li>`).join('') || '<li class="muted small">Aucun spécialiste trouvé.</li>'}
        </ul>
        <button type="submit" class="primary"${busy ? ' disabled' : ''}>Ouvrir la garde</button>
        <p class="muted small">L’administrateur, le CTD et le CDS neige reçoivent une notification.</p>
      </form>`;
    } else {
      h += '<p class="orga-note">L’ouverture d’une garde est réservée aux chefs d’unité qualifiés NEIGE.</p>';
    }
    const autres = data.postes.filter(x => !(x.moiChef && x.statut !== 'clos'));
    if (autres.length) {
      h += `<h2 class="section-title">Gardes récentes</h2><ul class="ng-hist">${autres.map(x => {
        const n = (x.manques || []).filter(m => m !== 'fermeture du poste').length;
        return `<li class="ng-hist-item"><div class="ng-hist-l"><strong>${esc(dCourt(x.date))} · ${esc(hm(x.heure))}</strong><span>${esc(x.chef)} · ${(x.presents || []).length} présents</span></div>
          <div class="ng-hist-r">${x.man === 'fait' ? `<span class="chip chip-edit">${fmtH(x.manH)}</span>` : ''}
          <span class="chip ${x.statut === 'clos' ? 'chip-ro' : n ? 'orga-chip-complet' : 'orga-chip-cu'}">${x.statut === 'clos' ? 'Fermée' : n ? `${n} à compléter` : 'À fermer'}</span></div></li>`;
      }).join('')}</ul>`;
    }
    return h;
  }

  function vueInventaire(p) {
    const st = brouillon.inventaire || p.inv || 'fait';
    return `<form class="ng-card" data-form="inventaire" data-id="${esc(p.id)}">
      <h2 class="section-title">Inventaire du lot neige</h2>
      ${seg('inventaire', st)}
      ${st === 'fait'
        ? `<p class="muted small">La composition du lot neige sera ajoutée prochainement. Notez les manques ou anomalies constatés.</p>
           <label>Observations<textarea name="observations" rows="4" maxlength="2000" placeholder="RAS, ou matériel manquant / abîmé…">${esc(p.invObs)}</textarea></label>`
        : `<label>Justification <span class="req">*</span><textarea name="justification" rows="3" maxlength="1000" placeholder="Ex. : interventions successives toute la journée" required>${esc(p.invJust)}</textarea></label>`}
      <button type="submit" class="primary"${busy ? ' disabled' : ''}>Enregistrer et continuer</button>
    </form>`;
  }

  function vueManoeuvre(p) {
    const st = brouillon.manoeuvre || p.man || 'fait';
    const d = p.manH || '';
    return `<form class="ng-card" data-form="manoeuvre" data-id="${esc(p.id)}">
      <h2 class="section-title">Manœuvre</h2>
      ${seg('manoeuvre', st)}
      ${st === 'fait'
        ? `<label>Durée</label>
           <div class="fmpa-scale">${DUREES.map(x => `<button type="button" class="pill" data-duree="${x}" aria-pressed="${Number(d) === x}">${nf.format(x)} h</button>`).join('')}</div>
           <input type="number" name="duree" min="0.25" max="12" step="0.25" inputmode="decimal" value="${d}" placeholder="Autre durée (heures)">
           <label>Techniques mises en pratique <span class="req">*</span><textarea name="contenu" rows="4" maxlength="2000" placeholder="Ex. : recherche DVA, sondage, évacuation en barquette…">${esc(p.manTxt)}</textarea></label>
           <p class="orga-note small">Cette durée est comptée dans les heures FMPA neige de chaque spécialiste présent.</p>`
        : `<label>Justification <span class="req">*</span><textarea name="justification" rows="3" maxlength="1000" placeholder="Ex. : activité opérationnelle soutenue" required>${esc(p.manJust)}</textarea></label>`}
      <button type="submit" class="primary"${busy ? ' disabled' : ''}>Enregistrer et continuer</button>
    </form>`;
  }

  function vueInterv(p) {
    const v = brouillon.interv || p.itv || '';
    return `<form class="ng-card" data-form="interv" data-id="${esc(p.id)}">
      <h2 class="section-title">Interventions pendant la garde</h2>
      <div class="seg ng-seg" role="group">
        <button type="button" data-seg="interv" data-v="aucune" aria-pressed="${v === 'aucune'}">Aucune</button>
        <button type="button" data-seg="interv" data-v="oui" aria-pressed="${v === 'oui'}">Oui, intervention(s)</button></div>
      ${v === 'oui' ? `<p class="muted small">Enregistrez votre réponse, puis saisissez chaque intervention dans le formulaire habituel.</p>
        ${p.itv === 'oui' ? '<button type="button" class="home-btn home-btn-alert ng-itv" data-go="interv-new">Saisir une intervention</button>' : ''}` : ''}
      <button type="submit" class="primary"${busy || !v ? ' disabled' : ''}>Enregistrer${v === 'oui' && p.itv !== 'oui' ? ' et saisir l’intervention' : ' et continuer'}</button>
    </form>`;
  }

  function vueFermeture(p) {
    const lignes = [
      ['inventaire', 'Inventaire du lot neige', p.inv === 'fait' ? 'Réalisé' : p.inv ? 'Non réalisé (justifié)' : ''],
      ['manoeuvre', 'Manœuvre', p.man === 'fait' ? `${fmtH(p.manH)} · ${p.manTxt}` : p.man ? 'Non réalisée (justifiée)' : ''],
      ['interv', 'Interventions', p.itv === 'oui' ? 'Intervention(s) déclarée(s)' : p.itv === 'aucune' ? 'Aucune' : ''],
    ];
    const manque = lignes.filter(l => !l[2]);
    return `<div class="ng-card">
      <h2 class="section-title">Vérification avant fermeture</h2>
      <ul class="ng-check-list">${lignes.map(([id, nom, val]) => {
        const e = ETAPES.find(x => x.id === id);
        return `<li class="${val ? 'ng-li-ok' : 'ng-li-ko'}"><span class="ng-dot">${val ? '✓' : '✕'}</span><div><strong>${nom}</strong><span>${val ? esc(val) : 'À renseigner'}</span></div>
          ${val ? '' : `<button type="button" class="pill" data-go="${e.page}">Compléter</button>`}</li>`;
      }).join('')}</ul>
      ${manque.length
        ? `<p class="neige-manque">Garde incomplète : ${manque.map(l => l[1].toLowerCase()).join(', ')}.</p>`
        : '<p class="ok">Toutes les rubriques sont renseignées.</p>'}
      <button type="button" class="primary" data-act="fermer" data-id="${esc(p.id)}"${busy || manque.length ? ' disabled' : ''}>Fermer la garde</button>
    </div>`;
  }

  function render() {
    const box = root();
    if (!box) return;
    if (!data) { box.innerHTML = ''; return; }
    const mien = maGarde();
    const p = mien || (data.superviseur ? gardesOuvertes()[0] : null);
    const focus = document.activeElement && document.activeElement.id === 'neige-filtre';
    let corps;
    if (etape === 'ouverture') corps = vueOuverture();
    else if (!mien) corps = (p ? resumeLecture(p) : '') + lectureSeule(p);
    else corps = etape === 'inventaire' ? vueInventaire(mien) : etape === 'manoeuvre' ? vueManoeuvre(mien) : etape === 'interv' ? vueInterv(mien) : vueFermeture(mien);
    box.innerHTML = entete(p) + stepper(p) + (msg ? `<p class="error" role="alert">${esc(msg)}</p>` : '') + corps;
    if (focus) { const i = $('#neige-filtre'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  // Lecture seule (CTD, CDS neige, administrateur) : état de la garde en cours
  function resumeLecture(p) {
    const l = [['Inventaire', p.inv === 'fait' ? 'Réalisé' : p.inv ? 'Non réalisé : ' + p.invJust : ''],
      ['Manœuvre', p.man === 'fait' ? `${fmtH(p.manH)} · ${p.manTxt}` : p.man ? 'Non réalisée : ' + p.manJust : ''],
      ['Interventions', p.itv === 'oui' ? 'Oui' : p.itv === 'aucune' ? 'Aucune' : '']];
    return `<dl class="orga-infos ng-card">${l.map(([k, v]) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">À renseigner</span>'}</dd>`).join('')}</dl>`;
  }

  // ---------- actions ----------
  const suivante = id => { const i = ETAPES.findIndex(e => e.id === id); return ETAPES[Math.min(i + 1, ETAPES.length - 1)].page; };

  async function submit(ev) {
    const f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    if (busy) return;
    const k = f.dataset.form, id = f.dataset.id;
    const v = n => (f.elements[n] ? f.elements[n].value : '');
    let r = null, apres = null;
    if (k === 'ouvrir') {
      r = await call('ouvrir', { date: v('date'), heure: v('heure'), presents: [...choix], submission_id: subId });
      if (r) { subId = sid(); filtre = ''; choix.clear(); apres = 'neige-inventaire'; }
    } else if (k === 'inventaire') {
      r = await call('inventaire', { id, statut: brouillon.inventaire || 'fait', observations: v('observations'), justification: v('justification') });
      apres = suivante('inventaire');
    } else if (k === 'manoeuvre') {
      r = await call('manoeuvre', { id, statut: brouillon.manoeuvre || 'fait', duree: v('duree'), contenu: v('contenu'), justification: v('justification') });
      apres = suivante('manoeuvre');
    } else if (k === 'interv') {
      const val = brouillon.interv || (maGarde() || {}).itv;
      r = await call('interventions', { id, interventions: val });
      apres = val === 'oui' ? 'interv-new' : suivante('interv');
    }
    if (!r) { render(); return; }
    Object.keys(brouillon).forEach(x => delete brouillon[x]);
    await load();
    if (apres) app().goto(apres);
  }

  async function onClick(ev) {
    const go = ev.target.closest('[data-go]');
    if (go) { msg = ''; app().goto(go.dataset.go); return; }
    const s = ev.target.closest('[data-seg]');
    if (s) { brouillon[s.dataset.seg] = s.dataset.v; msg = ''; render(); return; }
    const d = ev.target.closest('[data-duree]');
    if (d) {
      const f = d.closest('form');
      f.elements.duree.value = d.dataset.duree;
      f.querySelectorAll('[data-duree]').forEach(b => b.setAttribute('aria-pressed', String(b === d)));
      return;
    }
    const a = ev.target.closest('[data-agent]');
    if (a) { const c = a.dataset.agent; if (choix.has(c)) choix.delete(c); else choix.add(c); render(); return; }
    const fe = ev.target.closest('[data-act="fermer"]');
    if (fe && !busy) {
      if (!confirm('Fermer la garde ? Elle ne pourra plus être modifiée.')) return;
      const r = await call('fermer', { id: fe.dataset.id });
      if (r) { await load(); app().flash({ kind: 'ok', text: 'Garde fermée. Merci !' }); app().goto('neige-ouverture'); } else render();
    }
  }

  function onKey(ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-agent]')) { ev.preventDefault(); ev.target.click(); }
  }
  function onInput(ev) {
    if (ev.target.id === 'neige-filtre') { filtre = ev.target.value; render(); }
    if (ev.target.name === 'duree') ev.target.form.querySelectorAll('[data-duree]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.duree) === Number(ev.target.value))));
  }

  function open(page) {
    etape = String(page || 'neige-ouverture').replace(/^neige-/, '') || 'ouverture';
    if (!ETAPES.some(e => e.id === etape)) etape = 'ouverture';
    msg = '';
    Object.keys(brouillon).forEach(x => delete brouillon[x]);
    render();
    load();
  }
  function refresh() { return load(); }

  function init() {
    const box = root();
    if (!box || box.dataset.init) return;
    box.dataset.init = '1';
    box.addEventListener('submit', submit);
    box.addEventListener('click', onClick);
    box.addEventListener('keydown', onKey);
    box.addEventListener('input', onInput);
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  window.SMPM_NEIGE = { open, refresh };
})();
