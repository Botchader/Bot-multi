#!/data/data/com.termux/files/usr/bin/bash
# ══════════════════════════════════════════════════════════════
# 🛡️ SUPERVISEUR — relance automatiquement le bot s'il plante
# ══════════════════════════════════════════════════════════════
# Usage : SUPERADMIN_NUMBERS=tonNumero ./start.sh
# (sur un vrai VPS/Fly.io, remplace le shebang par #!/usr/bin/env bash)
#
# Sans ce script, un crash de "node index.js" arrête tout —
# le portail ET toutes les sessions utilisateurs — sans que
# personne (toi y compris) ne puisse le relancer à distance.

echo "🛡️ Superviseur démarré — le bot sera relancé automatiquement s'il plante."

while true; do
  node index.js
  EXIT_CODE=$?
  echo ""
  echo "⚠️ Le bot s'est arrêté (code $EXIT_CODE). Relance dans 5 secondes..."
  echo "   (Ctrl+C deux fois rapidement pour arrêter complètement le superviseur)"
  sleep 5
done
