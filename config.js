// URL de déploiement de la Web App Google Apps Script (se termine par /exec)
// https://script.google.com/macros/s/AKfycbzOoejS1S1AZjHTa8Vw6iUFD4naaDHY51QtB-gNhFEg4AXqtouLvQ8owEbw-Z3dGj7-/exec
window.SMPM_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzOoejS1S1AZjHTa8Vw6iUFD4naaDHY51QtB-gNhFEg4AXqtouLvQ8owEbw-Z3dGj7-/exec',
  // Notifications push (Firebase Cloud Messaging) : valeurs publiques de l'application web Firebase
  // (Paramètres du projet > Général > Vos applications) et clé VAPID publique (Cloud Messaging >
  // Certificats Web Push). Laisser vide : les notifications push restent masquées dans l'application.
  // La clé privée du compte de service n'est JAMAIS ici : elle est dans les propriétés du script Apps Script.
  FIREBASE: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    messagingSenderId: '',
    appId: '',
    vapidKey: '',
  },
};
