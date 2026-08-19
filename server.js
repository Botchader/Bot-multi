/**
 * ══════════════════════════════════════════════════════════════
 * 🌐 PORTAIL WEB — chaque utilisateur connecte son propre numéro
 * ══════════════════════════════════════════════════════════════
 * Aucune donnée de code n'est jamais exposée : juste un formulaire de
 * numéro + affichage du code de jumelage. Toi (le propriétaire) n'as
 * jamais besoin d'intervenir pour qu'une personne se connecte.
 */
import express from 'express';
import { startSession, getSession, listActiveSessions } from './sessionManager.js';

const PORT = process.env.PORT || 3000;

export function createServer(onMessage) {
  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connexion au bot</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 40px auto; padding: 0 16px; }
  input { width: 100%; padding: 12px; font-size: 16px; box-sizing: border-box; margin: 8px 0; }
  button { width: 100%; padding: 12px; font-size: 16px; background: #16a34a; color: white; border: none; border-radius: 6px; }
  #qrbox { text-align: center; margin: 16px 0; display: none; }
  #qrbox img { width: 240px; height: 240px; border: 8px solid white; border-radius: 8px; }
  #status { margin-top: 12px; text-align: center; color: #555; }
</style>
</head>
<body>
  <h2>🕶️ Connecte ton compte WhatsApp</h2>
  <p>Entre ton numéro avec l'indicatif pays, sans le +.<br>Ex : 22670123456</p>
  <input id="phone" type="tel" placeholder="22670123456" />
  <button onclick="register()">Obtenir mon QR code</button>
  <div id="qrbox"><img id="qrimg" alt="QR code" /></div>
  <div id="status"></div>

<script>
async function register() {
  const phone = document.getElementById('phone').value.replace(/\\D/g, '');
  const statusEl = document.getElementById('status');
  const qrbox = document.getElementById('qrbox');
  const qrimg = document.getElementById('qrimg');
  if (!/^[1-9]\\d{7,14}$/.test(phone)) {
    statusEl.textContent = '❌ Numéro invalide.';
    return;
  }
  statusEl.textContent = '⏳ Génération du QR code...';
  qrbox.style.display = 'none';
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.qrDataUrl) {
      qrimg.src = data.qrDataUrl;
      qrbox.style.display = 'block';
      statusEl.textContent = 'Ouvre WhatsApp > Appareils liés > Lier un appareil, et scanne ce QR code.';
      pollStatus(phone);
    } else {
      statusEl.textContent = data.error || '❌ Erreur inconnue.';
    }
  } catch (e) {
    statusEl.textContent = '❌ Erreur réseau, réessaie.';
  }
}

async function pollStatus(phone) {
  const statusEl = document.getElementById('status');
  const interval = setInterval(async () => {
    const res = await fetch('/api/status/' + phone);
    const data = await res.json();
    if (data.status === 'connected') {
      clearInterval(interval);
      window.location.href = '/status/' + phone;
    }
  }, 3000);
}
</script>
</body>
</html>`);
  });

  app.get('/status/:phone', (req, res) => {
    const phone = req.params.phone.replace(/\D/g, '');
    res.type('html').send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Statut de ton bot</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 40px auto; padding: 0 16px; }
  button { width: 100%; padding: 12px; font-size: 16px; background: #16a34a; color: white; border: none; border-radius: 6px; margin-top: 12px; }
  #badge { text-align: center; padding: 16px; border-radius: 8px; font-weight: bold; }
  #qrbox { text-align: center; margin: 16px 0; display: none; }
  #qrbox img { width: 240px; height: 240px; border: 8px solid white; border-radius: 8px; }
</style>
</head>
<body>
  <h2>📌 Ton bot</h2>
  <p>Garde cette page en favori — tu peux revenir ici à tout moment pour vérifier ou relancer ta connexion.</p>
  <div id="badge">⏳ Vérification...</div>
  <div id="qrbox"><img id="qrimg" alt="QR code" /></div>
  <button id="reconnectBtn" style="display:none" onclick="reconnect()">Me reconnecter</button>

<script>
const phone = '${phone}';
async function checkStatus() {
  const res = await fetch('/api/status/' + phone);
  const data = await res.json();
  const badge = document.getElementById('badge');
  const btn = document.getElementById('reconnectBtn');
  if (data.status === 'connected') {
    badge.textContent = '✅ Connecté et actif';
    badge.style.background = '#f0fdf4';
    btn.style.display = 'none';
  } else {
    badge.textContent = '⚠️ Déconnecté — reconnexion nécessaire';
    badge.style.background = '#fef2f2';
    btn.style.display = 'block';
  }
}
async function reconnect() {
  const qrbox = document.getElementById('qrbox');
  const qrimg = document.getElementById('qrimg');
  document.getElementById('badge').textContent = '⏳ Génération du QR code...';
  const res = await fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
  });
  const data = await res.json();
  if (data.qrDataUrl) {
    qrimg.src = data.qrDataUrl;
    qrbox.style.display = 'block';
    document.getElementById('badge').textContent = 'Scanne ce QR dans WhatsApp > Appareils liés > Lier un appareil';
    setTimeout(checkStatus, 5000);
  } else {
    document.getElementById('badge').textContent = data.error || '❌ Erreur, réessaie.';
  }
}
checkStatus();
setInterval(checkStatus, 10000);
</script>
</body>
</html>`);
  });

  app.post('/api/register', async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({ error: 'Numéro invalide.' });
    }
    try {
      const entry = await startSession(phone, { onMessage });
      // On attend que le QR soit genere (evenement asynchrone dans sessionManager).
      for (let i = 0; i < 20 && !entry.qrDataUrl; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!entry.qrDataUrl) {
        return res.status(504).json({ error: "Le QR code n'a pas pu être généré, réessaie." });
      }
      return res.json({ qrDataUrl: entry.qrDataUrl });
    } catch (error) {
      console.error('Erreur /api/register :', error.message);
      return res.status(500).json({ error: 'Erreur serveur, réessaie plus tard.' });
    }
  });

  app.get('/api/status/:phone', (req, res) => {
    const entry = getSession(req.params.phone);
    res.json({ status: entry?.status || 'unknown' });
  });

  // Endpoint interne simple pour le superadmin (protégé par un jeton, pas
  // exposé dans l'UI publique) — utile pour un futur dashboard.
  app.get('/api/admin/sessions', (req, res) => {
    if (req.query.token !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: 'forbidden' });
    res.json(listActiveSessions());
  });

  return app.listen(PORT, () => console.log(`🌐 Portail web sur http://0.0.0.0:${PORT}`));
}
