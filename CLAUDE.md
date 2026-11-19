# SMPM 84 — règles complémentaires pour Claude

Les consignes principales sont dans les instructions du projet Claude « Outils numérique SMPM 84 ».

## Fenêtre « Nouveautés » (`nouveautes.js`)

À chaque évolution utile à l'utilisateur, dans la même modification que l'incrément de `CACHE` dans `sw.js` :

- ajouter une entrée **en tête** de `NOUVEAUTES` dans `nouveautes.js` :
  `{ v: <nouveau numéro de CACHE>, titre: '…', texte: '…', pour: ['chef_section', 'ctd'] }`
  - `texte` : une ou deux phrases en français, du point de vue de l'utilisateur ;
  - `pour` : **uniquement les rôles qui voient ou utilisent la fonction** (`equipier`, `chef_unite`, `chef_section`, `ctd`, `admin`), en reprenant les droits de `app.js` (`canDeclare`, `canAllFmpa`, `canIntervene`…) ; `'tous'` seulement si la fonction sert à tous les rôles, équipiers compris. Les administrateurs ne voient plus tout : seulement `'tous'`, `'admin'` et les entrées de leur propre rôle. Une entrée sans `pour` n'est montrée à personne ;
- pas d'entrée pour une correction interne sans effet visible ;
- sur une autre branche que `main`, vérifier que la constante `BRANCHE` correspond à la branche.
