/**
 * ══════════════════════════════════════════════════════════════
 * 🧠 SESSION MANAGER — une session WhatsApp par numéro, en parallèle
 * ══════════════════════════════════════════════════════════════
 * - Chaque utilisateur a sa propre connexion Baileys + son propre dossier
 *   d'authentification (sessions/<phone>/auth), donc son propre fromMe,
 *   ses propres groupes, ses propres réglages.
 * - Détecte les erreurs "Bad MAC" (désync du chiffrement Signal) et
 *   réinitialise UNIQUEMENT la session concernée, sans toucher aux autres.
 * - Prévient automatiquement le propriétaire (toi) à chaque événement
 *   important : connexion, déconnexion, reset, logout.
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { authDir, deleteSessionAuth, logSessionEvent, listKnownSessions } from './storage.js';

const BAD_MAC_THRESHOLD = 3;       // nb d'erreurs Bad MAC avant reset
const BAD_MAC_WINDOW_MS = 60_000;  // ...dans cette fenêtre de temps
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;

const sessions = new Map(); // phone -> entry

let notifyOwnerFn = null;
export function setOwnerNotifier(fn) { notifyOwnerFn = fn; }

async function notifyOwner(text) {
  console.log('👑 [NOTIF OWNER]', text.replace(/\n/g, ' | '));
  if (notifyOwnerFn) {
    try { await notifyOwnerFn(text); } catch (error) { console.error('⚠️ Notification owner échouée :', error.message); }
  }
}

/**
 * Logger pino "espion" : ne change rien au comportement normal, mais
 * inspecte chaque ligne de log d'erreur pour repérer un Bad MAC.
 * NOTE : le texte exact loggué par Baileys peut varier selon les versions —
 * si le reset ne se déclenche jamais alors que tu VOIS "Bad MAC" dans tes
 * logs, élargis le regex ci-dessous avec le message exact observé.
 */
function makeSessionLogger(onBadMac) {
  const stream = {
    write(chunk) {
      try {
        const line = JSON.parse(chunk);
        const text = `${line?.msg ?? ''} ${line?.err?.message ?? ''}`;
        if (/bad mac|failed to decrypt|mac verification|invalid mac/i.test(text)) {
          onBadMac();
        }
      } catch {
        // ligne non-JSON, on ignore
      }
    }
  };
  return pino({ level: 'error' }, stream);
}

export function getSession(phone) {
  return sessions.get(phone);
}

export function listActiveSessions() {
  return [...sessions.entries()].map(([phone, s]) => ({ phone, status: s.status }));
}

export async function startSession(phone, { onQrCode, onMessage } = {}) {
  const existing = sessions.get(phone);
  if (existing && existing.status !== 'stopped') return existing;

  const entry = {
    sock: null,
    status: 'connecting',
    badMacTimestamps: [],
    reconnectAttempts: 0,
    reconnectTimer: null,
    qrDataUrl: null,
    stopped: false
  };
  sessions.set(phone, entry);

  async function connect() {
    if (entry.stopped) return;

    const { state, saveCreds } = await useMultiFileAuthState(authDir(phone));
    // fetchLatestBaileysVersion() interroge GitHub pour la derniere version du
    // protocole WhatsApp. Si ca echoue (reseau instable), on retombe sur une
    // version fixe recente plutot que de planter — une version trop vieille
    // peut faire fermer la connexion immediatement par les serveurs WhatsApp.
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (error) {
      console.error(`⚠️ fetchLatestBaileysVersion a échoué (${phone}), utilisation de la version de secours :`, error.message);
      version = [2, 3000, 1023223821];
    }

    const onBadMac = () => {
      const now = Date.now();
      entry.badMacTimestamps.push(now);
      entry.badMacTimestamps = entry.badMacTimestamps.filter((t) => now - t < BAD_MAC_WINDOW_MS);
      if (entry.badMacTimestamps.length >= BAD_MAC_THRESHOLD) {
        console.error(`🛑 Bad MAC répété pour ${phone} — reset de cette session uniquement.`);
        logSessionEvent(phone, 'bad_mac_reset', { count: entry.badMacTimestamps.length });
        notifyOwner(
          `⚠️ SESSION RÉINITIALISÉE\n👤 ${phone}\n🔎 Bad MAC détecté (${entry.badMacTimestamps.length} erreurs en 1 min)\n🔁 Session supprimée — l'utilisateur doit repasser par le portail pour un nouveau pairing.`
        );
        resetSession(phone).catch((error) => console.error(`Erreur reset ${phone} :`, error.message));
      }
    };

    const logger = makeSessionLogger(onBadMac);

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      // ⚠️ Ne PAS mettre un nom de navigateur personnalise ici — plusieurs
      // rapports recents (issues Baileys #2008, #2370...) montrent que ca
      // declenche un rejet "401/405 Connection Failure" cote WhatsApp lors
      // du pairing. On utilise une combinaison standard connue pour marcher.
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60_000,
      // undefined (pas un nombre) — un timeout numérique ici coupe souvent
      // la requête de pairing code avant qu'elle n'aboutisse.
      defaultQueryTimeoutMs: undefined,
      keepAliveIntervalMs: 20_000
    });

    entry.sock = sock;

    sock.ev.on('creds.update', async () => {
      try { await saveCreds(); } catch (error) { console.error(`⚠️ saveCreds ${phone} :`, error.message); }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (update.qr && !entry.qrDataUrl) {
        try {
          entry.qrDataUrl = await QRCode.toDataURL(update.qr);
          console.log(`🔳 QR code généré pour ${phone}.`);
          onQrCode?.(entry.qrDataUrl);
        } catch (error) {
          console.error(`❌ Génération du QR échouée pour ${phone} :`, error.message);
        }
      }

      if (connection === 'open') {
        entry.status = 'connected';
        entry.reconnectAttempts = 0;
        logSessionEvent(phone, 'connected');
        console.log(`✅ Session ${phone} connectée.`);
        notifyOwner(`✅ Nouvelle session connectée : ${phone}`);
        return;
      }

      if (connection !== 'close') return;

      const code = lastDisconnect?.error?.output?.statusCode;
      entry.status = 'disconnected';
      console.error(`🔌 Connexion fermée (${phone}) — code ${code ?? 'inconnu'} :`, lastDisconnect?.error?.message ?? '(pas de détail)');

      // Code 515 "restart required" est un signal NORMAL de WhatsApp juste
      // apres un scan QR reussi — il faut juste reconnecter normalement,
      // surtout pas effacer la session (sinon on efface au moment exact ou
      // ca allait marcher).
      if (code === DisconnectReason.restartRequired) {
        console.log(`🔁 Redémarrage demandé par WhatsApp (${phone}) — reconnexion normale, pairing en cours de finalisation.`);
        connect().catch((error) => console.error(`Erreur reconnexion ${phone} :`, error.message));
        return;
      }

      // Si le pairing n'a JAMAIS abouti (creds.registered === false) et que la
      // connexion se ferme quand meme (hors restart required, deja traite
      // au-dessus), les fichiers de session sont probablement corrompus ou
      // partiels — reboucler dessus echouerait a l'identique en boucle.
      // On efface et on force un nouveau pairing propre.
      if (!state.creds.registered) {
        console.error(`🧹 Pairing jamais abouti pour ${phone} (code ${code ?? 'inconnu'}) — session effacée, réessaie depuis le portail.`);
        logSessionEvent(phone, 'pairing_failed_reset', { code });
        await resetSession(phone);
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        logSessionEvent(phone, 'logged_out');
        notifyOwner(`🚪 Session déconnectée (logout WhatsApp) : ${phone}`);
        await stopSession(phone);
        return;
      }

      if (entry.stopped) return;

      entry.reconnectAttempts += 1;
      if (entry.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        logSessionEvent(phone, 'max_reconnect_reached');
        notifyOwner(`🛑 Session ${phone} : trop de tentatives de reconnexion, abandon.`);
        await stopSession(phone);
        return;
      }

      const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** (entry.reconnectAttempts - 1)), RECONNECT_MAX_DELAY_MS);
      entry.reconnectTimer = setTimeout(() => {
        connect().catch((error) => console.error(`Erreur reconnexion ${phone} :`, error.message));
      }, delay);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) {
        try {
          await onMessage?.(sock, message, phone);
        } catch (error) {
          console.error(`❌ Erreur traitement message (${phone}) :`, error.message);
        }
      }
    });
  }

  await connect();
  return entry;
}

export async function resetSession(phone) {
  const entry = sessions.get(phone);
  if (entry?.reconnectTimer) clearTimeout(entry.reconnectTimer);
  try { entry?.sock?.ws?.close(); } catch { /* déjà fermé */ }
  deleteSessionAuth(phone);
  sessions.delete(phone);
  // Ne relance pas automatiquement : l'utilisateur doit repasser par le
  // portail pour un nouveau pairing. Ça évite une boucle infinie si le
  // souci vient d'ailleurs (ex. deux connexions actives en même temps).
}

export async function stopSession(phone) {
  const entry = sessions.get(phone);
  if (!entry) return;
  entry.stopped = true;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  try { entry.sock?.ws?.close(); } catch { /* déjà fermé */ }
  entry.status = 'stopped';
}

/** Relance automatiquement au démarrage du serveur toutes les sessions déjà appairées. */
export function restoreKnownSessions(onMessage) {
  for (const phone of listKnownSessions()) {
    startSession(phone, { onMessage }).catch((error) => {
      console.error(`Erreur restauration session ${phone} :`, error.message);
    });
  }
}
