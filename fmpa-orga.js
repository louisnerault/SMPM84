// Planning des FMPA (action « orga », Orga.gs) :
//   le conseiller technique crée des dates (plusieurs à la fois, avec le secteur de chacune),
//   les chefs d'unité (IMP 3) se positionnent pour encadrer, le CT valide le ou les chefs d'unité,
//   puis les inscriptions s'ouvrent à tous (6 participants par chef d'unité validé, au-delà liste d'attente).
//   Les chefs d'unité validés complètent le rendez-vous et le programme, transmis aux inscrits.
// Règles d'inscription (Orga.gs, R1 à R10) : heures fixées par le CT, CU RP + CU sécurité, 3e IMP 3 (participant ou
//   nouvelle FMPA), quotas annuel et du 1er semestre, liste d'attente par retard sur le quota, FMPA départementales
//   (affectations sur 2 jours), annulation proposée faute de participants, encadrements attendus des IMP 3.
// Trois espaces dans le menu, un par rôle (app.js : ORGA_PAGES) :
//   « CT · Organiser » (orga-ct), « CU · Encadrer » (orga-cu), « IMP 2 / IMP 1 · S'inscrire » (orga-insc).
// Les boutons affichés sont ceux que le serveur autorise (f.actions) : c'est lui qui contrôle les droits.
// Dernière liste gardée sur l'appareil pour une consultation hors ligne ; les actions demandent le réseau.
(() => {
  'use strict';

  const KEY = 'smpm_orga';
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const SECTEURS_DEF = [
    { code: 'NORD', nom: 'Nord' }, { code: 'SUD', nom: 'Sud' }, { code: 'CENTRE', nom: 'Centre' },
    { code: 'NEIGE', nom: 'Neige', restreint: true }, { code: 'ISS', nom: 'ISS', restreint: true }, { code: 'SSH', nom: 'SSH', restreint: true },
    { code: 'DEPT', nom: 'Départementale', dept: true },
  ];
  const JOURS_DEPT = { '1': 'Jour 1', '2': 'Jour 2', '12': 'Les deux jours' };
  const nb = n => String(Math.round(n * 10) / 10).replace('.', ',');
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };

  const moisCourant = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const S = { data: null, fresh: false, espace: 'insc', vue: null, secteur: '', id: null, busy: false, edit: null, mois: moisCourant() };

  const actif = f => f.phase !== 'annulee' && f.phase !== 'passee';
  const aExaminer = f => actif(f) && f.actions.decider && f.candidats.length > 0;
  const aCompleter = f => actif(f) && f.moi.encadrant === 'VALIDE' && !(f.infos.lieu && f.infos.heure);
  const aDecider = f => actif(f) && !!f.actions.decisionAnnulation;
  const jEncadre = f => f.moi.encadrant === 'VALIDE' || f.moi.encadrant === 'CANDIDAT';

  // Espaces : titre, présentation, onglets (filtre de la liste, message si vide)
  const ESPACES = {
    ct: {
      nom: 'CT · Organiser',
      titre: 'Organiser les FMPA',
      intro: 'Créez les dates et leurs heures, validez le CU RP puis le CU sécurité : les inscriptions s’ouvrent dès le CU RP validé. Les FMPA départementales se créent ici aussi.',
      vues: [
        { code: 'traiter', nom: 'À traiter', compte: aExaminer,
          filtre: f => actif(f) && (f.candidats.length > 0 || f.phase === 'encadrant'),
          vide: 'Aucune candidature à examiner ni FMPA sans encadrant.' },
        { code: 'toutes', nom: 'À venir', filtre: f => !f.passee, vide: 'Aucune FMPA programmée.' },
        { code: 'passees', nom: 'Passées', filtre: f => f.passee, inverse: true, vide: 'Aucune FMPA passée récente.' },
      ],
    },
    cu: {
      nom: 'CU · Encadrer',
      titre: 'Encadrer une FMPA',
      intro: 'Positionnez-vous sur les dates proposées par le CT : le 1er validé est CU RP, le 2e CU sécurité. Une fois validé, complétez le rendez-vous et le programme. FMPA pleine : proposez-en une nouvelle.',
      vues: [
        { code: 'proposees', nom: 'Proposées', filtre: f => actif(f) && (f.actions.candidater || f.actions.proposer || f.moi.encadrant === 'CANDIDAT'),
          vide: 'Aucune FMPA à encadrer pour le moment. Vous serez prévenu des nouvelles dates.' },
        { code: 'miennes', nom: 'Mes encadrements', compte: aCompleter, filtre: f => !f.passee && jEncadre(f),
          vide: 'Vous n’êtes positionné sur aucune FMPA à venir.' },
        { code: 'passees', nom: 'Passées', filtre: f => f.passee && f.moi.encadrant === 'VALIDE', inverse: true,
          vide: 'Aucune FMPA encadrée récemment.' },
      ],
    },
    insc: {
      nom: 'IMP 2 / IMP 1 · S’inscrire',
      titre: 'S’inscrire à une FMPA',
      intro: 'Inscrivez-vous aux FMPA ouvertes (6 places par chef d’unité). Votre quota d’heures, FMPA départementales comprises, est à répartir sur l’année : au 1er semestre, pas plus de la moitié (+ 10 %).',
      vues: [
        { code: 'ouvertes', nom: 'Ouvertes', filtre: f => (f.phase === 'inscriptions' || f.phase === 'complet') && !jEncadre(f),
          vide: 'Aucune FMPA ouverte aux inscriptions pour le moment. Vous serez prévenu de l’ouverture.' },
        { code: 'miennes', nom: 'Mes inscriptions', filtre: f => !f.passee && !!f.moi.inscrit,
          vide: 'Vous n’êtes inscrit à aucune FMPA à venir.' },
        { code: 'toutes', nom: 'Calendrier', filtre: f => !f.passee, vide: 'Aucune FMPA programmée.' },
      ],
    },
  };

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

  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const addDays = (j, n) => {
    const [y, m, d] = j.split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const dateLongue = j => {
    const [y, m, d] = String(j || '').split('-').map(Number);
    if (!d) return j || '';
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const jourSemaine = j => {
    const [y, m, d] = String(j || '').split('-').map(Number);
    return d ? new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short' }) : '';
  };
  const secteurs = () => (S.data && S.data.secteurs) || SECTEURS_DEF;
  const secNom = c => (secteurs().find(s => s.code === c) || {}).nom || c || '—';
  const tagSecteur = c => {
    const cat = ['NORD', 'SUD', 'CENTRE'].includes(c) ? 'smpm' : String(c || '').toLowerCase();
    return el('span', { class: 'tag tag-' + cat, text: cat === 'smpm' ? 'SMPM ' + secNom(c) : secNom(c) });
  };
  const heureTxt = h => (h ? h.replace(':', 'h') : '');

  // ---------- chargement ----------
  // espace : 'ct', 'cu' ou 'insc' ; id : fiche à ouvrir (notification « fmpa-orga:<id> »).
  // Rechargé à chaque ouverture.
  function open(espace, id) {
    if (ESPACES[espace] && espace !== S.espace) { S.espace = espace; S.vue = null; }
    S.ouvrirDepuisNotif = !!id;
    S.id = id || null;
    S.edit = null;
    S.fresh = false;
    setState('');
    if (!S.data) {
      const c = store.getJSON(KEY);
      if (c) S.data = c;
    }
    render();
    if (!S.fresh) load();
  }

  async function load() {
    setState(S.data ? 'Mise à jour…' : 'Chargement…');
    try {
      const res = await app().api('orga', { token: app().token(), op: 'list' });
      recevoir(res);
      setState('');
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) return app().logout();
      const maj = S.data && S.data.maj ? new Date(S.data.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      setState(err instanceof app().NetworkError
        ? (S.data ? `${app().netLabel()} : planning du ${maj}.` : app().netLabel() + ' : planning indisponible sur cet appareil.')
        : err.message === 'Action inconnue' ? 'Le planning des FMPA n’est pas encore activé sur le serveur.' : err.message, !S.data);
    }
  }

  function recevoir(res) {
    S.data = { fmpa: res.fmpa || [], moi: res.moi || {}, secteurs: res.secteurs || SECTEURS_DEF, ratio: res.ratio || 6, aFaire: res.aFaire || 0,
      imp3: res.imp3 || null, personnel: res.personnel || null, heures: res.heures || { defaut: 7, dept: 8 }, maj: res.maj };
    S.fresh = true;
    store.set(KEY, JSON.stringify(S.data));
    // fiche ouverte depuis une notification : espace selon le rôle de chacun sur cette FMPA
    if (S.ouvrirDepuisNotif && S.id) {
      const f = S.data.fmpa.find(x => x.id === S.id);
      if (f) {
        S.espace = (f.actions.decider && (f.candidats.length || f.phase === 'encadrant')) || (f.actions.decisionAnnulation && S.data.moi.gerer) ? 'ct'
          : jEncadre(f) ? 'cu' : 'insc';
        S.mois = f.date.slice(0, 7);
      }
      S.vue = null;
      S.ouvrirDepuisNotif = false;
    }
    badge();
    render();
  }

  // Compteurs du menu : candidatures à examiner (CT), informations à compléter (chef d'unité validé), total sur le groupe
  function badge() {
    const l = (S.data && S.data.fmpa) || [];
    const ct = l.filter(f => aExaminer(f) || aDecider(f)).length;
    const cu = l.filter(aCompleter).length;
    const set = (sel, n) => document.querySelectorAll(sel).forEach(b => { b.textContent = n ? String(n) : ''; b.hidden = !n; });
    set('[data-orga-count-ct]', ct);
    set('[data-orga-count-cu]', cu);
    set('[data-orga-count]', ct + cu);
  }

  async function action(op, payload, okMsg) {
    if (S.busy) return false;
    S.busy = true;
    document.querySelectorAll('#tab-fmpa-orga button').forEach(b => { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; });
    setState('Envoi…');
    try {
      const res = await app().api('orga', Object.assign({ token: app().token(), op }, payload));
      S.edit = null;
      if (res.nouvelle) S.id = res.nouvelle;
      recevoir(res);
      setState(okMsg || 'Enregistré.', false, true);
      return res;
    } catch (err) {
      if (app().AUTH_ERRORS.includes(err.message)) { app().logout(); return false; }
      setState(err instanceof app().NetworkError ? app().netLabel() + ' : action impossible pour le moment, réessayez avec du réseau.' : err.message, true);
      return false;
    } finally {
      S.busy = false;
      document.querySelectorAll('#tab-fmpa-orga button').forEach(b => { if (!b.dataset.wasDisabled) b.disabled = false; });
    }
  }

  function setState(msg, isError, isOk) {
    const p = $('#orga-state');
    p.textContent = msg || '';
    p.classList.toggle('error', !!isError);
    p.classList.toggle('ok', !!isOk);
  }

  // ---------- rendu ----------
  function render() {
    const f = S.id && S.data && S.data.fmpa.find(x => x.id === S.id);
    if (S.id && S.data && !f && S.fresh) S.id = null;
    $('#orga-liste').hidden = !!f;
    $('#orga-liste-bas').hidden = !!f;
    $('#orga-fiche').hidden = !f;
    if (f) renderFiche(f);
    else renderListe();
  }

  function renderListe() {
    const moi = (S.data && S.data.moi) || {};
    const E = ESPACES[S.espace];
    if (!E.vues.some(v => v.code === S.vue)) S.vue = E.vues[0].code;
    $('#orga-espace').textContent = 'Planning des FMPA · ' + E.nom;
    $('#orga-titre').textContent = E.titre;
    $('#orga-intro').textContent = E.intro;
    $('#orga-moi-quota').replaceChildren(...encartMoi(moi));
    const creer = S.espace === 'ct' && moi.gerer;
    if (!creer && !$('#orga-new').hidden) fermerCreation(true);
    $('#orga-new-btn').hidden = !creer || !$('#orga-new').hidden;

    const ssel = $('#orga-secteur');
    ssel.replaceChildren(new Option('Tous secteurs', ''), ...secteurs().map(s => new Option(s.nom, s.code)));
    ssel.value = S.secteur;

    const auj = today();
    const all = ((S.data && S.data.fmpa) || []).map(f => Object.assign(f, { passee: (f.date2 || f.date) < auj }));
    const parSecteur = all.filter(f => !S.secteur || f.secteur === S.secteur);
    $('#orga-tabs').replaceChildren(...E.vues.map(v => {
      const n = v.compte ? parSecteur.filter(v.compte).length : 0;
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(v.code === S.vue),
        onclick: () => { S.vue = v.code; renderListe(); } }, v.nom, n ? el('span', { class: 'orga-tab-n', text: String(n) }) : null);
    }));

    // CT : calendrier mensuel à la place des onglets et de la liste
    const cal = S.espace === 'ct';
    $('#orga-tabs').hidden = cal;
    $('#orga-cal').hidden = !cal;
    $('#orga-list').hidden = cal;
    if (cal) {
      $('#orga-empty').hidden = true;
      renderCalendrier(parSecteur);
      return;
    }
    $('#orga-list').hidden = false;

    const V = E.vues.find(v => v.code === S.vue);
    let list = parSecteur.filter(V.filtre);
    if (V.inverse) list = list.reverse();

    const empty = $('#orga-empty');
    empty.hidden = !S.data || list.length > 0;
    empty.textContent = V.vide;
    $('#orga-list').replaceChildren(...list.map(carte));
  }

  // ---------- mon quota (R4 à R6) et mes encadrements (R10) ----------
  function ligneQuota(libelle, h, max, limite) {
    const pct = max ? Math.min(100, Math.round(100 * h / max)) : 0;
    return el('div', { class: 'orga-quota-l' },
      el('span', { text: libelle }),
      el('div', { class: 'orga-jauge', role: 'img', 'aria-label': nb(h) + ' h sur ' + nb(max) + ' h' },
        el('div', { class: 'orga-jauge-fill' + (h >= max ? (limite ? ' limite' : ' plein') : ''), style: 'width:' + pct + '%' })),
      el('span', { text: nb(h) + ' / ' + nb(max) + ' h' }));
  }
  function encartMoi(moi) {
    const out = [];
    const an = String(new Date().getFullYear());
    const mois = new Date().getMonth() + 1;
    if (S.espace === 'insc' && moi.quota) {
      const Q = moi.quota;
      const ans = Object.keys(Q.annees || {}).filter(y => y === an || (Q.annees[y].tot > 0) ||
        ((S.data && S.data.fmpa) || []).some(f => f.date.slice(0, 4) === y && f.phase !== 'annulee'));
      ans.forEach(y => {
        const h = Q.annees[y];
        const box = el('div', { class: 'orga-encart' }, el('strong', { text: 'Mon quota ' + y + ' (' + (moi.niveau || '') + ')' }),
          ligneQuota('Année', h.tot, Q.quota, false));
        if (y > an || mois <= 6) box.append(ligneQuota('1er semestre', h.s1, Q.seuilS1, true));
        if (h.tot >= Q.quota) box.append(el('p', { text: 'Quota atteint : plus d’inscription possible aux FMPA libres de ' + y + '.' }));
        else if ((y > an || mois <= 6) && h.s1 >= Q.seuilS1) box.append(el('p', { text: 'Limite du 1er semestre dépassée : vous pourrez vous inscrire aux FMPA du 2e semestre.' }));
        box.append(el('p', { class: 'muted small', text: 'FMPA réalisées et à venir (inscriptions, FMPA départementales, encadrements). Neige, ISS et SSH ont leurs propres quotas.' }));
        out.push(box);
      });
    }
    if (S.espace === 'cu' && moi.encadrements) {
      const a = moi.encadrements.annees[an] || { faites: 0, prevues: 0 };
      const tot = a.faites + a.prevues;
      const att = moi.encadrements.attendu;
      out.push(el('div', { class: 'orga-encart' + (tot < att ? ' attention' : '') },
        el('strong', { text: 'Mes encadrements ' + an + ' : ' + a.faites + ' réalisé' + (a.faites > 1 ? 's' : '') + (a.prevues ? ' · ' + a.prevues + ' prévu' + (a.prevues > 1 ? 's' : '') : '') }),
        el('p', { text: tot < att ? 'Au moins ' + att + ' encadrements sont attendus dans l’année : positionnez-vous sur les dates proposées.' : 'Objectif annuel de ' + att + ' encadrements atteint.' })));
    }
    return out;
  }

  // ---------- calendrier mensuel (CT · Organiser) ----------
  const ICO = {
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17h.01"/>',
    danger: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    personne: '<circle cx="12" cy="7.5" r="3.6"/><path d="M4.8 20.5c.8-4.2 3.7-6.3 7.2-6.3s6.4 2.1 7.2 6.3"/>',
    personnes: '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.7-3.7 3.2-5.5 6.2-5.5s5.5 1.8 6.2 5.5"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.3 14.8c2 .6 3.4 2.3 3.9 5.2"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    croix: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const ico = (k, cls) => {
    const sp = el('span', { class: 'cal-ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + ICO[k] + '</svg>';
    return sp;
  };
  const joursAvant = j => {
    const [y, m, d] = j.split('-').map(Number);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d) - t) / 86400e3);
  };

  // État d'affichage d'une FMPA dans le calendrier
  function etatCal(f) {
    if (f.phase === 'annulee') return { cls: 'st-annulee', libelle: 'Annulée' };
    if (f.departementale) return { cls: 'st-dept', libelle: 'Départementale · ' + f.inscrits.length + ' affecté' + (f.inscrits.length > 1 ? 's' : '') };
    if (f.phase === 'proposee') return { cls: 'st-proposee', libelle: 'Nouvelle FMPA proposée, à valider' };
    if (f.alerteAnnulation) return { cls: 'st-urgent', libelle: 'Annulation proposée : ' + f.alerteAnnulation.effectif + ' personne(s)' };
    const urgent = !f.encadrants.length && f.phase !== 'passee' && joursAvant(f.date) < 7;
    if (f.encadrants.length) {
      return f.inscrits.length >= f.capacite
        ? { cls: 'st-complet', libelle: 'Complet' + (f.attente.length ? ' (' + f.attente.length + ' en attente)' : '') }
        : { cls: 'st-ouvert', libelle: 'Inscriptions ouvertes' };
    }
    if (urgent) return { cls: 'st-urgent', libelle: f.candidats.length ? 'Moins de 7 jours : encadrant à valider' : 'Moins de 7 jours : aucun encadrant' };
    if (f.candidats.length) return { cls: 'st-candidat', libelle: f.candidats.length > 1 ? f.candidats.length + ' candidats à départager' : '1 candidat à valider' };
    return { cls: 'st-attente', libelle: 'En attente d’un IMP 3 encadrant' };
  }

  function tuileCal(f) {
    const E = etatCal(f);
    const t = el('button', { type: 'button', class: 'cal-fmpa ' + E.cls + (f.phase === 'passee' ? ' cal-passee' : ''),
      'aria-label': dateLongue(f.date) + ', ' + secNom(f.secteur) + ' : ' + E.libelle, onclick: e => { e.stopPropagation(); cacherBulle(); ouvrir(f.id); } });
    const haut = el('span', { class: 'cal-l1' });
    if (E.cls === 'st-attente') haut.append(ico('question'));
    if (E.cls === 'st-urgent') haut.append(ico('danger'));
    if (E.cls === 'st-urgent' || E.cls === 'st-candidat' || E.cls === 'st-proposee') {
      if (f.candidats.length) haut.append(ico(f.candidats.length > 1 ? 'personnes' : 'personne'));
    }
    if (E.cls === 'st-complet') haut.append(ico('ok'));
    if (E.cls === 'st-annulee') haut.append(ico('croix'));
    haut.append(el('span', { class: 'cal-sec', text: secNom(f.secteur) }));
    t.append(haut);
    if (f.departementale) t.append(el('span', { class: 'cal-n', text: f.inscrits.length + ' affecté' + (f.inscrits.length > 1 ? 's' : '') }));
    else if (f.encadrants.length) {
      t.append(el('span', { class: 'cal-cu', text: f.encadrants[0].nom + (f.encadrants.length > 1 ? ' +' + (f.encadrants.length - 1) : '') }));
      t.append(el('span', { class: 'cal-n', text: f.inscrits.length + '/' + f.capacite }));
    }
    t.addEventListener('mouseenter', () => montrerBulle(f, t));
    t.addEventListener('mouseleave', cacherBulle);
    t.addEventListener('focus', () => montrerBulle(f, t));
    t.addEventListener('blur', cacherBulle);
    return t;
  }

  function renderCalendrier(list) {
    const box = $('#orga-cal');
    const [y, m] = S.mois.split('-').map(Number);
    const premier = new Date(y, m - 1, 1);
    const decal = (premier.getDay() + 6) % 7;          // lundi en premier
    const nb = new Date(y, m, 0).getDate();
    const auj = today();
    const parJour = {};
    list.forEach(f => {
      (parJour[f.date] = parJour[f.date] || []).push(f);
      if (f.date2 && f.date2 !== f.date) (parJour[f.date2] = parJour[f.date2] || []).push(f);   // 2e jour d'une départementale
    });
    const titre = premier.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const tete = el('div', { class: 'cal-head' },
      el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois précédent', text: '‹', onclick: () => changerMois(-1) }),
      el('h2', { class: 'cal-titre', text: titre.charAt(0).toUpperCase() + titre.slice(1) }),
      el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois suivant', text: '›', onclick: () => changerMois(1) }));
    const outils = el('div', { class: 'cal-tools' },
      S.mois !== moisCourant() ? el('button', { type: 'button', class: 'link', text: 'Revenir à aujourd’hui', onclick: () => { S.mois = moisCourant(); renderListe(); } }) : null);

    const grille = el('div', { class: 'cal-grid', role: 'grid', 'aria-label': titre });
    ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].forEach(j => grille.append(el('div', { class: 'cal-wd', role: 'columnheader', text: j })));
    for (let i = 0; i < decal; i++) grille.append(el('div', { class: 'cal-day cal-out', 'aria-hidden': 'true' }));
    for (let d = 1; d <= nb; d++) {
      const j = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const fs = parJour[j] || [];
      const passe = j < auj;
      const cell = el('div', { class: 'cal-day' + (j === auj ? ' cal-today' : '') + (passe ? ' cal-past' : '') + (fs.length ? ' cal-has' : ''), role: 'gridcell' },
        el('span', { class: 'cal-num', text: String(d) }), ...fs.map(tuileCal));
      if (!passe && S.data && S.data.moi && S.data.moi.gerer) {
        cell.classList.add('cal-libre');
        cell.title = 'Ajouter une FMPA le ' + dateLongue(j);
        cell.addEventListener('click', () => creerLe(j));
      }
      grille.append(cell);
    }
    const reste = (7 - ((decal + nb) % 7)) % 7;
    for (let i = 0; i < reste; i++) grille.append(el('div', { class: 'cal-day cal-out', 'aria-hidden': 'true' }));

    const leg = el('ul', { class: 'cal-legende' },
      ...[['st-attente', 'question', 'Attente d’un IMP 3'], ['st-urgent', 'danger', 'Moins de 7 jours sans encadrant'],
        ['st-candidat', 'personne', 'Candidat(s) à valider'], ['st-ouvert', null, 'Inscriptions ouvertes'],
        ['st-complet', 'ok', 'Complet'], ['st-proposee', 'personne', 'Nouvelle FMPA proposée'], ['st-dept', null, 'Départementale'],
        ['st-annulee', 'croix', 'Annulée']]
        .map(([c, i, t]) => el('li', null, el('span', { class: 'cal-pastille ' + c }, i ? ico(i) : null), t)));

    const nbMois = list.filter(f => f.date.slice(0, 7) === S.mois && f.phase !== 'annulee').length;
    box.replaceChildren(tete, outils, grille,
      el('p', { class: 'muted small cal-aide', text: (nbMois ? nbMois + ' FMPA ce mois-ci. ' : 'Aucune FMPA ce mois-ci. ') +
        'Faites glisser pour changer de mois ; touchez un jour libre pour y créer une FMPA.' }), leg);
  }

  function changerMois(delta) {
    const [y, m] = S.mois.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    S.mois = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    cacherBulle();
    renderListe();
    const g = $('#orga-cal .cal-grid');
    if (g) { g.classList.add(delta > 0 ? 'cal-slide-g' : 'cal-slide-d'); }
  }

  // Glisser vers la gauche ou la droite : mois suivant ou précédent
  (() => {
    const box = $('#orga-cal');
    let x0 = null, y0 = 0;
    box.addEventListener('touchstart', e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
    box.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) changerMois(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  // Jour libre touché : ligne ajoutée au formulaire de création, avec cette date
  function creerLe(j) {
    if ($('#orga-new').hidden) {
      ouvrirCreation(j);
    } else {
      const li = ligneDate(j, S.secteur);
      $('#orga-new-rows').append(li);
      majCompteur();
    }
    $('#orga-new').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const rows = $('#orga-new-rows').children;
    const sel = rows[rows.length - 1].querySelector('select');
    if (sel && !sel.value) setTimeout(() => sel.focus(), 300);
  }

  // Bulle de détail au survol (ordinateur)
  const survol = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : { matches: false };
  let bulle = null;
  function montrerBulle(f, cible) {
    if (!survol.matches) return;
    cacherBulle();
    const E = etatCal(f);
    const an = f.date.slice(0, 4);
    const lignes = [el('strong', { text: dateLongue(f.date) }), el('span', { class: 'cal-b-etat ' + E.cls, text: secNom(f.secteur) + ' · ' + E.libelle })];
    if (f.note) lignes.push(el('span', { class: 'cal-b-note', text: f.note }));
    if (f.date2) lignes.push(el('span', { text: '2e jour : ' + dateLongue(f.date2) }));
    lignes.push(el('span', { text: nb(f.heures) + ' h' + (f.departementale ? ' par jour' : '') + ' comptées dans les quotas' }));
    if (f.encadrants.length) lignes.push(el('span', { text: 'Encadrement : ' + f.encadrants.map(e => e.nomComplet + (e.role === 'RP' ? ' (CU RP)' : ' (CU sécu.)')).join(', ') }));
    if (f.candidats.length) lignes.push(el('span', { text: 'Candidats : ' + trierParCompteur(f.candidats, an).map(e => e.nomComplet + ' (' + compteurTxt(e.nom, an, true) + ')').join(', ') }));
    if (f.capacite) lignes.push(el('span', { text: 'Inscrits : ' + f.inscrits.length + '/' + f.capacite + (f.attente.length ? ' · ' + f.attente.length + ' en attente' : '') }));
    if (f.departementale) lignes.push(el('span', { text: 'Affectés : ' + f.inscrits.length }));
    if (f.infos.lieu || f.infos.heure) lignes.push(el('span', { text: 'RDV : ' + [heureTxt(f.infos.heure), f.infos.lieu].filter(Boolean).join(' – ') }));
    if (f.phase === 'annulee' && f.motif) lignes.push(el('span', { text: 'Motif : ' + f.motif }));
    bulle = el('div', { class: 'cal-bulle', role: 'tooltip' }, ...lignes);
    document.body.append(bulle);
    const r = cible.getBoundingClientRect();
    const b = bulle.getBoundingClientRect();
    let left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    let top = r.bottom + 6;
    if (top + b.height > window.innerHeight - 8) top = r.top - b.height - 6;
    bulle.style.left = left + 'px';
    bulle.style.top = Math.max(8, top) + 'px';
  }
  function cacherBulle() { if (bulle) { bulle.remove(); bulle = null; } }
  window.addEventListener('scroll', cacherBulle, { passive: true });

  // ---------- compteur de FMPA encadrées par IMP 3 (CT) ----------
  function compteur(nom, an) {
    const x = ((S.data && S.data.imp3) || []).find(p => p.nom === nom);
    const a = (x && x.annees && x.annees[an]) || {};
    return { faites: a.faites || 0, prevues: a.prevues || 0 };
  }
  function compteurTxt(nom, an, court) {
    const c = compteur(nom, an);
    if (court) return c.faites + (c.prevues ? '+' + c.prevues : '') + ' en ' + an;
    return c.faites + ' FMPA encadrée' + (c.faites > 1 ? 's' : '') + ' en ' + an + (c.prevues ? ' · ' + c.prevues + ' prévue' + (c.prevues > 1 ? 's' : '') : '');
  }
  function trierParCompteur(l, an) {
    const tot = p => { const c = compteur(p.nom, an); return c.faites + c.prevues; };
    return l.slice().sort((a, b) => tot(a) - tot(b) || String(a.nomComplet).localeCompare(String(b.nomComplet), 'fr'));
  }

  function phaseChip(f) {
    const n = f.inscrits.length;
    if (f.phase === 'annulee') return el('span', { class: 'chip orga-chip-annulee', text: 'Annulée' });
    if (f.phase === 'passee') return el('span', { class: 'chip chip-ro', text: n ? n + ' participant' + (n > 1 ? 's' : '') : 'Passée' });
    if (f.phase === 'departementale') return el('span', { class: 'chip orga-chip-dept', text: 'Départementale · présence obligatoire · ' + n + ' affecté' + (n > 1 ? 's' : '') });
    if (f.phase === 'proposee') return el('span', { class: 'chip orga-chip-cu', text: 'Nouvelle FMPA proposée · à valider par le CT' });
    if (f.phase === 'encadrant') return el('span', { class: 'chip orga-chip-cu', text: f.candidats.length ? 'CU RP à valider (' + f.candidats.length + ')' : 'Recherche un CU RP' });
    if (f.phase === 'complet') return el('span', { class: 'chip orga-chip-complet', text: 'Complet' + (f.attente.length ? ' · ' + f.attente.length + ' en attente' : '') });
    return el('span', { class: 'chip chip-edit', text: 'Inscriptions ouvertes · ' + (f.capacite - n) + ' place' + (f.capacite - n > 1 ? 's' : '') });
  }

  function monStatut(f) {
    const m = f.moi;
    if (m.encadrant === 'VALIDE') return m.responsable ? 'Vous êtes CU RP (responsable pédagogique)' : 'Vous êtes CU sécurité';
    if (m.encadrant === 'CANDIDAT') return f.phase === 'proposee' ? 'Votre proposition attend la validation du CT' : 'Candidature en attente de validation';
    if (f.departementale && m.inscrit === 'INSCRIT') return 'Vous êtes affecté : ' + (m.jour === '12' ? 'les deux jours' : dateLongue(m.jour === '2' ? f.date2 : f.date));
    if (m.inscrit === 'INSCRIT') return 'Vous êtes inscrit';
    if (m.inscrit === 'ATTENTE') return 'Liste d’attente (' + m.rangAttente + (m.rangAttente === 1 ? 'er' : 'e') + ')';
    if (m.encadrant === 'REFUSE') return 'Candidature non retenue';
    return '';
  }

  function carte(f) {
    const [, m, d] = (f.date || '').split('-').map(Number);
    const li = el('li');
    const btn = el('button', { type: 'button', class: 'fmpal-item orga-item' + (f.phase === 'annulee' ? ' orga-annulee' : ''), onclick: () => ouvrir(f.id) });
    const date = el('time', { class: 'fmpa-date', datetime: f.date },
      el('strong', { text: d ? String(d) : '–' }), el('span', { text: MOIS[(m || 1) - 1] || '' }));
    const body = el('div', { class: 'fmpa-body' });
    const resp = f.encadrants[0];
    body.append(el('p', { class: 'fmpa-lieu', text: f.infos.lieu || (resp ? 'CU RP ' + resp.nomComplet : f.departementale ? 'FMPA départementale' : f.note || 'Lieu à préciser') }));
    const meta = el('p', { class: 'fmpa-meta' }, tagSecteur(f.secteur),
      ' ' + [jourSemaine(f.date) + (f.date2 ? ' et ' + jourSemaine(f.date2) + ' ' + Number(f.date2.slice(8)) : ''), nb(f.heures) + ' h' + (f.date2 ? '/jour' : ''),
        f.infos.heure ? 'RDV ' + heureTxt(f.infos.heure) : '', f.encadrants.length > 1 ? 'CU RP + CU sécurité' : ''].filter(Boolean).join(' · '));
    body.append(meta, phaseChip(f));
    const st = monStatut(f);
    if (st) body.append(el('span', { class: 'orga-moi', text: st }));
    const fig = el('div', { class: 'fmpa-fig' },
      el('strong', { text: f.capacite ? f.inscrits.length + '/' + f.capacite : f.departementale ? String(f.inscrits.length) : '' }),
      f.capacite ? el('span', { text: 'inscrits' }) : f.departementale ? el('span', { text: 'affectés' }) : null);
    btn.append(date, body, fig);
    li.append(btn);
    return li;
  }

  function ouvrir(id) {
    S.id = id;
    S.edit = null;
    setState('');
    render();
    window.scrollTo(0, 0);
  }

  function retourListe() {
    S.id = null;
    S.edit = null;
    setState('');
    render();
    window.scrollTo(0, 0);
  }

  // ---------- fiche d'une FMPA ----------
  function section(titre, ...children) {
    return el('section', { class: 'orga-sec' }, el('h2', { class: 'section-title', text: titre }), ...children);
  }

  function bouton(text, onclick, cls) {
    return el('button', { type: 'button', class: cls || 'pill', text, onclick });
  }

  function renderFiche(f) {
    const box = $('#orga-fiche');
    const A = f.actions;
    const out = [];
    out.push(el('div', { class: 'sub-head' }, el('button', { type: 'button', class: 'link', text: '← ' + ESPACES[S.espace].titre, onclick: retourListe })));
    out.push(el('h1', { class: 'orga-titre', text: dateLongue(f.date) + (f.date2 ? ' et ' + dateLongue(f.date2) : '') }));
    out.push(el('p', { class: 'fmpa-meta' }, tagSecteur(f.secteur),
      ' ' + nb(f.heures) + ' h' + (f.departementale ? ' par jour' : '') + ' comptées dans les quotas' +
      (f.restreint ? ' · réservée aux qualifiés ' + secNom(f.secteur) + ' (hors quota SMPM)' : '')));
    out.push(phaseChip(f));
    const st = monStatut(f);
    if (st) out.push(el('p', { class: 'orga-moi orga-moi-fiche', text: st }));
    if (f.phase === 'annulee') out.push(el('p', { class: 'error', text: 'FMPA annulée' + (f.motif ? ' : ' + f.motif : '.') }));
    if (f.note) out.push(el('p', { class: 'orga-note', text: f.note }));

    // Annulation proposée faute de participants (R9)
    if (f.alerteAnnulation && A.decisionAnnulation) {
      const n = f.alerteAnnulation.effectif;
      out.push(el('div', { class: 'orga-encart alerte' },
        el('strong', { text: 'Annulation proposée' }),
        el('p', { text: (n ? n + ' personne' + (n > 1 ? 's' : '') + ', CU compris' : 'Aucun participant') + ' : la FMPA peut être annulée. Le CT ou le chef de section du secteur décide ; la première décision s’applique.' }),
        el('div', { class: 'orga-actions' },
          bouton('Annuler la FMPA', () => {
            const motif = prompt('Annuler cette FMPA ? Encadrants et inscrits seront prévenus.\nMotif (facultatif) :', 'Pas assez de participants');
            if (motif !== null) action('annuler', { id: f.id, motif }, 'FMPA annulée.');
          }, 'pill danger-pill'),
          bouton('Maintenir la FMPA', () => {
            if (confirm('Maintenir cette FMPA ? Il n’y aura plus de rappel.')) action('maintenir', { id: f.id }, 'FMPA maintenue.');
          }, 'pill orga-ok'))));
    }
    if (f.decisionAnnulation && f.decisionAnnulation.decision === 'MAINTENUE' && (A.gerer || A.decider)) {
      out.push(el('p', { class: 'muted small', text: 'Maintenue malgré le faible nombre de participants (' + f.decisionAnnulation.par + ').' }));
    }

    // Action principale de l'utilisateur
    const act = el('div', { class: 'orga-actions' });
    if (A.inscrire) act.append(bouton(f.phase === 'complet' ? 'M’inscrire en liste d’attente' : 'M’inscrire', () => action('inscrire', { id: f.id }, f.phase === 'complet' ? 'Inscrit en liste d’attente.' : 'Inscription enregistrée.'), 'primary'));
    if (A.desinscrire) act.append(bouton(f.moi.inscrit === 'ATTENTE' ? 'Quitter la liste d’attente' : 'Me désinscrire', () => {
      const q = f.moi.inscrit === 'ATTENTE' ? 'Quitter la liste d’attente ?'
        : f.departementale ? 'Vous désinscrire de cette FMPA départementale (présence obligatoire) ? L’organisateur sera prévenu ; vos heures redeviennent disponibles pour une FMPA libre.'
          : 'Vous désinscrire de cette FMPA ?';
      if (confirm(q)) action('inscrire', { id: f.id, desinscrire: true }, 'Désinscription enregistrée.');
    }, 'primary orga-secondaire'));
    if (A.candidater) act.append(bouton((f.moi.encadrant === 'REFUSE' ? 'Me positionner à nouveau' : 'Me positionner') + (f.encadrants.length ? ' comme CU sécurité' : ' pour encadrer'),
      () => action('candidater', { id: f.id }, 'Candidature envoyée au conseiller technique.'), 'primary'));
    if (A.proposer && S.edit !== 'proposer') act.append(bouton('Proposer une nouvelle FMPA', () => { S.edit = 'proposer'; render(); }, 'primary'));
    if (A.retirerCandidature) act.append(bouton(f.moi.encadrant === 'VALIDE' ? 'Je ne peux plus encadrer' : f.phase === 'proposee' ? 'Retirer ma proposition' : 'Retirer ma candidature', () => {
      const q = f.moi.encadrant === 'VALIDE' ? 'Vous désister de l’encadrement ? Le conseiller technique sera prévenu' + (f.encadrants.length === 1 ? ' et les inscrits passeront en liste d’attente.' : '.')
        : f.phase === 'proposee' ? 'Retirer votre proposition ? La FMPA proposée sera annulée.' : 'Retirer votre candidature ?';
      if (confirm(q)) action('candidater', { id: f.id, retirer: true }, 'C’est noté.');
    }, 'primary orga-secondaire'));
    if (act.childNodes.length) out.push(act);
    if (S.edit === 'proposer' && A.proposer) out.push(formProposer(f));
    if (f.raison) out.push(el('p', { class: 'muted small', text: f.raison }));
    if (f.phase === 'encadrant' && !A.candidater && !f.moi.encadrant) {
      out.push(el('p', { class: 'muted small', text: 'Les inscriptions ouvriront dès qu’un CU RP aura été validé par le conseiller technique. Vous serez prévenu.' }));
    }

    if (f.departementale) {
      out.push(section('Agents affectés · ' + f.inscrits.length, ...renderAffectes(f)));
    } else {
      // Rendez-vous et programme
      out.push(section('Rendez-vous et programme', ...renderInfos(f)));

      // Encadrement : CU RP puis CU sécurité (R2)
      const enc = el('ul', { class: 'orga-people' });
      f.encadrants.forEach(e => enc.append(el('li', null,
        el('span', { class: 'orga-name', text: e.nomComplet }),
        el('span', { class: 'tag', text: e.role === 'RP' ? 'CU RP' : 'CU sécurité' }),
        A.decider ? bouton('Retirer', () => decider(f, e, 'retirer'), 'link danger-link') : null)));
      const an = f.date.slice(0, 4);
      const voirCompteur = !!(S.data && S.data.imp3);
      f.encadrants.forEach((e, k) => { if (voirCompteur) enc.children[k].append(el('span', { class: 'orga-cpt', text: compteurTxt(e.nom, an) })); });
      const plein = f.encadrants.length >= (f.maxCu || 2);
      trierParCompteur(f.candidats, an).forEach(e => enc.append(el('li', { class: 'orga-candidat' },
        el('span', { class: 'orga-name', text: e.nomComplet }),
        el('span', { class: 'chip orga-chip-cu', text: f.phase === 'proposee' ? 'Propose cette FMPA (CU RP)' : 'Candidat ' + (f.encadrants.length ? 'CU sécurité' : 'CU RP') }),
        voirCompteur ? el('span', { class: 'orga-cpt', text: compteurTxt(e.nom, an) }) : null,
        A.decider ? el('span', { class: 'orga-btns' },
          plein ? null : bouton('Valider', () => decider(f, e, 'valider'), 'pill orga-ok'),
          bouton('Refuser', () => decider(f, e, 'refuser'), 'pill danger-pill')) : null)));
      if (!enc.childNodes.length) enc.append(el('li', { class: 'muted' }, 'Aucun chef d’unité positionné pour le moment.'));
      out.push(section('Encadrement',
        enc,
        A.decider && voirCompteur && !plein && f.phase !== 'proposee' ? designer(f, an) : null,
        el('p', { class: 'muted small', text: f.ratio + ' participants par chef d’unité : le CU RP ouvre ' + f.ratio + ' places, le CU sécurité ' + f.ratio +
          ' de plus (au plus ' + (2 * f.ratio) + ' IMP 2 et 2 IMP 3). Un 3e IMP 3 s’inscrit comme participant s’il reste une place, sinon il propose une nouvelle FMPA.' })));

      // Participants
      if (f.encadrants.length || f.inscrits.length || f.attente.length) {
        const pct = f.capacite ? Math.min(100, Math.round(100 * f.inscrits.length / f.capacite)) : 0;
        const ins = el('ol', { class: 'orga-people' });
        const ligne = (p, att) => el('li', null,
          el('span', { class: 'orga-name', text: p.nomComplet }),
          el('span', { class: 'muted small', text: [p.niveau, p.secteur ? secNom(p.secteur) : '', att && p.quota !== null && p.quota !== undefined ? p.quota + ' % du quota' : ''].filter(Boolean).join(' · ') }),
          A.retirerInscrit ? bouton('Retirer', () => retirerInscrit(f, p), 'link danger-link') : null);
        f.inscrits.forEach(p => ins.append(ligne(p)));
        if (!f.inscrits.length) ins.append(el('li', { class: 'muted' }, 'Aucun inscrit pour le moment.'));
        const kids = [
          el('div', { class: 'orga-jauge', role: 'img', 'aria-label': f.inscrits.length + ' inscrits sur ' + f.capacite },
            el('div', { class: 'orga-jauge-fill' + (pct >= 100 ? ' plein' : ''), style: 'width:' + pct + '%' })),
          ins,
        ];
        if (f.attente.length) {
          const att = el('ol', { class: 'orga-people' });
          f.attente.forEach(p => att.append(ligne(p, true)));
          kids.push(el('h3', { class: 'orga-h3', text: 'Liste d’attente (' + f.attente.length + ')' }), att,
            el('p', { class: 'muted small', text: 'Une place libérée revient d’abord aux IMP 2, puis à celui qui a le moins avancé dans son quota ; un agent qui a atteint son quota ou la limite du 1er semestre est passé.' }));
        }
        out.push(section('Participants · ' + f.inscrits.length + '/' + f.capacite, ...kids));
      }
    }

    // Gestion de la date (CT)
    if (A.gerer && f.phase !== 'annulee' && f.phase !== 'proposee') out.push(section('Gestion de la date', ...renderGestion(f)));

    box.replaceChildren(...out);
  }

  // 3e IMP 3 sur une FMPA pleine (R3) : proposer une nouvelle FMPA dont il sera CU RP
  function formProposer(f) {
    const form = el('form', { class: 'orga-form orga-encart', onsubmit: async e => {
      e.preventDefault();
      const v = form.elements;
      const res = await action('proposer', { id: f.id, proposition: { date: v.date.value, lieu: v.lieu.value, note: v.note.value } },
        'Proposition envoyée au conseiller technique.');
      if (res) window.scrollTo(0, 0);
    } },
    el('strong', { text: 'Nouvelle FMPA ' + secNom(f.secteur) }),
    el('p', { class: 'muted small', text: 'Vous en serez CU RP. Le conseiller technique valide la proposition ; la liste d’attente de cette FMPA y passe alors automatiquement.' }),
    el('label', null, 'Date', el('input', { name: 'date', type: 'date', required: true, min: today(), value: f.date })),
    el('label', null, 'Lieu', el('input', { name: 'lieu', required: true, maxlength: '200', placeholder: 'Site, falaise, caserne…' })),
    el('label', null, 'Remarque (facultatif)', el('input', { name: 'note', maxlength: '200' })),
    el('div', { class: 'orga-actions' },
      el('button', { type: 'submit', class: 'primary', text: 'Envoyer la proposition' }),
      bouton('Annuler', () => { S.edit = null; render(); }, 'link')));
    return form;
  }

  // FMPA départementale (R8) : agents affectés, par jour ; affectation par le CT ou un chef de section
  function renderAffectes(f) {
    const A = f.actions;
    const pers = (S.data && S.data.personnel) || [];
    if (S.edit === 'affecter' && A.affecter) {
      const actuel = {};
      f.inscrits.forEach(p => { actuel[p.nom] = p.jour || '1'; });
      const choix = Object.assign({}, actuel);
      const liste = el('ul', { class: 'orga-affect' });
      const filtre = el('input', { type: 'search', class: 'orga-affect-filtre', placeholder: 'Filtrer par nom ou secteur…', 'aria-label': 'Filtrer' });
      const lignes = pers.map(p => {
        const sel = el('select', { 'aria-label': 'Affectation de ' + p.nomComplet },
          new Option('—', ''), new Option('Jour 1 · ' + jourSemaine(f.date), '1'), new Option('Jour 2 · ' + jourSemaine(f.date2), '2'), new Option('Les deux (organisateur)', '12'));
        sel.value = choix[p.nom] || '';
        const li = el('li', { class: sel.value ? 'on' : '' },
          el('span', { class: 'orga-name', text: p.nomComplet }),
          el('span', { class: 'muted small', text: [p.niveau, p.secteur ? secNom(p.secteur) : ''].filter(Boolean).join(' · ') }), sel);
        sel.addEventListener('change', () => { choix[p.nom] = sel.value; li.classList.toggle('on', !!sel.value); });
        li.dataset.q = (p.nomComplet + ' ' + (p.secteur || '') + ' ' + (p.niveau || '')).toLowerCase();
        return li;
      });
      liste.append(...lignes);
      filtre.addEventListener('input', () => {
        const q = filtre.value.trim().toLowerCase();
        lignes.forEach(li => { li.hidden = !!q && !li.dataset.q.includes(q); });
      });
      const repartir = () => {
        const sansJour = pers.filter(p => !choix[p.nom]);
        sansJour.forEach((p, k) => { choix[p.nom] = k % 2 ? '2' : '1'; });
        lignes.forEach((li, k) => { const s2 = li.querySelector('select'); s2.value = choix[pers[k].nom] || ''; li.classList.toggle('on', !!s2.value); });
      };
      return [
        el('p', { class: 'muted small', text: 'Choisissez le jour de chacun (les organisateurs : les deux jours). Les agents sont prévenus ; ' + nb(f.heures) + ' h par jour comptent dans leur quota.' }),
        el('div', { class: 'orga-actions' }, bouton('Répartir les autres sur les deux jours', repartir, 'pill')),
        filtre, liste,
        el('div', { class: 'orga-actions' },
          bouton('Enregistrer les affectations', () => {
            const aff = pers.filter(p => (choix[p.nom] || '') !== (actuel[p.nom] || '')).map(p => ({ nom: p.nom, jour: choix[p.nom] || '' }));
            if (!aff.length) { S.edit = null; render(); return; }
            action('affecter', { id: f.id, affectations: aff }, aff.length + ' affectation' + (aff.length > 1 ? 's' : '') + ' enregistrée' + (aff.length > 1 ? 's' : '') + ' : les agents sont prévenus.');
          }, 'primary'),
          bouton('Annuler', () => { S.edit = null; render(); }, 'link')),
      ];
    }
    const out = [];
    ['1', '2', '12'].forEach(j => {
      const l = f.inscrits.filter(p => (p.jour || '1') === j);
      if (!l.length) return;
      out.push(el('h3', { class: 'orga-h3', text: (j === '12' ? 'Les deux jours (organisateurs)' : JOURS_DEPT[j] + ' · ' + dateLongue(j === '2' ? f.date2 : f.date)) + ' · ' + l.length }));
      out.push(el('ol', { class: 'orga-people' }, ...l.map(p => el('li', null,
        el('span', { class: 'orga-name', text: p.nomComplet }),
        el('span', { class: 'muted small', text: [p.niveau, p.secteur ? secNom(p.secteur) : ''].filter(Boolean).join(' · ') })))));
    });
    if (!out.length) out.push(el('p', { class: 'muted', text: 'Aucun agent affecté pour le moment.' }));
    out.push(el('p', { class: 'muted small', text: 'Présence obligatoire. Les heures comptent dans le quota ; elles sont libérées en cas de désinscription, ou d’absence (agent non déclaré présent par le CU RP).' }));
    if (A.affecter && pers.length) out.push(bouton('Affecter des agents', () => { S.edit = 'affecter'; render(); }, 'pill'));
    return out;
  }

  function renderInfos(f) {
    const I = f.infos;
    if (S.edit === 'infos') {
      const form = el('form', { class: 'orga-form', onsubmit: e => {
        e.preventDefault();
        const v = form.elements;
        action('infos', { id: f.id, infos: { lieu: v.lieu.value, heure: v.heure.value, programme: v.programme.value, infos: v.infos.value } },
          f.inscrits.length ? 'Informations publiées : les inscrits sont prévenus.' : 'Informations enregistrées.');
      } },
      el('label', null, 'Lieu de rendez-vous', el('input', { name: 'lieu', maxlength: '200', value: I.lieu, placeholder: 'Parking, caserne, coordonnées…' })),
      el('label', null, 'Heure de rendez-vous', el('input', { name: 'heure', type: 'time', value: I.heure })),
      el('label', null, 'Programme', el('textarea', { name: 'programme', rows: '4', maxlength: '2000' })),
      el('label', null, 'Informations complémentaires', el('textarea', { name: 'infos', rows: '3', maxlength: '2000', placeholder: 'Matériel personnel, repas, covoiturage…' })),
      el('div', { class: 'orga-actions' },
        el('button', { type: 'submit', class: 'primary', text: 'Publier' }),
        bouton('Annuler', () => { S.edit = null; render(); }, 'link')));
      form.elements.programme.value = I.programme;
      form.elements.infos.value = I.infos;
      return [form];
    }
    const out = [];
    if (I.lieu || I.heure || I.programme || I.infos) {
      const dl = el('dl', { class: 'orga-infos' });
      const add = (t, v) => { if (v) dl.append(el('dt', { text: t }), el('dd', { text: v })); };
      add('Rendez-vous', [I.heure ? heureTxt(I.heure) : '', I.lieu].filter(Boolean).join(' – '));
      add('Programme', I.programme);
      add('Informations', I.infos);
      out.push(dl);
      if (I.maj) out.push(el('p', { class: 'muted small', text: 'Publié par ' + I.par + ', le ' + new Date(I.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '.' }));
    } else {
      out.push(el('p', { class: 'muted', text: f.encadrants.length ? 'Le chef d’unité n’a pas encore publié le rendez-vous ni le programme.' : 'Renseigné par le chef d’unité une fois validé.' }));
    }
    if (f.actions.infos) out.push(bouton(I.lieu || I.programme ? 'Modifier les informations' : 'Compléter les informations', () => { S.edit = 'infos'; render(); }, 'pill'));
    return out;
  }

  function selectSecteur(name, value, sansDept) {
    const s = el('select', { name, required: true }, new Option('— Secteur —', ''),
      ...secteurs().filter(x => !(sansDept && x.dept)).map(x => new Option(x.nom, x.code)));
    s.value = value || '';
    return s;
  }

  function renderGestion(f) {
    if (S.edit === 'date') {
      const form = el('form', { class: 'orga-form', onsubmit: e => {
        e.preventDefault();
        const v = form.elements;
        const change = v.date.value !== f.date || v.secteur.value !== f.secteur || (f.departementale && v.date2.value !== f.date2);
        const qui = f.encadrants.length + f.candidats.length + f.inscrits.length + f.attente.length;
        if (change && qui && !confirm('Les encadrants et inscrits seront prévenus du changement. Continuer ?')) return;
        const champs = { date: v.date.value, secteur: v.secteur.value, note: v.note.value, heures: v.heures.value };
        if (f.departementale) champs.date2 = v.date2.value;
        action('modifier', { id: f.id, champs }, 'FMPA modifiée.');
      } },
      el('label', null, f.departementale ? 'Jour 1' : 'Date', el('input', { name: 'date', type: 'date', required: true, min: today(), value: f.date })),
      f.departementale ? el('label', null, 'Jour 2', el('input', { name: 'date2', type: 'date', required: true, min: today(), value: f.date2 })) : null,
      f.departementale ? null : el('label', null, 'Secteur', selectSecteur('secteur', f.secteur, true)),
      f.departementale ? el('input', { type: 'hidden', name: 'secteur', value: f.secteur }) : null,
      el('label', null, 'Heures comptées' + (f.departementale ? ' par jour' : ''), el('input', { name: 'heures', type: 'number', min: '0.5', max: '24', step: '0.5', required: true, value: String(f.heures) })),
      el('label', null, 'Remarque (facultatif)', el('input', { name: 'note', maxlength: '300', value: f.note, placeholder: 'Thème, site pressenti…' })),
      el('div', { class: 'orga-actions' },
        el('button', { type: 'submit', class: 'primary', text: 'Enregistrer' }),
        bouton('Annuler', () => { S.edit = null; render(); }, 'link')));
      return [form];
    }
    return [el('div', { class: 'orga-actions' },
      bouton(f.departementale ? 'Modifier les dates ou les heures' : 'Modifier la date, le secteur ou les heures', () => { S.edit = 'date'; render(); }, 'pill'),
      bouton('Annuler la FMPA', () => {
        const motif = prompt((f.departementale ? 'Annuler cette FMPA départementale (force majeure uniquement) ? Les agents affectés seront prévenus.'
          : 'Annuler cette FMPA ? Encadrants et inscrits seront prévenus.') + '\nMotif (facultatif) :', '');
        if (motif !== null) action('annuler', { id: f.id, motif }, 'FMPA annulée.');
      }, 'pill danger-pill'))];
  }

  // CT : désigner directement un IMP 3 (les moins sollicités de l'année en premier)
  function designer(f, an) {
    const pris = new Set([].concat(f.encadrants, f.candidats, f.inscrits, f.attente).map(p => p.nom));
    const ok = trierParCompteur((S.data.imp3 || []).filter(p => !pris.has(p.nom) && (!f.restreint || p[f.secteur])), an);
    if (!ok.length) return null;
    const sel = el('select', { 'aria-label': 'IMP 3 à désigner' }, new Option('— Choisir un IMP 3 —', ''),
      ...ok.map(p => new Option(p.nomComplet + ' · ' + compteurTxt(p.nom, an, true) + (p.secteur ? ' · ' + secNom(p.secteur) : ''), p.nom)));
    return el('div', { class: 'orga-designer' },
      el('label', { class: 'small' }, 'Désigner un IMP 3 comme ' + (f.encadrants.length ? 'CU sécurité' : 'CU RP') + ' (les moins sollicités en ' + an + ' en premier)', sel),
      bouton('Désigner', () => {
        const p = ok.find(x => x.nom === sel.value);
        if (!p) { sel.focus(); return; }
        const q = `Désigner ${p.nomComplet} pour encadrer la FMPA du ${dateLongue(f.date)} (${compteurTxt(p.nom, an)}) ?` +
          (f.encadrants.length ? ` Il sera CU sécurité ; la FMPA passera à ${(f.encadrants.length + 1) * f.ratio} places.` : ' Il sera CU RP ; les inscriptions seront ouvertes et tous les membres prévenus.');
        if (confirm(q)) action('decider', { id: f.id, nom: p.nom, decision: 'designer' }, p.nomComplet + ' est désigné.');
      }, 'pill orga-ok'));
  }

  function decider(f, e, decision) {
    const q = {
      valider: (f.phase === 'proposee' ? `Valider la nouvelle FMPA du ${dateLongue(f.date)} proposée par ${e.nomComplet}, qui en sera CU RP ?` +
          ' Les inscriptions seront ouvertes et la liste d’attente de la FMPA complète y passera.'
        : `Valider ${e.nomComplet} comme ${f.encadrants.length ? 'CU sécurité' : 'CU RP'} de la FMPA du ${dateLongue(f.date)}` +
          (S.data && S.data.imp3 ? ` (${compteurTxt(e.nom, f.date.slice(0, 4))})` : '') + ' ?' +
          (f.encadrants.length ? ` La FMPA passera à ${(f.encadrants.length + 1) * f.ratio} places.` : ' Les inscriptions seront ouvertes et tous les membres prévenus.')),
      refuser: (f.phase === 'proposee' ? `Refuser la FMPA proposée par ${e.nomComplet} ? Elle sera annulée.` : `Refuser la candidature de ${e.nomComplet} ?`) + '\nMessage pour lui (facultatif) :',
      retirer: `Retirer ${e.nomComplet} de l’encadrement ?` + (f.encadrants.length === 1 ? ' Les inscrits passeront en liste d’attente.' : ` La FMPA passera à ${(f.encadrants.length - 1) * f.ratio} places.`) + '\nMessage pour lui (facultatif) :',
    }[decision];
    let message = '';
    if (decision === 'valider') { if (!confirm(q)) return; }
    else { message = prompt(q, ''); if (message === null) return; }
    action('decider', { id: f.id, nom: e.nom, decision, message },
      decision === 'valider' ? e.nomComplet + ' est validé.' : decision === 'refuser' ? 'Candidature refusée.' : 'Encadrant retiré.');
  }

  function retirerInscrit(f, p) {
    const message = prompt(`Retirer ${p.nomComplet} des inscrits ? Il sera prévenu.\nMessage (facultatif) :`, '');
    if (message === null) return;
    action('retirer_inscrit', { id: f.id, nom: p.nom, message }, 'Inscription retirée.');
  }

  // ---------- création de dates (CT) ----------
  function ligneDate(date, secteur, heures, date2) {
    const H = (S.data && S.data.heures) || { defaut: 7, dept: 8 };
    const sel = selectSecteur('secteur', secteur);
    const h = el('input', { type: 'number', name: 'heures', min: '0.5', max: '24', step: '0.5', required: true, 'aria-label': 'Heures comptées',
      value: String(heures || (secteur === 'DEPT' ? H.dept : H.defaut)) });
    const d2 = el('input', { type: 'date', name: 'date2', min: today(), value: date2 || '', 'aria-label': 'Jour 2 (départementale)', title: 'Jour 2 (départementale)' });
    const majDept = () => {
      const dept = sel.value === 'DEPT';
      d2.classList.toggle('orga-cache', !dept);
      d2.required = dept;
      d2.disabled = !dept;
    };
    sel.addEventListener('change', () => {
      h.value = String(sel.value === 'DEPT' ? H.dept : H.defaut);
      majDept();
    });
    const li = el('li', { class: 'orga-new-row' },
      el('input', { type: 'date', name: 'date', required: true, min: today(), value: date || '', 'aria-label': 'Date' }),
      sel,
      el('label', { class: 'orga-h' }, h, 'h'),
      d2,
      el('input', { name: 'note', maxlength: '300', placeholder: 'Remarque (facultatif)', 'aria-label': 'Remarque' }),
      el('button', { type: 'button', class: 'orga-del', 'aria-label': 'Retirer cette date', text: '×', onclick: () => {
        li.remove();
        majCompteur();
      } }));
    majDept();
    return li;
  }

  function majCompteur() {
    const n = $('#orga-new-rows').children.length;
    $('#orga-new-submit').textContent = n > 1 ? `Créer les ${n} dates` : 'Créer la date';
    $('#orga-new-submit').disabled = !n;
  }

  function ouvrirCreation(jour) {
    $('#orga-new-rows').replaceChildren(ligneDate(typeof jour === 'string' ? jour : '', S.secteur));
    $('#orga-new').hidden = false;
    $('#orga-new-btn').hidden = true;
    majCompteur();
  }

  function ajouterLigne() {
    const rows = $('#orga-new-rows').children;
    const last = rows[rows.length - 1];
    const d = last && last.querySelector('[name="date"]').value;
    const s = last && last.querySelector('[name="secteur"]').value;
    const h = last && last.querySelector('[name="heures"]').value;
    const d2 = last && last.querySelector('[name="date2"]').value;
    const li = ligneDate(d ? addDays(d, 7) : '', s, h, s === 'DEPT' && d2 ? addDays(d2, 7) : '');
    $('#orga-new-rows').append(li);
    majCompteur();
    li.querySelector('[name="date"]').focus();
  }

  function fermerCreation(sansRendu) {
    $('#orga-new').hidden = true;
    $('#orga-new-rows').replaceChildren();
    if (sansRendu !== true) renderListe();
  }

  $('#orga-new-btn').addEventListener('click', () => ouvrirCreation());
  $('#orga-new-add').addEventListener('click', ajouterLigne);
  $('#orga-new-cancel').addEventListener('click', () => fermerCreation());
  $('#orga-new').addEventListener('submit', async e => {
    e.preventDefault();
    const dates = Array.from($('#orga-new-rows').children).map(li => ({
      date: li.querySelector('[name="date"]').value,
      secteur: li.querySelector('[name="secteur"]').value,
      heures: li.querySelector('[name="heures"]').value,
      date2: li.querySelector('[name="secteur"]').value === 'DEPT' ? li.querySelector('[name="date2"]').value : '',
      note: li.querySelector('[name="note"]').value,
    }));
    if (!dates.length) return;
    const ok = await action('creer', { dates }, dates.length > 1 ? dates.length + ' dates créées : les chefs d’unité sont prévenus.' : 'Date créée : les chefs d’unité sont prévenus.');
    if (ok) { S.mois = dates.map(x => x.date).sort()[0].slice(0, 7); fermerCreation(); }
  });
  $('#orga-secteur').addEventListener('change', e => { S.secteur = e.target.value; renderListe(); });

  // Rafraîchit le compteur du menu sans ouvrir la rubrique (encadrement : candidatures, informations à compléter)
  async function refresh() {
    const c = store.getJSON(KEY);
    if (c && !S.data) { S.data = c; badge(); }
    try {
      const res = await app().api('orga', { token: app().token(), op: 'list' });
      recevoir(res);
    } catch (e) { /* compteur gardé */ }
  }

  function reset() {
    store.del(KEY);
    Object.assign(S, { data: null, fresh: false, espace: 'insc', vue: null, secteur: '', id: null, busy: false, edit: null, mois: moisCourant() });
    badge();
  }

  window.SMPM_ORGA = { open, refresh, reset };
})();
