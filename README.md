# LaLosch — 3D STL Lamp Generator

Web application interattiva e generatore CAD/STL per lampade asimmetriche bicolore personalizzate con lettere sagomate, diffuse con faretto IKEA KAPPLAKE.

---

## 🚀 Requisiti

* **Node.js** >= 18.0.0
* **npm** >= 9.0.0
* Connessione Internet attiva (per il primo calcolo dei modelli geometrici booleani)

---

## 📦 Pubblicazione su GitHub (dal tuo PC locale)

Se non hai ancora inizializzato il repository Git locale:

```bash
# 1. Inizializza il repository
git init

# 2. Aggiungi tutti i file puliti (escluse cache pesanti e STL di test)
git add .

# 3. Effettua il primo commit
git commit -m "feat: LaLosch 3D Webapp production package"

# 4. Collega il tuo repository remoto GitHub (sostituisci con il tuo URL)
git branch -M main
git remote add origin https://github.com/TUO_UTENTE/TUO_REPO.git

# 5. Carica su GitHub
git push -u origin main
```

---

## 🏔️ Installazione su Alpine Linux (Proxmox LXC)

### 1. Creazione del Container su Proxmox VE
* **Tipo**: CT (LXC Container)
* **Template**: `alpine-3.20-default` (o versione più recente)
* **Risorse consigliate**:
  * Core: 1 vCPU
  * RAM: 512 MB
  * Swap: 512 MB
  * Disco: 2 GB – 4 GB
* **Rete**: DHCP oppure IP statico (es. `192.168.1.150/24`), Gateway e DNS funzionanti.

### 2. Primo setup nel Container Alpine
Accedi alla shell del container su Proxmox ed esegui:

```sh
# Scarica il repository da GitHub
mkdir -p /opt/lalosch
cd /opt/lalosch
git clone https://github.com/TUO_UTENTE/TUO_REPO.git .

# Rendi eseguibile lo script di configurazione automatica
chmod +x setup-alpine.sh

# Esegui l'installazione automatica
./setup-alpine.sh
```

Lo script installerà Node.js, configurerà PM2 e avvierà l'app automaticamente.

### 3. Aggiornamenti successivi con `git pull`
Quando apporti modifiche e fai `push` su GitHub, per aggiornare il container su Proxmox ti basterà fare:

```sh
cd /opt/lalosch
git pull origin main
pm2 restart lalosch
```

---

## 🐳 Alternativa con Docker / Docker Compose

Se preferisci eseguire l'app tramite Docker (su VM o LXC abilitato a Docker):

```bash
# Avvio con Docker Compose in background
docker compose up -d --build

# Controllo dei log
docker compose logs -f

# Aggiornamento da GitHub
git pull origin main
docker compose up -d --build
```

---

## 🌐 Accesso alla Webapp

Una volta avviato il server, la webapp è accessibile da qualsiasi browser nella tua rete locale:

```
http://<IP_CONTAINER_PROXMOX>:3000/
```

---

## 🛠️ CLI per generazione rapida da terminale

Puoi generare file STL direttamente da riga di comando senza aprire il browser:

```bash
node generate-stl.js -c MO -t TRI -b NE -e right -o ./output
```
