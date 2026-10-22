# SMPM 84 – front-end

Site statique (GitHub Pages). Aucune donnée de personnel ici : tout passe par l'API Apps Script.

1. Déployer `Code.gs` en application Web, copier l'URL (`.../exec`) dans `config.js`.
2. Pousser ce dossier dans un dépôt GitHub, puis Settings > Pages > branche `main`, dossier `/ (root)`.
3. Ouvrir l'URL Pages sur mobile, puis « Ajouter à l'écran d'accueil ».

## Back-end (dossier `backend/`)

Fichiers à copier dans le projet Apps Script « Web App SMPM84 », à côté de `Code.gs` :

- `Livret.gs` : livret individuel (action `livret`).
- `Fmpa.gs` : déclaration de FMPA (actions `fmpa_form` et `fmpa_submit`), réservée aux chefs d'unité, chefs de section, conseillers techniques et administrateurs.
  1. Dans `doPost()` de `Code.gs`, ajouter :
     ```js
     case 'fmpa_form':   result = fmpaForm_(b.token); break;
     case 'fmpa_submit': result = fmpaSubmit_(b.token, b.answers, b.submission_id); break;
     ```
  2. Exécuter une fois `testFmpaForm()` dans l'éditeur (autorisation FormApp ; le journal affiche la structure lue).
  3. Redéployer en « Nouvelle version ».

  L'app lit la structure du Google Form « Formulaire FMPA » et soumet la déclaration au formulaire lui-même :
  la réponse arrive dans le sheet FMPA comme une saisie classique et les traitements déjà branchés sur le formulaire continuent de fonctionner.
