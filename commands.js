/**
 * ══════════════════════════════════════════════════════════════
 * 📂 COMMANDES — partagées entre toutes les sessions, mais l'ÉTAT
 * (réglages de groupe, commandes perso, utilisateurs bloqués) est
 * toujours isolé par numéro grâce à storage.js (sessions/<phone>/...).
 * ══════════════════════════════════════════════════════════════
 *
 * 👉 Pour ajouter les commandes média/IA/Brawl Stars de la version
 * précédente (video, song, sticker, translate, calc, ai, brawl, quote,
 * 8ball, joke...) : colle-les telles quelles avec registerCommand(...)
 * n'importe où dans ce fichier, avant "export const commands". Elles
 * n'ont pas besoin de changer : elles ne touchent à aucun état
 * spécifique à une session (elles ne prennent que sock/msg/args/jid).
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadJSON, saveJSON, readSessionEvents } from './storage.js';
import { listActiveSessions, stopSession, resetSession } from './sessionManager.js';

export const PREFIX = '!';
export const BOT_NAME = '𝑰𝑵𝑪𝑶𝑵𝑵𝑼𝑺';

// Numéros du SUPER propriétaire (toi) — actifs sur TOUTES les sessions,
// pas juste la tienne. Format : 22670123456@s.whatsapp.net
const SUPERADMIN_NUMBERS = (process.env.SUPERADMIN_NUMBERS || '')
  .split(',').map((n) => n.trim()).filter(Boolean);

export const commands = new Map();

export function registerCommand(name, { description = 'Aucune description', aliases = [], category = 'divers' } = {}, handler) {
  const entry = { name: name.toLowerCase(), description, category, handler };
  commands.set(entry.name, entry);
  for (const alias of aliases) commands.set(alias.toLowerCase(), entry);
}

function redactedBar() { return '▓'.repeat(24); }

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

async function sendReply(sock, jid, quotedMsg, text) {
  await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
}

function getSenderJid(sock, message) {
  if (message.key.fromMe) return (sock.user?.id?.split(':')[0] ?? '') + '@s.whatsapp.net';
  return message.key.participant || message.key.remoteJid;
}

function getTargetJid(message) {
  const content = message?.message?.extendedTextMessage?.contextInfo;
  if (content?.mentionedJid?.length) return content.mentionedJid[0];
  if (content?.participant) return content.participant;
  return null;
}

async function isGroupAdmin(sock, groupJid, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata.participants.find((p) => p.id === userJid);
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch {
    return false;
  }
}

async function requireGroupAdmin(sock, msg, jid) {
  if (!jid.endsWith('@g.us')) { await sendReply(sock, jid, msg, '⚠️ Commande valable uniquement en groupe.'); return false; }
  const senderJid = getSenderJid(sock, msg);
  if (!(await isGroupAdmin(sock, jid, senderJid))) { await sendReply(sock, jid, msg, '⛔ Réservé aux admins du groupe.'); return false; }
  return true;
}

// "Propriétaire de CETTE session" = le numéro connecté à cette session
// précise (fromMe). "Super admin" = toi, sur TOUTES les sessions.
function isSessionOwner(message) { return message.key.fromMe; }
function isSuperAdmin(sock, message) {
  const senderJid = getSenderJid(sock, message);
  return SUPERADMIN_NUMBERS.some((num) => senderJid?.startsWith(num));
}
function isOwner(sock, message) { return isSessionOwner(message) || isSuperAdmin(sock, message); }

function getSelfJid(sock) {
  const rawId = sock.user?.id || '';
  return rawId.split(':')[0].split('@')[0] + '@s.whatsapp.net';
}

// ══════════════════════════════════════════════════
// 🗂️ ÉTAT PAR SESSION — group settings, commandes perso, bloqués
// ══════════════════════════════════════════════════
function getGroupSettings(phone, jid) {
  const all = loadJSON(phone, 'group-settings.json', {});
  if (!all[jid]) all[jid] = { antilink: false, welcome: false, goodbye: false };
  return { all, settings: all[jid] };
}
function saveGroupSettings(phone, all) { saveJSON(phone, 'group-settings.json', all); }

function getBlockedUsers(phone) { return new Set(loadJSON(phone, 'blocked-users.json', [])); }
function saveBlockedUsers(phone, set) { saveJSON(phone, 'blocked-users.json', [...set]); }

function getCustomCommands(phone) { return loadJSON(phone, 'custom-commands.json', {}); }
function saveCustomCommands(phone, data) { saveJSON(phone, 'custom-commands.json', data); }

// ══════════════════════════════════════════════════
// ── PRINCIPAL ──────────────────────────────────────
// ══════════════════════════════════════════════════
registerCommand('ping', { description: 'Vérifie la latence du bot', aliases: ['p'], category: 'principal' },
  async (sock, msg, args, jid, startedAt) => {
    await sendReply(sock, jid, msg, `${redactedBar()}\n👁️ SIGNAL DÉTECTÉ\n${redactedBar()}\n\n⚡ Latence : ${Date.now() - startedAt} ms\n🕓 En poste : ${formatUptime(process.uptime())}`);
  }
);

registerCommand('menu', { description: 'Affiche le dossier des commandes', aliases: ['help', 'aide'], category: 'principal' },
  async (sock, msg, args, jid) => {
    const seen = new Set();
    const byCategory = new Map();
    for (const cmd of commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
      byCategory.get(cmd.category).push(cmd);
    }
    let text = `${redactedBar()}\n🕶️ DOSSIER ${BOT_NAME}\n${redactedBar()}\n\n`;
    for (const [category, cmds] of byCategory) {
      text += `┌─ ${category.toUpperCase()}\n`;
      for (const cmd of cmds) text += `│ ▸ ${PREFIX}${cmd.name} — ${cmd.description}\n`;
      text += `└${'─'.repeat(20)}\n\n`;
    }
    await sendReply(sock, jid, msg, text.trim());
  }
);

registerCommand('report', { description: 'Signale un problème au propriétaire du bot : !report <message>', category: 'principal' },
  async (sock, msg, args, jid) => {
    const text = args.join(' ');
    if (!text) { await sendReply(sock, jid, msg, `Usage : ${PREFIX}report <ton message>`); return; }
    const senderJid = getSenderJid(sock, msg);
    await sock.sendMessage(getSelfJid(sock), {
      text: `${redactedBar()}\n📬 SIGNALEMENT\n${redactedBar()}\n\n👤 De : ${senderJid.split('@')[0]}\n📍 ${jid.endsWith('@g.us') ? 'Groupe' : 'Privé'}\n\n💬 ${text}`
    });
    await sendReply(sock, jid, msg, '✅ Signalement envoyé, merci !');
  }
);

// ══════════════════════════════════════════════════
// ── GROUPE (admin du groupe) ───────────────────────
// ══════════════════════════════════════════════════
registerCommand('tagall', { description: 'Mentionne tous les membres (admin)', aliases: ['everyone'], category: 'groupe' },
  async (sock, msg, args, jid) => {
    if (!(await requireGroupAdmin(sock, msg, jid))) return;
    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants.map((p) => p.id);
    const text = `${redactedBar()}\n📢 APPEL GÉNÉRAL\n${redactedBar()}\n\n` + participants.map((p) => `@${p.split('@')[0]}`).join(' ');
    await sock.sendMessage(jid, { text, mentions: participants }, { quoted: msg });
  }
);

registerCommand('kick', { description: 'Expulse un membre mentionné/répondu (admin)', category: 'groupe' },
  async (sock, msg, args, jid) => {
    if (!(await requireGroupAdmin(sock, msg, jid))) return;
    const target = getTargetJid(msg);
    if (!target) { await sendReply(sock, jid, msg, '⚠️ Mentionne ou réponds au membre.'); return; }
    await sock.groupParticipantsUpdate(jid, [target], 'remove');
    await sendReply(sock, jid, msg, `${redactedBar()}\n🚫 MEMBRE EXPULSÉ\n${redactedBar()}`);
  }
);

registerCommand('promote', { description: 'Promeut un membre admin (admin)', category: 'groupe' },
  async (sock, msg, args, jid) => {
    if (!(await requireGroupAdmin(sock, msg, jid))) return;
    const target = getTargetJid(msg);
    if (!target) { await sendReply(sock, jid, msg, '⚠️ Mentionne ou réponds au membre.'); return; }
    await sock.groupParticipantsUpdate(jid, [target], 'promote');
    await sendReply(sock, jid, msg, `${redactedBar()}\n⬆️ PROMU ADMIN\n${redactedBar()}`);
  }
);

registerCommand('demote', { description: 'Retire les droits admin (admin)', category: 'groupe' },
  async (sock, msg, args, jid) => {
    if (!(await requireGroupAdmin(sock, msg, jid))) return;
    const target = getTargetJid(msg);
    if (!target) { await sendReply(sock, jid, msg, '⚠️ Mentionne ou réponds au membre.'); return; }
    await sock.groupParticipantsUpdate(jid, [target], 'demote');
    await sendReply(sock, jid, msg, `${redactedBar()}\n⬇️ DROITS RETIRÉS\n${redactedBar()}`);
  }
);

function toggleSetting(key, label) {
  return async (sock, msg, args, jid, startedAt, phone) => {
    if (!(await requireGroupAdmin(sock, msg, jid))) return;
    const mode = (args[0] || '').toLowerCase();
    if (mode !== 'on' && mode !== 'off') { await sendReply(sock, jid, msg, `Usage : ${PREFIX}${key} on|off`); return; }
    const { all, settings } = getGroupSettings(phone, jid);
    settings[key] = mode === 'on';
    saveGroupSettings(phone, all);
    await sendReply(sock, jid, msg, `${redactedBar()}\n${label} ${settings[key] ? 'ACTIVÉ' : 'DÉSACTIVÉ'}\n${redactedBar()}`);
  };
}
registerCommand('antilink', { description: 'Supprime auto les liens : !antilink on|off (admin)', category: 'groupe' }, toggleSetting('antilink', '🔗 ANTILINK'));
registerCommand('welcome', { description: 'Message de bienvenue : !welcome on|off (admin)', category: 'groupe' }, toggleSetting('welcome', '👋 BIENVENUE'));
registerCommand('goodbye', { description: 'Message de départ : !goodbye on|off (admin)', category: 'groupe' }, toggleSetting('goodbye', '📤 DÉPART'));

// ══════════════════════════════════════════════════
// ── ADMINISTRATION (propriétaire de la session) ────
// ══════════════════════════════════════════════════
const RESERVED_NAMES = new Set(['addcmd', 'delcmd', 'admin', 'superadmin']);

registerCommand('addcmd', { description: 'Ajoute une commande perso (propriétaire) : !addcmd <nom> <réponse>', category: 'administration' },
  async (sock, msg, args, jid, startedAt, phone) => {
    if (!isOwner(sock, msg)) { await sendReply(sock, jid, msg, '⛔ Réservé au propriétaire.'); return; }
    const name = (args[0] || '').toLowerCase();
    const responseText = args.slice(1).join(' ');
    if (!name || !responseText) { await sendReply(sock, jid, msg, `Usage : ${PREFIX}addcmd <nom> <réponse>`); return; }
    if (!/^[a-z0-9_-]{2,20}$/.test(name) || RESERVED_NAMES.has(name)) { await sendReply(sock, jid, msg, '⚠️ Nom invalide ou réservé.'); return; }
    const custom = getCustomCommands(phone);
    custom[name] = { response: responseText, addedAt: new Date().toISOString() };
    saveCustomCommands(phone, custom);
    await sendReply(sock, jid, msg, `${redactedBar()}\n✅ COMMANDE AJOUTÉE : ${PREFIX}${name}\n${redactedBar()}`);
  }
);

registerCommand('delcmd', { description: 'Supprime une commande perso (propriétaire) : !delcmd <nom>', category: 'administration' },
  async (sock, msg, args, jid, startedAt, phone) => {
    if (!isOwner(sock, msg)) { await sendReply(sock, jid, msg, '⛔ Réservé au propriétaire.'); return; }
    const name = (args[0] || '').toLowerCase();
    const custom = getCustomCommands(phone);
    if (!custom[name]) { await sendReply(sock, jid, msg, `⚠️ Aucune commande perso "${name}".`); return; }
    delete custom[name];
    saveCustomCommands(phone, custom);
    await sendReply(sock, jid, msg, `${redactedBar()}\n🗑️ SUPPRIMÉE : ${PREFIX}${name}\n${redactedBar()}`);
  }
);

registerCommand('admin', {
  description: 'Panneau admin de TON bot (propriétaire) : stats | broadcast <texte> | block <num> | unblock <num> | blocked',
  aliases: ['sudo'],
  category: 'administration'
},
  async (sock, msg, args, jid, startedAt, phone) => {
    if (!isOwner(sock, msg)) { await sendReply(sock, jid, msg, '⛔ Réservé au propriétaire.'); return; }
    const sub = (args[0] || 'stats').toLowerCase();

    if (sub === 'stats') {
      const mem = process.memoryUsage();
      const custom = getCustomCommands(phone);
      const blocked = getBlockedUsers(phone);
      const text = `${redactedBar()}\n👑 TON BOT\n${redactedBar()}\n\n` +
        ` 📱 Numéro : ${phone}\n` +
        ` 🕓 En ligne (process) : ${formatUptime(process.uptime())}\n` +
        ` 💾 RAM (process) : ${(mem.rss / 1024 / 1024).toFixed(1)} Mo\n` +
        ` 🧩 Commandes perso : ${Object.keys(custom).length}\n` +
        ` 🚫 Utilisateurs bloqués : ${blocked.size}`;
      await sendReply(sock, jid, msg, text);
      return;
    }

    if (sub === 'broadcast') {
      const text = args.slice(1).join(' ');
      if (!text) { await sendReply(sock, jid, msg, `Usage : ${PREFIX}admin broadcast <message>`); return; }
      const allGroups = await sock.groupFetchAllParticipating();
      let sent = 0;
      for (const gid of Object.keys(allGroups)) {
        try { await sock.sendMessage(gid, { text: `${redactedBar()}\n📢 ANNONCE\n${redactedBar()}\n\n${text}` }); sent += 1; await new Promise((r) => setTimeout(r, 300)); }
        catch (error) { console.error(`Broadcast échoué ${gid} :`, error.message); }
      }
      await sendReply(sock, jid, msg, `✅ Envoyé à ${sent} groupe(s).`);
      return;
    }

    if (sub === 'block' || sub === 'unblock') {
      const target = getTargetJid(msg) || (args[1] ? `${args[1].replace(/\D/g, '')}@s.whatsapp.net` : null);
      if (!target) { await sendReply(sock, jid, msg, `Usage : ${PREFIX}admin ${sub} <numéro ou réponds au message>`); return; }
      const blocked = getBlockedUsers(phone);
      if (sub === 'block') blocked.add(target); else blocked.delete(target);
      saveBlockedUsers(phone, blocked);
      await sendReply(sock, jid, msg, `${sub === 'block' ? '🚫 Bloqué' : '✅ Débloqué'} : ${target.split('@')[0]}`);
      return;
    }

    if (sub === 'blocked') {
      const blocked = getBlockedUsers(phone);
      await sendReply(sock, jid, msg, blocked.size ? [...blocked].map((u) => `▸ ${u.split('@')[0]}`).join('\n') : 'Aucun utilisateur bloqué.');
      return;
    }

    await sendReply(sock, jid, msg, '⚠️ Sous-commande inconnue : stats, broadcast, block, unblock, blocked.');
  }
);

// ══════════════════════════════════════════════════
// ── SUPER ADMIN (toi uniquement, sur TOUTES les sessions) ──
// ══════════════════════════════════════════════════
registerCommand('superadmin', {
  description: 'Panneau global (toi uniquement) : sessions | events | kill <numéro> | reset <numéro>',
  aliases: ['sa'],
  category: 'administration'
},
  async (sock, msg, args, jid) => {
    if (!isSuperAdmin(sock, msg)) { await sendReply(sock, jid, msg, '⛔ Réservé au super admin.'); return; }
    const sub = (args[0] || 'sessions').toLowerCase();

    if (sub === 'sessions') {
      const list = listActiveSessions();
      const text = list.length
        ? list.map((s) => `▸ ${s.phone} — ${s.status}`).join('\n')
        : 'Aucune session active.';
      await sendReply(sock, jid, msg, `${redactedBar()}\n🌍 SESSIONS ACTIVES (${list.length})\n${redactedBar()}\n\n${text}`);
      return;
    }

    if (sub === 'events') {
      const events = readSessionEvents(15);
      const text = events.length
        ? events.map((e) => `▸ [${e.at.slice(0, 16).replace('T', ' ')}] ${e.phone} — ${e.type}`).join('\n')
        : 'Aucun événement récent.';
      await sendReply(sock, jid, msg, `${redactedBar()}\n📜 DERNIERS ÉVÉNEMENTS\n${redactedBar()}\n\n${text}`);
      return;
    }

    if (sub === 'kill' || sub === 'reset') {
      const target = (args[1] || '').replace(/\D/g, '');
      if (!target) { await sendReply(sock, jid, msg, `Usage : ${PREFIX}superadmin ${sub} <numéro>`); return; }
      if (sub === 'kill') await stopSession(target);
      else await resetSession(target);
      await sendReply(sock, jid, msg, `✅ Session ${target} ${sub === 'kill' ? 'arrêtée' : 'réinitialisée'}.`);
      return;
    }

    await sendReply(sock, jid, msg, '⚠️ Sous-commande inconnue : sessions, events, kill, reset.');
  }
);

// ══════════════════════════════════════════════════
// 📩 TRAITEMENT D'UN MESSAGE — factory branchée par session
// ══════════════════════════════════════════════════
function unwrapMessageContent(content) {
  let current = content;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current.ephemeralMessage?.message) { current = current.ephemeralMessage.message; continue; }
    if (current.viewOnceMessage?.message) { current = current.viewOnceMessage.message; continue; }
    if (current.viewOnceMessageV2?.message) { current = current.viewOnceMessageV2.message; continue; }
    break;
  }
  return current;
}
function extractText(message) {
  const content = unwrapMessageContent(message?.message);
  if (!content) return '';
  return content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || '';
}

export async function handleIncomingMessage(sock, message, phone) {
  const jid = message?.key?.remoteJid;
  if (!jid || jid === 'status@broadcast' || !message?.message) return;

  if (!isOwner(sock, message)) {
    const senderJid = getSenderJid(sock, message);
    if (getBlockedUsers(phone).has(senderJid)) return;
  }

  const text = extractText(message);
  if (!text.startsWith(PREFIX)) return;
  const body = text.slice(PREFIX.length).trim();
  if (!body) return;

  const [commandName, ...args] = body.split(/\s+/);
  let command = commands.get(commandName.toLowerCase());

  if (!command) {
    const custom = getCustomCommands(phone)[commandName.toLowerCase()];
    if (custom) {
      await sendReply(sock, jid, message, custom.response.replaceAll('{args}', args.join(' ')));
      return;
    }
    return;
  }

  const startedAt = Date.now();
  try {
    await command.handler(sock, message, args, jid, startedAt, phone);
  } catch (error) {
    console.error(`❌ Erreur commande [${commandName}] (${phone}) :`, error.message);
    await sock.sendMessage(jid, { text: `❌ Erreur lors de l'exécution de *${commandName}*.` }).catch(() => {});
  }
}
