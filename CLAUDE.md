# SMPM 84 — règles complémentaires pour Claude

Les consignes principales sont dans les instructions du projet Claude « Outils numérique SMPM 84 ».

## Fenêtre « Nouveautés » (`nouveautes.js`)

À chaque évolution utile à l'utilisateur, dans la même modification que l'incrément de `CACHE` dans `sw.js` :

- ajouter une entrée **en tête** de `NOUVEAUTES` dans `nouveautes.js` :
  `{ v: <nouveau numéro de CACHE>, titre: '…', texte: '…', pour: ['tous'] }`
  - `texte` : une ou deux phrases en français, du point de vue de l'utilisateur ;
  - `pour` : `'tous'` ou les rôles concernés (`equipier`, `chef_unite`, `chef_section`, `ctd`) ; les administrateurs voient tout ;
- pas d'entrée pour une correction interne sans effet visible ;
- sur une autre branche que `main`, vérifier que la constante `BRANCHE` correspond à la branche.
