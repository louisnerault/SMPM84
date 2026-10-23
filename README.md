# SMPM 84 – front-end

Site statique (GitHub Pages). Aucune donnée de personnel ici : tout passe par l'API Apps Script.

1. Déployer `Code.gs` en application Web, copier l'URL (`.../exec`) dans `config.js`.
2. Pousser ce dossier dans un dépôt GitHub, puis Settings > Pages > branche `main`, dossier `/ (root)`.
3. Ouvrir l'URL Pages sur mobile, puis « Ajouter à l'écran d'accueil ».

Les notices d'utilisation par rôle ne sont pas publiées ici (dépôt public) : elles sont conservées dans le projet Claude « Outils numérique SMPM 84 ».

## Back-end (dossier `backend/`)

Fichiers à copier dans le projet Apps Script « Web App SMPM84 », à côté de `Code.gs` :

- `Livret.gs` : livret individuel (action `livret`).
- `Fmpa.gs` : FMPA (déclaration, listes, consultation, modification). Réservé aux chefs d'unité et au-delà.
  1. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'fmpa_form':   result = fmpaForm_(b.token); break;
     case 'fmpa_submit': result = fmpaSubmit_(b.token, b.answers, b.submission_id); break;
     case 'fmpa_list':   result = fmpaList_(b.token, b.scope); break;
     case 'fmpa_get':    result = fmpaGet_(b.token, b.id); break;
     case 'fmpa_update': result = fmpaUpdate_(b.token, b.id, b.answers, b.version); break;
     ```
  2. Exécuter une fois `testFmpaForm()` puis `testFmpaMapping()` dans l'éditeur (autorisations ; le journal montre les questions lues et leur rapprochement avec les colonnes du sheet FMPA).
  3. Redéployer en « Nouvelle version ».

  Déclaration : la réponse est soumise au Google Form « Formulaire FMPA », qui alimente le sheet FMPA comme une saisie classique.

  Indice de risque : l'application l'affiche dans la fenêtre de validation, avec le même calcul que l'onglet `FMPA_test` du sheet FMPA (compte rendu PDF, SMS au chef d'unité). Exécuter une fois `corrigerIndiceRisque()` dans l'éditeur pour corriger deux formules de cet onglet : `H11` (SOIEC CNF) lisait la colonne Reconnaissance du site, et `I17` ne comptait pas « Autres difficultés » (`SUM(I4:I15)` → `SUM(I4:I16)`).

  Droits de modification d'une FMPA enregistrée (ligne de l'onglet `test_fmpa`) :
  - administrateur et conseiller technique : toutes les FMPA (menu « Toutes les FMPA ») ;
  - chef de section : les FMPA de son secteur (menu « Toutes les FMPA », où il consulte aussi les autres secteurs en lecture seule) ;
  - chef d'unité (IMP3 responsable) : ses FMPA pendant 24 h après la déclaration, ensuite lecture seule et renvoi vers le N+1 (colonne « CHEFS DE SECTION » de la liste du personnel).

  La modification réécrit seulement les cellules changées, sans renvoyer le formulaire (les traitements déclenchés à l'envoi ne sont pas relancés). Chaque modification est tracée dans l'onglet Journal.

- `Roles.gs` : fonctions SMPM lues dans l'onglet « CT et CdS » de la Liste du personnel (CTD, chefs de section NORD/SUD/CENTRE/NEIGE/ISS/SSSM), IMP3 pour encadrer une FMPA, administration invisible.
  1. **Supprimer la fonction `deriveRole_` de `Code.gs`** : `Roles.gs` la remplace (deux fonctions du même nom = comportement imprévisible).
  2. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'fonction': result = fonctionApi_(b.token); break;
     ```
  3. Vérifier que la case `is_admin` de l'onglet Comptes est cochée pour l'administrateur (le rôle forcé « admin » est encore reconnu, mais n'est plus affiché).
  4. Exécuter une fois `testFonctions()` (le journal liste l'onglet lu et la fonction calculée pour chacun), puis redéployer en « Nouvelle version ».

- `Validation.gs` : validation des thèmes FMPA par les chefs d'unité (rubrique FMPA > Validation des livrets).
  1. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'cu_list':   result = cuList_(b.token); break;
     case 'cu_decide': result = cuDecide_(b.token, b.id, b.decision, b.motif); break;
     ```
  2. Exécuter une fois `testValidation()` dans l'éditeur (autorisations Sheets et envoi de mails ; le journal liste les colonnes du fichier CORE reconnues et les demandes en attente, sans rien modifier).
  3. Redéployer en « Nouvelle version ».

  L'application lit le fichier CORE (onglet « formulaire thèmes ») et applique le même traitement que le script « SMPM : validation thèmes FMPA et CORE » : validation = ligne copiée en tête de l'onglet LOGS du livret de l'agent + année en colonne D + statut « validé » ; rejet = statut « rejeté » ; dans les deux cas mail à l'agent, ligne copiée dans ARCHIVES puis retirée du CORE. Les feuilles « validation CU » de chaque chef d'unité continuent de fonctionner en parallèle.

  Droits : chef d'unité et chef de section = demandes qui leur sont adressées ; conseiller technique et administrateur = toutes.

- `Annuaire.gs` : annuaire des spécialistes (mode intervention › Annuaire des spécialistes). Accessible à tous les membres connectés ; personnel actif uniquement.
  1. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'annuaire': result = annuaireApi_(b.token); break;
     ```
  2. Optionnel : renseigner un jeton dans `testAnnuaire()` et l'exécuter (le journal indique combien de personnes ont un numéro).
  3. Redéployer en « Nouvelle version ».

  Renvoie nom, prénom, grade, secteur SMPM, centre d'affectation (colonne « Affectation »), qualifications acquises (IMP 1/2/3, NEIGE, ISS, SSH, CAN, SSSM), fonction (CTD / chef de section, onglet « CT et CdS ») et téléphone. Le téléphone est lu dans une colonne « Téléphone » (ou Tel, Portable, Mobile…) de la Liste du personnel, sinon dans l'onglet Comptes (rapprochement par e-mail puis par nom).

- `Intervention.gs` : compte rendu d'intervention (rubrique Intervention › Nouvelle intervention). Fichier autonome, indépendant de `Fmpa.gs` (il n'utilise que les fonctions communes de `Code.gs`).
  1. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'itv_form':   result = itvForm_(b.token); break;
     case 'itv_submit': result = itvSubmit_(b.token, b.answers, b.submission_id); break;
     case 'itv_list':   result = itvList_(b.token, b.scope); break;
     case 'itv_get':    result = itvGet_(b.token, b.id); break;
     case 'itv_update': result = itvUpdate_(b.token, b.id, b.answers, b.version); break;
     ```
  2. Exécuter une fois `testIntervention()` dans l'éditeur (autorisations ; le journal liste les sections et questions du formulaire « INTERVENTION - SMPM 84 » confirme la question « Coordonnées GPS » et vérifie le rapprochement questions / colonnes de l'onglet des réponses).
  3. Redéployer en « Nouvelle version ».

  La saisie est soumise au formulaire lui-même (retrouvé automatiquement : celui relié au sheet « Interventions SMPM »), qui alimente l'onglet des réponses comme une saisie classique. Le chef d'unité peut pointer l'intervention sur une carte (Plan IGN, photo aérienne, OpenStreetMap) ou relever sa position : les coordonnées (« 44.174130, 5.278690 ») remplissent la question réponse courte « Coordonnées GPS » du formulaire.

  Mes interventions : interventions dont l'utilisateur est le « Chef d'unité SMPM », modifiables pendant 24 h après l'envoi. Toutes les interventions (conseiller technique et administrateur) : consultation et modification de toutes les interventions, sans limite de délai. La modification réécrit seulement les cellules changées de la ligne, sans renvoyer le formulaire ; elle est tracée dans l'onglet Journal.

  Droits : chef d'unité, chef de section, conseiller technique, administrateur.
