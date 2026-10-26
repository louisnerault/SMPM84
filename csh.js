// Heures chefs de section (menu « Chefs de section › Heures chefs de section »).
//   - « Mes heures » (cs-heures) : compteur récapitulatif, déclaration, modification et suppression de SES journées
//     sans limite de délai (chefs de section, CTD, administrateurs inscrits dans l'onglet DATA) ;
//   - « Toutes les heures » (cs-heures-toutes) : toutes les journées de tous les chefs (CTD, administrateurs).
// Back-end : backend/Heures.gs (cs_heures_list / _submit / _update / _delete), classeur « Formulaire chefs de section ».
// Hors ligne : dernière liste gardée sur l'appareil, nouvelles journées mises en attente puis envoyées.
(() => {
  'use strict';

  const KEY_CACHE = 'smpm_csh_cache';
  const KEY_QUEUE = 'smpm_csh_queue';
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const ls = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmtDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const fmtH = h => nf.format(h) + ' h';
  // Statuts du classeur → catégorie courte
  const CAT = s => /REPOS/i.test(s) ? 'repos' : /LIB/i.test(s) ? 'lib' : 'recup';
  const CAT_LABEL = { repos: 'En repos', recup: 'À récupérer', lib: 'À être libéré' };
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  let mode = 'cs-heures';                 // ou 'cs-heures-toutes'
  let data = null;
  let annee = new Date().getFullYear();
  let edition = null;                     // clé de la journée en cours de modification
  const ouverts = new Set();
  let busy = false;

  const toutes = () => mode === 'cs-heures-toutes';
  const cacheKey = () => (toutes() ? 'T' : 'M') + annee;
  function state(t) { $('#csh-state').textContent = t || ''; }
  function msg(err, ok) { const f = $('#csh-form'); $('.error', f).textContent = err || ''; $('.ok', f).textContent = ok || ''; }
  function catch401(e) { if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return true; } return false; }

  // ---------- compteur récapitulatif (même présentation que les compteurs du livret, en violet) ----------
  function compteur(c) {
    const box = $('#csh-counter');
    const done = c.total || 0, q = Number(c.quota) || 0;
    const level = !q ? '' : done >= q ? ' full' : done >= q * 0.8 ? ' warn' : '';
    const pct = q ? Math.round(done / q * 100) : 0;
    const r = { repos: 0, recup: 0, lib: 0 };
    c.lignes.forEach(l => { r[CAT(l.statut)] += l.heures; });
    const parts = ['repos', 'recup', 'lib'].filter(k => r[k] > 0);
    const p = h => Math.round(h / done * 100);

    const card = document.createElement('article');
    card.className = 'counter csh-counter' + level + (q ? '' : ' no-quota');
    card.innerHTML = `<div class="counter-head"><strong>Heures chef de section</strong><span>${esc(c.fonctions.join(' / ') || annee)}</span></div>
      <p class="counter-value"><span class="big" data-to="${done}">0</span><span class="unit">${q ? ` / ${nf.format(q)} h` : ' h'}</span></p>`;
    if (q) {
      const fig = document.createElement('div');
      fig.className = 'pie-wrap';
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', `${fmtH(done)} sur ${fmtH(q)}, ${pct} %`);
      fig.append(app().pieChart(pct, done >= q));
      card.append(fig);
      const note = document.createElement('p');
      note.className = done >= q ? 'counter-alert' : 'counter-note';
      note.textContent = done >= q ? 'Volume horaire annuel atteint' : `Reste ${fmtH(q - done)} · ${c.lignes.length} journée${c.lignes.length > 1 ? 's' : ''}`;
      card.append(note);
    } else {
      card.insertAdjacentHTML('beforeend', '<p class="counter-note">Volume horaire non renseigné</p>');
    }
    if (done > 0) {
      card.insertAdjacentHTML('beforeend', `<div class="rh" role="img" aria-label="Répartition : ${parts.map(k => `${CAT_LABEL[k]} ${fmtH(r[k])}`).join(', ')}">
        <div class="rh-bar">${parts.map(k => `<span class="csh-${k}" style="width:${r[k] / done * 100}%"></span>`).join('')}</div>
        <p class="rh-legend">${parts.map(k => `<span><i class="csh-${k}"></i>${CAT_LABEL[k]} ${fmtH(r[k])} · ${p(r[k])} %</span>`).join('')}</p></div>`);
    }
    box.replaceChildren(card);
    app().animateCounters(box);
  }

  // ---------- listes ----------
  function ligne(l, gerer, nom) {
    return `<li class="csh-line${edition === l.cle ? ' csh-editing' : ''}">
      <div class="csh-line-head"><strong>${fmtDate(l.date)}</strong> · ${fmtH(l.heures)}
        <span class="csh-badge csh-b-${CAT(l.statut)}">${CAT_LABEL[CAT(l.statut)]}</span>
        ${nom ? `<span class="muted small">${esc(nom)}</span>` : ''}
        ${gerer ? `<span class="csh-tools"><button type="button" class="link csh-edit" data-cle="${esc(l.cle)}">Modifier</button><button type="button" class="link csh-del" data-cle="${esc(l.cle)}">Supprimer</button></span>` : ''}</div>
      <div class="csh-detail">${esc(l.detail)}</div></li>`;
  }

  function render() {
    $('#csh-title').textContent = toutes() ? 'Toutes les heures' : 'Mes heures';
    const annees = (data && data.annees) || [annee];
    if (!annees.includes(annee)) annees.unshift(annee);
    $('#csh-annee').innerHTML = annees.map(a => `<option value="${a}"${a === annee ? ' selected' : ''}>${a}</option>`).join('');
    const none = $('#csh-none');
    none.hidden = true;
    if (!data) { $('#csh-list').innerHTML = ''; $('#csh-moi').hidden = true; renderOutbox(); return; }

    const st = $('#csh-statut');
    if (st.options.length <= 1) st.innerHTML = '<option value="">Choisir…</option>' + data.statuts.map(s => `<option>${esc(s)}</option>`).join('');

    if (!toutes()) {
      // Toujours SA fiche (data.moi), jamais la première de la liste : un serveur pas encore à jour
      // renvoie tous les chefs, dans l'ordre de l'onglet DATA.
      const moi = data.moi ? data.chefs.find(c => c.nom === data.moi) : null;
      $('#csh-moi').hidden = !moi;
      if (!moi) {
        none.hidden = false;
        none.textContent = 'Vous ne figurez pas dans la liste des chefs de section qui déclarent des heures (onglet DATA du classeur). Contactez l\'administrateur.';
        $('#csh-list').innerHTML = '';
      } else {
        compteur(moi);
        $('#csh-list').innerHTML = moi.lignes.map(l => ligne(l, true)).join('') || '<li class="muted small">Aucune journée déclarée cette année.</li>';
      }
    } else {
      $('#csh-moi').hidden = true;
      $('#csh-list').innerHTML = data.chefs.map(c => {
        const ouvert = ouverts.has(c.nom);
        const q = Number(c.quota) || 0;
        const pct = q ? Math.min(100, Math.round(c.total / q * 100)) : 0;
        const lvl = !q ? '' : c.total >= q ? ' full' : c.total >= q * 0.8 ? ' warn' : '';
        return `<li class="csh-chef counter csh-counter${lvl}">
          <button type="button" class="csh-chef-head" data-nom="${esc(c.nom)}" aria-expanded="${ouvert}">
            <span><strong>${esc(c.nom)}</strong><small class="muted"> ${esc(c.fonctions.join(' / '))}</small></span>
            <span class="csh-chef-tot"><strong>${fmtH(c.total)}</strong>${q ? ` / ${nf.format(q)} h` : ''}</span>
          </button>
          ${q ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
          <span class="muted small">${c.lignes.length} journée${c.lignes.length > 1 ? 's' : ''}</span>
          <ul class="csh-lines"${ouvert ? '' : ' hidden'}>${c.lignes.map(l => ligne(l, true)).join('') || '<li class="muted small">Aucune journée déclarée.</li>'}</ul>
        </li>`;
      }).join('');
    }
    renderOutbox();
  }

  function renderOutbox() {
    const q = ls.get(KEY_QUEUE, []);
    $('#csh-outbox').innerHTML = q.length
      ? `<p class="muted small">⏳ ${q.length} journée${q.length > 1 ? 's' : ''} en attente d'envoi (sans réseau).</p>` : '';
    const dot = document.querySelector('#nav-csh .pending-dot');
    if (dot) dot.hidden = !q.length;
  }

  async function load() {
    const cache = ls.get(KEY_CACHE, {});
    data = cache[cacheKey()] || null;
    if (data && !toutes()) data.chefs = (data.chefs || []).filter(c => data.moi && c.nom === data.moi);
    render();
    if (!app() || !app().token()) return;
    state('Chargement…');
    try {
      const r = await app().api('cs_heures_list', { token: app().token(), annee, tous: toutes() });
      // « Mes heures » : ne garder que ses propres journées, quelle que soit la version du serveur
      if (!toutes()) r.chefs = (r.chefs || []).filter(c => r.moi && c.nom === r.moi);
      data = r; annee = r.annee;
      cache[cacheKey()] = r; ls.set(KEY_CACHE, cache);
      state('');
      render();
    } catch (e) {
      if (catch401(e)) return;
      state(e instanceof app().NetworkError
        ? (data ? `${app().netLabel()} : dernières données gardées sur l'appareil.` : `${app().netLabel()} : données indisponibles.`)
        : (e.message || 'Chargement impossible'));
    }
  }

  async function flush() {
    if (busy || !navigator.onLine || !app() || !app().token()) return;
    const q = ls.get(KEY_QUEUE, []);
    if (!q.length) return;
    busy = true;
    let envoye = false;
    try {
      while (q.length) {
        try { await app().api('cs_heures_submit', { token: app().token(), decl: q[0].decl, submission_id: q[0].id }); }
        catch (e) { break; }
        q.shift(); ls.set(KEY_QUEUE, q); envoye = true;
      }
    } finally { busy = false; }
    if (envoye && !$('#tab-cs-heures').hidden) load(); else renderOutbox();
  }

  // ---------- formulaire (déclaration ou modification) ----------
  function setEdition(l) {
    const f = $('#csh-form');
    edition = l ? l.cle : null;
    $('#csh-form-title').textContent = l ? `Modifier la journée du ${fmtDate(l.date)}` : 'Déclarer une journée';
    $('#csh-send').textContent = l ? 'Enregistrer' : 'Déclarer';
    $('#csh-cancel').hidden = !l;
    f.elements.date.value = l ? l.date : todayIso();
    f.elements.heures.value = l ? l.heures : 7;
    f.elements.statut.value = l ? l.statut : '';
    f.elements.detail.value = l ? l.detail : '';
    msg('', '');
  }

  async function submit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const decl = {
      date: f.elements.date.value,
      heures: Number(String(f.elements.heures.value).replace(',', '.')),
      statut: f.elements.statut.value,
      detail: f.elements.detail.value.trim(),
    };
    if (!decl.date) return msg('Indiquez la journée.');
    if (!(decl.heures > 0 && decl.heures <= 24)) return msg('Nombre d\'heures invalide (0,5 à 24).');
    if (!decl.statut) return msg('Précisez comment la journée est déclarée.');
    if (decl.detail.length < 3) return msg('Décrivez la journée en quelques mots.');
    const btn = $('#csh-send');
    btn.disabled = true; msg('', '');
    const cle = edition;
    const item = { id: 'csh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), decl };
    try {
      if (cle) await app().api('cs_heures_update', { token: app().token(), cle, decl });
      else await app().api('cs_heures_submit', { token: app().token(), decl, submission_id: item.id });
      setEdition(null);
      msg('', cle ? 'Journée modifiée.' : 'Journée déclarée.');
      annee = Number(decl.date.slice(0, 4));
      load();
    } catch (e) {
      if (catch401(e)) return;
      if (e instanceof app().NetworkError && !cle) {
        const q = ls.get(KEY_QUEUE, []); q.push(item); ls.set(KEY_QUEUE, q);
        setEdition(null);
        msg('', 'Pas de réseau : la journée est gardée sur cet appareil et sera envoyée au retour de la connexion.');
        renderOutbox();
      } else if (e instanceof app().NetworkError) msg('La modification demande le réseau.');
      else msg(e.message || 'Envoi impossible');
    } finally { btn.disabled = false; }
  }

  function trouver(cle) {
    for (const c of (data ? data.chefs : [])) { const l = c.lignes.find(x => x.cle === cle); if (l) return l; }
    return null;
  }

  async function supprimer(cle) {
    if (!confirm('Supprimer cette journée déclarée ?')) return;
    try {
      await app().api('cs_heures_delete', { token: app().token(), cle });
      if (edition === cle) setEdition(null);
      if (app().flash) app().flash('Journée supprimée');
      load();
    } catch (e) {
      if (catch401(e)) return;
      alert(e instanceof app().NetworkError ? 'Suppression impossible sans réseau.' : (e.message || 'Suppression impossible'));
    }
  }

  // « Toutes les heures » : modification dans un formulaire léger, sous la journée
  async function modifierAutre(l, li) {
    const anc = li.querySelector('.csh-inline');
    if (anc) { anc.remove(); return; }
    const opts = data.statuts.map(s => `<option${s === l.statut ? ' selected' : ''}>${esc(s)}</option>`).join('');
    li.insertAdjacentHTML('beforeend', `<form class="csh-inline csh-form" novalidate>
      <label>Journée<input type="date" name="date" value="${l.date}" required></label>
      <label>Heures<input type="number" name="heures" min="0.5" max="24" step="0.5" value="${l.heures}" required></label>
      <label>Je déclare la journée<select name="statut">${opts}</select></label>
      <label>Détail<textarea name="detail" rows="3" maxlength="1000">${esc(l.detail)}</textarea></label>
      <p class="error" role="alert"></p>
      <div class="csh-actions"><button type="submit" class="primary">Enregistrer</button><button type="button" class="link csh-inline-cancel">Annuler</button></div>
    </form>`);
    const f = li.querySelector('.csh-inline');
    f.querySelector('.csh-inline-cancel').addEventListener('click', () => f.remove());
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const decl = { date: f.elements.date.value, heures: Number(f.elements.heures.value), statut: f.elements.statut.value, detail: f.elements.detail.value.trim() };
      const b = f.querySelector('.primary'); b.disabled = true;
      try {
        await app().api('cs_heures_update', { token: app().token(), cle: l.cle, decl });
        if (app().flash) app().flash('Journée modifiée');
        load();
      } catch (e) {
        if (catch401(e)) return;
        f.querySelector('.error').textContent = e instanceof app().NetworkError ? 'La modification demande le réseau.' : (e.message || 'Enregistrement impossible');
      } finally { b.disabled = false; }
    });
  }

  function open(page) {
    const neuf = page && page !== mode;
    mode = page === 'cs-heures-toutes' ? 'cs-heures-toutes' : 'cs-heures';
    if (neuf || !edition) setEdition(null);
    $('#csh-form').elements.date.max = todayIso();
    flush();
    load();
  }

  function init() {
    const tab = $('#tab-cs-heures');
    if (!tab || tab.dataset.ready) return;
    tab.dataset.ready = '1';
    $('#csh-form').addEventListener('submit', submit);
    $('#csh-cancel').addEventListener('click', () => { setEdition(null); render(); });
    $('#csh-annee').addEventListener('change', e => { annee = Number(e.target.value); load(); });
    $('#csh-list').addEventListener('click', e => {
      const del = e.target.closest('.csh-del');
      if (del) return supprimer(del.dataset.cle);
      const ed = e.target.closest('.csh-edit');
      if (ed) {
        const l = trouver(ed.dataset.cle);
        if (!l) return;
        if (toutes()) return modifierAutre(l, ed.closest('.csh-line'));
        setEdition(l);
        render();
        $('#csh-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const head = e.target.closest('.csh-chef-head');
      if (!head) return;
      const ul = head.parentElement.querySelector('.csh-lines');
      ul.hidden = !ul.hidden;
      head.setAttribute('aria-expanded', String(!ul.hidden));
      if (ul.hidden) ouverts.delete(head.dataset.nom); else ouverts.add(head.dataset.nom);
    });
    renderOutbox();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('online', () => setTimeout(flush, 3000));
  setTimeout(flush, 5000);

  window.SMPM_CSH = { open, flush };
})();
