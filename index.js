import 'dotenv/config';
import { startTelegramBridge } from './telegram-bridge.js';
import { restoreKnownSessions, setOwnerNotifier, getSession } from './sessionManager.js';
import { handleIncomingMessage } from './commands.js';

// Filet de sécurité : une erreur non gérée ne doit pas tuer le process en silence
process.on('unhandledRejection', (reason) => {
  console.error('🔥 Promesse rejetée non gérée :', reason);
});
process.on('uncaughtException', (error) => {
  console.error('🔥 Exception non gérée :', error);
});

const SUPERADMIN_NUMBERS = (process.env.SUPERADMIN_NUMBERS || '').split(',').map((n) => n.trim()).filter(Boolean);

setOwnerNotifier(async (text) => {
  for (const num of SUPERADMIN_NUMBERS) {
    const entry = getSession(num);
    if (entry?.sock && entry.status === 'connected') {
      await entry.sock.sendMessage(`${num}@s.whatsapp.net`, { text });
      return;
    }
  }
});

console.log('🕶️ Démarrage du bot multi-utilisateurs...');
startTelegramBridge(handleIncomingMessage);
restoreKnownSessions(handleIncomingMessage);
console.log('✅ Pont Telegram prêt. Les sessions existantes sont en cours de restauration.');
