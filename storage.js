/**
 * ══════════════════════════════════════════════════════════════
 * 📂 STORAGE — persistance JSON isolée par session (par utilisateur)
 * ══════════════════════════════════════════════════════════════
 * Chaque utilisateur a son propre dossier : sessions/<phone>/
 *   sessions/<phone>/auth/              → creds Baileys (géré par la lib)
 *   sessions/<phone>/group-settings.json
 *   sessions/<phone>/custom-commands.json
 *   sessions/<phone>/blocked-users.json
 *
 * Ça garantit qu'un utilisateur ne peut jamais voir ou modifier les
 * réglages/groupes/commandes perso d'un autre utilisateur.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SESSIONS_ROOT = path.join(process.cwd(), 'sessions');

export function sessionDir(phone) {
  return path.join(SESSIONS_ROOT, phone);
}

export function authDir(phone) {
  return path.join(sessionDir(phone), 'auth');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadJSON(phone, filename, fallback) {
  try {
    const raw = fs.readFileSync(path.join(sessionDir(phone), filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(phone, filename, data) {
  ensureDir(sessionDir(phone));
  try {
    fs.writeFileSync(path.join(sessionDir(phone), filename), JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`⚠️ Sauvegarde ${filename} (${phone}) échouée :`, error.message);
    return false;
  }
}

export function deleteSessionAuth(phone) {
  try {
    fs.rmSync(authDir(phone), { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`⚠️ Suppression session auth (${phone}) échouée :`, error.message);
    return false;
  }
}

export function listKnownSessions() {
  ensureDir(SESSIONS_ROOT);
  return fs.readdirSync(SESSIONS_ROOT).filter((name) => {
    return fs.existsSync(path.join(SESSIONS_ROOT, name, 'auth'));
  });
}

// ── LOGS D'ÉVÉNEMENTS (Bad MAC, reset, déconnexion) ─────────
const EVENT_LOG_PATH = path.join(process.cwd(), 'session-events.json');

export function logSessionEvent(phone, type, details = {}) {
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(EVENT_LOG_PATH, 'utf8'));
  } catch {
    log = [];
  }
  log.push({ phone, type, details, at: new Date().toISOString() });
  if (log.length > 500) log = log.slice(-500); // garde les 500 derniers événements
  try {
    fs.writeFileSync(EVENT_LOG_PATH, JSON.stringify(log, null, 2));
  } catch (error) {
    console.error('⚠️ Écriture du journal des sessions échouée :', error.message);
  }
}

export function readSessionEvents(limit = 20) {
  try {
    const log = JSON.parse(fs.readFileSync(EVENT_LOG_PATH, 'utf8'));
    return log.slice(-limit).reverse();
  } catch {
    return [];
  }
}
