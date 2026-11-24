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
    { v: 212, titre: 'Mes prochaines FMPA sur l’accueil', texte: 'L’accueil (Mes heures) affiche les prochaines FMPA auxquelles vous êtes inscrit, en liste d’attente ou encadrant. Un toucher ouvre la fiche de la FMPA.', pour: ['tous'] },
    { v: 211, titre: 'Carte : points regroupés et zoom', texte: 'Sur la carte, les agents trop proches s’affichent en un seul point avec leur nombre : zoomez pour les séparer. Un clic sur un point (agent ou POI) zoome automatiquement à l’échelle 200 m.', pour: ['tous'] },
    { v: 210, titre: 'Cartographie plus compacte', texte: 'La carte s’affiche dès l’ouverture de Cartographie / points d’intérêt : boutons répartis sur la largeur avec leurs icônes, secteurs et types en listes côte à côte.', pour: ['tous'] },
    { v: 209, titre: 'Supprimer une FMPA', texte: 'Dans la fiche d’une FMPA du planning, le bouton « Supprimer définitivement » efface la FMPA, ses encadrants et ses inscrits, sans notification (double confirmation).', pour: ['admin'] },
    { v: 208, titre: 'Orienter la carte', texte: 'Sur la carte des points d’intérêt, tournez la carte avec deux doigts, ou touchez la boussole (sous le zoom) pour qu’elle suive l’orientation du téléphone ; un nouveau toucher remet le nord en haut.', pour: ['tous'] },
    { v: 204, titre: 'Traccar configuré en un geste', texte: 'Dans « Partager ma position », le bouton Configurer Traccar ouvre Traccar Client avec l’adresse du serveur, votre identifiant et les bons réglages déjà remplis.', pour: ['tous'] },
    { v: 203, titre: 'Croix SSSM sur la carte', texte: 'Pendant le partage de position, les agents SSSM sont repérés sur la carte par une croix de secours blanche dans leur pastille.', pour: ['tous'] },
    { v: 200, titre: 'Partager ma position', texte: 'Nouveau bouton « Partager ma position » dans Cartographie / points d’intérêt et sur l’accueil intervention : avec l’appli gratuite Traccar Client, votre position est partagée même écran éteint. Pendant votre partage, vous voyez sur la carte les agents qui partagent aussi la leur.', pour: ['tous'] },
    { v: 197, titre: 'Maintenance de l’application', texte: 'Nouvelle rubrique Administration › Maintenance : mettez l’application en maintenance (seuls les administrateurs y accèdent, les autres membres voient une page d’attente) et prévenez les membres par notification, au début puis au retour à la normale.', pour: ['admin'] },
    { v: 192, titre: 'Vue RH : quotas Neige et ISS', texte: 'Dans la Vue RH, les agents qualifiés Neige ou ISS ont aussi une barre sur leur quota de la spécialité (quotas du livret), et la liste est plus compacte.', pour: ['ctd', 'admin'] },
    { v: 191, titre: 'Vue RH', texte: 'Menu « Administration › Vue RH » : vous voyez l’espace RH comme un responsable RH, pour tous les centres — barres de quota FMPA et heures chef de section, filtre par période, détail des dates.', pour: ['ctd', 'admin'] },
    { v: 190, titre: 'Administration › RH', texte: 'Les responsables RH se gèrent désormais dans le nouveau menu « Administration › RH » : nom, prénom, e-mail et centres gérés. Ils se connectent sur un espace séparé (adresse dans leur invitation) où chaque agent a une barre de progression sur son quota, repos et temps de travail distingués, dépassement en rouge, et une seconde barre pour les heures des chefs de section.', pour: ['ctd', 'admin'] },
    { v: 189, titre: 'Accès RH', texte: 'Nouvelle rubrique « Accès RH » (Chefs de section) : créez un accès pour le service RH d’un centre. Il reçoit une invitation par e-mail et consulte, en lecture seule, les FMPA suivies par les agents SMPM de ses centres (date, durée, lieu, repos ou temps de travail).', pour: ['ctd', 'admin'] },
    { v: 185, titre: 'Planning des FMPA : secteur à définir', texte: 'Le secteur n’est plus obligatoire à la création d’une date : laissez « Secteur à définir ». Il est fixé quand vous validez le CU RP, par défaut celui du CU RP, ou celui que vous choisissez au-dessus de la liste des candidats.', pour: ['ctd', 'admin'] },
    { v: 184, titre: 'Planning des FMPA : quotas', texte: 'Votre quota d’heures de l’année (FMPA départementales comprises) s’affiche dans « S’inscrire ». Au 1er semestre, vous ne pouvez pas dépasser la moitié du quota (+ 10 %) ; une fois le quota atteint, l’inscription est bloquée. En liste d’attente, la place libérée va à celui qui a le moins avancé dans son quota.', pour: ['tous'] },
    { v: 184, titre: 'Planning des FMPA : CU RP et CU sécurité', texte: 'Le premier chef d’unité validé est CU RP, le second CU sécurité. Si la FMPA est pleine, un 3e IMP 3 peut proposer une nouvelle FMPA dont il sera CU RP. Votre nombre d’encadrements de l’année (4 attendus) s’affiche dans « CU · Encadrer ».', pour: ['chef_unite', 'chef_section', 'ctd', 'admin'] },
    { v: 184, titre: 'Planning des FMPA : heures, départementales, annulations', texte: 'Le CT fixe les heures de chaque FMPA à sa création et peut créer les FMPA départementales (2 jours) ; le CT et les chefs de section y affectent les agents. Une FMPA à 3 personnes ou moins est proposée à l’annulation à J-7 (rappel à J-3).', pour: ['chef_section', 'ctd', 'admin'] },
    { v: 182, titre: 'Tableau de bord : Effectifs', texte: 'Nouveau thème « Effectifs » dans le tableau de bord : le personnel actif de chaque secteur, réparti par fonction (IMP3, IMP2, autres), avec un tableau récapitulatif et la liste nominative par secteur.', pour: ['ctd', 'admin'] },
    { v: 180, titre: 'Invitation aux notifications', texte: 'Si les notifications ne sont pas activées sur votre téléphone, une fenêtre vous le propose à l’ouverture de l’application et explique ce qu’elles vous apportent. Touchez « Activer les notifications », « Plus tard », ou « Ne plus me le proposer ».', pour: ['tous'] },
    { v: 179, titre: 'Détail des heures d’un spécialiste', texte: 'Tableau de bord › Livrets : touchez le nom d’un spécialiste dans « Tous les livrets » pour voir ses FMPA de la période (date, compteur, lieu, IMP3, repos ou TT, heures) et ses totaux par compteur.', pour: ['chef_section', 'ctd', 'admin'] },
    { v: 178, titre: 'Total des formations', texte: 'Dans Mon livret, sous « Formations effectuées », le total d’heures de l’année s’affiche avec sa répartition par compteur : les FMPA Neige, ISS, SSH ou Canyon comptent dans leur propre compteur, pas dans SMPM.', pour: ['tous'] },
    { v: 177, titre: 'Alertes d’inventaire plus lisibles', texte: 'Dans les alertes d’inventaire, le matériel manquant s’affiche en grand et en gras, sous la forme « Il manque … dans … », et le nom du contenant concerné est en gras.', pour: ['tous'] },
    { v: 176, titre: 'Clochette : actions en icônes', texte: 'Dans la clochette, les actions sont maintenant des icônes (laissez le doigt ou la souris dessus pour voir leur nom) : ✓ marquer comme lue, ✓✓ tout marquer comme lu, case pour tout cocher, corbeille pour supprimer les lues ou la sélection. La suppression est aussi plus fiable : elle est vérifiée et renvoyée automatiquement si le serveur répond mal.', pour: ['tous'] },
    { v: 175, titre: 'Chargements plus fiables', texte: 'Quand un chargement échoue à cause d’un raté passager du réseau ou du serveur, l’application réessaie d’elle-même plusieurs fois avant d’afficher « Chargement des données impossible ». Si le message apparaît quand même, sa cause est indiquée dessous.', pour: ['tous'] },
    { v: 174, titre: 'Fiche d’un point d’intérêt', texte: 'Points d’intérêt : en mode Liste, touchez un point pour ouvrir sa fiche (photos affichées directement). Sur la carte, le bouton « Consulter » de la bulle ouvre la même fiche sans quitter la carte ; les actions de la bulle sont maintenant de vrais boutons.', pour: ['tous'] },
    { v: 173, titre: 'Évaluation GNR dans l’application', texte: 'Chefs de section › Évaluation GNR : l’évaluation annuelle se remplit maintenant directement dans l’application, avec les mêmes questions que le formulaire, même hors ligne (envoi automatique au retour du réseau). Le PDF et la validation annuelle du livret de l’agent sont créés automatiquement.', pour: ['chef_section', 'ctd', 'admin'] },
    { v: 172, titre: 'Planning des FMPA', texte: 'Nouvelle rubrique « Planning des FMPA » dans le menu : le CT propose les dates, les chefs d’unité se positionnent pour encadrer, puis chacun s’inscrit (6 places par chef d’unité, liste d’attente au-delà). Vous êtes prévenu à chaque étape et des informations de rendez-vous.', pour: ['tous'] },
    { v: 172, titre: 'Calendrier des FMPA', texte: 'Dans « Planning des FMPA › CT · Organiser », les dates s’affichent sur un calendrier mensuel coloré selon leur état. Pour valider ou désigner un IMP 3, son nombre de FMPA encadrées dans l’année est affiché, les moins sollicités en premier.', pour: ['ctd', 'admin'] },
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
