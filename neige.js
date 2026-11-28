// Poste neige (rubrique « Poste neige », action neige : back-end Neige.gs, dépôt privé).
// Le chef de poste (chef d'unité qualifié NEIGE) ouvre le poste (date, heure, spécialistes présents), puis renseigne
// l'inventaire du lot neige, la manœuvre (durée et techniques, comptée dans les heures FMPA neige) et les interventions,
// et ferme le poste. Inventaire et manœuvre peuvent être déclarés « non réalisés » avec une justification.
// Rappel push à 18h30 au chef de poste si une rubrique manque ; encadrement (administrateur, CTD, CDS neige) prévenu.
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmtDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const nowHm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const sid = () => 'neige-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  let data = null;
  let busy = false;
  let msg = '';
  let subId = sid();
  let filtre = '';

  const root = () => $('#neige-body');
  const state = t => { const s = $('#neige-state'); if (s) s.textContent = t || ''; };
  function catch401(e) { if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return true; } return false; }

  async function call(op, extra) {
    busy = true; msg = '';
    try {
      const r = await app().api('neige', Object.assign({ token: app().token(), op }, extra || {}));
      return r;
    } catch (e) {
      if (catch401(e)) return null;
      msg = e instanceof app().NetworkError ? 'Pas de réseau : réessayez dans un instant.' : (e.message || 'Échec');
      return null;
    } finally { busy = false; }
  }

  async function load() {
    if (!app() || !app().token()) return;
    state('Chargement…');
    const r = await call('data');
    if (r) { data = r; state(''); } else state(msg);
    render();
  }

  function statutLib(p) {
    return p.statut === 'clos' ? 'Fermé' : 'Ouvert';
  }

  function rubrique(titre, etat, detail) {
    const cls = etat === 'ok' ? 'ok' : etat === 'nr' ? 'warn' : 'todo';
    const lib = etat === 'ok' ? 'Renseigné' : etat === 'nr' ? 'Non réalisé' : 'À renseigner';
    return `<div class="neige-rub neige-${cls}"><strong>${esc(titre)}</strong> · <span>${lib}</span>${detail ? `<div class="muted small">${detail}</div>` : ''}</div>`;
  }

  function resume(p) {
    const inv = p.inv === 'fait' ? rubrique('Inventaire du lot neige', 'ok', esc(p.invObs))
      : p.inv ? rubrique('Inventaire du lot neige', 'nr', 'Justification : ' + esc(p.invJust)) : rubrique('Inventaire du lot neige', '');
    const man = p.man === 'fait' ? rubrique('Manœuvre', 'ok', `${nf.format(p.manH)} h · ${esc(p.manTxt)}`)
      : p.man ? rubrique('Manœuvre', 'nr', 'Justification : ' + esc(p.manJust)) : rubrique('Manœuvre', '');
    const itv = p.itv === 'oui' ? rubrique('Interventions', 'ok', 'Intervention(s) pendant le poste') : p.itv === 'aucune' ? rubrique('Interventions', 'ok', 'Aucune intervention') : rubrique('Interventions', '');
    return inv + man + itv;
  }

  function formInventaire(p) {
    return `<form class="neige-form" data-form="inventaire" data-id="${esc(p.id)}">
      <h3>Inventaire du lot neige</h3>
      <label><input type="radio" name="statut" value="fait"${p.inv !== 'non_realise' ? ' checked' : ''}> Inventaire réalisé</label>
      <label><input type="radio" name="statut" value="non_realise"${p.inv === 'non_realise' ? ' checked' : ''}> Non réalisé (activité opérationnelle)</label>
      <label>Observations (manques, anomalies)</label>
      <textarea name="observations" rows="3" maxlength="2000">${esc(p.invObs)}</textarea>
      <label>Justification (obligatoire si non réalisé)</label>
      <textarea name="justification" rows="2" maxlength="1000">${esc(p.invJust)}</textarea>
      <button type="submit" class="primary">Enregistrer l’inventaire</button>
    </form>`;
  }

  function formManoeuvre(p) {
    return `<form class="neige-form" data-form="manoeuvre" data-id="${esc(p.id)}">
      <h3>Manœuvre</h3>
      <label><input type="radio" name="statut" value="fait"${p.man !== 'non_realise' ? ' checked' : ''}> Manœuvre réalisée</label>
      <label><input type="radio" name="statut" value="non_realise"${p.man === 'non_realise' ? ' checked' : ''}> Non réalisée (activité opérationnelle)</label>
      <label>Durée (heures)</label>
      <input type="number" name="duree" min="0.25" max="12" step="0.25" inputmode="decimal" value="${p.manH || ''}">
      <label>Techniques mises en pratique</label>
      <textarea name="contenu" rows="3" maxlength="2000" placeholder="Ex. : recherche DVA, sondage, évacuation en luge…">${esc(p.manTxt)}</textarea>
      <label>Justification (obligatoire si non réalisée)</label>
      <textarea name="justification" rows="2" maxlength="1000">${esc(p.manJust)}</textarea>
      <p class="muted small">La durée est comptée dans les heures FMPA neige de chaque présent.</p>
      <button type="submit" class="primary">Enregistrer la manœuvre</button>
    </form>`;
  }

  function formFermer(p) {
    return `<form class="neige-form" data-form="fermer" data-id="${esc(p.id)}">
      <h3>Fermer le poste</h3>
      <label><input type="radio" name="itv" value="aucune" checked> Aucune intervention</label>
      <label><input type="radio" name="itv" value="oui"> Intervention(s) pendant le poste</label>
      <p class="muted small">Si vous indiquez une intervention, vous serez orienté vers le formulaire de saisie d’intervention.</p>
      <button type="submit" class="primary">Fermer le poste</button>
    </form>`;
  }

  function carte(p) {
    const manques = p.manques || [];
    const present = (p.presents || []).map(x => esc(x.label)).join(', ');
    let h = `<li class="neige-poste"><div class="neige-head"><strong>${fmtDate(p.date)} · ${esc(p.heure)}</strong>
      <span class="badge">${statutLib(p)}</span></div>
      <div class="muted small">Chef de poste : ${esc(p.chef)} · Présents : ${present}${p.fermeture ? ' · Fermé à ' + esc(p.fermeture) : ''}</div>`;
    if (p.statut !== 'clos' && manques.length) h += `<p class="neige-manque">À compléter : ${esc(manques.join(', '))}</p>`;
    h += resume(p);
    if (p.itv === 'oui') h += `<button type="button" class="link" data-act="interv">Saisir l’intervention</button>`;
    if (p.moiChef && p.statut !== 'clos') h += formInventaire(p) + formManoeuvre(p) + formFermer(p);
    return h + '</li>';
  }

  function formOuvrir() {
    const f = filtre.toLowerCase();
    const agents = (data.agents || []).filter(a => a.cle !== data.moi.cle && (!f || a.label.toLowerCase().includes(f)));
    return `<form class="neige-form" data-form="ouvrir">
      <h2 class="section-title">Ouvrir un poste</h2>
      <label for="neige-date">Date</label>
      <input type="date" id="neige-date" name="date" value="${todayIso()}" required>
      <label for="neige-heure">Heure d’ouverture</label>
      <input type="time" id="neige-heure" name="heure" value="${nowHm()}" required>
      <label>Spécialistes présents (vous êtes inclus)</label>
      <input type="search" id="neige-filtre" placeholder="Rechercher un spécialiste NEIGE" value="${esc(filtre)}">
      <div class="neige-agents">${agents.map(a => `<label><input type="checkbox" name="presents" value="${esc(a.cle)}"> ${esc(a.label)}</label>`).join('') || '<span class="muted small">Aucun résultat</span>'}</div>
      <p class="muted small">L’administrateur, le CTD et le CDS neige sont prévenus à l’ouverture.</p>
      <button type="submit" class="primary">Ouvrir le poste</button>
    </form>`;
  }

  function render() {
    const box = root();
    if (!box) return;
    if (!data) { box.innerHTML = ''; return; }
    const ouvertMoi = data.postes.some(p => p.moiChef && p.statut !== 'clos');
    let h = '';
    if (msg) h += `<p class="error" role="alert">${esc(msg)}</p>`;
    if (data.peutOuvrir && !ouvertMoi) h += formOuvrir();
    h += '<h2 class="section-title">Postes</h2><ul class="neige-list">' +
      (data.postes.map(carte).join('') || '<li class="muted small">Aucun poste enregistré.</li>') + '</ul>';
    // conserver la saisie du filtre (recréé à chaque rendu)
    const sel = document.activeElement && document.activeElement.id === 'neige-filtre';
    const cochés = [...box.querySelectorAll('input[name="presents"]:checked')].map(i => i.value);
    box.innerHTML = h;
    cochés.forEach(v => { const i = box.querySelector(`input[name="presents"][value="${CSS.escape(v)}"]`); if (i) i.checked = true; });
    if (sel) { const i = $('#neige-filtre'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  async function submit(ev) {
    const f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    if (busy) return;
    const k = f.dataset.form, id = f.dataset.id;
    const v = n => { const e = f.elements[n]; return e ? e.value : ''; };
    const radio = n => { const e = f.querySelector(`[name="${n}"]:checked`); return e ? e.value : ''; };
    let r = null;
    if (k === 'ouvrir') {
      const presents = [...f.querySelectorAll('input[name="presents"]:checked')].map(i => i.value);
      r = await call('ouvrir', { date: v('date'), heure: v('heure'), presents, submission_id: subId });
      if (r) { subId = sid(); filtre = ''; }
    } else if (k === 'inventaire') {
      r = await call('inventaire', { id, statut: radio('statut'), observations: v('observations'), justification: v('justification') });
    } else if (k === 'manoeuvre') {
      r = await call('manoeuvre', { id, statut: radio('statut'), duree: v('duree'), contenu: v('contenu'), justification: v('justification') });
    } else if (k === 'fermer') {
      r = await call('fermer', { id, interventions: radio('itv') });
      if (r && r.itv === 'oui') { await load(); app().goto('interv-new'); return; }
    }
    if (r) { await load(); return; }
    render();
  }

  function onClick(ev) {
    const b = ev.target.closest('[data-act="interv"]');
    if (b) app().goto('interv-new');
  }

  function onInput(ev) {
    if (ev.target.id === 'neige-filtre') { filtre = ev.target.value; render(); }
  }

  function open() { load(); }
  function refresh() { return load(); }

  function init() {
    const box = root();
    if (!box) return;
    box.addEventListener('submit', submit);
    box.addEventListener('click', onClick);
    box.addEventListener('input', onInput);
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  window.SMPM_NEIGE = { open, refresh };
})();
