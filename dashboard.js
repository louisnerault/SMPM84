// Tableaux de bord (menu « Chefs de section › Tableau de bord ») : vision d'ensemble de l'unité à un instant T.
// Thèmes : Interventions, FMPA, Livrets, Neige, Spéléo, Inventaires. Filtre par année ou par période, et par secteur.
// Le serveur (Dashboard.gs, action dash_data) renvoie des données compactes ; toutes les statistiques sont calculées
// ici : changer de filtre ne redemande rien au serveur. Données gardées en mémoire seulement (jamais sur l'appareil).
// Conçu pour l'ordinateur ; sur smartphone en portrait, le mode paysage est proposé.
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const n0 = v => nf0.format(v || 0);
  const n1 = v => nf1.format(v || 0);
  const pct = v => (v == null || !isFinite(v) ? '—' : nf0.format(v) + ' %');
  const fmtH = h => n1(h) + ' h';
  const fmtDuree = m => { if (m == null || !isFinite(m)) return '—'; const h = Math.floor(m / 60), mn = Math.round(m % 60); return h ? `${h} h ${String(mn).padStart(2, '0')}` : `${mn} min`; };
  const fmtDate = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const median = arr => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const TRANCHES = ['0 h–4 h', '4 h–8 h', '8 h–12 h', '12 h–16 h', '16 h–20 h', '20 h–24 h'];
  const SECTEURS = [['', 'Toute l’unité'], ['NORD', 'Nord'], ['CENTRE', 'Centre'], ['SUD', 'Sud']];
  const NOM_SECTEUR = { NORD: 'Nord', SUD: 'Sud', CENTRE: 'Centre', NEIGE: 'Neige', ISS: 'ISS', SSH: 'SSH', CAN: 'Canyon', SSSM: 'SSSM' };
  const SMPM_SECT = ['CENTRE', 'NORD', 'SUD'];
  const CONTEXTES = { simple: 'Inventaire simple', fmpa_debut: 'FMPA – début', fmpa_fin: 'FMPA – fin de journée', intervention: 'Après intervention' };
  const ico = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const THEMES = [
    { id: 'itv', nom: 'Interventions', sets: ['itv', 'personnel'], ico: ico('<path d="M6 18v-5a6 6 0 0 1 12 0v5"/><path d="M4 18h16v3H4z"/><path d="M12 2.5v2M3.5 6l1.5 1.4M20.5 6L19 7.4"/>') },
    { id: 'fmpa', nom: 'FMPA', sets: ['fmpa', 'personnel'], ico: ico('<rect x="5" y="3.5" width="14" height="17.5" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 12.5l2.2 2.2 4.8-4.8"/>') },
    { id: 'livrets', nom: 'Livrets', sets: ['livrets', 'personnel'], ico: ico('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 11.5h5"/>') },
    { id: 'neige', nom: 'Neige', sets: ['personnel', 'fmpa', 'itv', 'livrets', 'inv'], ico: ico('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>') },
    { id: 'speleo', nom: 'Spéléo', sets: ['personnel', 'fmpa', 'itv', 'livrets', 'inv'], ico: ico('<path d="M3 20h18"/><path d="M5 20c0-6 3-11 7-11s7 5 7 11"/><path d="M12 9V4M9.5 5.5L12 4l2.5 1.5"/>') },
    { id: 'inv', nom: 'Inventaires', sets: ['inv'], ico: ico('<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>') },
  ];
  const KEY_PREF = 'smpm_dash_pref';        // thème et mode préférés (aucune donnée personnelle)
  const FRAIS_MS = 10 * 60000;              // données rechargées au-delà de 10 min

  const auj = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const pref = (() => { try { return JSON.parse(localStorage.getItem(KEY_PREF) || '{}') || {}; } catch (e) { return {}; } })();
  const st = {
    theme: THEMES.some(t => t.id === pref.theme) ? pref.theme : 'itv',
    mode: pref.mode === 'periode' ? 'periode' : 'annee',
    annee: new Date().getFullYear(),
    du: `${new Date().getFullYear()}-01-01`, au: auj(),
    secteur: '',
  };
  const cache = {};                         // jeu -> { d, t }
  let moi = null, construit = false, demande = 0, carte = null, verrouPaysage = false, portraitIgnore = false;

  function sauverPref() { try { localStorage.setItem(KEY_PREF, JSON.stringify({ theme: st.theme, mode: st.mode })); } catch (e) {} }

  // ---------- période ----------
  // Date « aaaa-mm-jj » locale d'une valeur ISO (les horodatages UTC sont ramenés au jour de Paris)
  const jour = v => (!v ? '' : String(v).length <= 10 ? String(v) : (() => { const d = new Date(v); if (isNaN(d)) return String(v).slice(0, 10); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })());
  const dans = (d, r) => { const j = jour(d); return !!j && j >= r.du && j <= r.au; };
  const moinsUnAn = d => { const [y, m, j] = d.split('-'); return `${Number(y) - 1}-${m}-${m === '02' && j === '29' ? '28' : j}`; };
  function periode() {
    if (st.mode === 'annee') return { du: `${st.annee}-01-01`, au: `${st.annee}-12-31`, lib: String(st.annee), annee: st.annee };
    let du = st.du || `${st.annee}-01-01`, au = st.au || auj();
    if (du > au) [du, au] = [au, du];
    return { du, au, lib: `du ${fmtDate(du)} au ${fmtDate(au)}`, annee: Number(au.slice(0, 4)) };
  }
  // Période de comparaison : la même un an plus tôt, arrêtée à la même date si la période n'est pas terminée
  function precedente(r) {
    const fin = r.au > auj() ? auj() : r.au;
    return { du: moinsUnAn(r.du), au: moinsUnAn(fin < r.du ? r.du : fin) };
  }
  const libN1 = () => (st.mode === 'annee' ? 'même période\u00a0N\u20111' : 'période\u00a0N\u20111');
  // Graduations de temps : mois (jusqu'à 36), sinon années
  function axeTemps(r) {
    const [y0, m0] = r.du.split('-').map(Number), [y1, m1] = r.au.split('-').map(Number);
    const nb = (y1 - y0) * 12 + (m1 - m0) + 1;
    if (nb > 36) {
      const keys = []; for (let y = y0; y <= y1; y++) keys.push(String(y));
      return { keys, lab: k => k, de: d => jour(d).slice(0, 4), prec: k => String(Number(k) - 1) };
    }
    const keys = [];
    for (let i = 0; i < nb; i++) { const y = y0 + Math.floor((m0 - 1 + i) / 12), m = (m0 - 1 + i) % 12 + 1; keys.push(`${y}-${String(m).padStart(2, '0')}`); }
    const multiAn = y0 !== y1;
    return {
      keys, de: d => jour(d).slice(0, 7),
      lab: k => MOIS[Number(k.slice(5)) - 1] + (multiAn ? ' ' + k.slice(2, 4) : ''),
      prec: k => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`,
    };
  }
  const joursPeriode = r => Math.round((new Date(r.au) - new Date(r.du)) / 864e5) + 1;

  // ---------- composants ----------
  function delta(cur, prev, upBon = true) {
    if (prev == null || cur == null) return '';
    if (!prev && !cur) return `<span class="k-d neutre" title="${esc(libN1())} : 0">= ${esc(libN1())}</span>`;
    if (!prev) return `<span class="k-d neutre">${esc(libN1())} : 0</span>`;
    const p = Math.round((cur - prev) / prev * 100);
    const sens = p > 0 ? 'up' : p < 0 ? 'down' : 'eq';
    const cls = upBon === null || sens === 'eq' ? 'neutre' : (sens === 'up') === upBon ? 'bon' : 'mauvais';
    const fl = sens === 'up' ? '▲' : sens === 'down' ? '▼' : '=';
    return `<span class="k-d ${cls}" title="${esc(libN1())} : ${esc(n1(prev))}">${fl} ${p > 0 ? '+' : ''}${p} % vs ${esc(libN1())}</span>`;
  }
  const kpi = (label, valeur, sous = '', d = '', cls = '') =>
    `<div class="dash-kpi ${cls}"><span class="k-l">${esc(label)}</span><strong class="k-v">${valeur}</strong>${sous ? `<span class="k-s">${sous}</span>` : ''}${d}</div>`;
  const kpis = list => `<div class="dash-kpis">${list.filter(Boolean).join('')}</div>`;
  const carteHtml = (titre, corps, o = {}) =>
    `<section class="dash-card${o.large ? ' wide' : ''}${o.plein ? ' full' : ''}"><h2>${esc(titre)}</h2>${o.sous ? `<p class="dash-sub">${o.sous}</p>` : ''}${corps}</section>`;
  const vide = (t = 'Aucune donnée sur la période.') => `<p class="dash-vide">${esc(t)}</p>`;
  const titreGroupe = t => `<h2 class="dash-group">${esc(t)}</h2>`;
  const grille = cartes => `<div class="dash-grid">${cartes.filter(Boolean).join('')}</div>`;

  // Barres horizontales : items [{ l, v, tip?, s? (sous-libellé) }], triées, au-delà de top regroupées en « Autres »
  function barres(items, o = {}) {
    const fmt = o.fmt || n0;
    let list = items.filter(x => x.v > 0 || o.zero);
    if (!list.length) return vide(o.vide);
    if (o.tri !== false) list.sort((a, b) => b.v - a.v);
    const top = o.top || 10;
    if (list.length > top && o.autres !== false) {
      const reste = list.slice(top - 1);
      list = list.slice(0, top - 1).concat({ l: `Autres (${reste.length})`, v: sum(reste, x => x.v), autre: true, tip: reste.slice(0, 12).map(x => `${x.l} : ${fmt(x.v)}`).join('\n') });
    } else list = list.slice(0, top);
    const max = o.max || Math.max(...list.filter(x => !x.autre).map(x => x.v), 0) || 1;
    return `<div class="hb-list">${list.map(x => `<div class="hb${x.autre ? ' autre' : ''}" data-tip="${esc(x.tip || `${x.l} : ${fmt(x.v)}`)}">
      <span class="hb-l">${esc(x.l)}${x.s ? `<small>${esc(x.s)}</small>` : ''}</span>
      <span class="hb-t"><span class="hb-b" style="width:${x.v > 0 ? Math.max(1.5, Math.min(100, x.v / max * 100)) : 0}%;${x.c ? `background:${x.c}` : ''}"></span></span>
      <span class="hb-v">${esc(fmt(x.v))}</span></div>`).join('')}</div>`;
  }

  const graduation = max => {
    if (max <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    return [1, 2, 2.5, 5, 10].map(k => k * p).find(v => v >= max) || max;
  };
  // Colonnes (empilables) : series [{ nom, c, vals }], ref (comparaison N-1, même unité, même axe) : { nom, vals }
  function colonnes(labels, series, o = {}) {
    const fmt = o.fmt || n0;
    const tot = labels.map((_, i) => sum(series, s => s.vals[i]));
    const refs = o.ref ? o.ref.vals : [];
    const max = graduation(Math.max(...tot, ...refs, 0));
    if (!tot.some(Boolean) && !refs.some(Boolean)) return vide(o.vide);
    const iMax = tot.indexOf(Math.max(...tot));
    const cols = labels.map((l, i) => {
      const tip = [l, ...series.map(s => `${series.length > 1 ? s.nom + ' : ' : ''}${fmt(s.vals[i])}`), o.ref ? `${o.ref.nom} : ${fmt(refs[i])}` : ''].filter(Boolean).join('\n');
      const segs = series.map(s => s.vals[i] > 0 ? `<span class="vc-seg" style="flex:${s.vals[i]};background:${s.c}"></span>` : '').join('');
      return `<div class="vc-col" data-tip="${esc(tip)}"><div class="vc-stack" style="height:${tot[i] / max * 100}%">${i === iMax && tot[i] ? `<span class="vc-cap">${esc(fmt(tot[i]))}</span>` : ''}${segs}</div>${o.ref ? `<span class="vc-ref" style="bottom:${refs[i] / max * 100}%"></span>` : ''}</div>`;
    }).join('');
    const leg = [...(series.length > 1 ? series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.nom)}</span>`) : []),
      o.ref ? `<span><i class="ref"></i>${esc(o.ref.nom)}</span>` : ''].filter(Boolean).join('');
    const pas = labels.length > 18 ? Math.ceil(labels.length / 12) : 1;
    return `<div class="vc">
      <div class="vc-plot"><div class="vc-grid"><span data-v="${esc(fmt(max))}"></span><span data-v="${esc(fmt(max / 2))}"></span><span data-v="0"></span></div>
      <div class="vc-cols" style="--n:${labels.length}">${cols}</div></div>
      <div class="vc-x" style="--n:${labels.length}">${labels.map((l, i) => `<span>${i % pas ? '' : esc(l)}</span>`).join('')}</div>
      ${leg ? `<div class="dash-leg">${leg}</div>` : ''}</div>`;
  }

  // Barre segmentée (un tout et ses parts) : parts [{ l, v, c }]
  function segments(parts, o = {}) {
    const tot = sum(parts, p => p.v);
    if (!tot) return vide(o.vide);
    const fmt = o.fmt || n0;
    return `<div class="dseg"><div class="dseg-bar">${parts.filter(p => p.v > 0).map(p => `<span style="flex:${p.v};background:${p.c}" data-tip="${esc(`${p.l} : ${fmt(p.v)} (${pct(p.v / tot * 100)})`)}"></span>`).join('')}</div>
      <div class="dash-leg dseg-leg">${parts.map(p => `<span><i style="background:${p.c}"></i>${esc(p.l)} <b>${esc(fmt(p.v))}</b> <em>${pct(p.v / tot * 100)}</em></span>`).join('')}</div></div>`;
  }

  // Carte de chaleur jour × tranche horaire
  function chaleur(m) {
    const max = Math.max(...m.flat(), 0);
    if (!max) return vide('Aucune heure de déclenchement renseignée sur la période.');
    return `<div class="heat"><span></span>${TRANCHES.map(t => `<span class="heat-h">${esc(t)}</span>`).join('')}
      ${m.map((ligne, j) => `<span class="heat-j">${JOURS[j]}</span>${ligne.map((v, t) => `<span class="heat-c${v / max > 0.55 ? ' fonce' : ''}" style="--a:${v ? 0.12 + 0.88 * v / max : 0}" data-tip="${esc(`${JOURS[j]}, ${TRANCHES[t]} : ${v}`)}">${v || ''}</span>`).join('')}`).join('')}</div>`;
  }

  // Tableau dans une section dépliable : cols [{ t, f, cls }]
  function tableau(titre, cols, rows, o = {}) {
    if (!rows.length) return o.cacheVide ? '' : `<details class="dash-det"><summary>${esc(titre)} (0)</summary>${vide()}</details>`;
    const max = o.max || 300;
    return `<details class="dash-det"${o.ouvert ? ' open' : ''}><summary>${esc(titre)} (${rows.length})</summary><div class="dash-tbl-wrap"><table class="dash-tbl"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, max).map(r => `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${rows.length > max ? `<p class="muted small">${rows.length - max} ligne(s) non affichée(s).</p>` : ''}</details>`;
  }

  const compter = (list, f) => { const m = {}; list.forEach(x => { const v = f(x); (Array.isArray(v) ? v : [v]).forEach(k => { if (k !== '' && k != null) m[k] = (m[k] || 0) + 1; }); }); return m; };
  const versItems = (m, lab = k => k) => Object.keys(m).map(k => ({ l: lab(k), v: m[k] }));
  const parTemps = (axe, list, f = () => 1) => { const m = {}; list.forEach(x => { const k = axe.de(x.d); m[k] = (m[k] || 0) + f(x); }); return axe.keys.map(k => m[k] || 0); };
  const parTempsPrec = (axe, list, f = () => 1) => { const m = {}; list.forEach(x => { const k = axe.de(x.d); m[k] = (m[k] || 0) + f(x); }); return axe.keys.map(k => m[axe.prec(k)] || 0); };
  const S1 = 'var(--s1)', S2 = 'var(--s2)', S3 = 'var(--s3)', S4 = 'var(--s4)', BON = 'var(--good)', MAUV = 'var(--bad)', ALERTE = 'var(--warn)', NEUTRE = 'var(--neutral)';

  // Personnel : nom (clé NOM) -> agent
  const persMap = P => { const m = {}; ((P && P.agents) || []).forEach(a => { m[a.n] = a; }); return m; };
  const nomAff = (pm, n) => { const a = pm[n]; return a ? `${a.p} ${a.n}`.trim() : String(n || '—'); };
  const actifsSecteur = (P, s) => ((P && P.agents) || []).filter(a => !s || a.s === s);

  // Questions à choix du formulaire : une carte par question
  function cartesQuestions(q, L, idx0 = 0) {
    const out = [];
    (q || []).forEach((qu, i) => {
      if (qu.k === 'note') return;
      const m = compter(L, x => x.c[i + idx0]);
      if (!Object.keys(m).length) return;
      out.push(carteHtml(qu.t, barres(versItems(m), { top: 8 }), { sous: qu.k === 'multi' ? 'Plusieurs réponses possibles' : '' }));
    });
    return out;
  }
  function kpisNotes(q, L) {
    return (q || []).map((qu, i) => {
      if (qu.k !== 'note') return '';
      const v = L.map(x => x.c[i]).filter(x => typeof x === 'number');
      if (!v.length) return '';
      return kpi(qu.t, `${n1(sum(v) / v.length)}<small> / ${qu.max || 5}</small>`, `${v.length} réponse${v.length > 1 ? 's' : ''}`);
    }).filter(Boolean);
  }
  const erreurJeu = (nom, x) => (!x ? `<p class="dash-err">${esc(nom)} : données non reçues.</p>` : x.erreur ? `<p class="dash-err">${esc(nom)} : ${esc(x.erreur)}</p>` : '');

  // ====================== Interventions ======================
  function vueItv(D, r, rp) {
    const X = D.itv, P = D.personnel;
    const e = erreurJeu('Interventions', X); if (e) return e;
    const pm = persMap(P);
    const okS = x => !st.secteur || (pm[x.cu] || {}).s === st.secteur;
    const L = X.recs.filter(x => dans(x.d, r) && okS(x)), Lp = X.recs.filter(x => dans(x.d, rp) && okS(x));
    const axe = axeTemps(r);
    const dureeOk = x => x.m != null && x.m > 0 && x.m < 72 * 60;
    const durees = L.filter(dureeOk).map(x => x.m);
    const heures = sum(durees) / 60, heuresP = sum(Lp.filter(dureeOk), x => x.m) / 60;
    const engag = sum(L, x => x.ag.length);
    const distincts = new Set(L.flatMap(x => x.ag));
    const vict = L.filter(x => x.v != null);
    const ch = X.champs || {};
    const html = [kpis([
      kpi('Interventions', n0(L.length), r.lib, delta(L.length, Lp.length, null)),
      ch.duree ? kpi('Heures d’engagement', fmtH(heures), `${durees.length} intervention${durees.length > 1 ? 's' : ''} avec heure de fin`, delta(heures, heuresP, null)) : '',
      ch.duree ? kpi('Durée médiane', fmtDuree(median(durees)), durees.length ? `de ${fmtDuree(Math.min(...durees))} à ${fmtDuree(Math.max(...durees))}` : '') : '',
      ch.engages ? kpi('Spécialistes engagés', n0(distincts.size), `${n0(engag)} engagements · ${L.length ? n1(engag / L.length) : 0} par intervention`) : '',
      ch.victimes ? kpi('Victimes', n0(sum(vict, x => x.v)), `${vict.length} intervention${vict.length > 1 ? 's' : ''} renseignée${vict.length > 1 ? 's' : ''}`) : '',
      kpi('Neige · Spéléo', `${n0(L.filter(x => x.sp === 'NEIGE').length)} · ${n0(L.filter(x => x.sp === 'ISS').length)}`, 'd’après les réponses au compte rendu'),
    ])];
    const heat = Array.from({ length: 7 }, () => Array(6).fill(0));
    L.forEach(x => { if (!x.hd) return; const j = (new Date(x.d + 'T12:00').getDay() + 6) % 7; heat[j][Math.min(5, Math.floor(Number(x.hd.slice(0, 2)) / 4))]++; });
    const tranchesD = [['< 1 h', 0, 60], ['1 h – 2 h', 60, 120], ['2 h – 4 h', 120, 240], ['4 h – 8 h', 240, 480], ['> 8 h', 480, 1e9]];
    // Taux d'engagement : spécialistes actifs du secteur engagés au moins une fois sur la période
    const tauxSect = SMPM_SECT.filter(s => !st.secteur || s === st.secteur).map(s => {
      const act = actifsSecteur(P, s), eng = act.filter(a => distincts.has(a.n)).length;
      return { l: NOM_SECTEUR[s], v: act.length ? eng / act.length * 100 : 0, tip: `${NOM_SECTEUR[s]} : ${eng} engagé(s) sur ${act.length} actif(s)` };
    });
    html.push(grille([
      carteHtml('Interventions par mois', colonnes(axe.keys.map(axe.lab), [{ nom: 'Interventions', c: S1, vals: parTemps(axe, L) }], { ref: { nom: 'N-1', vals: parTempsPrec(axe, X.recs.filter(okS)) } }), { large: true, sous: 'Le trait gris marque l’année précédente.' }),
      carteHtml('Jour et heure de déclenchement', chaleur(heat), { sous: 'Nombre d’interventions par jour de la semaine et tranche de 4 h' }),
      ch.duree ? carteHtml('Durée des interventions', barres(tranchesD.map(([l, a, b]) => ({ l, v: durees.filter(m => m >= a && m < b).length })), { tri: false, autres: false, zero: true }), { sous: 'De l’heure de début à l’heure de fin' }) : '',
      carteHtml('Communes', barres(versItems(compter(L, x => x.co)), { top: 10 })),
      carteHtml('Départements', barres(versItems(compter(L, x => x.dp)), { top: 6 })),
      ch.engages ? carteHtml('Spécialistes les plus engagés', barres(versItems(compter(L, x => x.ag), n => nomAff(pm, n)), { top: 10, autres: false })) : '',
      carteHtml('Chefs d’unité', barres(versItems(compter(L, x => x.cu), n => nomAff(pm, n)), { top: 10, autres: false })),
      ch.engages ? carteHtml('Taux d’engagement par secteur', barres(tauxSect, { fmt: pct, max: 100, tri: false, zero: true }), { sous: 'Part des spécialistes actifs engagés au moins une fois' }) : '',
      ...cartesQuestions(X.q, L),
      ch.gps ? carteHtml('Carte des interventions', `<div class="dash-map" data-map="itv"></div><p class="dash-sub">${L.filter(x => x.g).length} intervention(s) localisée(s) sur ${L.length}.</p>`, { large: true }) : '',
      ...kpisNotes(X.q, L).length ? [carteHtml('Notes moyennes', kpis(kpisNotes(X.q, L)))] : [],
    ]));
    html.push(tableau('Liste des interventions', [
      { t: 'Date', f: x => fmtDate(x.d) }, { t: 'Heure', f: x => esc(x.hd || '—') }, { t: 'Commune', f: x => esc(x.co || '—') },
      { t: 'Chef d’unité', f: x => esc(nomAff(pm, x.cu)) }, { t: 'Durée', f: x => fmtDuree(x.m), cls: 'num' }, { t: 'Engagés', f: x => n0(x.ag.length), cls: 'num' },
    ], L.slice().sort((a, b) => (a.d < b.d ? 1 : -1))));
    carteDonnees = L.filter(x => x.g).map(x => ({ g: x.g, t: `${fmtDate(x.d)} — ${x.co || ''}`, s: x.sp }));
    return html.join('');
  }

  // ====================== FMPA ======================
  function vueFmpa(D, r, rp) {
    const X = D.fmpa, P = D.personnel;
    const e = erreurJeu('FMPA', X); if (e) return e;
    const pm = persMap(P);
    const okS = x => !st.secteur || x.s === st.secteur;
    const L = X.recs.filter(x => dans(x.d, r) && okS(x)), Lp = X.recs.filter(x => dans(x.d, rp) && okS(x));
    const axe = axeTemps(r);
    const hp = x => (x.h || 0) * x.pr.length;
    const heuresP = sum(L, hp), heuresPp = sum(Lp, hp);
    const pres = L.flatMap(x => x.pr);
    const repos = pres.filter(p => p[1] === 'R').length, tt = pres.length - repos;
    const actifs = actifsSecteur(P, st.secteur);
    const parAgent = {};
    pres.forEach(p => { parAgent[p[0]] = (parAgent[p[0]] || 0) + 1; });
    const formes = actifs.filter(a => parAgent[a.n]).length;
    const sansFmpa = actifs.filter(a => !parAgent[a.n]);
    const binsN = [['0', 0, 0], ['1', 1, 1], ['2 à 3', 2, 3], ['4 à 6', 4, 6], ['7 à 10', 7, 10], ['plus de 10', 11, 1e9]];
    const html = [kpis([
      kpi('FMPA', n0(L.length), r.lib, delta(L.length, Lp.length)),
      kpi('Heures de FMPA', fmtH(sum(L, x => x.h)), `durée cumulée des manœuvres`, delta(sum(L, x => x.h), sum(Lp, x => x.h))),
      kpi('Heures de formation dispensées', fmtH(heuresP), 'durée × spécialistes présents', delta(heuresP, heuresPp)),
      kpi('Présents par FMPA', L.length ? n1(pres.length / L.length) : '—', `${n0(pres.length)} présences au total`),
      kpi('Spécialistes formés', `${n0(formes)}<small> / ${n0(actifs.length)}</small>`, `${pct(actifs.length ? formes / actifs.length * 100 : null)} des actifs ont fait au moins une FMPA`),
      ...kpisNotes(X.q, L),
    ])];
    html.push(grille([
      carteHtml('FMPA par mois', colonnes(axe.keys.map(axe.lab), [{ nom: 'FMPA', c: S1, vals: parTemps(axe, L) }], { ref: { nom: 'N-1', vals: parTempsPrec(axe, X.recs.filter(okS)) } }), { large: true, sous: 'Le trait gris marque l’année précédente.' }),
      carteHtml('Heures de formation dispensées par mois', colonnes(axe.keys.map(axe.lab), [{ nom: 'Heures', c: S1, vals: parTemps(axe, L, hp) }], { fmt: n0, ref: { nom: 'N-1', vals: parTempsPrec(axe, X.recs.filter(okS), hp) } }), { large: true, sous: 'Durée de la FMPA × nombre de présents' }),
      carteHtml('Repos ou temps de travail', segments([{ l: 'Repos', v: repos, c: S1 }, { l: 'Temps de travail', v: tt, c: S2 }]), { sous: 'Statut des présences sur la période' }),
      carteHtml('FMPA par secteur', barres(versItems(compter(L, x => x.s), k => NOM_SECTEUR[k] || k || '—').map(it => ({ ...it, tip: `${it.l} : ${it.v} FMPA` })), { top: 8 })),
      carteHtml('Assiduité des spécialistes', barres(binsN.map(([l, a, b]) => ({ l: `${l} FMPA`, v: actifs.filter(x => (parAgent[x.n] || 0) >= a && (parAgent[x.n] || 0) <= b).length })), { tri: false, autres: false, zero: true }), { sous: `Spécialistes actifs${st.secteur ? ' du secteur' : ''} selon leur nombre de FMPA` }),
      carteHtml('Lieux', barres(versItems(compter(L, x => x.l)), { top: 10 })),
      carteHtml('Chefs d’unité encadrants', barres(versItems(compter(L, x => x.cu), n => nomAff(pm, n)), { top: 10, autres: false })),
      carteHtml('Spécialistes les plus présents', barres(versItems(parAgent, n => nomAff(pm, n)), { top: 10, autres: false })),
      ...cartesQuestions(X.q, L),
    ]));
    html.push(tableau(`Spécialistes actifs sans FMPA sur la période`, [
      { t: 'Spécialiste', f: a => esc(`${a.n} ${a.p}`) }, { t: 'Secteur', f: a => esc(NOM_SECTEUR[a.s] || a.s || '—') },
    ], sansFmpa.sort((a, b) => a.n.localeCompare(b.n))));
    html.push(tableau('Liste des FMPA', [
      { t: 'Date', f: x => fmtDate(x.d) }, { t: 'Secteur', f: x => esc(NOM_SECTEUR[x.s] || x.s || '—') }, { t: 'Lieu', f: x => esc(x.l || '—') },
      { t: 'IMP3', f: x => esc(nomAff(pm, x.cu)) }, { t: 'Durée', f: x => fmtH(x.h), cls: 'num' }, { t: 'Présents', f: x => n0(x.pr.length), cls: 'num' },
    ], L.slice().sort((a, b) => (a.d < b.d ? 1 : -1))));
    return html.join('');
  }

  // ====================== Livrets ======================
  // Heures d'un agent sur la période pour des secteurs donnés (résumé mensuel du livret)
  const heuresLivret = (a, r, secteurs) => {
    const m0 = r.du.slice(0, 7), m1 = r.au.slice(0, 7);
    let h = 0;
    Object.keys(a.h || {}).forEach(k => { const [m, s] = k.split('|'); if (m >= m0 && m <= m1 && secteurs.includes(s)) h += a.h[k]; });
    return h;
  };
  const facteurQuota = r => (st.mode === 'annee' ? 1 : joursPeriode(r) / 365);
  function etatLivrets(LV) {
    if (!LV.installe) return '<p class="dash-err">Résumé des livrets pas encore calculé : l’administrateur doit exécuter installerTableauxDeBord() dans Apps Script.</p>';
    const parts = [`Livrets lus : ${LV.lus} sur ${LV.attendus}`];
    if (LV.maj) parts.push(`mis à jour le ${new Date(LV.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`);
    return `<p class="dash-sub">${esc(parts.join(' · '))}${LV.lus < LV.attendus ? ' — les autres sont lus chaque heure, en arrière-plan.' : ''}</p>`;
  }
  const binsPct = [['< 25 %', 0, 25], ['25 à 50 %', 25, 50], ['50 à 75 %', 50, 75], ['75 à 100 %', 75, 100], ['≥ 100 %', 100, 1e9]];
  const couleursPct = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)'];

  function vueLivrets(D, r, rp) {
    const LV = D.livrets;
    const e = erreurJeu('Livrets', LV); if (e) return e;
    const f = facteurQuota(r);
    const A = LV.agents.filter(a => !st.secteur || a.s === st.secteur);
    const lignes = A.map(a => {
      const h = heuresLivret(a, r, SMPM_SECT), hp = heuresLivret(a, rp, SMPM_SECT);
      const q = ((a.quotas || {}).SMPM || {}).quota * f || 0;
      return { a, h, hp, q, p: q ? h / q * 100 : null };
    });
    const avecQ = lignes.filter(x => x.q);
    const atteint = avecQ.filter(x => x.p >= 100).length;
    const y = String(r.annee);
    const crit = LV.criteres || [];
    // Validations annuelles : pour chaque critère requis, validé / non validé / non effectué
    const val = crit.map((c, k) => {
      const conc = A.filter(a => a.requis[k] !== false);
      const st_ = conc.map(a => ((a.v || {})[y] || [])[k] || '');
      return { c, v: st_.filter(s => s === 'v').length, n: st_.filter(s => s === 'n').length, x: st_.filter(s => !s).length };
    });
    const complets = A.filter(a => crit.length && crit.every((_, k) => a.requis[k] === false || ((a.v || {})[y] || [])[k] === 'v')).length;
    const spe = ['NEIGE', 'ISS', 'SSH', 'CAN'].map(S => {
      const conc = A.filter(a => a.quotas && a.quotas[S] && (!a.quotas[S].depuis || a.quotas[S].depuis <= r.annee));
      const ok = conc.filter(a => heuresLivret(a, r, [S]) >= (a.quotas[S].quota || 0) * f).length;
      return { S, n: conc.length, ok };
    }).filter(x => x.n);
    const axe = axeTemps(r);
    const parMois = axe.keys.map(k => sum(A, a => sum(Object.keys(a.h || {}).filter(x => { const [m, s] = x.split('|'); return SMPM_SECT.includes(s) && (axe.keys[0].length === 4 ? m.slice(0, 4) : m) === k; }), x => a.h[x])));
    const parMoisP = axe.keys.map(k => { const kp = axe.prec(k); return sum(A, a => sum(Object.keys(a.h || {}).filter(x => { const [m, s] = x.split('|'); return SMPM_SECT.includes(s) && (kp.length === 4 ? m.slice(0, 4) : m) === kp; }), x => a.h[x])); });
    const parSecteur = SMPM_SECT.filter(s => !st.secteur || s === st.secteur).map(s => {
      const l = avecQ.filter(x => x.a.s === s);
      return { l: NOM_SECTEUR[s], v: l.length ? l.filter(x => x.p >= 100).length / l.length * 100 : 0, tip: `${NOM_SECTEUR[s]} : ${l.filter(x => x.p >= 100).length} sur ${l.length} ont atteint le quota` };
    });
    const html = [etatLivrets(LV), kpis([
      kpi('Livrets suivis', n0(A.length), st.secteur ? `secteur ${NOM_SECTEUR[st.secteur]}` : 'personnel actif'),
      kpi('Quota SMPM atteint', pct(avecQ.length ? atteint / avecQ.length * 100 : null), `${n0(atteint)} spécialiste${atteint > 1 ? 's' : ''} sur ${n0(avecQ.length)}${f < 1 ? ' · quota proratisé à la période' : ''}`),
      kpi('Heures SMPM par spécialiste', A.length ? fmtH(sum(lignes, x => x.h) / A.length) : '—', `médiane ${fmtH(median(lignes.map(x => x.h)) || 0)}`, delta(sum(lignes, x => x.h), sum(lignes, x => x.hp))),
      kpi('Avancement médian du quota', pct(median(avecQ.map(x => x.p))), 'heures SMPM / quota personnel'),
      crit.length ? kpi(`Validation annuelle ${y} complète`, pct(A.length ? complets / A.length * 100 : null), `${n0(complets)} sur ${n0(A.length)} : tous les critères requis validés`) : '',
    ])];
    html.push(grille([
      carteHtml('Avancement du quota SMPM', barres(binsPct.map(([l, a, b], i) => ({ l, v: avecQ.filter(x => x.p >= a && x.p < b).length, c: couleursPct[i] })), { tri: false, autres: false, zero: true }), { sous: 'Nombre de spécialistes par tranche (heures CENTRE + NORD + SUD / quota)' }),
      carteHtml('Quota atteint par secteur', barres(parSecteur, { fmt: pct, max: 100, tri: false, zero: true })),
      carteHtml('Heures SMPM inscrites par mois', colonnes(axe.keys.map(axe.lab), [{ nom: 'Heures', c: S1, vals: parMois }], { ref: { nom: 'N-1', vals: parMoisP } }), { large: true, sous: 'Somme des heures des livrets (secteurs CENTRE, NORD, SUD)' }),
      spe.length ? carteHtml('Quotas de spécialité atteints', barres(spe.map(x => ({ l: NOM_SECTEUR[x.S] || x.S, v: x.n ? x.ok / x.n * 100 : 0, s: `${x.ok} sur ${x.n} qualifiés`, tip: `${NOM_SECTEUR[x.S] || x.S} : ${x.ok} sur ${x.n} qualifiés` })), { fmt: pct, max: 100, tri: false, zero: true })) : '',
      crit.length ? carteHtml(`Validations annuelles ${y}`, val.map(x => `<div class="val-crit"><p>${esc(x.c)}</p>${segments([{ l: 'Validé', v: x.v, c: BON }, { l: 'Non validé', v: x.n, c: MAUV }, { l: 'Non effectué', v: x.x, c: NEUTRE }])}</div>`).join(''), { large: true, sous: 'Parmi les spécialistes pour qui le critère est requis (selon leur niveau)' }) : '',
    ]));
    const cols = [
      { t: 'Spécialiste', f: x => esc(`${x.a.n} ${x.a.p}`) }, { t: 'Secteur', f: x => esc(NOM_SECTEUR[x.a.s] || x.a.s || '—') },
      { t: 'Heures SMPM', f: x => fmtH(x.h), cls: 'num' }, { t: 'Quota', f: x => (x.q ? fmtH(x.q) : '—'), cls: 'num' },
      { t: 'Avancement', f: x => `<span class="pastille ${x.p >= 100 ? 'bon' : x.p >= 50 ? 'moyen' : 'faible'}">${pct(x.p)}</span>`, cls: 'num' },
    ];
    html.push(tableau('Spécialistes sous 50 % du quota', cols, avecQ.filter(x => x.p < 50).sort((a, b) => a.p - b.p), { ouvert: false }));
    html.push(tableau('Tous les livrets', cols, lignes.slice().sort((a, b) => (a.p ?? 999) - (b.p ?? 999))));
    return html.join('');
  }

  // ====================== Neige / Spéléo ======================
  function vueSpecialite(D, r, rp, S) {
    const nom = S === 'NEIGE' ? 'Neige' : 'Spéléo (ISS)';
    const P = D.personnel, F = D.fmpa, I = D.itv, LV = D.livrets, V = D.inv;
    const e = erreurJeu('Personnel', P); if (e) return e;
    const pm = persMap(P);
    const Q = P.agents.filter(a => a.q[S]);
    const ancien = a => (S === 'NEIGE' ? a.dn : a.di);
    const anneeRef = r.annee;
    const binsA = [['moins de 2 ans', 0, 1], ['2 à 5 ans', 2, 5], ['6 à 10 ans', 6, 10], ['plus de 10 ans', 11, 999]];
    const axe = axeTemps(r);
    const html = [];
    const cartes = [];
    const kp = [
      kpi(`Spécialistes ${nom}`, n0(Q.length), `${pct(P.agents.length ? Q.length / P.agents.length * 100 : null)} du personnel actif`),
      kpi('Dont chefs d’unité (IMP3)', n0(Q.filter(a => a.q.IMP3).length), `IMP2 : ${n0(Q.filter(a => a.q.IMP2 && !a.q.IMP3).length)}`),
    ];
    cartes.push(carteHtml('Spécialistes qualifiés par secteur', barres(versItems(compter(Q, a => a.s), k => NOM_SECTEUR[k] || k || '—'), { top: 8 })));
    cartes.push(carteHtml('Ancienneté de la qualification', barres([...binsA.map(([l, a, b]) => ({ l, v: Q.filter(x => ancien(x) && anneeRef - ancien(x) >= a && anneeRef - ancien(x) <= b).length })), { l: 'année inconnue', v: Q.filter(x => !ancien(x)).length }], { tri: false, autres: false, zero: true }), { sous: `Au ${r.annee}, d’après l’année de qualification de la liste du personnel` }));

    if (F && !F.erreur) {
      const ok = x => x.s === S;
      const L = F.recs.filter(x => ok(x) && dans(x.d, r)), Lp = F.recs.filter(x => ok(x) && dans(x.d, rp));
      const hp = x => (x.h || 0) * x.pr.length;
      const parAgent = {}; L.forEach(x => x.pr.forEach(p => { parAgent[p[0]] = (parAgent[p[0]] || 0) + 1; }));
      const formes = Q.filter(a => parAgent[a.n]).length;
      kp.push(kpi(`FMPA ${nom}`, n0(L.length), `${fmtH(sum(L, x => x.h))} de manœuvre`, delta(L.length, Lp.length)));
      kp.push(kpi('Heures de formation dispensées', fmtH(sum(L, hp)), 'durée × présents', delta(sum(L, hp), sum(Lp, hp))));
      kp.push(kpi('Qualifiés présents en FMPA', `${n0(formes)}<small> / ${n0(Q.length)}</small>`, 'au moins une FMPA de la spécialité'));
      cartes.push(carteHtml(`FMPA ${nom} par mois`, colonnes(axe.keys.map(axe.lab), [{ nom: 'FMPA', c: S1, vals: parTemps(axe, L) }], { ref: { nom: 'N-1', vals: parTempsPrec(axe, F.recs.filter(ok)) } }), { large: true, sous: `FMPA déclarées dans le secteur ${S}` }));
      cartes.push(carteHtml('Lieux de FMPA', barres(versItems(compter(L, x => x.l)), { top: 8 })));
      cartes.push(carteHtml('Spécialistes les plus présents', barres(versItems(parAgent, n => nomAff(pm, n)), { top: 10, autres: false })));
    } else cartes.push(carteHtml('FMPA', erreurJeu('FMPA', F)));

    if (LV && !LV.erreur && LV.installe) {
      const f = facteurQuota(r);
      const conc = LV.agents.filter(a => a.quotas && a.quotas[S] && (!a.quotas[S].depuis || a.quotas[S].depuis <= r.annee));
      const lignes = conc.map(a => { const h = heuresLivret(a, r, [S]); const q = (a.quotas[S].quota || 0) * f; return { a, h, q, p: q ? h / q * 100 : null }; });
      const ok = lignes.filter(x => x.p >= 100).length;
      kp.push(kpi(`Quota ${nom} atteint`, pct(lignes.length ? ok / lignes.length * 100 : null), `${n0(ok)} sur ${n0(lignes.length)}${f < 1 ? ' · quota proratisé' : ''}`));
      cartes.push(carteHtml(`Avancement du quota ${nom}`, barres(binsPct.map(([l, a, b], i) => ({ l, v: lignes.filter(x => x.p != null && x.p >= a && x.p < b).length, c: couleursPct[i] })), { tri: false, autres: false, zero: true }), { sous: 'Heures du livret dans le secteur de la spécialité / quota' }));
      html.push(tableau(`Qualifiés sous 50 % du quota ${nom}`, [
        { t: 'Spécialiste', f: x => esc(`${x.a.n} ${x.a.p}`) }, { t: 'Secteur', f: x => esc(NOM_SECTEUR[x.a.s] || x.a.s || '—') },
        { t: 'Heures', f: x => fmtH(x.h), cls: 'num' }, { t: 'Quota', f: x => fmtH(x.q), cls: 'num' }, { t: 'Avancement', f: x => pct(x.p), cls: 'num' },
      ], lignes.filter(x => x.p != null && x.p < 50).sort((a, b) => a.p - b.p)));
    }

    if (I && !I.erreur) {
      const ok = x => x.sp === S;
      const L = I.recs.filter(x => ok(x) && dans(x.d, r)), Lp = I.recs.filter(x => ok(x) && dans(x.d, rp));
      kp.push(kpi(`Interventions ${nom}`, n0(L.length), 'd’après les réponses au compte rendu', delta(L.length, Lp.length, null)));
      cartes.push(carteHtml(`Interventions ${nom} par mois`, colonnes(axe.keys.map(axe.lab), [{ nom: 'Interventions', c: S1, vals: parTemps(axe, L) }], { ref: { nom: 'N-1', vals: parTempsPrec(axe, I.recs.filter(ok)) } }), { large: true }));
      if (L.length) cartes.push(carteHtml('Communes', barres(versItems(compter(L, x => x.co)), { top: 8 })));
    }

    if (V && !V.erreur) {
      const C = V.cordes.filter(c => c.f === S && c.st !== 'inactive');
      if (C.length) {
        kp.push(kpi(`Cordes ${nom}`, n0(C.length), `${n0(C.filter(c => c.st === 'a_surveiller' || c.an).length)} à surveiller ou signalée(s)`));
        cartes.push(carteHtml(`État des cordes ${nom}`, segments([
          { l: 'En service', v: C.filter(c => c.st === 'en_service' && !c.an).length, c: BON },
          { l: 'À surveiller ou signalée', v: C.filter(c => c.st === 'a_surveiller' || c.an).length, c: ALERTE },
        ])));
      }
    }
    html.unshift(kpis(kp), grille(cartes));
    return html.join('');
  }

  // ====================== Inventaires ======================
  function vueInv(D, r, rp) {
    const V = D.inv;
    const e = erreurJeu('Inventaires', V); if (e) return e;
    const vm = {}; V.veh.forEach(v => { vm[v.c] = v; });
    const okV = code => !st.secteur || (vm[code] || {}).s === st.secteur;
    const okS = s => !st.secteur || s === st.secteur;
    const L = V.inv.filter(x => dans(x.d, r) && okV(x.v)), Lp = V.inv.filter(x => dans(x.d, rp) && okV(x.v));
    const conf = L.filter(x => !x.e).length, confP = Lp.filter(x => !x.e).length;
    const ouvertes = V.al.filter(a => a.st !== 'close' && okS(a.s || (vm[a.v] || {}).s));
    const alP = V.al.filter(a => dans(a.d, r) && okS(a.s || (vm[a.v] || {}).s));
    const closes = alP.filter(a => a.st === 'close' && a.cl);
    const delais = closes.map(a => (new Date(a.cl) - new Date(a.d)) / 864e5).filter(x => x >= 0);
    const C = V.cordes.filter(c => c.st !== 'inactive' && okS(c.s));
    const axe = axeTemps(r);
    const conts = V.cont.filter(c => okV(c.v));
    const dernier = {};
    V.inv.forEach(i => { const j = jour(i.d); if (j <= r.au && (!dernier[i.c] || j > dernier[i.c])) dernier[i.c] = j; });
    const refJour = r.au > auj() ? auj() : r.au;
    const age = c => (dernier[c.id] ? Math.round((new Date(refJour) - new Date(dernier[c.id])) / 864e5) : null);
    const fr = { a: 0, b: 0, c: 0, d: 0 };
    conts.forEach(c => { const g = age(c); if (g == null) fr.d++; else if (g <= 30) fr.a++; else if (g <= 90) fr.b++; else fr.c++; });
    const SU = V.su.filter(s => dans(s.d, r));
    const html = [kpis([
      kpi('Inventaires réalisés', n0(L.length), r.lib, delta(L.length, Lp.length)),
      kpi('Taux de conformité', pct(L.length ? conf / L.length * 100 : null), `${n0(L.length - conf)} non conforme${L.length - conf > 1 ? 's' : ''}`, delta(L.length ? conf / L.length * 100 : null, Lp.length ? confP / Lp.length * 100 : null)),
      kpi('Alertes ouvertes', n0(ouvertes.length), 'à ce jour', '', ouvertes.length ? 'k-alerte' : ''),
      kpi('Alertes sur la période', n0(alP.length), `${n0(closes.length)} close${closes.length > 1 ? 's' : ''}`),
      kpi('Délai moyen de clôture', delais.length ? `${n1(sum(delais) / delais.length)} j` : '—', 'alertes de la période closes'),
      kpi('Contenants à jour', pct(conts.length ? fr.a / conts.length * 100 : null), `inventoriés depuis moins de 30 jours (${n0(fr.a)} sur ${n0(conts.length)})`),
      C.length ? kpi('Cordes en service', n0(C.length), `${n0(C.filter(c => c.st === 'a_surveiller' || c.an).length)} à surveiller ou signalée(s)`) : '',
    ])];
    const parVeh = V.veh.filter(v => okV(v.c)).map(v => { const l = L.filter(x => x.v === v.c); return { l: v.l, v: l.length, tip: `${v.l} : ${l.length} inventaire(s), ${l.filter(x => x.e).length} non conforme(s)${l.length ? `, conformité ${pct(l.filter(x => !x.e).length / l.length * 100)}` : ""}` }; });
    const typesSuivi = ['OPS', 'FMPA', 'INVENTAIRE'];
    const topCordes = C.map(c => ({ l: `${c.f} n° ${c.n}`, v: (c.cpt.OPS || 0) + (c.cpt.FMPA || 0), s: NOM_SECTEUR[c.s] || '', tip: `${c.f} n° ${c.n} : ${c.cpt.OPS || 0} OPS, ${c.cpt.FMPA || 0} FMPA` }));
    html.push(grille([
      carteHtml('Inventaires par mois', colonnes(axe.keys.map(axe.lab), [{ nom: 'Conformes', c: BON, vals: parTemps(axe, L.filter(x => !x.e)) }, { nom: 'Non conformes', c: MAUV, vals: parTemps(axe, L.filter(x => x.e)) }], { ref: { nom: 'Total N-1', vals: parTempsPrec(axe, V.inv.filter(x => okV(x.v))) } }), { large: true }),
      carteHtml('Fraîcheur des inventaires', segments([{ l: '≤ 30 j', v: fr.a, c: BON }, { l: '31 à 90 j', v: fr.b, c: ALERTE }, { l: '> 90 j', v: fr.c, c: MAUV }, { l: 'Jamais', v: fr.d, c: NEUTRE }]), { sous: `Dernier inventaire de chaque contenant au ${fmtDate(refJour)}` }),
      carteHtml('Inventaires par véhicule', barres(parVeh, { tri: false, zero: true })),
      carteHtml('Occasion de l’inventaire', barres(versItems(compter(L, x => x.x), k => CONTEXTES[k] || k), { top: 6 })),
      carteHtml('Alertes de la période par type', barres(versItems(compter(alP, a => a.t), k => (k ? k.charAt(0).toUpperCase() + k.slice(1) : '—')), { top: 6 })),
      C.length ? carteHtml('État des cordes', segments([
        { l: 'En service', v: C.filter(c => c.st === 'en_service' && !c.an).length, c: BON },
        { l: 'À surveiller ou signalée', v: C.filter(c => c.st === 'a_surveiller' || c.an).length, c: ALERTE },
      ])) : '',
      C.length ? carteHtml('Cordes par famille', barres(versItems(compter(C, c => c.f)), { top: 6 })) : '',
      carteHtml('Utilisations de cordes par mois', colonnes(axe.keys.map(axe.lab), typesSuivi.map((t, i) => ({ nom: t === 'INVENTAIRE' ? 'Inventaire' : t, c: [S1, S2, S3][i], vals: parTemps(axe, SU.filter(s => s.t === t), s => s.n) }))), { large: true, sous: 'Nombre de cordes utilisées (déclarations)' }),
      C.length ? carteHtml('Cordes les plus utilisées', barres(topCordes, { top: 10, autres: false }), { sous: 'Compteurs OPS + FMPA depuis la mise en service' }) : '',
    ]));
    html.push(tableau('Alertes ouvertes', [
      { t: 'Date', f: a => fmtDate(jour(a.d)) }, { t: 'Objet', f: a => esc(a.l || a.t) }, { t: 'Véhicule', f: a => esc((vm[a.v] || {}).l || a.v || '—') }, { t: 'Statut', f: a => esc(a.st || '—') },
    ], ouvertes.slice().sort((a, b) => (a.d < b.d ? -1 : 1))));
    html.push(tableau('Dernier inventaire par contenant', [
      { t: 'Véhicule', f: c => esc((vm[c.v] || {}).l || c.v) }, { t: 'Contenant', f: c => esc(c.n) },
      { t: 'Dernier inventaire', f: c => fmtDate(dernier[c.id]) },
      { t: 'Ancienneté', f: c => { const g = age(c); return g == null ? '<span class="pastille faible">jamais</span>' : `<span class="pastille ${g <= 30 ? 'bon' : g <= 90 ? 'moyen' : 'faible'}">${g} j</span>`; }, cls: 'num' },
    ], conts.slice().sort((a, b) => (age(b) ?? 1e6) - (age(a) ?? 1e6))));
    return html.join('');
  }

  // ====================== carte Leaflet ======================
  let carteDonnees = [];
  let leafletP = null;
  function leaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = './vendor/leaflet/leaflet.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = './vendor/leaflet/leaflet.js';
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletP = null; js.remove(); reject(new Error('Leaflet')); };
      document.head.append(js);
    });
    return leafletP;
  }
  function detruireCarte() { if (carte) { try { carte.remove(); } catch (e) {} carte = null; } }
  async function monterCarte() {
    const box = $('#dash-body [data-map]');
    if (!box) return;
    const pts = carteDonnees;
    try {
      const L = await leaflet();
      if (!box.isConnected) return;
      carte = L.map(box, { scrollWheelZoom: false });
      if (window.SMPM_FONDS) window.SMPM_FONDS.ajouter(L, carte);
      const css = getComputedStyle($('#tab-cs-tableau'));
      const coul = s => css.getPropertyValue(s === 'NEIGE' ? '--s3' : s === 'ISS' ? '--s2' : '--s1').trim() || '#2a78d6';
      const grp = pts.map(p => L.circleMarker(p.g, { radius: 6, weight: 2, color: '#fff', fillColor: coul(p.s), fillOpacity: 0.9 }).bindTooltip(esc(p.t)));
      grp.forEach(m => m.addTo(carte));
      if (grp.length) carte.fitBounds(L.featureGroup(grp).getBounds().pad(0.15), { maxZoom: 12 });
      else carte.setView([44.05, 5.15], 9);
      box.insertAdjacentHTML('afterend', `<div class="dash-leg"><span><i style="background:${coul('')}"></i>Intervention</span><span><i style="background:${coul('NEIGE')}"></i>Neige</span><span><i style="background:${coul('ISS')}"></i>Spéléo</span></div>`);
    } catch (e) { box.innerHTML = vide('Carte indisponible.'); }
  }

  // ====================== infobulle ======================
  function initTip() {
    const tip = document.createElement('div');
    tip.className = 'dash-tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
    const root = $('#tab-cs-tableau');
    let actif = null;
    const place = (el, x, y) => {
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x - w / 2)) + 'px';
      tip.style.top = (y - h - 12 < 6 ? y + 18 : y - h - 12) + 'px';
    };
    root.addEventListener('pointermove', e => {
      const el = e.target.closest('[data-tip]');
      if (!el || !root.contains(el)) { if (actif) { actif.classList.remove('tip-on'); actif = null; } tip.hidden = true; return; }
      if (actif !== el) { if (actif) actif.classList.remove('tip-on'); actif = el; el.classList.add('tip-on'); }
      place(el, e.clientX, e.clientY);
    });
    root.addEventListener('pointerleave', () => { tip.hidden = true; if (actif) { actif.classList.remove('tip-on'); actif = null; } });
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  }

  // ====================== mode paysage (smartphone) ======================
  const mqPortrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
  function majPaysage() {
    const box = $('#dash-paysage');
    if (!box) return;
    const ouvert = !$('#tab-cs-tableau').hidden;
    box.hidden = !(ouvert && mqPortrait.matches && !portraitIgnore);
    const btn = $('#dash-rotation');
    if (btn) btn.hidden = !(document.documentElement.requestFullscreen && screen.orientation && screen.orientation.lock);
  }
  async function passerPaysage() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation.lock('landscape');
      verrouPaysage = true;
    } catch (e) {
      $('#dash-paysage-txt').textContent = 'Tournez votre téléphone pour passer en mode paysage.';
      $('#dash-rotation').hidden = true;
    }
    majPaysage();
  }
  function quitterPaysage() {
    if (!verrouPaysage) return;
    verrouPaysage = false;
    try { screen.orientation.unlock(); } catch (e) {}
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  // ====================== construction et filtres ======================
  function construire() {
    if (construit) return;
    construit = true;
    const th = $('#dash-themes');
    th.innerHTML = THEMES.map(t => `<button type="button" role="tab" data-theme="${t.id}">${t.ico}<span>${esc(t.nom)}</span></button>`).join('');
    th.addEventListener('click', e => {
      const b = e.target.closest('[data-theme]');
      if (!b || b.dataset.theme === st.theme) return;
      st.theme = b.dataset.theme; sauverPref(); charger();
    });
    $('#dash-mode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      st.mode = b.dataset.mode; sauverPref(); rendre();
    });
    $('#dash-annee').addEventListener('change', e => { st.annee = Number(e.target.value); rendre(); });
    $('#dash-du').addEventListener('change', e => { st.du = e.target.value; rendre(); });
    $('#dash-au').addEventListener('change', e => { st.au = e.target.value; rendre(); });
    $('#dash-secteur').innerHTML = SECTEURS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    $('#dash-secteur').addEventListener('change', e => { st.secteur = e.target.value; rendre(); });
    $('#dash-refresh').addEventListener('click', () => charger(true));
    $('#dash-rotation').addEventListener('click', passerPaysage);
    $('#dash-portrait').addEventListener('click', () => { portraitIgnore = true; majPaysage(); });
    if (mqPortrait.addEventListener) mqPortrait.addEventListener('change', majPaysage); else if (mqPortrait.addListener) mqPortrait.addListener(majPaysage);
    $('#dash-du').value = st.du; $('#dash-au').value = st.au;
    initTip();
  }

  function annees() {
    const ys = new Set([new Date().getFullYear()]);
    const add = d => { const y = Number(jour(d).slice(0, 4)); if (y > 2000 && y < 2100) ys.add(y); };
    const D = donnees();
    if (D.itv && D.itv.recs) D.itv.recs.forEach(x => add(x.d));
    if (D.fmpa && D.fmpa.recs) D.fmpa.recs.forEach(x => add(x.d));
    if (D.inv && D.inv.inv) D.inv.inv.forEach(x => add(x.d));
    if (D.livrets && D.livrets.agents) D.livrets.agents.forEach(a => Object.keys(a.h || {}).forEach(k => add(k.slice(0, 4) + '-01-01')));
    return [...ys].sort((a, b) => b - a);
  }
  const theme = () => THEMES.find(t => t.id === st.theme) || THEMES[0];
  function donnees() { const D = {}; Object.keys(cache).forEach(k => { D[k] = cache[k].d; }); return D; }

  function majFiltres() {
    $$('#dash-themes [data-theme]').forEach(b => { const on = b.dataset.theme === st.theme; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    $$('#dash-mode [data-mode]').forEach(b => { const on = b.dataset.mode === st.mode; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
    const ys = annees();
    if (!ys.includes(st.annee)) st.annee = ys[0];
    const sel = $('#dash-annee');
    sel.innerHTML = ys.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = String(st.annee);
    $('#dash-f-annee').hidden = st.mode !== 'annee';
    $('#dash-f-du').hidden = $('#dash-f-au').hidden = st.mode !== 'periode';
    const avecSecteur = !['neige', 'speleo'].includes(st.theme);
    $('#dash-f-secteur').hidden = !avecSecteur;
    $('#dash-secteur').value = st.secteur;
  }
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function rendre() {
    if (!construit) return;
    majFiltres();
    detruireCarte();
    carteDonnees = [];
    const D = donnees();
    const t = theme();
    const manquants = t.sets.filter(s => !D[s]);
    const body = $('#dash-body');
    if (manquants.length) { body.innerHTML = ''; return; }
    const r = periode(), rp = precedente(r);
    let html;
    try {
      if (t.id === 'itv') html = vueItv(D, r, rp);
      else if (t.id === 'fmpa') html = vueFmpa(D, r, rp);
      else if (t.id === 'livrets') html = vueLivrets(D, r, rp);
      else if (t.id === 'neige') html = vueSpecialite(D, r, rp, 'NEIGE');
      else if (t.id === 'speleo') html = vueSpecialite(D, r, rp, 'ISS');
      else html = vueInv(D, r, rp);
    } catch (e) {
      console.error(e);
      html = `<p class="dash-err">Erreur d’affichage : ${esc(e.message)}</p>`;
    }
    body.innerHTML = `<p class="dash-titre">${t.ico}<strong>${esc(t.nom)}</strong><span>${esc(r.lib)}${st.secteur && !['neige', 'speleo'].includes(t.id) ? ' · secteur ' + esc(NOM_SECTEUR[st.secteur]) : ''}</span></p>${html}`;
    monterCarte();
    const plus = Math.min(...t.sets.map(s => (cache[s] ? cache[s].t : Date.now())));
    $('#dash-maj').textContent = 'Données du ' + new Date(plus).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function charger(force) {
    construire();
    const t = theme();
    const manquants = t.sets.filter(s => force || !cache[s] || Date.now() - cache[s].t > FRAIS_MS);
    rendre();
    if (!manquants.length) { $('#dash-state').textContent = ''; return; }
    const id = ++demande;
    const tousAbsents = t.sets.every(s => !cache[s]);
    $('#dash-state').textContent = 'Chargement des données…';
    if (tousAbsents) $('#dash-body').innerHTML = '<div class="dash-attente is-loading center"></div>';
    $('#dash-refresh').disabled = true;
    try {
      const res = await app().api('dash_data', { token: app().token(), sets: manquants });
      if (id !== demande && !manquants.every(s => res[s])) return;
      moi = res.moi || moi;
      manquants.forEach(s => { if (res[s]) cache[s] = { d: res[s], t: Date.now() }; });
      $('#dash-state').textContent = '';
    } catch (e) {
      if ((app().AUTH_ERRORS || []).includes(e.message)) { app().logout(); return; }
      const reseau = e instanceof app().NetworkError;
      $('#dash-state').textContent = (reseau ? app().netLabel() + ' : ' : '') + (reseau ? 'tableaux de bord indisponibles pour le moment.' : e.message);
      if (tousAbsents) $('#dash-body').innerHTML = '';
    } finally {
      $('#dash-refresh').disabled = false;
    }
    if (id === demande) rendre();
  }

  window.SMPM_DASH = {
    open() { charger(false); majPaysage(); },
    close() { detruireCarte(); quitterPaysage(); portraitIgnore = false; majPaysage(); },
    reset() { Object.keys(cache).forEach(k => delete cache[k]); moi = null; },
  };
})();
