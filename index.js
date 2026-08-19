/**
 * ══════════════════════════════════════════════════════════════
 * 🚀 LANCEMENT — bot WhatsApp multi-utilisateurs
 * ══════════════════════════════════════════════════════════════
 * Variables d'environnement attendues (fichier .env ou config Fly.io) :
 *   SUPERADMIN_NUMBERS   ex: "22670123456"  (toi, sans le +, sans @s...)
 *   PORT                 (optionnel, 3000 par défaut)
 *   AI_API_KEY, BRAWLSTARS_API_KEY  (optionnels, si tu réactives ces commandes)
 */
import { createServer } from './server.js';
import { restoreKnownSessions, setOwnerNotifier, getSession } from './sessionManager.js';
import { handleIncomingMessage } from './commands.js';

// Filet de sécurité : une erreur non gérée ne doit pas tuer le process en
// silence (ce qui couperait le portail ET toutes les sessions actives).
// Le superviseur (start.sh) relance quand même en dernier recours si le
// process finit par s'arrêter malgré tout.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 Promesse rejetée non gérée :', reason);
});
process.on('uncaughtException', (error) => {
  console.error('🔥 Exception non gérée :', error);
});

const SUPERADMIN_NUMBERS = (process.env.SUPERADMIN_NUMBERS || '').split(',').map((n) => n.trim()).filter(Boolean);

// Pour t'envoyer les notifications (Bad MAC, logout, nouvelle connexion...),
// on utilise TA propre session si elle est connectée. Assure-toi de
// connecter ton propre numéro via le portail au moins une fois.
setOwnerNotifier(async (text) => {
  for (const num of SUPERADMIN_NUMBERS) {
    const entry = getSession(num);
    if (entry?.sock && entry.status === 'connected') {
      await entry.sock.sendMessage(`${num}@s.whatsapp.net`, { text });
      return;
    }
  }
  // Si aucune session admin n'est connectée, on se contente du log console
  // (déjà fait dans sessionManager) — pas d'erreur bloquante.
});

console.log('🕶️ Démarrage du bot multi-utilisateurs...');
createServer(handleIncomingMessage);
restoreKnownSessions(handleIncomingMessage);
console.log('✅ Portail prêt. Les sessions existantes sont en cours de restauration.');
