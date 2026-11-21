// Administration › Maintenance (administrateurs seulement).
// Met l'application en maintenance : le serveur (dépôt privé, Maintenance.gs) refuse alors toute action aux
// non-administrateurs, qui voient l'écran « Maintenance en cours » (app.js). Notification push facultative
// au début (« application indisponible ») et au retour à la normale.
// Actions serveur : maintenance_get, maintenance_set — droits contrôlés par le serveur.
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => window.SMPM_APP;
  const S = { etat: null, busy: false };
  const MESSAGE_DEFAUT = 'L’application est en cours de maintenance. Elle sera de nouveau disponible très prochainement.';

  function setState(t, err) { const p = $('#mnt-state'); p.textContent = t || ''; p.classList.toggle('error', !!err); }
  function setError(t) { $('#mnt-form .error').textContent = t || ''; }
  function dateHeure(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    const e = S.etat || { actif: false };
    const form = $('#mnt-form');
    const carte = $('#mnt-carte');
    carte.className = 'mnt-carte ' + (e.actif ? 'is-on' : 'is-off');
    carte.replaceChildren();
    const t = document.createElement('p'); t.className = 'mnt-carte-titre';
    t.textContent = e.actif ? '🛠️ Application en maintenance' : '✅ Application ouverte à tous';
    const d = document.createElement('p'); d.className = 'small';
    d.textContent = e.actif
      ? ['Depuis le ' + (dateHeure(e.depuis) || '—'), e.par ? 'par ' + e.par : '', e.notifie ? '· utilisateurs notifiés' : '· utilisateurs non notifiés'].filter(Boolean).join(' ')
      : 'Tous les membres utilisent l’application normalement.';
    carte.append(t, d);

    if (!form.dataset.touche) form.elements.message.value = e.actif ? (e.message || '') : '';
    form.elements.message.placeholder = MESSAGE_DEFAUT;
    form.elements.notifier.checked = e.actif ? e.notifie !== false : true;
    $('#mnt-notif-lib').textContent = e.actif ? 'Prévenir les utilisateurs du retour à la normale' : 'Notifier les utilisateurs';
    $('#mnt-notif-aide').textContent = e.actif
      ? 'Notification push « Application disponible » à tous les membres, et message dans leur clochette.'
      : 'Notification push à tous les membres (sauf administrateurs) : application en maintenance et indisponible pendant ce temps ; ils seront prévenus du retour à la normale.';
    const go = $('#mnt-go');
    go.textContent = e.actif ? 'Terminer la maintenance' : 'Mettre l’application en maintenance';
    go.classList.toggle('mnt-danger', !e.actif);
    $('#mnt-msg-maj').hidden = !e.actif;
  }

  async function load() {
    const a = app();
    if (!a) return;
    setState('Chargement…');
    try {
      const r = await a.api('maintenance_get', { token: a.token() });
      S.etat = r.maintenance || { actif: false };
      a.setMaintenance(S.etat);
      setState('');
      render();
    } catch (err) {
      if (a.AUTH_ERRORS.includes(err.message)) return a.logout();
      setState(err instanceof a.NetworkError ? a.netLabel() + ' : état de la maintenance indisponible.' : err.message, true);
    }
  }

  function open() {
    const e = app() && app().maintenance();
    if (e) { S.etat = e; }
    delete $('#mnt-form').dataset.touche;
    render();
    load();
  }

  async function envoyer(actif, notifier, message) {
    const a = app();
    if (S.busy) return;
    S.busy = true;
    setError('');
    const btns = [$('#mnt-go'), $('#mnt-msg-maj')];
    btns.forEach(b => { b.disabled = true; });
    setState(actif ? 'Mise en maintenance…' : 'Fin de la maintenance…');
    try {
      const r = await a.api('maintenance_set', { token: a.token(), actif, message, notifier }, { noRetry: true });
      S.etat = r.maintenance || { actif: false };
      a.setMaintenance(S.etat);
      delete $('#mnt-form').dataset.touche;
      render();
      let t = actif ? 'L’application est en maintenance : seuls les administrateurs y ont accès.' : 'Maintenance terminée : l’application est de nouveau ouverte à tous.';
      if (notifier && (r.envoyes || r.personnes)) t += ' Notification envoyée (' + r.personnes + ' personne' + (r.personnes > 1 ? 's' : '') + ', ' + r.envoyes + ' appareil' + (r.envoyes > 1 ? 's' : '') + ').';
      else if (notifier && !r.avertissement) t += ' Message ajouté à la clochette de chacun.';
      if (r.avertissement) t += ' ' + r.avertissement;
      setState(t, !!r.avertissement);
    } catch (err) {
      if (a.AUTH_ERRORS.includes(err.message)) return a.logout();
      setState('');
      setError(err instanceof a.NetworkError ? a.netLabel() + ' : réessayez quand le réseau sera disponible.' : err.message);
    } finally {
      S.busy = false;
      btns.forEach(b => { b.disabled = false; });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('#mnt-form');
    if (!form) return;
    form.elements.message.addEventListener('input', () => { form.dataset.touche = '1'; });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const actif = !(S.etat && S.etat.actif);
      const notifier = form.elements.notifier.checked;
      const message = form.elements.message.value.trim();
      const q = actif
        ? 'Mettre l’application en maintenance ?\n\nSeuls les administrateurs pourront l’utiliser ; les autres membres verront la page « Maintenance en cours »' + (notifier ? ' et recevront une notification.' : '.')
        : 'Terminer la maintenance et rouvrir l’application à tous ?' + (notifier ? '\n\nLes membres seront prévenus par notification.' : '');
      if (!confirm(q)) return;
      envoyer(actif, notifier, message);
    });
    $('#mnt-msg-maj').addEventListener('click', () => {
      envoyer(true, false, form.elements.message.value.trim());
    });
  });

  window.SMPM_MAINT = { open };
})();
