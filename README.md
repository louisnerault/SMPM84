# SMPM 84 – front-end

Site statique (GitHub Pages). Aucune donnée de personnel ici : tout passe par l'API Apps Script.

1. Déployer `Code.gs` en application Web, copier l'URL (`.../exec`) dans `config.js`.
2. Pousser ce dossier dans un dépôt GitHub, puis Settings > Pages > branche `main`, dossier `/ (root)`.
3. Ouvrir l'URL Pages sur mobile, puis « Ajouter à l'écran d'accueil ».

Notices d'utilisation par rôle : [`docs/notices/`](docs/notices/README.md).

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

  Droits de modification d'une FMPA enregistrée (ligne de l'onglet `test_fmpa`) :
  - administrateur et conseiller technique : toutes les FMPA (menu « Toutes les FMPA ») ;
  - chef de section : les FMPA de son secteur (menu « Toutes les FMPA », où il consulte aussi les autres secteurs en lecture seule) ;
  - chef d'unité (IMP3 responsable) : ses FMPA pendant 24 h après la déclaration, ensuite lecture seule et renvoi vers le N+1 (colonne « CHEFS DE SECTION » de la liste du personnel).

  La modification réécrit seulement les cellules changées, sans renvoyer le formulaire (les traitements déclenchés à l'envoi ne sont pas relancés). Chaque modification est tracée dans l'onglet Journal.

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
