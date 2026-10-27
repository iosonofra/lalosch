#!/bin/sh
set -e

echo "============================================================"
echo "  Installazione automatica LaLosch su Alpine Linux (Proxmox)"
echo "============================================================"

# 1. Aggiorna i repository e installa Node.js, npm, git
echo "[1/4] Installazione Node.js e runtime..."
apk update
apk add --no-cache nodejs npm git curl tzdata

# 2. Installa dipendenze del progetto
echo "[2/4] Installazione dipendenze Node.js..."
npm install --omit=dev

# 3. Crea directory per cache e output STL
echo "[3/4] Verifica cartelle operative..."
mkdir -p cache output

# 4. Configurazione PM2 per avvio automatico all'avvio del container
echo "[4/4] Configurazione PM2 process manager..."
npm install -g pm2
pm2 delete lalosch 2>/dev/null || true
pm2 start server.js --name "lalosch"
pm2 save

echo ""
echo "============================================================"
echo "  LaLosch installato e avviato con successo!"
echo "  Porta attiva: 3000"
echo "  Comandi utili:"
echo "    pm2 status          (mostra lo stato dell'app)"
echo "    pm2 logs lalosch    (visualizza i log in tempo reale)"
echo "    pm2 restart lalosch (riavvia l'app)"
echo "============================================================"
