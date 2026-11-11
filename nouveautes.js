/* Fenêtre « Nouveautés » affichée à l'ouverture de l'application.
 *
 * Montre les nouveautés publiées depuis la dernière version vue par l'utilisateur (sur cet appareil),
 * filtrées selon son rôle. Un nouvel utilisateur (aucune version vue enregistrée) ne voit rien :
 * la version actuelle est simplement retenue comme point de départ.
 *
 * Chaque branche a son propre fichier : BRANCHE et NOUVEAUTES ne décrivent que ce qui est
 * en ligne sur cette branche (les versions vues sont mémorisées séparément par branche).
 *
 * Ajouter une entrée à chaque version qui apporte quelque chose d'utile à l'utilisateur :
 *   { v: 135, titre: '…', texte: '…', pour: ['tous'] }
 *   v     : numéro de version (celui de CACHE dans sw.js, smpm84-shell-vNN)
 *   pour  : 'tous' ou rôles parmi equipier, chef_unite, chef_section, ctd (les administrateurs voient tout)
 * Ne pas y mettre les corrections internes sans effet visible.
 */
(function () {
  'use strict';

  const BRANCHE = 'main';

  const NOUVEAUTES = [
    { v: 148, titre: 'Tableaux de bord', texte: 'Nouvelle rubrique « Tableau de bord » (Chefs de section) : vision d’ensemble de l’unité par thème — Interventions, FMPA, Livrets, Neige, Spéléo, Inventaires — filtrable par année, par période et par secteur, avec comparaison à l’année précédente. Conçue pour l’ordinateur ; sur téléphone, passez en mode paysage.', pour: ['chef_section', 'ctd'] },
    { v: 147, titre: 'Bouton Retour sur les documents (Android aussi)', texte: 'Sur tous les téléphones, les fiches techniques, notices et GTO/GDO/GNR s’ouvrent maintenant dans l’application, avec un bouton « ← Retour » et des boutons − / + pour zoomer.', pour: ['tous'] },
    { v: 146, titre: 'Bouton Retour sur les documents (iPhone)', texte: 'Sur iPhone, les fiches techniques, notices et GTO/GDO/GNR s’ouvrent maintenant avec un bouton « ← Retour » : plus besoin de fermer et rouvrir l’application. La carte hors ligne ne signale plus à tort des images manquantes (cliquez une fois sur « Mettre à jour la sélection »).', pour: ['tous'] },
    { v: 145, titre: 'Suivi de vos signalements', texte: 'Après un signalement (bug, suggestion…), vous recevez une notification quand il est pris en charge, puis quand il est corrigé ou rejeté, avec la réponse de l’administrateur. Chaque notification rappelle le numéro et votre demande.', pour: ['tous'] },
    { v: 144, titre: 'Itinéraire sur la carte', texte: 'Sur la carte des points d’intérêt, tracez l’itinéraire vers un point, une adresse ou un endroit pointé (appui long) : étapes, profil altimétrique avec dénivelé et pentes, en véhicule ou à pied. « Démarrer » suit votre position, même sans réseau une fois l’itinéraire calculé.', pour: ['tous'] },
    { v: 143, titre: 'Inventaire : recopie complète', texte: 'Dans « Modifier le contenu », les contenants cochés sous « Recopier ce contenu dans » reçoivent désormais tout le contenu, photos comprises. Les articles qui n’y existent pas sont signalés : cochez « Conserver » pour les garder.', pour: ['chef_section', 'ctd'] },
    { v: 142, titre: 'Inventaire : photos reportées', texte: 'Dans « Modifier le contenu », une photo d’article ajoutée, changée ou retirée est désormais aussi reportée dans les contenants cochés sous « Reporter aussi les changements dans », sur l’article du même nom.', pour: ['chef_section', 'ctd'] },
    { v: 141, titre: 'Dernière connexion du personnel', texte: 'Dans « Mes spécialistes », chaque fiche indique la date de la dernière connexion à l’application (ou « Jamais connecté »), pour repérer qui n’utilise pas encore l’outil.', pour: ['chef_section', 'ctd'] },
    { v: 140, titre: 'Inventaire : choix de l’occasion', texte: 'En début d’inventaire, aucune occasion n’est plus cochée d’office : choisissez-la (simple, FMPA, intervention…) pour faire apparaître la liste du matériel.', pour: ['tous'] },
    { v: 139, titre: 'Inventaire du matériel', texte: 'Nouvelle rubrique pour suivre le contenu des contenants des véhicules et l’état des cordes : inventaire pré-rempli avec le contenu théorique, remarques, alertes et cordes numérotées. Les écarts sont signalés à l’encadrement et au contrôleur EPI du secteur.', pour: ['tous'] },
    { v: 136, titre: 'Bandeau simplifié', texte: 'Hors ligne, une antenne barrée s\u2019affiche dans le bandeau. La synchronisation se réduit à son pictogramme : touchez-le (ou survolez-le) pour voir la date de la dernière synchronisation.', pour: ['tous'] },
    { v: 135, titre: 'GTO / GDO / GNR', texte: 'Nouvelle rubrique dans Documentation › GTO/GDO/GNR : les documents de référence GTO, GDO et GNR, avec favoris, consultables hors ligne sur smartphone.', pour: ['tous'] },
    { v: 134, titre: 'Fenêtre des nouveautés', texte: 'À chaque mise à jour, les nouveautés qui vous concernent s’affichent ici à l’ouverture de l’application.', pour: ['tous'] },
  ];

  const keyOf = user => 'smpm_nouveautes_vu_' + BRANCHE + '_' + String(user || 'anonyme').toLowerCase();
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // Version servie par le service worker (null s'il n'y en a pas encore)
  function versionCourante() {
    return new Promise(resolve => {
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!sw) return resolve(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 3000);
      ch.port1.onmessage = e => { clearTimeout(t); resolve(parseInt(e.data, 10) || null); };
      sw.postMessage('version', [ch.port2]);
    });
  }

  async function majEnAttente() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      if (!reg.installing && !reg.waiting) { await Promise.race([reg.update(), new Promise(r => setTimeout(r, 2000))]); }
      return !!(reg.installing || reg.waiting);
    } catch (e) { return false; }
  }

  function concerne(n, session) {
    const pour = n.pour || ['tous'];
    if (pour.includes('tous')) return true;
    if (!session) return false;
    if (session.is_admin === true || session.admin === true || session.role === 'admin') return true;
    return pour.includes(session.role);
  }

  function afficher(liste, onClose) {
    const dlg = document.createElement('dialog');
    dlg.className = 'ann-dialog nouv-dialog';
    dlg.setAttribute('aria-labelledby', 'nouv-title');
    const h = document.createElement('h2');
    h.id = 'nouv-title';
    h.textContent = 'Nouveautés';
    const ul = document.createElement('ul');
    ul.className = 'nouv-list';
    liste.forEach(n => {
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = n.titre;
      const p = document.createElement('p');
      p.textContent = n.texte;
      const s = document.createElement('span');
      s.className = 'nouv-v';
      s.textContent = 'v' + n.v;
      li.append(b, ' ', s, p);
      ul.append(li);
    });
    const btns = document.createElement('div');
    btns.className = 'ann-dialog-btns';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'primary'; ok.textContent = 'J’ai compris';
    ok.addEventListener('click', () => dlg.close());
    btns.append(ok);
    dlg.append(h, ul, btns);
    dlg.addEventListener('cancel', e => e.preventDefault());
    dlg.addEventListener('close', () => { onClose(); dlg.remove(); });
    document.body.append(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // Renvoie une promesse résolue quand il n'y a rien à montrer, ou quand l'utilisateur a fermé la fenêtre :
  // le démarrage de l'application attend cette promesse (tout est en pause pendant l'affichage).
  let enCours = null;
  function verifier(session, user) {
    if (!enCours) enCours = verifierUneFois(session, user).catch(() => {});
    return enCours;
  }
  async function verifierUneFois(session, user) {
    const courante = await versionCourante();
    if (!courante) return;
    const key = keyOf(user);
    const vue = parseInt(get(key), 10);
    if (!vue) { set(key, String(courante)); return; }   // première ouverture : pas d'historique
    if (vue >= courante) return;
    const liste = NOUVEAUTES
      .filter(n => n.v > vue && n.v <= courante && concerne(n, session))
      .sort((a, b) => b.v - a.v);
    // rien à montrer : la version vue n'avance pas, une nouveauté ajoutée après coup s'affichera encore
    if (!liste.length) return;
    // nouvelle version en cours d'installation : la page va se recharger, la fenêtre s'affichera après
    if (await majEnAttente()) return;
    await new Promise(resolve => afficher(liste, () => { set(key, String(courante)); resolve(); }));
  }

  // Fenêtre ouverte : l'application ne doit pas se recharger (nouvelle version) pendant la lecture
  const ouverte = () => !!document.querySelector('.nouv-dialog[open]');

  window.SMPM_NOUVEAUTES = { verifier, ouverte };
})();
