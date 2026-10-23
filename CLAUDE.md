# SMPM 84 — consignes pour Claude

- Pousser les modifications directement sur `main` (GitHub Pages).
- **Notices par rôle (`docs/notices/`)** : à chaque évolution visible par un utilisateur (rubrique, droits, comportement, libellé), mettre à jour dans le même commit la ou les notices concernées, le tableau « Qui a accès à quoi » de `docs/notices/README.md` et la date « Dernière mise à jour » en tête des fichiers modifiés.
- Rôles : équipier, chef d'unité, chef de section, conseiller technique (`ctd`), administrateur (`admin` ou case `is_admin`). Droits définis dans `app.js` (`canDeclare`, `canSectorFmpa`, `canAllFmpa`) et `backend/Fmpa.gs`.
- Textes de l'application et de la documentation en français.
- **Service worker** : l'application est servie depuis le cache puis mise à jour en arrière-plan. À chaque modification d'un fichier de l'application (HTML, CSS, JS, images), incrémenter `CACHE` dans `sw.js` (`smpm84-shell-vNN`) et ajouter tout nouveau fichier indispensable hors ligne à `SHELL`.
- **Images** : ne jamais afficher une image plus lourde que nécessaire (l'écusson affiché fait 44 px : `assets/ecusson-132.png`).
