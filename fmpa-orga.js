// Planning des FMPA (action « orga », Orga.gs) :
//   le conseiller technique crée des dates (plusieurs à la fois, avec le secteur de chacune),
//   les chefs d'unité (IMP 3) se positionnent pour encadrer, le CT valide le ou les chefs d'unité,
//   puis les inscriptions s'ouvrent à tous (6 participants par chef d'unité validé, au-delà liste d'attente).
//   Les chefs d'unité validés complètent le rendez-vous et le programme, transmis aux inscrits.
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
  ];
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const store = {
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };

  const S = { data: null, fresh: false, espace: 'insc', vue: null, secteur: '', id: null, busy: false, edit: null };

  const actif = f => f.phase !== 'annulee' && f.phase !== 'passee';
  const aExaminer = f => actif(f) && f.actions.decider && f.candidats.length > 0;
  const aCompleter = f => actif(f) && f.moi.encadrant === 'VALIDE' && !(f.infos.lieu && f.infos.heure);
  const jEncadre = f => f.moi.encadrant === 'VALIDE' || f.moi.encadrant === 'CANDIDAT';

  // Espaces : titre, présentation, onglets (filtre de la liste, message si vide)
  const ESPACES = {
    ct: {
      nom: 'CT · Organiser',
      titre: 'Organiser les FMPA',
      intro: 'Créez les dates, validez les chefs d’unité qui se positionnent : les inscriptions s’ouvrent dès le premier validé.',
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
      intro: 'Positionnez-vous sur les dates proposées par le CT. Une fois validé, complétez le rendez-vous et le programme pour les inscrits.',
      vues: [
        { code: 'proposees', nom: 'Proposées', filtre: f => actif(f) && (f.actions.candidater || f.moi.encadrant === 'CANDIDAT'),
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
      intro: 'Inscrivez-vous aux FMPA ouvertes (6 places par chef d’unité). Vous êtes prévenu de leur ouverture et des informations du chef d’unité.',
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
    S.data = { fmpa: res.fmpa || [], moi: res.moi || {}, secteurs: res.secteurs || SECTEURS_DEF, ratio: res.ratio || 6, aFaire: res.aFaire || 0, maj: res.maj };
    S.fresh = true;
    store.set(KEY, JSON.stringify(S.data));
    // fiche ouverte depuis une notification : espace selon le rôle de chacun sur cette FMPA
    if (S.ouvrirDepuisNotif && S.id) {
      const f = S.data.fmpa.find(x => x.id === S.id);
      if (f) S.espace = f.actions.decider && (f.candidats.length || f.phase === 'encadrant') ? 'ct' : jEncadre(f) ? 'cu' : 'insc';
      S.vue = null;
      S.ouvrirDepuisNotif = false;
    }
    badge();
    render();
  }

  // Compteurs du menu : candidatures à examiner (CT), informations à compléter (chef d'unité validé), total sur le groupe
  function badge() {
    const l = (S.data && S.data.fmpa) || [];
    const ct = l.filter(aExaminer).length;
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
      recevoir(res);
      setState(okMsg || 'Enregistré.', false, true);
      return true;
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
    const creer = S.espace === 'ct' && moi.gerer;
    if (!creer && !$('#orga-new').hidden) fermerCreation(true);
    $('#orga-new-btn').hidden = !creer || !$('#orga-new').hidden;

    const ssel = $('#orga-secteur');
    ssel.replaceChildren(new Option('Tous secteurs', ''), ...secteurs().map(s => new Option(s.nom, s.code)));
    ssel.value = S.secteur;

    const auj = today();
    const all = ((S.data && S.data.fmpa) || []).map(f => Object.assign(f, { passee: f.date < auj }));
    const parSecteur = all.filter(f => !S.secteur || f.secteur === S.secteur);
    $('#orga-tabs').replaceChildren(...E.vues.map(v => {
      const n = v.compte ? parSecteur.filter(v.compte).length : 0;
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(v.code === S.vue),
        onclick: () => { S.vue = v.code; renderListe(); } }, v.nom, n ? el('span', { class: 'orga-tab-n', text: String(n) }) : null);
    }));

    const V = E.vues.find(v => v.code === S.vue);
    let list = parSecteur.filter(V.filtre);
    if (V.inverse) list = list.reverse();

    const empty = $('#orga-empty');
    empty.hidden = !S.data || list.length > 0;
    empty.textContent = V.vide;
    $('#orga-list').replaceChildren(...list.map(carte));
  }

  function phaseChip(f) {
    const n = f.inscrits.length;
    if (f.phase === 'annulee') return el('span', { class: 'chip orga-chip-annulee', text: 'Annulée' });
    if (f.phase === 'passee') return el('span', { class: 'chip chip-ro', text: n ? n + ' participant' + (n > 1 ? 's' : '') : 'Passée' });
    if (f.phase === 'encadrant') return el('span', { class: 'chip orga-chip-cu', text: f.candidats.length ? 'Encadrant à valider (' + f.candidats.length + ')' : 'Recherche un encadrant' });
    if (f.phase === 'complet') return el('span', { class: 'chip orga-chip-complet', text: 'Complet' + (f.attente.length ? ' · ' + f.attente.length + ' en attente' : '') });
    return el('span', { class: 'chip chip-edit', text: 'Inscriptions ouvertes · ' + (f.capacite - n) + ' place' + (f.capacite - n > 1 ? 's' : '') });
  }

  function monStatut(f) {
    const m = f.moi;
    if (m.encadrant === 'VALIDE') return m.responsable ? 'Vous êtes responsable' : 'Vous êtes co-encadrant';
    if (m.encadrant === 'CANDIDAT') return 'Candidature en attente de validation';
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
    body.append(el('p', { class: 'fmpa-lieu', text: f.infos.lieu || (resp ? 'CU ' + resp.nomComplet : f.note || 'Lieu à préciser') }));
    const meta = el('p', { class: 'fmpa-meta' }, tagSecteur(f.secteur),
      ' ' + [jourSemaine(f.date), f.infos.heure ? 'RDV ' + heureTxt(f.infos.heure) : '', f.encadrants.length > 1 ? f.encadrants.length + ' encadrants' : ''].filter(Boolean).join(' · '));
    body.append(meta, phaseChip(f));
    const st = monStatut(f);
    if (st) body.append(el('span', { class: 'orga-moi', text: st }));
    const fig = el('div', { class: 'fmpa-fig' },
      el('strong', { text: f.capacite ? f.inscrits.length + '/' + f.capacite : '' }),
      f.capacite ? el('span', { text: 'inscrits' }) : null);
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
    out.push(el('h1', { class: 'orga-titre', text: dateLongue(f.date) }));
    out.push(el('p', { class: 'fmpa-meta' }, tagSecteur(f.secteur), f.restreint ? ' Réservée aux qualifiés ' + secNom(f.secteur) : ''));
    out.push(phaseChip(f));
    const st = monStatut(f);
    if (st) out.push(el('p', { class: 'orga-moi orga-moi-fiche', text: st }));
    if (f.phase === 'annulee') out.push(el('p', { class: 'error', text: 'FMPA annulée' + (f.motif ? ' : ' + f.motif : '.') }));
    if (f.note) out.push(el('p', { class: 'orga-note', text: f.note }));

    // Action principale de l'utilisateur
    const act = el('div', { class: 'orga-actions' });
    if (A.inscrire) act.append(bouton(f.phase === 'complet' ? 'M’inscrire en liste d’attente' : 'M’inscrire', () => action('inscrire', { id: f.id }, f.phase === 'complet' ? 'Inscrit en liste d’attente.' : 'Inscription enregistrée.'), 'primary'));
    if (A.desinscrire) act.append(bouton(f.moi.inscrit === 'ATTENTE' ? 'Quitter la liste d’attente' : 'Me désinscrire', () => {
      if (confirm(f.moi.inscrit === 'ATTENTE' ? 'Quitter la liste d’attente ?' : 'Vous désinscrire de cette FMPA ?')) action('inscrire', { id: f.id, desinscrire: true }, 'Désinscription enregistrée.');
    }, 'primary orga-secondaire'));
    if (A.candidater) act.append(bouton(f.moi.encadrant === 'REFUSE' ? 'Me positionner à nouveau pour encadrer' : 'Me positionner pour encadrer', () => action('candidater', { id: f.id }, 'Candidature envoyée au conseiller technique.'), 'primary'));
    if (A.retirerCandidature) act.append(bouton(f.moi.encadrant === 'VALIDE' ? 'Je ne peux plus encadrer' : 'Retirer ma candidature', () => {
      const q = f.moi.encadrant === 'VALIDE' ? 'Vous désister de l’encadrement ? Le conseiller technique sera prévenu' + (f.encadrants.length === 1 ? ' et les inscrits passeront en liste d’attente.' : '.') : 'Retirer votre candidature ?';
      if (confirm(q)) action('candidater', { id: f.id, retirer: true }, 'C’est noté.');
    }, 'primary orga-secondaire'));
    if (act.childNodes.length) out.push(act);
    if (f.raison) out.push(el('p', { class: 'muted small', text: f.raison }));
    if (f.phase === 'encadrant' && !A.candidater && !f.moi.encadrant) {
      out.push(el('p', { class: 'muted small', text: 'Les inscriptions ouvriront dès qu’un chef d’unité aura été validé par le conseiller technique. Vous serez prévenu.' }));
    }

    // Rendez-vous et programme
    out.push(section('Rendez-vous et programme', ...renderInfos(f)));

    // Encadrement
    const enc = el('ul', { class: 'orga-people' });
    f.encadrants.forEach(e => enc.append(el('li', null,
      el('span', { class: 'orga-name', text: e.nomComplet }),
      el('span', { class: 'tag', text: e.responsable ? 'Responsable' : 'Co-encadrant' }),
      A.decider ? bouton('Retirer', () => decider(f, e, 'retirer'), 'link danger-link') : null)));
    f.candidats.forEach(e => enc.append(el('li', { class: 'orga-candidat' },
      el('span', { class: 'orga-name', text: e.nomComplet }),
      el('span', { class: 'chip orga-chip-cu', text: 'Candidat' }),
      A.decider ? el('span', { class: 'orga-btns' },
        bouton('Valider', () => decider(f, e, 'valider'), 'pill orga-ok'),
        bouton('Refuser', () => decider(f, e, 'refuser'), 'pill danger-pill')) : null)));
    if (!enc.childNodes.length) enc.append(el('li', { class: 'muted' }, 'Aucun chef d’unité positionné pour le moment.'));
    out.push(section('Encadrement',
      enc,
      el('p', { class: 'muted small', text: f.ratio + ' participants par chef d’unité validé : un deuxième encadrant porte la FMPA à ' + (2 * f.ratio) + ' places.' })));

    // Participants
    if (f.encadrants.length || f.inscrits.length || f.attente.length) {
      const pct = f.capacite ? Math.min(100, Math.round(100 * f.inscrits.length / f.capacite)) : 0;
      const ins = el('ol', { class: 'orga-people' });
      const ligne = (p, k) => el('li', null,
        el('span', { class: 'orga-name', text: p.nomComplet }),
        el('span', { class: 'muted small', text: [p.niveau, p.secteur ? secNom(p.secteur) : ''].filter(Boolean).join(' · ') }),
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
        f.attente.forEach(p => att.append(ligne(p)));
        kids.push(el('h3', { class: 'orga-h3', text: 'Liste d’attente (' + f.attente.length + ')' }), att);
      }
      out.push(section('Participants · ' + f.inscrits.length + '/' + f.capacite, ...kids));
    }

    // Gestion de la date (CT)
    if (A.gerer && f.phase !== 'annulee') out.push(section('Gestion de la date', ...renderGestion(f)));

    box.replaceChildren(...out);
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

  function selectSecteur(name, value) {
    const s = el('select', { name, required: true }, new Option('— Secteur —', ''), ...secteurs().map(x => new Option(x.nom, x.code)));
    s.value = value || '';
    return s;
  }

  function renderGestion(f) {
    if (S.edit === 'date') {
      const form = el('form', { class: 'orga-form', onsubmit: e => {
        e.preventDefault();
        const v = form.elements;
        const change = v.date.value !== f.date || v.secteur.value !== f.secteur;
        const qui = f.encadrants.length + f.candidats.length + f.inscrits.length + f.attente.length;
        if (change && qui && !confirm('Les encadrants et inscrits seront prévenus du changement. Continuer ?')) return;
        action('modifier', { id: f.id, champs: { date: v.date.value, secteur: v.secteur.value, note: v.note.value } }, 'FMPA modifiée.');
      } },
      el('label', null, 'Date', el('input', { name: 'date', type: 'date', required: true, min: today(), value: f.date })),
      el('label', null, 'Secteur', selectSecteur('secteur', f.secteur)),
      el('label', null, 'Remarque (facultatif)', el('input', { name: 'note', maxlength: '300', value: f.note, placeholder: 'Thème, site pressenti…' })),
      el('div', { class: 'orga-actions' },
        el('button', { type: 'submit', class: 'primary', text: 'Enregistrer' }),
        bouton('Annuler', () => { S.edit = null; render(); }, 'link')));
      return [form];
    }
    return [el('div', { class: 'orga-actions' },
      bouton('Modifier la date ou le secteur', () => { S.edit = 'date'; render(); }, 'pill'),
      bouton('Annuler la FMPA', () => {
        const motif = prompt('Annuler cette FMPA ? Encadrants et inscrits seront prévenus.\nMotif (facultatif) :', '');
        if (motif !== null) action('annuler', { id: f.id, motif }, 'FMPA annulée.');
      }, 'pill danger-pill'))];
  }

  function decider(f, e, decision) {
    const q = {
      valider: `Valider ${e.nomComplet} pour encadrer la FMPA du ${dateLongue(f.date)} ?` +
        (f.encadrants.length ? ` La FMPA passera à ${(f.encadrants.length + 1) * f.ratio} places.` : ' Les inscriptions seront ouvertes et tous les membres prévenus.'),
      refuser: `Refuser la candidature de ${e.nomComplet} ?\nMessage pour lui (facultatif) :`,
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
  function ligneDate(date, secteur) {
    const li = el('li', { class: 'orga-new-row' },
      el('input', { type: 'date', name: 'date', required: true, min: today(), value: date || '', 'aria-label': 'Date' }),
      selectSecteur('secteur', secteur),
      el('input', { name: 'note', maxlength: '300', placeholder: 'Remarque (facultatif)', 'aria-label': 'Remarque' }),
      el('button', { type: 'button', class: 'orga-del', 'aria-label': 'Retirer cette date', text: '×', onclick: () => {
        li.remove();
        majCompteur();
      } }));
    return li;
  }

  function majCompteur() {
    const n = $('#orga-new-rows').children.length;
    $('#orga-new-submit').textContent = n > 1 ? `Créer les ${n} dates` : 'Créer la date';
    $('#orga-new-submit').disabled = !n;
  }

  function ouvrirCreation() {
    $('#orga-new-rows').replaceChildren(ligneDate('', S.secteur));
    $('#orga-new').hidden = false;
    $('#orga-new-btn').hidden = true;
    majCompteur();
  }

  function ajouterLigne() {
    const rows = $('#orga-new-rows').children;
    const last = rows[rows.length - 1];
    const d = last && last.querySelector('[name="date"]').value;
    const s = last && last.querySelector('[name="secteur"]').value;
    const li = ligneDate(d ? addDays(d, 7) : '', s);
    $('#orga-new-rows').append(li);
    majCompteur();
    li.querySelector('[name="date"]').focus();
  }

  function fermerCreation(sansRendu) {
    $('#orga-new').hidden = true;
    $('#orga-new-rows').replaceChildren();
    if (sansRendu !== true) renderListe();
  }

  $('#orga-new-btn').addEventListener('click', ouvrirCreation);
  $('#orga-new-add').addEventListener('click', ajouterLigne);
  $('#orga-new-cancel').addEventListener('click', () => fermerCreation());
  $('#orga-new').addEventListener('submit', async e => {
    e.preventDefault();
    const dates = Array.from($('#orga-new-rows').children).map(li => ({
      date: li.querySelector('[name="date"]').value,
      secteur: li.querySelector('[name="secteur"]').value,
      note: li.querySelector('[name="note"]').value,
    }));
    if (!dates.length) return;
    const ok = await action('creer', { dates }, dates.length > 1 ? dates.length + ' dates créées : les chefs d’unité sont prévenus.' : 'Date créée : les chefs d’unité sont prévenus.');
    if (ok) { fermerCreation(); S.vue = 'traiter'; renderListe(); }
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
    Object.assign(S, { data: null, fresh: false, espace: 'insc', vue: null, secteur: '', id: null, busy: false, edit: null });
    badge();
  }

  window.SMPM_ORGA = { open, refresh, reset };
})();
