// Heures chefs de section (menu « Chefs de section ») : déclaration des journées et suivi du volume
// horaire annuel de chacun. Back-end : backend/Heures.gs (actions cs_heures_list / _submit / _delete),
// qui écrit dans le classeur « Formulaire chefs de section (réponses) ».
// Hors ligne : dernière liste gardée sur l'appareil, déclarations mises en attente puis envoyées.
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
  const fmtDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const fmtH = h => String(Math.round(h * 10) / 10).replace('.', ',') + ' h';
  const STATUT_COURT = s => /REPOS/i.test(s) ? 'En repos' : /LIB/i.test(s) ? 'À être libéré' : /CUP/i.test(s) ? 'À récupérer' : s;
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  let data = null;
  let annee = new Date().getFullYear();
  let ouverts = new Set();
  let busy = false;

  function state(t) { $('#csh-state').textContent = t || ''; }
  function msg(err, ok) { const f = $('#csh-form'); $('.error', f).textContent = err || ''; $('.ok', f).textContent = ok || ''; }

  function barre(total, quota) {
    if (!quota) return `<p class="csh-tot"><strong>${fmtH(total)}</strong></p>`;
    const pct = Math.min(100, Math.round(total / quota * 100));
    const cls = total > quota ? ' csh-over' : '';
    return `<p class="csh-tot"><strong>${fmtH(total)}</strong> / ${quota} h <span class="muted">(${pct} %)</span></p>
      <div class="bar${cls}"><span style="width:${pct}%"></span></div>`;
  }

  function ligne(l, peutSuppr) {
    return `<li class="csh-line">
      <div class="csh-line-head"><strong>${fmtDate(l.date)}</strong> · ${fmtH(l.heures)}
        <span class="csh-badge">${esc(STATUT_COURT(l.statut))}</span>
        ${peutSuppr ? `<button type="button" class="link csh-del" data-cle="${esc(l.cle)}">Supprimer</button>` : ''}</div>
      <div class="csh-detail">${esc(l.detail)}</div></li>`;
  }

  function render() {
    const sel = $('#csh-annee');
    const annees = (data && data.annees) || [annee];
    sel.innerHTML = annees.map(a => `<option value="${a}"${a === annee ? ' selected' : ''}>${a}</option>`).join('');
    if (!data) { $('#csh-list').innerHTML = ''; $('#csh-moi').hidden = true; return; }

    // Statuts du formulaire
    const st = $('#csh-statut');
    if (!st.options.length) st.innerHTML = '<option value="">Choisir…</option>' + data.statuts.map(s => `<option>${esc(s)}</option>`).join('');

    const moi = data.chefs.find(c => c.nom === data.moi);
    $('#csh-moi').hidden = !moi;
    if (moi) {
      $('#csh-moi-card').innerHTML = `<p class="muted small">Mes heures ${data.annee}</p>${barre(moi.total, moi.quota)}`;
    }

    $('#csh-list').innerHTML = data.chefs.map(c => {
      const ouvert = ouverts.has(c.nom) || c.nom === data.moi;
      const suppr = data.toutGerer || c.nom === data.moi;
      return `<li class="csh-chef${c.nom === data.moi ? ' csh-me' : ''}">
        <button type="button" class="csh-chef-head" data-nom="${esc(c.nom)}" aria-expanded="${ouvert}">
          <span><strong>${esc(c.nom)}</strong><small class="muted"> ${esc(c.fonctions.join(' / '))}</small></span>
          <span class="muted small">${c.lignes.length} j.</span>
        </button>
        ${barre(c.total, c.quota)}
        <ul class="csh-lines"${ouvert ? '' : ' hidden'}>${c.lignes.map(l => ligne(l, suppr)).join('') || '<li class="muted small">Aucune journée déclarée.</li>'}</ul>
      </li>`;
    }).join('');
    renderOutbox();
  }

  function renderOutbox() {
    const q = ls.get(KEY_QUEUE, []);
    $('#csh-outbox').innerHTML = q.length
      ? `<p class="muted small">⏳ ${q.length} journée${q.length > 1 ? 's' : ''} en attente d'envoi (sans réseau).</p>` : '';
  }

  async function load() {
    const cache = ls.get(KEY_CACHE, {});
    if (cache[annee]) { data = cache[annee]; render(); }
    if (!app() || !app().token()) return;
    state('Chargement…');
    try {
      const r = await app().api('cs_heures_list', { token: app().token(), annee });
      data = r; annee = r.annee;
      cache[annee] = r; ls.set(KEY_CACHE, cache);
      state('');
      render();
    } catch (e) {
      if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return; }
      state(e instanceof app().NetworkError
        ? (data ? `${app().netLabel()} : dernières données gardées sur l'appareil.` : `${app().netLabel()} : données indisponibles.`)
        : (e.message || 'Chargement impossible'));
      render();
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
    const item = { id: 'csh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), decl };
    const btn = $('#csh-send');
    btn.disabled = true; msg('', '');
    try {
      await app().api('cs_heures_submit', { token: app().token(), decl, submission_id: item.id });
      resetForm();
      msg('', 'Journée déclarée.');
      if (Number(decl.date.slice(0, 4)) !== annee) annee = Number(decl.date.slice(0, 4));
      load();
    } catch (e) {
      if (e instanceof app().NetworkError) {
        const q = ls.get(KEY_QUEUE, []); q.push(item); ls.set(KEY_QUEUE, q);
        resetForm();
        msg('', 'Pas de réseau : la journée est gardée sur cet appareil et sera envoyée au retour de la connexion.');
        renderOutbox();
      } else if ((app().AUTH_ERRORS || []).includes(e.message)) app().logout();
      else msg(e.message || 'Envoi impossible');
    } finally { btn.disabled = false; }
  }

  function resetForm() {
    const f = $('#csh-form');
    f.elements.detail.value = '';
    f.elements.date.value = todayIso();
  }

  async function supprimer(cle) {
    if (!confirm('Supprimer cette journée déclarée ?')) return;
    try {
      await app().api('cs_heures_delete', { token: app().token(), cle });
      app().flash && app().flash('Journée supprimée');
      load();
    } catch (e) {
      if ((app().AUTH_ERRORS || []).includes(e.message)) return app().logout();
      alert(e instanceof app().NetworkError ? 'Suppression impossible sans réseau.' : (e.message || 'Suppression impossible'));
    }
  }

  function open() {
    const f = $('#csh-form');
    if (!f.elements.date.value) f.elements.date.value = todayIso();
    f.elements.date.max = todayIso();
    msg('', '');
    flush();
    load();
  }

  function init() {
    const tab = $('#tab-cs-heures');
    if (!tab || tab.dataset.ready) return;
    tab.dataset.ready = '1';
    $('#csh-form').addEventListener('submit', submit);
    $('#csh-annee').addEventListener('change', e => { annee = Number(e.target.value); data = null; load(); });
    $('#csh-list').addEventListener('click', e => {
      const del = e.target.closest('.csh-del');
      if (del) return supprimer(del.dataset.cle);
      const head = e.target.closest('.csh-chef-head');
      if (!head) return;
      const ul = head.parentElement.querySelector('.csh-lines');
      ul.hidden = !ul.hidden;
      head.setAttribute('aria-expanded', String(!ul.hidden));
      if (ul.hidden) ouverts.delete(head.dataset.nom); else ouverts.add(head.dataset.nom);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('online', () => setTimeout(flush, 3000));

  window.SMPM_CSH = { open, flush };
})();
