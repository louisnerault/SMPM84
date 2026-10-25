# SMPM 84 — consignes pour Claude

Web app (PWA) de la spécialité SMPM du SDIS 84. Front statique sur GitHub Pages, back-end Google Apps Script. Textes de l'application et de la documentation **en français**.

## Flux de travail
1. Lire uniquement les fichiers concernés (voir la carte ci-dessous) — ne pas parcourir tout le dépôt.
2. Modifier, puis vérifier la syntaxe : `node --check <fichier>.js` pour chaque JS touché.
3. Si un fichier de l'application change (HTML, CSS, JS, images) : incrémenter `CACHE` dans `sw.js` (`smpm84-shell-vNN`) et ajouter à `SHELL` tout nouveau fichier indispensable hors ligne.
4. Si l'évolution est visible par un utilisateur : mettre à jour les notices (voir plus bas).
5. Commit en français, message court et explicite, puis **push direct sur `main`** (déploiement GitHub Pages immédiat). Pas de branche ni de PR.
6. Si un fichier `backend/*.gs` change : le dire à Louis en fin de réponse — il doit le copier dans le projet Apps Script « Web App SMPM84 », ajouter les éventuels `case` dans `doPost()` de `Code.gs`, puis **redéployer en « Nouvelle version »**. Lister précisément les étapes.

## Carte du code
| Domaine | Front | Back-end (`backend/`) |
|---|---|---|
| Socle, connexion, navigation, droits | `index.html`, `app.js`, `style.css` | `Roles.gs` |
| FMPA (déclaration, listes, validation) | `fmpa.js`, `fmpa-list.js`, `fmpa-valid.js` | `Fmpa.gs`, `Validation.gs` |
| Livret individuel / thèmes | `livret-remplir.js`, `livret-themes.js` | `Livret.gs`, `Themes.gs` |
| Interventions | `intervention-list.js` | `Intervention.gs` |
| Annuaire | `annuaire.js` | `Annuaire.gs` |
| Fiches techniques | `fiches.js`, `fiches/` | `scripts/sync_fiches.py`, `scripts/categories.json` |
| Carte hors ligne | `carte-hors-ligne.js`, `vendor/leaflet` | — |
| Notifications push (FCM) | `push.js`, `sw.js` | `Push.gs` |
| Signalement de bugs | `bugs.js` | `Bugs.gs` |
| Configuration publique | `config.js` (URL API `/exec`, clés Firebase publiques) | — |

`Code.gs` (routeur `doPost`) n'est **pas** dans le dépôt : il vit seulement dans Apps Script.

## Rôles et droits
Équipier, chef d'unité, chef de section, conseiller technique (`ctd`), administrateur (`admin` ou case `is_admin`). Droits définis dans `app.js` (`canDeclare`, `canSectorFmpa`, `canAllFmpa`) **et** dans `backend/Fmpa.gs` — toujours garder les deux cohérents (le front masque, le back-end contrôle).

## Notices par rôle
Pas dans ce dépôt (il est public). Elles sont dans les documents du projet Claude « Outils numérique SMPM 84 », sous `docs/notices/` (outil Projects : `project_read` / `project_write`). À chaque évolution visible (rubrique, droits, comportement, libellé), mettre à jour dans la même session : la ou les notices concernées, le tableau « Qui a accès à quoi » de `docs/notices/README.md`, et la date « Dernière mise à jour » en tête des fichiers modifiés. Ne jamais recréer de dossier de documentation interne dans le dépôt.

## Règles impératives
- **Sécurité** : dépôt public — aucune donnée de personnel, aucun secret (la clé privée du compte de service Firebase reste dans les propriétés du script Apps Script).
- **Images** : jamais plus lourdes que nécessaire (l'écusson affiché fait 44 px → `assets/ecusson-132.png` ; bannières en 700/1000/1400).
- Pas de framework ni d'étape de build : JS vanilla, fichiers servis tels quels.
