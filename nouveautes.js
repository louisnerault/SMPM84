/* Fenêtre « Nouveautés » affichée à l'ouverture de l'application.
 *
 * Montre les nouveautés publiées depuis la dernière version vue par l'utilisateur (sur cet appareil),
 * filtrées selon son rôle. Un nouvel utilisateur (aucune version vue enregistrée) ne voit rien :
 * la version actuelle est simplement retenue comme point de départ.
 *
 * Chaque branche a son propre fichier : BRANCHE et NOUVEAUTES ne décrivent que ce qui est
 * en ligne sur cette branche (les versions vues sont mémorisées séparément par branche).
 *
 * Ajouter une entrée à chaque version qui apporte quelque chose d'utile à l'utilisateur :
 *   { v: 135, titre: '…', texte: '…', pour: ['tous'] }
 *   v     : numéro de version (celui de CACHE dans sw.js, smpm84-shell-vNN)
 *   pour  : 'tous' ou rôles parmi equipier, chef_unite, chef_section, ctd (les administrateurs voient tout)
 * Ne pas y mettre les corrections internes sans effet visible.
 */
(function () {
  'use strict';

  const BRANCHE = 'main';

  const NOUVEAUTES = [
    { v: 135, titre: 'GTO / GDO / GNR', texte: 'Nouvelle rubrique dans Documentation › GTO/GDO/GNR : les documents de référence GTO, GDO et GNR, avec favoris, consultables hors ligne sur smartphone.', pour: ['tous'] },
    { v: 134, titre: 'Fenêtre des nouveautés', texte: 'À chaque mise à jour, les nouveautés qui vous concernent s’affichent ici à l’ouverture de l’application.', pour: ['tous'] },
  ];

  const keyOf = user => 'smpm_nouveautes_vu_' + BRANCHE + '_' + String(user || 'anonyme').toLowerCase();
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // Version servie par le service worker (null s'il n'y en a pas encore)
  function versionCourante() {
    return new Promise(resolve => {
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!sw) return resolve(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 3000);
      ch.port1.onmessage = e => { clearTimeout(t); resolve(parseInt(e.data, 10) || null); };
      sw.postMessage('version', [ch.port2]);
    });
  }

  function concerne(n, session) {
    const pour = n.pour || ['tous'];
    if (pour.includes('tous')) return true;
    if (!session) return false;
    if (session.is_admin === true || session.admin === true || session.role === 'admin') return true;
    return pour.includes(session.role);
  }

  function afficher(liste, onClose) {
    const dlg = document.createElement('dialog');
    dlg.className = 'ann-dialog nouv-dialog';
    dlg.setAttribute('aria-labelledby', 'nouv-title');
    const h = document.createElement('h2');
    h.id = 'nouv-title';
    h.textContent = 'Nouveautés';
    const ul = document.createElement('ul');
    ul.className = 'nouv-list';
    liste.forEach(n => {
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = n.titre;
      const p = document.createElement('p');
      p.textContent = n.texte;
      const s = document.createElement('span');
      s.className = 'nouv-v';
      s.textContent = 'v' + n.v;
      li.append(b, ' ', s, p);
      ul.append(li);
    });
    const btns = document.createElement('div');
    btns.className = 'ann-dialog-btns';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'primary'; ok.textContent = 'J’ai compris';
    ok.addEventListener('click', () => dlg.close());
    btns.append(ok);
    dlg.append(h, ul, btns);
    dlg.addEventListener('close', () => { onClose(); dlg.remove(); });
    document.body.append(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  let dejaVerifie = false;
  async function verifier(session, user) {
    if (dejaVerifie) return;
    dejaVerifie = true;
    const courante = await versionCourante();
    if (!courante) return;
    const key = keyOf(user);
    const vue = parseInt(get(key), 10);
    if (!vue) { set(key, String(courante)); return; }   // première ouverture : pas d'historique
    if (vue >= courante) return;
    const liste = NOUVEAUTES
      .filter(n => n.v > vue && n.v <= courante && concerne(n, session))
      .sort((a, b) => b.v - a.v);
    if (!liste.length) { set(key, String(courante)); return; }
    afficher(liste, () => set(key, String(courante)));
  }

  window.SMPM_NOUVEAUTES = { verifier };
})();
