# SMPM 84 — consignes pour Claude

- Pousser les modifications directement sur `main` (GitHub Pages).
- **Notices par rôle (`docs/notices/`)** : à chaque évolution visible par un utilisateur (rubrique, droits, comportement, libellé), mettre à jour dans le même commit la ou les notices concernées, le tableau « Qui a accès à quoi » de `docs/notices/README.md` et la date « Dernière mise à jour » en tête des fichiers modifiés.
- Rôles : équipier, chef d'unité, chef de section, conseiller technique (`ctd`), administrateur (`admin` ou case `is_admin`). Droits définis dans `app.js` (`canDeclare`, `canSectorFmpa`, `canAllFmpa`) et `backend/Fmpa.gs`.
- Textes de l'application et de la documentation en français.
