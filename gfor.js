// GFOR : heures réalisées dans le cadre du GFOR (menu « Heures chefs de section › GFOR »).
// Saisie par les chefs de section, CTD et administrateurs : compteur sans quota, dans « Mon livret » de l'agent
// (affiché seulement si son total est supérieur à 0). Hors quotas, absent de la Vue RH.
// Back-end : backend/Gfor.gs (gfor_list, gfor_submit, gfor_delete).
(() => {
  'use strict';

  const KEY_CACHE = 'smpm_gfor_cache';
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmtH = h => nf.format(h) + ' h';
  const fmtDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  let annee = new Date().getFullYear();
  let data = null;

  function state(t) { $('#gfor-state').textContent = t || ''; }
  function msg(err, ok) { const f = $('#gfor-form'); $('.error', f).textContent = err || ''; $('.ok', f).textContent = ok || ''; }
  function catch401(e) { if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return true; } return false; }

  function render() {
    const annees = (data && data.annees) || [annee];
    if (!annees.includes(annee)) annees.unshift(annee);
    $('#gfor-annee').innerHTML = annees.map(a => `<option value="${a}"${a === annee ? ' selected' : ''}>${a}</option>`).join('');
    if (!data) { $('#gfor-list').innerHTML = ''; return; }
    const sel = $('#gfor-agent');
    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Choisir un agent…</option>' +
        data.agents.map(a => `<option value="${esc(a.cle)}">${esc(a.label)}</option>`).join('');
    }
    const total = data.lignes.reduce((s, l) => s + l.heures, 0);
    $('#gfor-total').textContent = data.lignes.length
      ? `Total ${annee} : ${fmtH(total)} · ${data.lignes.length} saisie${data.lignes.length > 1 ? 's' : ''}`
      : '';
    $('#gfor-list').innerHTML = data.lignes.map(l => `<li class="csh-line">
        <div class="csh-line-head"><strong>${esc(l.nom)} ${esc(l.prenom)}</strong> · ${fmtDate(l.date)} · ${fmtH(l.heures)}
          <span class="csh-tools"><button type="button" class="link gfor-del" data-cle="${esc(l.cle)}">Supprimer</button></span></div>
        <div class="csh-detail">${esc(l.detail)}</div>
        <div class="muted small">Saisi par ${esc(l.saisi)}</div></li>`).join('')
      || '<li class="muted small">Aucune saisie GFOR pour cette année.</li>';
  }

  async function load() {
    const cache = JSON.parse(localStorage.getItem(KEY_CACHE) || '{}');
    if (cache[annee]) { data = cache[annee]; render(); }
    if (!app() || !app().token()) return;
    state('Chargement…');
    try {
      const r = await app().api('gfor_list', { token: app().token(), annee });
      data = r; annee = r.annee;
      cache[annee] = r; localStorage.setItem(KEY_CACHE, JSON.stringify(cache));
      state('');
      render();
    } catch (e) {
      if (catch401(e)) return;
      state(e instanceof app().NetworkError ? 'Hors réseau : dernières données gardées sur l\'appareil.' : (e.message || 'Chargement impossible'));
    }
  }

  async function submit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const decl = {
      agent: f.elements.agent.value,
      date: f.elements.date.value,
      heures: Number(String(f.elements.heures.value).replace(',', '.')),
      detail: f.elements.detail.value.trim(),
    };
    if (!decl.agent) return msg('Choisissez l\'agent formé.');
    if (!decl.date) return msg('Indiquez la date.');
    if (!(decl.heures > 0 && decl.heures <= 24)) return msg('Nombre d\'heures invalide (0,5 à 24).');
    if (decl.detail.length < 3) return msg('Décrivez la formation en quelques mots.');
    const btn = $('#gfor-send');
    btn.disabled = true; msg('', '');
    try {
      const id = 'gfor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      await app().api('gfor_submit', { token: app().token(), decl, submission_id: id });
      f.elements.heures.value = 7;
      f.elements.detail.value = '';
      msg('', 'Heures enregistrées.');
      annee = Number(decl.date.slice(0, 4));
      load();
    } catch (e) {
      if (catch401(e)) return;
      msg(e instanceof app().NetworkError ? 'La saisie demande le réseau.' : (e.message || 'Enregistrement impossible'));
    } finally { btn.disabled = false; }
  }

  async function supprimer(cle) {
    if (!confirm('Supprimer cette saisie GFOR ?')) return;
    try {
      await app().api('gfor_delete', { token: app().token(), cle });
      if (app().flash) app().flash('Saisie supprimée');
      load();
    } catch (e) {
      if (catch401(e)) return;
      alert(e instanceof app().NetworkError ? 'Suppression impossible sans réseau.' : (e.message || 'Suppression impossible'));
    }
  }

  function open() {
    $('#gfor-form').elements.date.max = todayIso();
    if (!$('#gfor-form').elements.date.value) $('#gfor-form').elements.date.value = todayIso();
    load();
  }

  function init() {
    const tab = $('#tab-cs-gfor');
    if (!tab || tab.dataset.ready) return;
    tab.dataset.ready = '1';
    $('#gfor-form').addEventListener('submit', submit);
    $('#gfor-annee').addEventListener('change', e => { annee = Number(e.target.value); load(); });
    $('#gfor-list').addEventListener('click', e => {
      const del = e.target.closest('.gfor-del');
      if (del) supprimer(del.dataset.cle);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.SMPM_GFOR = { open };
})();
