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
 *   pour  : rôles concernés parmi equipier, chef_unite, chef_section, ctd, admin.
 *           'tous' uniquement si TOUS les rôles utilisent la fonction (équipiers compris).
 *           Les administrateurs ne voient que 'tous', 'admin' et les entrées de leur propre rôle.
 *           Une entrée sans « pour » n'est montrée à personne.
 * Ne pas y mettre les corrections internes sans effet visible.
 */
(function () {
  'use strict';

  const BRANCHE = 'main';

  const NOUVEAUTES = [
    { v: 172, titre: 'Planning des FMPA', texte: 'Nouvelle rubrique « Planning des FMPA » dans le menu : le CT propose les dates, les chefs d’unité se positionnent pour encadrer, puis chacun s’inscrit (6 places par chef d’unité, liste d’attente au-delà). Vous êtes prévenu à chaque étape et des informations de rendez-vous.', pour: ['tous'] },
    { v: 172, titre: 'Calendrier des FMPA', texte: 'Dans « Planning des FMPA › CT · Organiser », les dates s’affichent sur un calendrier mensuel coloré selon leur état. Pour valider ou désigner un IMP 3, son nombre de FMPA encadrées dans l’année est affiché, les moins sollicités en premier.', pour: ['ctd', 'admin'] },
    { v: 171, titre: 'Évaluation GNR', texte: 'Nouvelle entrée « Évaluation GNR » dans la section Chefs de section du menu : elle ouvre directement le formulaire d’évaluation annuelle des spécialistes.', pour: ['chef_section', 'ctd', 'admin'] },
    { v: 169, titre: 'Activation des notifications', texte: 'Le bouton « Activer sur ce téléphone » indique maintenant où en est l’activation. Si elle bloque (autorisation non donnée, téléphone sans services Google…), un message explique quoi faire au lieu de ne rien afficher.', pour: ['tous'] },
    { v: 168, titre: 'Heures du livret fiabilisées', texte: 'Les heures de « Mon livret » sont maintenant calculées directement à partir des FMPA enregistrées (base FMPA), et non plus recopiées dans l’ancien tableau du livret. Une FMPA déclarée deux fois n’est comptée qu’une fois.', pour: ['tous'] },
    { v: 167, titre: 'Pourcentage réel', texte: 'Pour Toutes les FMPA, les interventions et le tableau de bord, le pourcentage de chargement suit maintenant l’avancement réel du serveur (lecture des données, préparation de la liste).', pour: ['chef_unite', 'chef_section', 'ctd'] },
    { v: 165, titre: 'Chargements suivis partout', texte: 'Dans toutes les rubriques, le chargement des données affiche son avancement en pourcentage. L’application attend jusqu’à 2 minutes ; si le chargement échoue, un bouton Réessayer le relance.', pour: ['tous'] },
    { v: 164, titre: 'Toutes les FMPA : chargement suivi', texte: 'Pendant le chargement de la liste, une barre indique l’avancement en pourcentage. Le chargement peut durer jusqu’à 2 minutes ; en cas d’échec, un bouton Réessayer le relance.', pour: ['chef_section', 'ctd'] },
  { v: 162, titre: 'Tableaux de bord : listes complètes', texte: 'Les classements des tableaux de bord (communes, lieux, spécialistes…) ne s’arrêtent plus aux 10 premiers : touchez « Tout afficher » pour dérouler la liste entière. Les tableaux détaillés affichent aussi toutes les lignes.', pour: ['chef_section', 'ctd'] },
  { v: 161, titre: 'Points liés sur la carte', texte: 'Sur la carte des points d’intérêt, les points liés entre eux sont maintenant entourés d’un cercle transparent de la couleur de leur secteur, au lieu d’être reliés par des pointillés.', pour: ['tous'] },
  { v: 157, titre: 'Groupes de points d’intérêt', texte: 'Les points peuvent être rangés dans un ou plusieurs groupes (ex. « Autran » : aven, parking, accès). La liste les regroupe sous un titre repliable, et un filtre permet d’afficher un seul groupe, aussi sur la carte.', pour: ['tous'] },
  { v: 156, titre: 'Proposer un point d’intérêt', texte: 'Chacun peut désormais proposer un point avec « ＋ Proposer un point » : il apparaît pour tous une fois validé par un chef de section ou un administrateur, et vous êtes prévenu de la décision.', pour: ['equipier'] },
  { v: 156, titre: 'Points proposés à valider', texte: 'Les points proposés par les équipiers de vos secteurs vous sont notifiés et apparaissent en tête de la liste des points d’intérêt, avec les boutons Valider et Refuser.', pour: ['chef_section'] },
  { v: 153, titre: 'Point éphémère plus rapide', texte: 'Plus de nom à saisir pour un point éphémère : choisissez simplement son type (PRM, victime…) et sa position.', pour: ['tous'] },
  { v: 152, titre: 'Points éphémères en intervention', texte: 'Chacun peut poser un point éphémère (PRM, victime, PMA, DZ…) avec « ＋ Point éphémère » ou un clic droit sur la carte : il est visible de tous et s’efface au bout de 24 h.', pour: ['tous'] },
  { v: 152, titre: 'Points liés', texte: 'Un point peut être lié à d’autres (ex. un sommet, ses parkings et ses accès) : les points liés s’affichent sur sa fiche et en pointillés sur la carte.', pour: ['tous'] },
    { v: 151, titre: 'Notifications supprimées pour de bon', texte: 'Les notifications supprimées dans la clochette ne réapparaissent plus, même si la suppression est faite hors ligne ou pendant un rafraîchissement : elle est enregistrée dès que le serveur répond.', pour: ['tous'] },
    { v: 150, titre: 'Tout cocher dans les notifications', texte: 'Dans la clochette, le bouton « Tout cocher » sélectionne d’un coup toutes vos notifications, pour les supprimer ensemble. « Tout décocher » annule la sélection.', pour: ['tous'] },
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

  // Une nouveauté n'est montrée qu'aux rôles qu'elle concerne : plus de passe-droit « administrateur voit tout »
  function concerne(n, session) {
    const pour = Array.isArray(n.pour) ? n.pour : [];
    if (pour.includes('tous')) return true;
    if (!session) return false;
    const admin = session.is_admin === true || session.admin === true || session.role === 'admin';
    if (admin && pour.includes('admin')) return true;
    return !!session.role && pour.includes(session.role);
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
