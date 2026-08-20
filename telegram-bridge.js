/**
 * ══════════════════════════════════════════════════════════════
 * 🤖 PONT TELEGRAM — inscription self-service SANS port web
 * ══════════════════════════════════════════════════════════════
 * Remplace server.js : au lieu d'un portail web (qui a besoin d'un
 * port entrant, bloqué sur les hébergeurs gratuits), on utilise
 * Telegram en mode "polling" — connexion 100% sortante, comme
 * WhatsApp/Baileys. Marche sur n'importe quel hébergeur gratuit.
 *
 * Flux : la personne parle au bot Telegram en privé → envoie son
 * numéro WhatsApp → reçoit le QR code en image → scanne.
 */
import TelegramBot from 'node-telegram-bot-api';
import { startSession, getSession } from './sessionManager.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Empêche de démarrer silencieusement sans token — erreur explicite plutôt
// qu'un crash cryptique de la librairie Telegram.
if (!TOKEN) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN manquant. Crée un bot via @BotFather sur Telegram, " +
    "récupère le token, et définis-le en variable d'environnement."
  );
}

const PHONE_REGEX = /^[1-9]\d{7,14}$/;

// Suit quel chat Telegram a demandé quel numéro, pour lui envoyer le QR et
// les mises à jour de statut au bon endroit (plusieurs users en parallèle).
const pendingByPhone = new Map(); // phone -> chatId
const phoneByChat = new Map();    // chatId -> phone (pour /status sans réécrire le numéro)

/** Convertit le data URL PNG (généré par sessionManager) en buffer envoyable à Telegram. */
function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Buffer.from(base64, 'base64');
}

export function startTelegramBridge(onMessage) {
  const bot = new TelegramBot(TOKEN, { polling: true });

  bot.on('polling_error', (error) => {
    // Ne fait pas planter tout le process pour une erreur réseau transitoire —
    // le mode polling réessaie tout seul.
    console.error('⚠️ Erreur polling Telegram :', error.message);
  });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      '🕶️ Envoie-moi ton numéro WhatsApp avec l\'indicatif pays, sans le +.\nEx : 22670123456'
    );
  });

  bot.onText(/\/status/, async (msg) => {
    const phone = phoneByChat.get(msg.chat.id);
    if (!phone) {
      await bot.sendMessage(msg.chat.id, "Tu n'as pas encore de session — envoie ton numéro d'abord.");
      return;
    }
    const entry = getSession(phone);
    const status = entry?.status || 'inconnu';
    const label = { connected: '✅ Connecté et actif', connecting: '⏳ Connexion en cours', disconnected: '⚠️ Déconnecté', stopped: '🛑 Arrêté' }[status] || status;
    await bot.sendMessage(msg.chat.id, `Statut : ${label}`);
  });

  bot.on('message', async (msg) => {
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // /start et /status déjà gérés au-dessus

    const phone = text.replace(/\D/g, '');
    if (!PHONE_REGEX.test(phone)) {
      await bot.sendMessage(msg.chat.id, '❌ Numéro invalide. Envoie-le avec indicatif pays, chiffres uniquement (ex : 22670123456).');
      return;
    }

    // Un même numéro déjà en cours d'inscription ailleurs (même via un
    // autre chat Telegram) → on prévient au lieu de dupliquer une session.
    const existing = getSession(phone);
    if (existing && existing.status === 'connected') {
      await bot.sendMessage(msg.chat.id, '✅ Ce numéro est déjà connecté et actif.');
      phoneByChat.set(msg.chat.id, phone);
      return;
    }
    if (pendingByPhone.has(phone) && pendingByPhone.get(phone) !== msg.chat.id) {
      await bot.sendMessage(msg.chat.id, '⏳ Une inscription pour ce numéro est déjà en cours ailleurs, patiente ou réessaie dans une minute.');
      return;
    }

    pendingByPhone.set(phone, msg.chat.id);
    phoneByChat.set(msg.chat.id, phone);
    await bot.sendMessage(msg.chat.id, '⏳ Génération du QR code...');

    try {
      const entry = await startSession(phone, { onMessage });

      // Le QR est généré de façon asynchrone dans sessionManager — on
      // attend qu'il apparaisse, avec une vraie limite pour ne jamais
      // rester bloqué en silence si ça échoue côté WhatsApp.
      for (let i = 0; i < 20 && !entry.qrDataUrl; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!entry.qrDataUrl) {
        await bot.sendMessage(msg.chat.id, "❌ Le QR code n'a pas pu être généré. Réessaie en renvoyant ton numéro.");
        pendingByPhone.delete(phone);
        return;
      }

      await bot.sendPhoto(msg.chat.id, dataUrlToBuffer(entry.qrDataUrl), {
        caption: 'Scanne ce QR dans WhatsApp > Appareils liés > Lier un appareil.'
      });

      // Suit la connexion pour prévenir automatiquement une fois scanné,
      // sans que la personne ait besoin de taper /status en boucle.
      const pollInterval = setInterval(async () => {
        const current = getSession(phone);
        if (current?.status === 'connected') {
          clearInterval(pollInterval);
          pendingByPhone.delete(phone);
          await bot.sendMessage(msg.chat.id, '✅ Connecté et actif ! Ton bot est en ligne.').catch(() => {});
        } else if (!current || current.status === 'stopped') {
          clearInterval(pollInterval);
          pendingByPhone.delete(phone);
        }
      }, 4000);
      // Ne surveille pas indéfiniment si la personne abandonne en cours de route.
      setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
    } catch (error) {
      console.error(`❌ Erreur inscription Telegram (${phone}) :`, error.message);
      await bot.sendMessage(msg.chat.id, '❌ Erreur serveur, réessaie dans un instant.');
      pendingByPhone.delete(phone);
    }
  });

  console.log('🤖 Pont Telegram démarré (mode polling, aucun port entrant nécessaire).');
  return bot;
}
