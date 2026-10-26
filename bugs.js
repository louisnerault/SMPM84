// Signaler un problème (menu, tous les membres). Envoi au serveur (backend/Bugs.gs, action bug_report) :
// ligne dans le classeur de suivi, mail et notification push à l'administrateur.
// Sans réseau : le signalement est gardé sur l'appareil et envoyé au retour de la connexion.
(() => {
  'use strict';

  const KEY_QUEUE = 'smpm_bug_queue';
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = () => window.SMPM_APP;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY_QUEUE) || '[]'); } catch (e) { return []; } },
    set(q) { try { if (q.length) localStorage.setItem(KEY_QUEUE, JSON.stringify(q)); else localStorage.removeItem(KEY_QUEUE); } catch (e) {} },
  };
  const RUBRIQUES = {
    livret: 'Mon livret', 'livret-remplir': 'Mon livret', 'livret-themes': 'Mon livret',
    fmpa: 'FMPA', 'fmpa-fiche': 'FMPA', 'fmpa-mes': 'FMPA', 'fmpa-toutes': 'FMPA', 'fmpa-valid': 'Validation des livrets',
    'interv-new': 'Intervention', 'interv-fiche': 'Intervention', 'interv-mes': 'Intervention', 'interv-toutes': 'Intervention',
    accueil: 'Mode intervention / annuaire', annuaire: 'Annuaire des spécialistes',
    fiches: 'Fiches techniques (FTE)', notices: 'Notices', infos: 'Mon profil',
    'cs-heures': 'Rubriques chefs de section', 'cs-heures-toutes': 'Rubriques chefs de section', 'cs-tableau': 'Rubriques chefs de section', 'cs-specialistes': 'Mes spécialistes (gestion du personnel)',
  };
  let prev = '';
  let busy = false;

  const form = () => $('#form-bug');
  function msg(err, ok) {
    $('.error', form()).textContent = err || '';
    $('.ok', form()).textContent = ok || '';
  }

  function open(prevPage) {
    prev = prevPage || '';
    msg('', '');
    const sel = form().elements.rubrique;
    if (RUBRIQUES[prev] && !form().elements.description.value) sel.value = RUBRIQUES[prev];
    flush();
  }

  const id = () => 'bug-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  async function envoyer(item) {
    return app().api('bug_report', { token: app().token(), bug: item.bug, submission_id: item.id });
  }

  /** Envoie les signalements gardés hors ligne. */
  async function flush() {
    if (busy || !navigator.onLine || !app() || !app().token()) return;
    const q = store.get();
    if (!q.length) return;
    busy = true;
    try {
      while (q.length) {
        try { await envoyer(q[0]); } catch (e) {
          if (e instanceof app().NetworkError) break;
          // erreur définitive (installation serveur absente…) : on garde pour plus tard
          break;
        }
        q.shift();
        store.set(q);
      }
    } finally { busy = false; }
  }

  async function submit(ev) {
    ev.preventDefault();
    const f = form();
    const description = f.elements.description.value.trim();
    if (description.length < 5) { msg('Décrivez le problème en quelques mots.'); return; }
    const vEl = document.getElementById('app-version');
    const item = {
      id: id(),
      bug: {
        rubrique: f.elements.rubrique.value,
        gravite: f.elements.gravite.value,
        description,
        page: prev,
        version: vEl ? vEl.textContent.trim() : '',
        appareil: navigator.userAgent + ' · ' + window.innerWidth + '×' + window.innerHeight,
      },
    };
    const btn = $('#btn-bug');
    btn.disabled = true;
    msg('', '');
    try {
      const r = await envoyer(item);
      f.reset();
      msg('', `Merci ! Signalement n°${r.numero} transmis à l'administrateur.`);
    } catch (e) {
      if (e instanceof app().NetworkError) {
        const q = store.get(); q.push(item); store.set(q);
        f.reset();
        msg('', 'Pas de réseau : le signalement est gardé sur cet appareil et sera envoyé au retour de la connexion.');
      } else if ((app().AUTH_ERRORS || []).includes(e.message)) {
        app().logout();
      } else {
        msg(e.message || 'Envoi impossible');
      }
    } finally { btn.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', () => { if (form()) form().addEventListener('submit', submit); });
  if (document.readyState !== 'loading' && form()) form().addEventListener('submit', submit);
  window.addEventListener('online', () => setTimeout(flush, 3000));
  setTimeout(flush, 5000);

  window.SMPM_BUGS = { open, flush };
})();
