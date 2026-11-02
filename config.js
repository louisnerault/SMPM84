// URL de déploiement de la Web App Google Apps Script (se termine par /exec)
// https://script.google.com/macros/s/AKfycbzOoejS1S1AZjHTa8Vw6iUFD4naaDHY51QtB-gNhFEg4AXqtouLvQ8owEbw-Z3dGj7-/exec
window.SMPM_CONFIG = {
  // Carte IGN SCAN 25 (1:25 000) : diffusée par la Géoplateforme sur un accès « privé » qui demande une clé.
  // « ign_scan_ws » est la clé générique communiquée par IGN (transitoire) : la remplacer par la clé du SDIS 84
  // créée sur cartes.gouv.fr dès qu'elle existe. Clé visible dans le navigateur : ce n'est pas un secret.
  IGN_SCAN_KEY: 'ign_scan_ws',
  API_URL: 'https://script.google.com/macros/s/AKfycbzOoejS1S1AZjHTa8Vw6iUFD4naaDHY51QtB-gNhFEg4AXqtouLvQ8owEbw-Z3dGj7-/exec',
  // Notifications push (Firebase Cloud Messaging) : valeurs publiques de l'application web Firebase
  // (Paramètres du projet > Général > Vos applications) et clé VAPID publique (Cloud Messaging >
  // Certificats Web Push). Laisser vide : les notifications push restent masquées dans l'application.
  // La clé privée du compte de service n'est JAMAIS ici : elle est dans les propriétés du script Apps Script.
  FIREBASE: {
    apiKey: 'AIzaSyBfjRdrYdZH9TxLMN-8PxGWkOnW_ooAUI8',
    authDomain: 'webappsmpm84.firebaseapp.com',
    projectId: 'webappsmpm84',
    messagingSenderId: '417173282740',
    appId: '1:417173282740:web:766ffea19488cd7c921ce1',
    vapidKey: 'BNMEtPl5SjoKwMD8E9bF8X0z6k9W3jiGf8RBBcd6yrnNoCD4Uwx4M4rjOiJDsVVLEIIP1aQdaowW2XMGhCOma0Y',
  },
};

// Fonds de carte communs (poi.js, fmpa.js, carte-hors-ligne.js). L'adresse d'une tuile doit être identique
// partout : c'est elle qui sert de clé au cache hors ligne (sw.js).
window.SMPM_FONDS = (() => {
  const geo = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${fmt}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  const scan = () => `https://data.geopf.fr/private/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&apikey=${encodeURIComponent(window.SMPM_CONFIG.IGN_SCAN_KEY || '')}`;
  const ign = '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';
  const KEY = 'smpm_fond_carte';
  const liste = [
    { nom: 'Plan IGN', url: geo('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), opt: { maxZoom: 19, attribution: ign } },
    { nom: 'Carte IGN 1:25 000', url: scan(), opt: { maxZoom: 19, maxNativeZoom: 16, minZoom: 6, attribution: ign + ' SCAN 25' } },
    { nom: 'Photo aérienne', url: geo('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), opt: { maxZoom: 19, attribution: ign } },
    { nom: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
  ];
  const tuile = (nom, z, x, y) => liste.find(f => f.nom === nom).url.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  // Ajoute les fonds et le sélecteur à une carte Leaflet ; le dernier fond choisi est retenu sur l'appareil
  function ajouter(L, map) {
    const couches = {};
    liste.forEach(f => { couches[f.nom] = L.tileLayer(f.url, f.opt); });
    let choix = null;
    try { choix = localStorage.getItem(KEY); } catch (e) {}
    (couches[choix] || couches['Plan IGN']).addTo(map);
    L.control.layers(couches, null, { collapsed: true }).addTo(map);
    map.on('baselayerchange', e => { try { localStorage.setItem(KEY, e.name); } catch (err) {} });
    return couches;
  }
  return { liste, tuile, ajouter };
})();
