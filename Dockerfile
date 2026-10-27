# Immagine Alpine Linux minimale e leggera (~130 MB)
FROM node:20-alpine

# Imposta la directory di lavoro nel container
WORKDIR /app

# Copia i file di dipendenze per sfruttare il layer caching di Docker
COPY package*.json ./

# Installa solo le dipendenze di produzione
RUN npm install --omit=dev

# Copia il codice sorgente dell'applicazione
COPY . .

# Crea le cartelle necessarie per cache e output
RUN mkdir -p /app/cache /app/output

# Esponi la porta del server
EXPOSE 3000

# Variabili d'ambiente predefinite
ENV PORT=3000
ENV NODE_ENV=production

# Comando di avvio del server
CMD ["node", "server.js"]
