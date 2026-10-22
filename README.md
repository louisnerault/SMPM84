# SMPM 84 – front-end

Site statique (GitHub Pages). Aucune donnée de personnel ici : tout passe par l'API Apps Script.

1. Déployer `Code.gs` en application Web, copier l'URL (`.../exec`) dans `config.js`.
2. Pousser ce dossier dans un dépôt GitHub, puis Settings > Pages > branche `main`, dossier `/ (root)`.
3. Ouvrir l'URL Pages sur mobile, puis « Ajouter à l'écran d'accueil ».

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
  - chef de section : les FMPA de son secteur (menu « FMPA du secteur ») ;
  - chef d'unité (IMP3 responsable) : ses FMPA pendant 24 h après la déclaration, ensuite lecture seule et renvoi vers le N+1 (colonne « CHEFS DE SECTION » de la liste du personnel).

  La modification réécrit seulement les cellules changées, sans renvoyer le formulaire (les traitements déclenchés à l'envoi ne sont pas relancés). Chaque modification est tracée dans l'onglet Journal.
